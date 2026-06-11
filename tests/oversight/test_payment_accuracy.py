"""TDD tests for paymentaccuracy.gov scraper.

Golden values are hand-read from the committed fixture:
  tests/fixtures/oversight/pa_program_page.html
  (CMS Advance Premium Tax Credit program page)
"""
from pathlib import Path

import httpx

from govbudget.oversight.payment_accuracy import discover_program_urls, parse_program_page

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "oversight"
PROGRAM_FIXTURE = FIXTURE_DIR / "pa_program_page.html"
PROGRAM_URL = (
    "https://paymentaccuracy.gov/program/"
    "hhs-centers-for-medicare-medicaid-services-cms-advance-premi-155942da"
)

# Minimal index HTML mimicking real paymentaccuracy.gov markup structure
# (3 program links, one duplicate, one non-program link)
INDEX_HTML = """<!DOCTYPE html><html><body>
<a href="/program/hhs-administration-for-children-and-families-acf-head-start">Head Start</a>
<a href="/program/ssa-disability-insurance-di">DI</a>
<a href="/program/dow-civilian-pay-army">Army Civ Pay</a>
<a href="/program/ssa-disability-insurance-di">DI duplicate</a>
<a href="/about">About</a>
</body></html>"""

BASE_URL = "https://paymentaccuracy.gov"
INDEX_URL = "https://paymentaccuracy.gov/agencies-and-programs"


# ---------------------------------------------------------------------------
# discover_program_urls
# ---------------------------------------------------------------------------


def test_discover_program_urls_returns_absolute_deduped():
    def handler(request):
        return httpx.Response(200, text=INDEX_HTML)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        urls = discover_program_urls(client, INDEX_URL)

    assert len(urls) == 3  # duplicate removed, non-program link excluded
    assert all(u.startswith("https://paymentaccuracy.gov/program/") for u in urls)
    assert "https://paymentaccuracy.gov/program/hhs-administration-for-children-and-families-acf-head-start" in urls
    assert "https://paymentaccuracy.gov/program/ssa-disability-insurance-di" in urls
    assert "https://paymentaccuracy.gov/program/dow-civilian-pay-army" in urls


def test_discover_excludes_non_program_links():
    def handler(request):
        return httpx.Response(200, text=INDEX_HTML)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        urls = discover_program_urls(client, INDEX_URL)

    # /about should be excluded
    assert not any("about" in u for u in urls)


# ---------------------------------------------------------------------------
# parse_program_page — golden assertions from the committed APTC fixture
# ---------------------------------------------------------------------------


def test_parse_program_page_title():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    assert result["program"] == (
        "Centers for Medicare & Medicaid Services (CMS) - "
        "Advance Premium Tax Credit (APTC)"
    )


def test_parse_program_page_agency():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    assert result["agency_name"] == "Department of Health and Human Services"
    # agency_code extracted from URL slug prefix
    assert result["agency_code"] == "hhs"


def test_parse_program_page_fy_rows_count():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    # Fixture has FY 2022-2025 data (4 years)
    assert len(result["fy_rows"]) == 4


def test_parse_program_page_fy2022_outlays():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2022 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2022")
    # $41,256 M -> stored as-is (varchar)
    assert row_2022["outlays_usd"] == "41256000000"


def test_parse_program_page_fy2022_rate():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2022 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2022")
    # accuracy rate 99.4% -> improper rate 0.6%
    assert row_2022["rate_pct"] == "0.6"


def test_parse_program_page_fy2024_rate():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2024 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2024")
    # accuracy rate 99.0% -> improper rate 1.0%
    assert row_2024["rate_pct"] == "1.0"


def test_parse_program_page_fy2025_outlays():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2025 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2025")
    # $73,813 M
    assert row_2025["outlays_usd"] == "73813000000"


def test_parse_program_page_source_url():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    assert result["source_url"] == PROGRAM_URL
    # Each FY row carries the same source_url
    for row in result["fy_rows"]:
        assert row["source_url"] == PROGRAM_URL


def test_parse_program_page_fy_rows_have_required_keys():
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    required = {"fiscal_year", "rate_pct", "amount_usd", "outlays_usd", "source_url"}
    for row in result["fy_rows"]:
        assert required.issubset(row.keys()), f"Missing keys in row: {row}"
