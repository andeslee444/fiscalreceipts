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
