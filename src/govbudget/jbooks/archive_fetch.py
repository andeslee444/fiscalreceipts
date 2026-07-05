"""Internet-Archive fetch adapter for Phase 5G Army + Air Force / Space Force
service J-books.

The Army (asafm.army.mil, Akamai WAF) and Air Force / Space Force
(saffm.hq.af.mil, CAC-gated) budget sites block server-side clients — even a
real headless browser is 403'd on Army (5G probe). But the Internet Archive
mirrors their **public** FY2026 justification books WAF-free. Fetching a public
archive of public records is a legitimate transport, not evasion: the
authoritative provenance recorded downstream is always the ORIGINAL official
government URL; the Wayback URL is only how the bytes were retrieved.

Transport facts (verified live 2026-07-05), pinned by test_archive_fetch.py:
  * Raw bytes: `https://web.archive.org/web/<TS>id_/<ORIGINAL_URL>` returns the
    byte-identical original PDF (retains the embedded .zzz jb-2009 XML). The
    `id_` suffix is critical — without it Wayback returns a rewritten HTML
    wrapper.
  * Availability API (`/wayback/available`) is FLAKY: it returns {} for URLs
    that CDX confirms are archived. So it is only a fast first try; the
    authoritative enumeration is the CDX server.
  * Not every snapshot yields raw PDF bytes — some `id_` fetches return the
    Wayback HTML interstitial. The downloader validates the %PDF magic and
    falls through to the next snapshot; if none is a real PDF it raises
    (recorded as a gap by the caller, never a silent bad payload).

Pure/transport split (same discipline as service_fetch.py): the URL/JSON/CDX
parsing is unit-tested via httpx.MockTransport; only real network I/O
(build_client's live client) is exercised by the live backfill run.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

WAYBACK_HOST = "https://web.archive.org"
AVAILABILITY_API = "http://archive.org/wayback/available"
CDX_API = "http://web.archive.org/cdx/search/cdx"

# A realistic desktop UA — the Internet Archive serves everyone, but a normal
# UA avoids any generic bot throttle and is honest about what we are.
ARCHIVE_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class ArchiveFetchError(RuntimeError):
    """No usable (real-PDF) Wayback snapshot could be fetched for a URL."""


@dataclass(frozen=True)
class Snapshot:
    original: str
    timestamp: str  # 14-digit Wayback timestamp


@dataclass(frozen=True)
class DownloadResult:
    original_url: str            # authoritative provenance (official gov URL)
    wayback_url: str             # transport provenance (how bytes were fetched)
    snapshot_timestamp: str
    sha256: str
    bytes: int
    resumed: bool = False        # True => already on disk, no network touched


def build_client(*, timeout: float = 240.0) -> httpx.Client:
    """A live httpx client for the Internet Archive. Follows redirects (the
    raw id_ endpoint 3xx-chains to the stored capture)."""
    return httpx.Client(
        headers={"User-Agent": ARCHIVE_UA},
        follow_redirects=True,
        timeout=timeout,
    )


def canonical_url(url: str) -> str:
    """Strip the query string and fragment: DNN emits `?ver=...` variants of
    the same logical PDF, and the archived original is keyed by path."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def raw_wayback_url(timestamp: str, original_url: str) -> str:
    """Construct the raw-bytes `id_` Wayback URL for a snapshot."""
    if not timestamp:
        raise ValueError("timestamp is required to build a wayback raw URL")
    return f"{WAYBACK_HOST}/web/{timestamp}id_/{original_url}"


def is_pdf_bytes(data: bytes) -> bool:
    """True iff the payload begins with the PDF magic. Guards against the
    Wayback HTML interstitial that some snapshots return."""
    return data[:5] == b"%PDF-"


def is_complete_pdf(data: bytes) -> bool:
    """True iff the payload is a PDF that both starts with the magic AND ends
    with the `%%EOF` trailer. Wayback occasionally returns a body that begins
    with a valid PDF header but was truncated mid-stream (the download then
    fails downstream with pypdf's 'Stream has ended unexpectedly'); a complete
    PDF always carries `%%EOF` in its final bytes. This lets the downloader
    treat a truncated snapshot as unusable and fall through to the next one."""
    if not is_pdf_bytes(data):
        return False
    # %%EOF may be followed by a newline / a few trailing bytes; scan the tail.
    return b"%%EOF" in data[-2048:]


