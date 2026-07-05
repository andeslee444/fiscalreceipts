"""Service J-book probe: Playwright-backed index fetch + PDF inventory.

Navy (secnav.navy.mil/fmc/fmb) sits behind a bot-WAF that returns a 244-byte
"Request Rejected" page to server-side curl; Army (asafm.army.mil) sits behind
Akamai returning 403 to the same. A real headless browser completes the
TLS+JS handshake those clients cannot. This module is the Phase 5G Task 1
probe: it fetches each service's FY2026 index page with headless Chromium and
inventories every PDF link. It does NOT download books in bulk, write the
warehouse, or touch the DB — that is Task 3+.

Split by testability:
  - Pure functions (parse_pdf_links, is_waf_block, absolute) — HTML/URL logic,
    unit-tested against recorded fixtures.
  - Live functions (fetch_rendered_html, download_pdf) — Playwright transport,
    exercised only by scripts/probe_service_jbooks.py against the real sites.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin

from selectolax.parser import HTMLParser

# Realistic desktop Chrome on macOS — the probe presents as a normal browser,
# no evasion beyond a real UA/viewport/locale (the WAF blocks non-browsers,
# not browsers; if it blocks THIS, that is a finding, not a challenge).
REALISTIC_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
VIEWPORT = {"width": 1440, "height": 900}
LOCALE = "en-US"

# FY2026 service index entry points. The listing page may be a child link of
# these; the live probe follows year links from here.
#
# Navy: the feasibility-spike URL /fmc/fmb/Pages/Pres-Budget.aspx is DEAD in
# 2026-07 — it redirects to the SECNAV homepage. The live FY2026 book listing
# is the SharePoint document library folder /fmc/fmb/Documents/26pres/ ("26pres"
# = 2026 President's budget), reached from the "Budget Materials" nav. Both are
# listed so the probe records the dead redirect and still finds the real books.
SERVICE_INDEX_URLS: dict[str, list[str]] = {
    "navy": [
        "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/",
        "https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx",
    ],
    "army": [
        "https://www.asafm.army.mil/Budget-Materials/",
    ],
}

# Signatures of the WAF rejection pages the feasibility spike recorded from
# server-side curl. If a headless browser still hits one of these, the service
# is BLOCKED — we stop, we do not escalate to stealth.
_WAF_MARKERS = (
    "request rejected",
    "the requested url was rejected",
    "access denied",
    "akamai",
    "reference #",
)


@dataclass(frozen=True)
class PdfLink:
    text: str
    href: str  # absolute


def absolute(base_url: str, href: str) -> str:
    """Resolve a possibly-relative href against the page URL."""
    return urljoin(base_url, href)


def parse_pdf_links(html: str, base_url: str) -> list[PdfLink]:
    """Every <a> whose (unquoted) absolute href ends in .pdf, de-duplicated.

    Link text is normalized to a single line; empty-text links keep the PDF
    basename as their text so the inventory is never blank.
    """
    out: list[PdfLink] = []
    seen: set[str] = set()
    for a in HTMLParser(html).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = absolute(base_url, href)
        low = unquote(url).lower().split("?")[0].split("#")[0]
        if not low.endswith(".pdf"):
            continue
        if url in seen:
            continue
        seen.add(url)
        text = " ".join((a.text() or "").split()).strip()
        if not text:
            text = unquote(url).rsplit("/", 1)[-1]
        out.append(PdfLink(text=text, href=url))
    return out


def parse_year_links(html: str, base_url: str, *, fiscal_year: int) -> list[str]:
    """Absolute hrefs of links whose text/href mentions the fiscal year.

    Service index pages are hubs: the FY2026 book listing is usually a child
    page ("FY 2026", "Budget2026", "president-s-budget-fy-2026"). This finds
    candidate drill-down links for the live probe to follow.
    """
    fy = str(fiscal_year)
    fy_short = fy[-2:]
    needles = (fy, f"fy{fy_short}", f"budget{fy}", f"pb{fy_short}", f"pb {fy}")
    out: list[str] = []
    seen: set[str] = set()
    for a in HTMLParser(html).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = absolute(base_url, href)
        hay = f"{(a.text() or '')} {unquote(url)}".lower()
        if any(n in hay for n in needles) and url not in seen:
            seen.add(url)
            out.append(url)
    return out


def is_waf_block(status: int | None, title: str, body: str) -> bool:
    """True when the response is a WAF rejection, not real content.

    A non-2xx status, or a small body containing a known rejection marker with
    no PDF links, is a block. Real index pages are large and carry PDF anchors.
    """
    if status is not None and status >= 400:
        return True
    hay = f"{title}\n{body}".lower()
    if any(m in hay for m in _WAF_MARKERS) and "<a" not in body.lower():
        return True
    # Tiny bodies with a marker are the classic 244-byte rejection page.
    if len(body) < 1500 and any(m in hay for m in _WAF_MARKERS):
        return True
    return False


def render_inventory(links: list[PdfLink]) -> str:
    """Format a PDF inventory as `text\\thref` lines for the evidence file."""
    return "\n".join(f"{ln.text}\t{ln.href}" for ln in links) + ("\n" if links else "")


# --------------------------------------------------------------------------
# Phase 5G Task 3 — acquisition adapter (pure logic).
#
# Turn a service PDF inventory into a resume-safe download plan: classify each
# link (registrable justification book vs. explicit exclusion), deduplicate the
# Navy RDTE BA-split PDFs (each embeds the SAME full master book — probe
# sample-extraction.md), and drop anything already downloaded. The live
# Playwright download that consumes the plan is a Task-4 script, not a test.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    """A registrable service J-book: a classified PdfLink ready to download."""
    name: str            # PDF basename (classifier key)
    href: str            # absolute source URL
    exhibit_family: str  # 'rdte' | 'procurement'
    org: str             # workbook org code, e.g. 'N'
    acquisition: str = "playwright"


@dataclass(frozen=True)
class DownloadPlan:
    """Resume-safe plan: what to fetch, and why the rest was left out."""
    to_download: list[Candidate]
    skipped: list[Candidate]            # already present (known URL) — resume
    deduped: list[tuple[str, str]]      # (name, reason) — RDTE BA-split dupes
    excluded: list[tuple[str, str]]     # (name, reason) — non-justification


def classify_inventory(
    links: list[PdfLink],
) -> tuple[list[Candidate], list[tuple[str, str]]]:
    """Run the J-book classifier over an inventory.

    Returns (registrable Candidates, [(name, exclusion_reason)]). Names that
    the classifier maps to (family, org) become Candidates; names pinned in any
    service exclusion map (Navy/Army/AF) are returned with their recorded
    reason. Any name the classifier neither classifies nor explicitly excludes
    is dropped silently (defensive: each service allowlist covers its full
    inventory by construction — the full-inventory partition tests guard this).
    """
    # Imported here to avoid a module-load cycle (registry imports nothing from
    # service_fetch, but keep the dependency edge one-directional and lazy).
    from govbudget.jbooks.registry import (
        AF_EXCLUSIONS,
        ARMY_EXCLUSIONS,
        NAVY_EXCLUSIONS,
        _classify_jbook,
    )

    exclusion_reasons = {**NAVY_EXCLUSIONS, **ARMY_EXCLUSIONS, **AF_EXCLUSIONS}
    registrable: list[Candidate] = []
    excluded: list[tuple[str, str]] = []
    for ln in links:
        name = unquote(ln.href).rsplit("/", 1)[-1]
        verdict = _classify_jbook(name)
        if verdict is not None:
            family, org = verdict
            registrable.append(
                Candidate(name=name, href=ln.href, exhibit_family=family, org=org)
            )
        elif name in exclusion_reasons:
            excluded.append((name, exclusion_reasons[name]))
    return registrable, excluded


_RDTE_BA = re.compile(r"(?i)_BA(\d+)")

# Families whose Navy appropriation books EACH embed the same full master XML.
# Both must dedup to one registered detail book per family: the 5 RDTEN_BA*
# volumes AND the 12 procurement appropriation books (APN/OPN/WPN/SCN/PMC/
# PANMC) were each verified live (Task 4) to embed the identical master —
# RDTE 252 PEs, procurement 135 line items (same master sha picked from every
# book by pick_book_xml). Registering all would load the same master N times
# (procurement was loaded 12× before this dedup was generalized).
_MASTER_DUP_FAMILIES = ("rdte", "procurement")


def _first_ba(name: str) -> int:
    """Lowest starting budget-activity number in a BA-split filename.

    'RDTEN_BA1-3_Book.pdf' -> 1, 'RDTEN_BA7-8_Book.pdf' -> 7,
    'APN_BA6-7_Book.pdf' -> 6. Names without a BA marker (WPN/SCN/PMC/PANMC)
    sort last (large sentinel) so a BA-numbered volume wins deterministically.
    """
    m = _RDTE_BA.search(name)
    return int(m.group(1)) if m else 10_000


def dedup_ba_splits(
    registrable: list[Candidate],
) -> tuple[list[Candidate], list[tuple[str, str]]]:
    """Collapse each master-duplicating family's BA-split PDFs to ONE book.

    Every Navy RDTE BA-split PDF embeds the SAME full 252-PE master; every
    Navy procurement appropriation PDF embeds the SAME full 135-line master
    (Task 4 live evidence). Registering all would load the identical master
    once per book. Per family, keep the candidate with the LOWEST starting
    budget activity (stable, deterministic); the rest are duplicates recorded
    for the manifest exclusion ledger.

    Families NOT in _MASTER_DUP_FAMILIES pass through untouched. Returns
    (kept, [(name, reason)]) where reason names the master-book duplication.

    NOTE: the deduped sibling PDFs are the ONLY source of their own budget
    activities' rendered R-2/R-2A/P-40 exhibit pages. Because each family is
    registered/loaded once (from the winner's PDF), page provenance can only
    locate facts whose exhibit page is rendered in the winner's PDF; the other
    BAs' facts resolve 'unresolved' (recorded honest gap) — the detail data
    is complete (the embedded master carries every fact), only the page
    highlight is missing. Cross-sibling page resolution is out of scope
    (it would require re-keying provenance to the detail sha; see the 5G
    review note).
    """
    kept: list[Candidate] = []
    deduped: list[tuple[str, str]] = []
    for family in _MASTER_DUP_FAMILIES:
        fam = [c for c in registrable if c.exhibit_family == family]
        if len(fam) <= 1:
            kept += fam
            continue
        winner = min(fam, key=lambda c: (_first_ba(c.name), c.name))
        kept.append(winner)
        deduped += [
            (c.name,
             f"BA-split {family} volume embedding the same full Navy {family}"
             f" master book as {winner.name} (registered once)")
            for c in fam if c.name != winner.name
        ]
    kept += [c for c in registrable
             if c.exhibit_family not in _MASTER_DUP_FAMILIES]
    # preserve input order for stable, diff-friendly plans
    order = {c.name: i for i, c in enumerate(registrable)}
    kept.sort(key=lambda c: order[c.name])
    deduped.sort(key=lambda nr: order[nr[0]])
    return kept, deduped


def build_download_plan(
    links: list[PdfLink], *, known_urls: set[str]
) -> DownloadPlan:
    """Full inventory -> resume-safe DownloadPlan.

    classify -> dedup BA-splits (RDTE and procurement) -> drop anything whose
    URL is already downloaded (`known_urls`, resume safety). Every candidate
    carries acquisition='playwright'.
    """
    registrable, excluded = classify_inventory(links)
    kept, deduped = dedup_ba_splits(registrable)
    to_download, skipped = [], []
    for c in kept:
        (skipped if c.href in known_urls else to_download).append(c)
    return DownloadPlan(
        to_download=to_download, skipped=skipped,
        deduped=deduped, excluded=excluded,
    )


# --------------------------------------------------------------------------
# Registration into jbook_documents. Registered rows carry the acquisition
# method; the download step (below) flips them to 'downloaded'.
# --------------------------------------------------------------------------


def known_downloaded_urls(dsn: str, *, fiscal_year: int) -> set[str]:
    """Source URLs already fetched (status='downloaded') for an edition —
    the resume-safe skip set for build_download_plan."""
    import psycopg

    with psycopg.connect(dsn) as con:
        return {
            r[0] for r in con.execute(
                "select source_url from jbook_documents"
                " where fiscal_year = %s and status = 'downloaded'",
                (fiscal_year,),
            )
        }


def register_service_documents(
    dsn: str, plan: "DownloadPlan", *, fiscal_year: int
) -> int:
    """Insert each to-download Candidate as a 'registered' jbook_documents row
    stamped acquisition='playwright'. Idempotent on source_url. Returns the
    number of new rows."""
    import psycopg

    inserted = 0
    with psycopg.connect(dsn) as con:
        for c in plan.to_download:
            cur = con.execute(
                "insert into jbook_documents (org, exhibit_family, fiscal_year,"
                " title, source_url, status, acquisition)"
                " values (%s,%s,%s,%s,%s,'registered','playwright')"
                " on conflict (source_url) do nothing",
                (c.org, c.exhibit_family, fiscal_year, c.name, c.href),
            )
            inserted += cur.rowcount
    return inserted


def register_local_documents(
    dsn: str, drop_dir, *, fiscal_year: int, source_url: str
) -> tuple[int, list[str]]:
    """Register operator-dropped PDFs (Army / Air Force manual path).

    Every *.pdf in `drop_dir` the classifier can place is inserted as a
    'registered' row with acquisition='manual' and the operator-supplied
    `source_url`. Files the classifier cannot place are reported (not
    registered) so the operator sees exactly what was skipped. Idempotent on
    source_url per file — the URL carries the basename as a fragment so
    multiple files sharing one operator URL stay distinct. Returns
    (registered_count, skipped_basenames)."""
    import psycopg

    from govbudget.jbooks.registry import _classify_jbook

    drop = Path(drop_dir)
    pdfs = sorted(p for p in drop.iterdir() if p.suffix.lower() == ".pdf")
    inserted, skipped = 0, []
    with psycopg.connect(dsn) as con:
        for p in pdfs:
            verdict = _classify_jbook(p.name)
            if verdict is None:
                skipped.append(p.name)
                continue
            family, org = verdict
            # one operator URL can cover a whole drop-dir; disambiguate per
            # file with a fragment so the unique(source_url) constraint holds.
            per_file_url = f"{source_url}#{p.name}"
            cur = con.execute(
                "insert into jbook_documents (org, exhibit_family, fiscal_year,"
                " title, source_url, file_path, status, acquisition)"
                " values (%s,%s,%s,%s,%s,%s,'registered','manual')"
                " on conflict (source_url) do nothing",
                (org, family, fiscal_year, p.name, per_file_url, str(p)),
            )
            inserted += cur.rowcount
    return inserted, skipped


# --------------------------------------------------------------------------
# Phase 5G (archive round) — master-identity dedup at LOAD time.
#
# The Navy plan-time dedup_ba_splits collapsed by filename heuristic. That does
# not generalize to Army/AF: Army RDTE volumes are genuinely BA-split (each
# embeds ONLY its own budget activities — distinct masters, must all load),
# while AF RDTE Vol I-IV embed the IDENTICAL master and AF Aircraft Procurement
# Vol I/II embed the identical master (verified live 2026-07-05). The correct,
# universal rule is EMPIRICAL: group downloaded books by the content sha256 of
# the master XML pick_book_xml selects, and keep exactly one per identical
# master. This keeps Army's 13 distinct RDTE volumes AND the distinct AF-vs-SF
# masters (same org 'F', same family, but different master content) while
# collapsing the true duplicates. Non-destructive (flips duplicates to
# status='superseded' and supersedes their details) and idempotent.
# --------------------------------------------------------------------------


def _picked_master_sha(file_path: str, family: str) -> str | None:
    """sha256 of the master XML pick_book_xml selects for a downloaded doc, or
    None if no XML is on disk (the book had no embedded master)."""
    import hashlib

    from govbudget.jbooks.attachments import pick_book_xml

    xml_dir = Path(file_path).parent / "xml"
    book = pick_book_xml(xml_dir, family=family)
    if book is None or not book.exists():
        return None
    return hashlib.sha256(book.read_bytes()).hexdigest()


def dedup_service_master_dups(
    dsn: str, *, fiscal_year: int, org: str, log=print
) -> list[tuple[str, str]]:
    """Collapse downloaded books that embed a byte-identical master XML.

    Groups this edition+org's downloaded, XML-bearing documents by
    (exhibit_family, master-XML sha256). For each group with more than one book,
    keeps the lowest-title document and flips every other to status='superseded'
    (marking its details/narratives superseded too — the same non-destructive,
    reversible terminal state the Navy round used). Returns [(superseded_title,
    kept_title)]. Idempotent: already-superseded rows are not re-selected.

    Books with no embedded master (sha None) are left alone — they are handled
    as extraction gaps elsewhere, never silently dropped.
    """
    import psycopg

    with psycopg.connect(dsn) as con:
        rows = con.execute(
            "select id, title, exhibit_family, file_path from jbook_documents"
            " where fiscal_year=%s and org=%s and status='downloaded'"
            " and has_embedded_xml and file_path is not null"
            " order by title",
            (fiscal_year, org),
        ).fetchall()

        groups: dict[tuple[str, str], list[tuple[int, str]]] = {}
        for doc_id, title, family, file_path in rows:
            sha = _picked_master_sha(file_path, family)
            if sha is None:
                continue
            groups.setdefault((family, sha), []).append((doc_id, title))

        superseded: list[tuple[str, str]] = []
        for (family, _sha), members in groups.items():
            if len(members) <= 1:
                continue
            members.sort(key=lambda m: m[1])  # lowest title wins (stable)
            keep_id, keep_title = members[0]
            for dup_id, dup_title in members[1:]:
                con.execute(
                    "update budget_line_details set superseded=true where document_id=%s",
                    (dup_id,),
                )
                con.execute(
                    "update detail_narratives set superseded=true where document_id=%s",
                    (dup_id,),
                )
                con.execute(
                    "update jbook_documents set status='superseded' where id=%s",
                    (dup_id,),
                )
                superseded.append((dup_title, keep_title))
                log(f"[dedup] superseded {dup_title!r} (same master as {keep_title!r})")
    return superseded


# --------------------------------------------------------------------------
# Live transport (Playwright). Not unit-tested; driven by the probe script.
# --------------------------------------------------------------------------


@dataclass
class FetchResult:
    url: str
    status: int | None
    title: str
    body_html: str


def fetch_rendered_html(page, url: str, *, wait_ms: int = 1500) -> FetchResult:
    """Navigate a Playwright page to url, wait for network idle, return HTML.

    `page` is a playwright.sync_api.Page. Kept parameterized so the probe
    script owns browser lifecycle (one browser, one page at a time — polite).
    """
    resp = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    try:
        page.wait_for_load_state("networkidle", timeout=20_000)
    except Exception:
        pass  # some pages keep long-poll sockets open; DOM is already settled
    page.wait_for_timeout(wait_ms)
    return FetchResult(
        url=url,
        status=(resp.status if resp is not None else None),
        title=page.title(),
        body_html=page.content(),
    )


def download_pdf(context, url: str, dest: Path) -> tuple[str, int]:
    """Download one PDF via the browser context's request API. Returns (sha256, bytes).

    Uses the SAME authenticated browser context that passed the WAF, so the
    request carries the browser's TLS fingerprint and cookies. Bounded to the
    Task 1 sample: the caller downloads exactly one book per reachable service.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    resp = context.request.get(url, timeout=180_000)
    if resp.status >= 400:
        raise RuntimeError(f"HTTP {resp.status} fetching {url}")
    data = resp.body()
    dest.write_bytes(data)
    return hashlib.sha256(data).hexdigest(), len(data)


def download_registered_playwright(
    context,
    dsn: str,
    *,
    raw_docs_dir: Path,
    fiscal_year: int,
    min_free_gb: float,
    throttle_s: float = 3.0,
    log=print,
) -> tuple[int, list[tuple[int, str, str]]]:
    """Download every registered playwright document for an edition (Task 4).

    The service equivalent of acquire.acquire_pending, but fetching through the
    SAME browser context that cleared the WAF (httpx cannot). Per document:
    sha256 + byte-count verification (download_pdf), embedded-XML extraction,
    row flip to status='downloaded'. Resume-safe — only 'registered' rows are
    touched, so a re-run after a crash skips what already landed. Polite:
    `throttle_s` (2-4s) between fetches. Per-document failures mark the row
    'failed' and continue (no aborted sweep). Returns (downloaded, failures).

    NOT unit-tested: the network fetch is exercised only by the Task-4 live run
    (scripts/probe_service_jbooks.py owns the browser lifecycle). The pure plan
    logic it depends on is covered in test_service_fetch.py.
    """
    import datetime as dt
    import time

    import psycopg

    from govbudget.download import ensure_free_space
    from govbudget.jbooks.attachments import extract_jbook_xml

    with psycopg.connect(dsn) as con:
        pending = con.execute(
            "select id, org, fiscal_year, title, source_url from jbook_documents"
            " where status='registered' and acquisition='playwright'"
            " and fiscal_year=%s order by id",
            (fiscal_year,),
        ).fetchall()

    done = 0
    failures: list[tuple[int, str, str]] = []
    for i, (doc_id, org, fy, title, url) in enumerate(pending):
        dest = raw_docs_dir / f"fy{fy}" / org.lower() / title
        try:
            ensure_free_space(dest.parent, min_free_gb)
            log(f"[service-acquire] GET {title} ({url})")
            sha, n = download_pdf(context, url, dest)
            xmls = extract_jbook_xml(dest, dest.parent / "xml")
            has_xml = bool(xmls)
        except Exception as e:  # noqa: BLE001
            failures.append((doc_id, title, f"{type(e).__name__}: {e}"))
            with psycopg.connect(dsn) as con:
                con.execute(
                    "update jbook_documents set status='failed' where id=%s",
                    (doc_id,),
                )
            log(f"[service-acquire] FAILED {title}: {type(e).__name__}: {e}")
            continue
        with psycopg.connect(dsn) as con:
            con.execute(
                "update jbook_documents set status='downloaded', file_path=%s,"
                " sha256=%s, bytes=%s, downloaded_at=%s, has_embedded_xml=%s"
                " where id=%s",
                (str(dest), sha, n, dt.datetime.now(dt.UTC), has_xml, doc_id),
            )
        done += 1
        log(f"[service-acquire] {title}: {n:,} bytes sha={sha[:16]}… xml={has_xml}")
        if i < len(pending) - 1:
            time.sleep(throttle_s)
    return done, failures
