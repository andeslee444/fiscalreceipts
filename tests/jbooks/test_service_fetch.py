"""Unit tests for the Phase 5G service-probe pure functions.

Live Playwright fetch is a script, not a test (scripts/probe_service_jbooks.py).
These cover the HTML/URL parsing and WAF-detection logic against recorded
fixtures modeled on the real service sites (SharePoint-style relative hrefs,
Akamai/BIG-IP rejection pages).
"""
from govbudget.jbooks.service_fetch import (
    PdfLink,
    absolute,
    is_waf_block,
    parse_pdf_links,
    parse_year_links,
    render_inventory,
)

# Navy FMB pages are ASP.NET/SharePoint: relative hrefs off the /fmc/fmb root.
NAVY_LISTING_HTML = """
<html><head><title>Department of the Navy FY2026 Budget</title></head><body>
<div id="content">
  <a href="/fmc/fmb/Documents/26pres/RDTN_BA1-4_book.pdf">RDT&amp;N BA 1-4</a>
  <a href="../Documents/26pres/RDTN_BA5_book.pdf">RDT&amp;N BA5-7</a>
  <a href="https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/PROC_APN_book.pdf">Aircraft Procurement Navy</a>
  <a href="/fmc/fmb/Documents/26pres/RDTN_BA1-4_book.pdf">dup link, same href</a>
  <a href="/fmc/fmb/Pages/Pres-Budget.aspx">Back to budget home</a>
  <a href="/fmc/fmb/Documents/26pres/overview.PDF"></a>
</div>
</body></html>
"""

NAVY_HUB_HTML = """
<html><body>
  <a href="/fmc/fmb/Pages/Fiscal-Year-2026.aspx">Fiscal Year 2026</a>
  <a href="/fmc/fmb/Pages/Fiscal-Year-2025.aspx">Fiscal Year 2025</a>
  <a href="/fmc/fmb/Pages/about.aspx">About FMB</a>
</body></html>
"""

# Akamai/BIG-IP style rejection page (what curl got in the feasibility spike).
WAF_REJECT_HTML = (
    "<html><head><title>Request Rejected</title></head><body>"
    "The requested URL was rejected. Please consult with your administrator."
    "<br><br>Your support ID is: 1234567890123456789<br></body></html>"
)


def test_absolute_resolves_relative_and_parent_and_abs():
    base = "https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx"
    assert absolute(base, "/fmc/fmb/x.pdf") == "https://www.secnav.navy.mil/fmc/fmb/x.pdf"
    assert (
        absolute(base, "../Documents/y.pdf")
        == "https://www.secnav.navy.mil/fmc/fmb/Documents/y.pdf"
    )
    already = "https://www.secnav.navy.mil/fmc/fmb/z.pdf"
    assert absolute(base, already) == already


def test_parse_pdf_links_collects_absolute_dedupes_and_names_empty():
    base = "https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx"
    links = parse_pdf_links(NAVY_LISTING_HTML, base)
    hrefs = [ln.href for ln in links]
    # three distinct PDFs + one uppercase .PDF; the dup href collapses.
    assert hrefs == [
        "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/RDTN_BA1-4_book.pdf",
        "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/RDTN_BA5_book.pdf",
        "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/PROC_APN_book.pdf",
        "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/overview.PDF",
    ]
    # the .aspx nav link is excluded
    assert all(not h.lower().endswith(".aspx") for h in hrefs)
    # empty-text link falls back to the basename
    overview = [ln for ln in links if ln.href.endswith("overview.PDF")][0]
    assert overview.text == "overview.PDF"
    # entity-decoded, whitespace-normalized text
    first = links[0]
    assert first.text == "RDT&N BA 1-4"


def test_parse_pdf_links_empty_when_no_pdfs():
    assert parse_pdf_links(NAVY_HUB_HTML, "https://www.secnav.navy.mil/") == []