def cdx_snapshots(client: httpx.Client, original_url: str) -> list[Snapshot]:
    """Every status-200 application/pdf capture of an EXACT url, oldest first.

    httpx encodes the params, so spaces and `&` in the filename never reach the
    wire literally (a raw literal space 400s the CDX server)."""
    params = {
        "url": original_url,
        "output": "text",
        "fl": "original,timestamp,statuscode,mimetype",
        "filter": ["statuscode:200", "mimetype:application/pdf"],
        "collapse": "digest",
    }
    r = client.get(CDX_API, params=params)
    r.raise_for_status()
    snaps: list[Snapshot] = []
    for line in r.text.splitlines():
        parts = line.split(" ")
        if len(parts) < 2:
            continue
        original, timestamp = parts[0], parts[1]
        snaps.append(Snapshot(original=original, timestamp=timestamp))
    return snaps


def _availability_snapshot(client: httpx.Client, original_url: str) -> Snapshot | None:
    """Fast first try. Returns None on empty/malformed (the common flaky case)."""
    try:
        r = client.get(AVAILABILITY_API, params={"url": original_url})
        r.raise_for_status()
        closest = r.json().get("archived_snapshots", {}).get("closest")
    except (httpx.HTTPError, ValueError):
        return None
    if not closest or not closest.get("available") or closest.get("status") != "200":
        return None
    ts = closest.get("timestamp")
    return Snapshot(original=original_url, timestamp=ts) if ts else None


def snapshots_for(client: httpx.Client, original_url: str) -> list[Snapshot]:
    """All candidate snapshots for a URL, best (availability) first, then the
    full CDX list. De-duplicated on timestamp, availability pick kept first."""
    ordered: list[Snapshot] = []
    seen: set[str] = set()
    avail = _availability_snapshot(client, original_url)
    if avail is not None:
        ordered.append(avail)
        seen.add(avail.timestamp)
    # CDX is the authoritative fallback, but if it's transiently down (503/404)
    # and availability already gave us a snapshot, don't let that fail the
    # lookup — the availability pick is enough. Only when we have nothing does a
    # CDX error propagate.
    try:
        cdx = cdx_snapshots(client, original_url)
    except httpx.HTTPError:
        if ordered:
            return ordered
        raise
    for s in cdx:
        if s.timestamp not in seen:
            ordered.append(s)
            seen.add(s.timestamp)
    # Last resort: some books were ONLY archived with a DNN `?ver=...` query
    # variant, so the canonical (stripped) URL has zero exact snapshots (AF RDTE
    # Vol I). Fall back to a prefix search for archived variants of this exact
    # path and adopt their snapshots (each carries its own `original`, so the
    # download fetches the variant URL that actually exists).
    if not ordered:
        ordered.extend(variant_snapshots(client, original_url))
    return ordered


def variant_snapshots(client: httpx.Client, original_url: str) -> list[Snapshot]:
    """Snapshots of `?...`-query variants of an exact canonical path.

    Only variants whose canonical (query-stripped) form equals `original_url`
    qualify — a prefix match must not pull in a different file that merely
    shares a name prefix. Oldest first."""
    params = {
        "url": original_url + "*",
        "output": "text",
        "fl": "original,timestamp,statuscode,mimetype",
        "filter": ["statuscode:200", "mimetype:application/pdf"],
        "collapse": "digest",
    }
    r = client.get(CDX_API, params=params)
    r.raise_for_status()
    out: list[Snapshot] = []
    seen_ts: set[str] = set()
    for line in r.text.splitlines():
        parts = line.split(" ")
        if len(parts) < 2:
            continue
        original, timestamp = parts[0], parts[1]
        if canonical_url(original) != original_url or timestamp in seen_ts:
            continue
        seen_ts.add(timestamp)
        out.append(Snapshot(original=original, timestamp=timestamp))
    return out


