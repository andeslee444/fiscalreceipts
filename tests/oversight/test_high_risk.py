"""TDD tests for GAO high-risk list ingest.

Golden values hand-read from the committed fixture:
  tests/fixtures/oversight/gao_high_risk.html
"""
from pathlib import Path

from govbudget.oversight.high_risk import parse_high_risk_index

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "oversight"
FIXTURE = FIXTURE_DIR / "gao_high_risk.html"
GAO_URL = "https://www.gao.gov/high-risk-list"


def test_parse_high_risk_index_count():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    # 2025 list has 38 areas
    assert len(areas) == 38


def test_parse_high_risk_index_has_required_keys():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    required = {"area_title", "area_url"}
    for area in areas:
        assert required.issubset(area.keys()), f"Missing keys in area: {area}"


def test_parse_high_risk_index_dod_areas_present():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    titles = {a["area_title"] for a in areas}
    # Must include at least 3 DOD areas
    assert "DOD Weapon Systems Acquisition" in titles
    assert "DOD Financial Management" in titles
    assert "DOD Contract Management" in titles


def test_parse_high_risk_index_area_urls_absolute():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    for area in areas:
        assert area["area_url"].startswith("https://"), (
            f"Expected absolute URL, got: {area['area_url']!r}"
        )


def test_parse_high_risk_index_source_url():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    for area in areas:
        assert area["source_url"] == GAO_URL


def test_parse_high_risk_index_specific_areas():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    titles = {a["area_title"] for a in areas}
    # Check a diverse sample
    assert "Medicare Program & Improper Payments" in titles
    assert "Enforcement of Tax Laws" in titles
    assert "Managing Risks and Improving VA Health Care" in titles
    assert "Unemployment Insurance System" in titles
    assert "USPS Financial Viability" in titles
    assert "NASA Acquisition Management" in titles


def test_parse_high_risk_index_urls_point_to_gao_report():
    html = FIXTURE.read_text(encoding="utf-8")
    areas = parse_high_risk_index(html, GAO_URL)
    # All area URLs should point to the GAO-25-107743 report
    for area in areas:
        assert "gao.gov" in area["area_url"] or "files.gao.gov" in area["area_url"]