def test_parse_year_links_finds_the_fy2026_hub_child():
    base = "https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx"
    yr = parse_year_links(NAVY_HUB_HTML, base, fiscal_year=2026)
    assert yr == ["https://www.secnav.navy.mil/fmc/fmb/Pages/Fiscal-Year-2026.aspx"]
    # FY2025 and About are not FY2026 candidates
    assert all("2026" in u for u in yr)


def test_is_waf_block_detects_rejection_page():
    assert is_waf_block(200, "Request Rejected", WAF_REJECT_HTML) is True


def test_is_waf_block_detects_403_status():
    assert is_waf_block(403, "Forbidden", "<html><a href='x'>content</a></html>") is True


def test_is_waf_block_passes_real_listing():
    assert (
        is_waf_block(200, "Department of the Navy FY2026 Budget", NAVY_LISTING_HTML)
        is False
    )


def test_render_inventory_tab_separated():
    links = [
        PdfLink(text="A", href="https://x/a.pdf"),
        PdfLink(text="B", href="https://x/b.pdf"),
    ]
    assert render_inventory(links) == "A\thttps://x/a.pdf\nB\thttps://x/b.pdf\n"
    assert render_inventory([]) == ""


# --------------------------------------------------------------------------
# Phase 5G Task 3 — acquisition adapter pure logic (download plan + dedup).
# The live Playwright download is exercised in Task 4 (a script, not a test);
# here we test the inventory -> plan and RDTE dedup selection deterministically.
# --------------------------------------------------------------------------

NAVY_BASE = "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres"


def _navy_links(*names):
    return [PdfLink(text=n[:-4], href=f"{NAVY_BASE}/{n}") for n in names]


def test_classify_inventory_partitions_navy():
    from govbudget.jbooks.service_fetch import classify_inventory

    links = _navy_links(
        "RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf",
        "OMN_Book.pdf", "BRAC_Book.pdf",
    )
    reg, excluded = classify_inventory(links)
    names = {c.name: (c.exhibit_family, c.org) for c in reg}
    assert names == {
        "RDTEN_BA1-3_Book.pdf": ("rdte", "N"),
        "APN_BA5_Book.pdf": ("procurement", "N"),
    }
    ex = {name: reason for name, reason in excluded}
    assert set(ex) == {"OMN_Book.pdf", "BRAC_Book.pdf"}
    assert "Operation & Maintenance" in ex["OMN_Book.pdf"]
    assert "not R/D" in ex["BRAC_Book.pdf"]


def test_dedup_ba_splits_keeps_lowest_ba_per_family():
    from govbudget.jbooks.service_fetch import (
        classify_inventory,
        dedup_ba_splits,
    )

    reg, _ = classify_inventory(_navy_links(
        "RDTEN_BA7-8_Book.pdf", "RDTEN_BA4_Book.pdf", "RDTEN_BA1-3_Book.pdf",
        "RDTEN_BA6_Book.pdf", "RDTEN_BA5_Book.pdf",
        # procurement books ALSO each embed the same full master (Task 4 live
        # evidence) — they dedup too, to one book (lowest BA: APN_BA1-4).
        "APN_BA1-4_Book.pdf", "APN_BA5_Book.pdf", "OPN_BA2_Book.pdf",
        "WPN_Book.pdf", "SCN_Book.pdf",
    ))
    kept, deduped = dedup_ba_splits(reg)
    kept_names = {c.name for c in kept}
    # exactly ONE book per master-duplicating family survives.
    assert kept_names == {"RDTEN_BA1-3_Book.pdf", "APN_BA1-4_Book.pdf"}
    assert sum(1 for c in kept if c.exhibit_family == "rdte") == 1
    assert sum(1 for c in kept if c.exhibit_family == "procurement") == 1
    deduped_names = {name for name, _ in deduped}
    assert deduped_names == {
        "RDTEN_BA4_Book.pdf", "RDTEN_BA5_Book.pdf",
        "RDTEN_BA6_Book.pdf", "RDTEN_BA7-8_Book.pdf",
        "APN_BA5_Book.pdf", "OPN_BA2_Book.pdf",
        "WPN_Book.pdf", "SCN_Book.pdf",
    }
    for _, reason in deduped:
        assert "master" in reason.lower()