def archive_snapshot_url(client: httpx.Client, original_url: str) -> str | None:
    """The raw `id_` URL of the best snapshot, or None if never archived.

    Availability API first (fast), CDX fallback (authoritative — the
    availability API returns {} for URLs CDX confirms are archived)."""
    snaps = snapshots_for(client, original_url)
    if not snaps:
        return None
    return raw_wayback_url(snaps[0].timestamp, snaps[0].original)


def download_via_archive(
    client: httpx.Client,
    original_url: str,
    dest: Path,
    *,
    throttle_s: float = 3.0,
    max_snapshots: int = 8,
    log=lambda *_: None,
) -> DownloadResult:
    """Fetch a PDF through the Internet Archive, verified and resume-safe.

    Tries each candidate snapshot (availability pick, then CDX list) until one
    returns real PDF bytes (%PDF magic). Verifies sha256 + size, writes atomically
    to `dest`. Resume: if `dest` already exists, returns its digest without
    touching the network. Raises ArchiveFetchError if the URL was never archived
    or every snapshot is an HTML interstitial (the caller records that as a gap).
    """
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        data = dest.read_bytes()
        # Resume only if the on-disk file is a COMPLETE PDF. A truncated resume
        # (Wayback occasionally caps a body at a 5 MB boundary) would otherwise
        # be returned forever and fail extraction on every run — re-download.
        if is_complete_pdf(data):
            return DownloadResult(
                original_url=original_url,
                wayback_url="",
                snapshot_timestamp="",
                sha256=hashlib.sha256(data).hexdigest(),
                bytes=len(data),
                resumed=True,
            )

    snaps = snapshots_for(client, original_url)
    if not snaps:
        raise ArchiveFetchError(f"no Wayback snapshot archived for {original_url}")

    last_reason = "no snapshot returned PDF bytes"
    for i, snap in enumerate(snaps[:max_snapshots]):
        # snap.original is the exact archived URL — usually == original_url, but
        # for variant-only books it is the `?ver=...` form that actually exists.
        wb = raw_wayback_url(snap.timestamp, snap.original)
        try:
            resp = client.get(wb)
        except httpx.HTTPError as e:  # noqa: BLE001
            last_reason = f"{type(e).__name__}: {e}"
            log(f"[archive] snapshot {snap.timestamp}: {last_reason}")
            continue
        if resp.status_code >= 400:
            last_reason = f"HTTP {resp.status_code}"
            log(f"[archive] snapshot {snap.timestamp}: {last_reason}")
            continue
        data = resp.content
        if not is_pdf_bytes(data):
            last_reason = "snapshot returned an HTML interstitial, not a PDF"
            log(f"[archive] snapshot {snap.timestamp}: {last_reason}")
            if throttle_s and i < len(snaps) - 1:
                time.sleep(throttle_s)
            continue
        if not is_complete_pdf(data):
            last_reason = "snapshot PDF was truncated (no %%EOF trailer)"
            log(f"[archive] snapshot {snap.timestamp}: {last_reason}")
            if throttle_s and i < len(snaps) - 1:
                time.sleep(throttle_s)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return DownloadResult(
            original_url=original_url,
            wayback_url=wb,
            snapshot_timestamp=snap.timestamp,
            sha256=hashlib.sha256(data).hexdigest(),
            bytes=len(data),
        )
    raise ArchiveFetchError(
        f"no usable snapshot for {original_url} "
        f"({len(snaps)} tried; last: {last_reason})"
    )


def enumerate_prefix(client: httpx.Client, prefix_glob: str) -> list[str]:
    """CDX prefix sweep -> sorted, canonical (query-stripped), unique original
    URLs. `prefix_glob` is a CDX url pattern, e.g.
    'asafm.army.mil/Portals/72/Documents/BudgetMaterial/2026*'."""
    params = {
        "url": prefix_glob,
        "output": "text",
        "fl": "original,timestamp,statuscode,mimetype",
        "collapse": "urlkey",
        "filter": ["statuscode:200", "mimetype:application/pdf"],
    }
    r = client.get(CDX_API, params=params)
    r.raise_for_status()
    originals: set[str] = set()
    for line in r.text.splitlines():
        first = line.split(" ", 1)[0]
        if first:
            originals.add(canonical_url(first))
    return sorted(originals)
