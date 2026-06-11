"""TDD tests for paymentaccuracy.gov scraper.

Golden values are hand-read from the committed fixture:
  tests/fixtures/oversight/pa_program_page.html
  (CMS Advance Premium Tax Credit program page)

Precise rates are parsed from canvas data-improper / data-accuracy / data-unknown
attributes (not the rounded display text in the metrics-summary cards).
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
    # agency_code extracted from URL slug prefix (raw, before canonicalization)
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


def test_parse_program_page_fy2022_rate_precise():
    """rate_pct is parsed from data-improper attribute (precise, not rounded display)."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2022 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2022")
    # canvas data-improper="0.61993693" for FY 2022
    assert row_2022["rate_pct"] == "0.61993693"


def test_parse_program_page_fy2023_rate_precise():
    """rate_pct from data-improper for FY 2023."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2023 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2023")
    # canvas data-improper="0.5844439100000001"
    assert row_2023["rate_pct"] == "0.5844439100000001"


def test_parse_program_page_fy2024_rate_precise():
    """rate_pct from data-improper for FY 2024."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2024 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2024")
    # canvas data-improper="1.01052567"
    assert row_2024["rate_pct"] == "1.01052567"


def test_parse_program_page_fy2025_rate_precise():
    """rate_pct from data-improper for FY 2025."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2025 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2025")
    # canvas data-improper="0.8907133253"
    assert row_2025["rate_pct"] == "0.8907133253"


def test_parse_program_page_fy2022_derived_improper_amount():
    """derived_improper_amount_usd = round(outlays * data-improper / 100)."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2022 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2022")
    # round(41256000000 * 0.61993693 / 100) = 255761180
    assert row_2022["derived_improper_amount_usd"] == "255761180"


def test_parse_program_page_fy2024_derived_improper_amount():
    """derived_improper_amount_usd for FY 2024."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2024 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2024")
    # round(55708000000 * 1.01052567 / 100) = 562943640
    assert row_2024["derived_improper_amount_usd"] == "562943640"


def test_parse_program_page_fy2022_unknown_rate():
    """unknown_rate_pct from data-unknown attribute (0.0 in fixture)."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    row_2022 = next(r for r in result["fy_rows"] if r["fiscal_year"] == "2022")
    # data-unknown="0"
    assert row_2022["unknown_rate_pct"] == "0.0"


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
    required = {
        "fiscal_year", "rate_pct", "derived_improper_amount_usd",
        "unknown_rate_pct", "outlays_usd", "source_url",
    }
    for row in result["fy_rows"]:
        assert required.issubset(row.keys()), f"Missing keys in row: {row}"


def test_parse_program_page_no_old_amount_usd_key():
    """amount_usd column has been renamed to derived_improper_amount_usd."""
    html = PROGRAM_FIXTURE.read_text(encoding="utf-8")
    result = parse_program_page(html, PROGRAM_URL)
    for row in result["fy_rows"]:
        assert "amount_usd" not in row, f"Stale key 'amount_usd' still present in row: {row}"