def test_dedup_single_book_per_family_keeps_it():
    """One candidate in each master-duplicating family means nothing to dedup."""
    from govbudget.jbooks.service_fetch import (
        classify_inventory,
        dedup_ba_splits,
    )

    reg, _ = classify_inventory(_navy_links("RDTEN_BA5_Book.pdf", "SCN_Book.pdf"))
    kept, deduped = dedup_ba_splits(reg)
    # one RDTE + one procurement, nothing to collapse.
    assert {c.name for c in kept} == {"RDTEN_BA5_Book.pdf", "SCN_Book.pdf"}
    assert deduped == []


def test_build_download_plan_dedups_and_skips_known_shas():
    """The full plan: classify -> dedup -> resume-safe skip of already-present
    shas. Returns (to_download, deduped, excluded)."""
    from govbudget.jbooks.service_fetch import build_download_plan

    links = _navy_links(
        "RDTEN_BA1-3_Book.pdf", "RDTEN_BA4_Book.pdf",  # dedup -> keep BA1-3
        "APN_BA5_Book.pdf",                             # keep
        "OMN_Book.pdf",                                 # exclude
    )
    plan = build_download_plan(links, known_urls=set())
    assert {c.name for c in plan.to_download} == {
        "RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf"
    }
    assert {n for n, _ in plan.deduped} == {"RDTEN_BA4_Book.pdf"}
    assert {n for n, _ in plan.excluded} == {"OMN_Book.pdf"}
    for c in plan.to_download:
        assert c.acquisition == "playwright"

    # resume-safe: a URL already downloaded is not re-planned.
    already = {f"{NAVY_BASE}/APN_BA5_Book.pdf"}
    plan2 = build_download_plan(links, known_urls=already)
    assert {c.name for c in plan2.to_download} == {"RDTEN_BA1-3_Book.pdf"}
    assert {c.name for c in plan2.skipped} == {"APN_BA5_Book.pdf"}


# --------------------------------------------------------------------------
# Phase 5G Task 3 — registration into jbook_documents (DB-backed, no network).
# --------------------------------------------------------------------------


def test_register_service_documents_marks_playwright_and_registered(pg_dsn):
    import psycopg

    from govbudget.jbooks.service_fetch import (
        build_download_plan,
        register_service_documents,
    )

    links = _navy_links(
        "RDTEN_BA1-3_Book.pdf", "RDTEN_BA4_Book.pdf",  # dedup
        "APN_BA5_Book.pdf", "OMN_Book.pdf",            # excl
    )
    plan = build_download_plan(links, known_urls=set())
    n = register_service_documents(pg_dsn, plan, fiscal_year=2026)
    assert n == 2
    with psycopg.connect(pg_dsn) as con:
        rows = {
            r[0]: r for r in con.execute(
                "select title, org, exhibit_family, fiscal_year, status,"
                " acquisition from jbook_documents order by title"
            )
        }
    assert set(rows) == {"RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf"}
    for r in rows.values():
        assert r[1] == "N" and r[3] == 2026
        assert r[4] == "registered" and r[5] == "playwright"
    assert rows["RDTEN_BA1-3_Book.pdf"][2] == "rdte"
    assert rows["APN_BA5_Book.pdf"][2] == "procurement"

    # idempotent: re-registering the same plan inserts nothing (unique URL).
    n2 = register_service_documents(pg_dsn, plan, fiscal_year=2026)
    assert n2 == 0


