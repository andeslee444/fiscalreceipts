"""Unit tests for the Phase 5G Internet-Archive fetch adapter.

The Army (asafm.army.mil, Akamai) and Air Force / Space Force (saffm.hq.af.mil,
CAC) sites block server-side clients, but the Internet Archive mirrors their
public FY2026 budget books WAF-free. This module fetches those mirrored PDFs
through the Wayback raw-bytes endpoint. These tests cover the pure URL/JSON
logic against recorded fixtures via httpx.MockTransport — no live network.

Two robustness facts these tests pin (both observed live 2026-07-05):
  1. The Wayback availability API is flaky (returns {} for URLs that CDX
     confirms are archived) — so CDX enumeration is the authoritative source
     and the availability path is only a fast first try.
  2. Not every snapshot timestamp yields raw PDF bytes: some `id_` fetches
     return the Wayback HTML interstitial. The downloader MUST validate the
     %PDF magic and fall through to the next snapshot.
"""
import hashlib

import httpx
import pytest

from govbudget.jbooks import archive_fetch as af

ARMY_RDTE = (
    "https://www.asafm.army.mil/Portals/72/Documents/BudgetMaterial/2026/"
    "Discretionary%20Budget/rdte/RDTE%20-%20Vol%201%20-%20Budget%20Activity%201.pdf"
)


# --------------------------------------------------------------------------
# raw_wayback_url — the `id_` raw-bytes endpoint (retains embedded XML).
# --------------------------------------------------------------------------


def test_raw_wayback_url_inserts_id_suffix():
    url = af.raw_wayback_url("20250712062339", ARMY_RDTE)
    assert url == f"https://web.archive.org/web/20250712062339id_/{ARMY_RDTE}"
    # The id_ marker is what returns the byte-identical original (not the
    # rewritten HTML wrapper) — losing it silently degrades the payload.
    assert "id_/" in url


def test_raw_wayback_url_rejects_empty_timestamp():
    with pytest.raises(ValueError):
        af.raw_wayback_url("", ARMY_RDTE)


# --------------------------------------------------------------------------
# is_pdf_bytes — magic-byte guard against HTML interstitials.
# --------------------------------------------------------------------------


def test_is_pdf_bytes_accepts_pdf_magic():
    assert af.is_pdf_bytes(b"%PDF-1.4\n...") is True


def test_is_pdf_bytes_rejects_wayback_html_interstitial():
    assert af.is_pdf_bytes(b"<!DOCTYPE html>\n<html lang=\"en\">") is False
    assert af.is_pdf_bytes(b"") is False


# --------------------------------------------------------------------------
# cdx_snapshots — authoritative enumeration, properly encoded.
# --------------------------------------------------------------------------