def test_known_downloaded_urls_reads_existing_rows(pg_dsn):
    """Resume safety pulls already-present source URLs from the DB so a re-run
    plan skips them."""
    import psycopg

    from govbudget.jbooks.service_fetch import known_downloaded_urls

    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year,"
            " title, source_url, status, acquisition)"
            " values ('N','procurement',2026,'APN_BA5_Book.pdf',%s,"
            " 'downloaded','playwright')",
            (f"{NAVY_BASE}/APN_BA5_Book.pdf",),
        )
        # a 'registered' (not yet downloaded) row is NOT resume-skippable
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year,"
            " title, source_url, status, acquisition)"
            " values ('N','rdte',2026,'RDTEN_BA1-3_Book.pdf',%s,"
            " 'registered','playwright')",
            (f"{NAVY_BASE}/RDTEN_BA1-3_Book.pdf",),
        )
    urls = known_downloaded_urls(pg_dsn, fiscal_year=2026)
    assert urls == {f"{NAVY_BASE}/APN_BA5_Book.pdf"}


def test_register_local_documents_manual_acquisition(pg_dsn, tmp_path):
    """ingest-local registers operator-dropped PDFs with acquisition='manual'
    and the operator-supplied source URL; the classifier assigns family/org."""
    import psycopg

    from govbudget.jbooks.service_fetch import register_local_documents

    # two Navy-style PDFs dropped in a dir (Army routes here too — same shape)
    (tmp_path / "RDTEN_BA1-3_Book.pdf").write_bytes(b"%PDF-1.4 fake")
    (tmp_path / "APN_BA5_Book.pdf").write_bytes(b"%PDF-1.4 fake")
    (tmp_path / "notes.txt").write_text("ignore me")  # non-pdf ignored

    n, skipped = register_local_documents(
        pg_dsn, tmp_path, fiscal_year=2026,
        source_url="https://www.asafm.army.mil/Budget-Materials/Budget2026/",
    )
    assert n == 2
    assert skipped == []
    with psycopg.connect(pg_dsn) as con:
        rows = {
            r[0]: r for r in con.execute(
                "select title, exhibit_family, org, acquisition, source_url,"
                " status from jbook_documents"
            )
        }
    assert set(rows) == {"RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf"}
    for r in rows.values():
        assert r[3] == "manual"
        assert r[4].startswith("https://www.asafm.army.mil/")
        assert r[5] == "registered"


def test_register_local_documents_reports_unclassifiable(pg_dsn, tmp_path):
    """A dropped PDF the classifier can't place is reported, not registered."""
    from govbudget.jbooks.service_fetch import register_local_documents

    (tmp_path / "RDTEN_BA1-3_Book.pdf").write_bytes(b"%PDF-1.4 fake")
    (tmp_path / "mystery_volume.pdf").write_bytes(b"%PDF-1.4 fake")

    n, skipped = register_local_documents(
        pg_dsn, tmp_path, fiscal_year=2026,
        source_url="https://example.mil/army/",
    )
    assert n == 1
    assert skipped == ["mystery_volume.pdf"]


def test_build_download_plan_dedup_ba_false_keeps_all_army_volumes():
    """The archive path (Army/AF) passes dedup_ba=False so genuinely BA-split
    Army RDTE volumes are all kept — the Navy filename collapse must not fire."""
    from govbudget.jbooks.service_fetch import PdfLink, build_download_plan

    base = ("https://www.asafm.army.mil/Portals/72/Documents/BudgetMaterial/2026/"
            "Discretionary%20Budget/rdte")
    names = [f"RDTE - Vol 1 - Budget Activity {n}.pdf" for n in (1, 2, 3)]
    links = [PdfLink(n, f"{base}/{n.replace(' ', '%20')}") for n in names]
    plan = build_download_plan(links, known_urls=set(), dedup_ba=False)
    assert len(plan.to_download) == 3
    assert plan.deduped == []
    # default (Navy) still collapses when the premise holds
    plan_default = build_download_plan(links, known_urls=set())
    assert len(plan_default.to_download) == 1
    assert len(plan_default.deduped) == 2