def _cdx_client(rows_text: str, *, expect_pdf_filter: bool = True):
    """A MockTransport client that serves a CDX text body for the cdx path."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "/cdx/search/cdx" in request.url.path:
            # httpx must have url-encoded the spaces/&; the raw query never
            # carries a literal space.
            assert " " not in str(request.url.query)
            return httpx.Response(200, text=rows_text)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_cdx_snapshots_parses_status200_pdf_rows():
    rows = (
        f"{ARMY_RDTE} 20250712062339 200 application/pdf\n"
        f"{ARMY_RDTE} 20250731185604 200 application/pdf\n"
    )
    client = _cdx_client(rows)
    snaps = af.cdx_snapshots(client, ARMY_RDTE)
    assert [s.timestamp for s in snaps] == ["20250712062339", "20250731185604"]
    assert all(s.original == ARMY_RDTE for s in snaps)


def test_cdx_snapshots_empty_when_no_capture():
    client = _cdx_client("")
    assert af.cdx_snapshots(client, ARMY_RDTE) == []


# --------------------------------------------------------------------------
# archive_snapshot_url — availability first, CDX fallback, id_ raw URL out.
# --------------------------------------------------------------------------


def test_archive_snapshot_url_uses_availability_when_present():
    ts = "20250630180305"
    avail = {
        "archived_snapshots": {
            "closest": {
                "status": "200",
                "available": True,
                "timestamp": ts,
                "url": f"http://web.archive.org/web/{ts}/{ARMY_RDTE}",
            }
        }
    }

    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json=avail)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    url = af.archive_snapshot_url(client, ARMY_RDTE)
    assert url == f"https://web.archive.org/web/{ts}id_/{ARMY_RDTE}"


def test_archive_snapshot_url_falls_back_to_cdx_when_availability_empty():
    # This is the observed live behavior: availability returns {} but CDX has
    # the snapshot. The fallback is load-bearing, not defensive.
    ts = "20250712062339"

    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            return httpx.Response(200, text=f"{ARMY_RDTE} {ts} 200 application/pdf\n")
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    url = af.archive_snapshot_url(client, ARMY_RDTE)
    assert url == f"https://web.archive.org/web/{ts}id_/{ARMY_RDTE}"


def test_archive_snapshot_url_none_when_never_archived():
    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            return httpx.Response(200, text="")
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert af.archive_snapshot_url(client, ARMY_RDTE) is None


# --------------------------------------------------------------------------
# download_via_archive — magic-validated, multi-snapshot, sha/size verified.
# --------------------------------------------------------------------------


def test_download_via_archive_skips_html_and_takes_next_snapshot(tmp_path):
    good = b"%PDF-1.4\nreal book bytes\n" + b"x" * 100 + b"\n%%EOF\n"
    ts_html, ts_pdf = "20250712000000", "20250712062339"

    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            # earliest snapshot first (the HTML one), then the good PDF
            return httpx.Response(
                200,
                text=(
                    f"{ARMY_RDTE} {ts_html} 200 application/pdf\n"
                    f"{ARMY_RDTE} {ts_pdf} 200 application/pdf\n"
                ),
            )
        # raw id_ fetches
        if f"{ts_html}id_" in str(request.url):
            return httpx.Response(200, content=b"<!DOCTYPE html><html>nope")
        if f"{ts_pdf}id_" in str(request.url):
            return httpx.Response(200, content=good)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    dest = tmp_path / "army_rdte_ba1.pdf"
    res = af.download_via_archive(client, ARMY_RDTE, dest, throttle_s=0)
    assert dest.read_bytes() == good
    assert res.sha256 == hashlib.sha256(good).hexdigest()
    assert res.bytes == len(good)
    assert res.snapshot_timestamp == ts_pdf
    # provenance: the authoritative source URL is the ORIGINAL, the wayback URL
    # is transport only.
    assert res.original_url == ARMY_RDTE
    assert f"{ts_pdf}id_/" in res.wayback_url


def test_download_via_archive_resume_skips_existing(tmp_path):
    good = b"%PDF-1.4\nalready here\n%%EOF\n"  # complete PDF -> real resume
    dest = tmp_path / "book.pdf"
    dest.write_bytes(good)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res = af.download_via_archive(client, ARMY_RDTE, dest, throttle_s=0)
    assert res.resumed is True
    assert res.sha256 == hashlib.sha256(good).hexdigest()
    assert calls["n"] == 0  # no network touched on resume


def test_download_via_archive_raises_when_all_snapshots_html(tmp_path):
    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            return httpx.Response(200, text=f"{ARMY_RDTE} 20250712000000 200 application/pdf\n")
        return httpx.Response(200, content=b"<!DOCTYPE html>not a pdf")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    dest = tmp_path / "book.pdf"
    with pytest.raises(af.ArchiveFetchError):
        af.download_via_archive(client, ARMY_RDTE, dest, throttle_s=0)
    assert not dest.exists()  # never leaves a bad partial


def test_download_via_archive_raises_when_never_archived(tmp_path):
    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            return httpx.Response(200, text="")
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(af.ArchiveFetchError):
        af.download_via_archive(client, ARMY_RDTE, tmp_path / "x.pdf", throttle_s=0)


# --------------------------------------------------------------------------
# enumerate_prefix — CDX prefix sweep -> canonical (query-stripped) originals.
# --------------------------------------------------------------------------


def test_enumerate_prefix_dedups_query_variants_to_canonical():
    # DNN emits ?ver=... variants of the same logical file; enumeration must
    # collapse them to one canonical original URL.
    base = "https://www.saffm.hq.af.mil/Portals/84/documents/FY26/FY26%20Air%20Force%20Missile%20Procurement.pdf"
    rows = (
        f"{base} 20250701000000 200 application/pdf\n"
        f"{base}?ver=abc 20250702000000 200 application/pdf\n"
        f"{base}?ver=def%3D%3D 20250703000000 200 application/pdf\n"
    )
    client = _cdx_client(rows)
    originals = af.enumerate_prefix(client, "saffm.hq.af.mil/Portals/84/documents/FY26*")
    assert originals == [base]


# --------------------------------------------------------------------------
# is_complete_pdf + truncation fallthrough (Wayback returns partial bodies).
# --------------------------------------------------------------------------


def test_is_complete_pdf_requires_eof_trailer():
    assert af.is_complete_pdf(b"%PDF-1.4\nbody\n%%EOF\n") is True
    assert af.is_complete_pdf(b"%PDF-1.4\nbody with no trailer") is False
    assert af.is_complete_pdf(b"<!DOCTYPE html>") is False


def test_download_via_archive_skips_truncated_pdf(tmp_path):
    truncated = b"%PDF-1.4\nstarts fine but was cut off mid-stream"  # no %%EOF
    complete = b"%PDF-1.4\nwhole book\n" + b"y" * 100 + b"\n%%EOF\n"
    ts_bad, ts_good = "20250712000000", "20250712062339"

    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            return httpx.Response(
                200,
                text=(f"{ARMY_RDTE} {ts_bad} 200 application/pdf\n"
                      f"{ARMY_RDTE} {ts_good} 200 application/pdf\n"),
            )
        if f"{ts_bad}id_" in str(request.url):
            return httpx.Response(200, content=truncated)
        if f"{ts_good}id_" in str(request.url):
            return httpx.Response(200, content=complete)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    dest = tmp_path / "book.pdf"
    res = af.download_via_archive(client, ARMY_RDTE, dest, throttle_s=0)
    assert dest.read_bytes() == complete
    assert res.snapshot_timestamp == ts_good


def test_download_via_archive_redownloads_truncated_resume(tmp_path):
    """A truncated PDF already on disk (Wayback 5 MB-boundary cap) must NOT be
    resumed — it fails extraction forever. Re-fetch a complete snapshot."""
    truncated = b"%PDF-1.4\ncut off, no trailer"
    complete = b"%PDF-1.4\nwhole book\n" + b"z" * 50 + b"\n%%EOF\n"
    dest = tmp_path / "book.pdf"
    dest.write_bytes(truncated)  # stale truncated resume
    ts = "20251028043358"

    def handler(request):
        if "/wayback/available" in request.url.path:
            return httpx.Response(200, json={"archived_snapshots": {}})
        if "/cdx/search/cdx" in request.url.path:
            return httpx.Response(200, text=f"{ARMY_RDTE} {ts} 200 application/pdf\n")
        if f"{ts}id_" in str(request.url):
            return httpx.Response(200, content=complete)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res = af.download_via_archive(client, ARMY_RDTE, dest, throttle_s=0)
    assert res.resumed is False
    assert dest.read_bytes() == complete
