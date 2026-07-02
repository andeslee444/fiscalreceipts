"""TDD tests for GAO high-risk list ingest.

Golden values hand-read from the committed fixture:
  tests/fixtures/oversight/gao_high_risk.html

Since backlog #11 the parquet is written with a typed schema: the mapped
flag is BOOLEAN (was VARCHAR 'true'/'false').
"""
from pathlib import Path

import duckdb
import httpx

from govbudget.oversight.high_risk import build_high_risk, parse_high_risk_index

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


# ---------------------------------------------------------------------------
# build_high_risk — typed parquet schema (backlog #11 regression)
# ---------------------------------------------------------------------------


def test_build_high_risk_writes_typed_parquet(tmp_path):
    """mapped is a native BOOLEAN column (was VARCHAR 'true'/'false');
    text columns stay VARCHAR."""
    html = FIXTURE.read_text(encoding="utf-8")
    agency_map_csv = tmp_path / "agency_map.csv"
    agency_map_csv.write_text(
        "area_title,agency_code,notes\n"
        "DOD Financial Management,DOD,DoD financial management\n",
        encoding="utf-8",
    )

    def handler(request):
        return httpx.Response(200, text=html)

    out = tmp_path / "high_risk.parquet"
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        build_high_risk(client, agency_map_csv=agency_map_csv, out_path=out)

    types = dict(
        duckdb.sql(
            f"select column_name, column_type from "
            f"(describe select * from read_parquet('{out}'))"
        ).fetchall()
    )
    assert types["mapped"] == "BOOLEAN"
    for col in ("area_title", "area_url", "agency_code", "notes", "source_url"):
        assert types[col] == "VARCHAR"

    # Exactly the one seeded area is mapped; boolean predicates work natively
    n_mapped = duckdb.sql(
        f"select count(*) from read_parquet('{out}') where mapped"
    ).fetchone()[0]
    assert n_mapped == 1
    # Legacy string predicate still works via DuckDB implicit cast
    # (verify_phase3 linkage gate uses mapped = 'true')
    n_mapped_legacy = duckdb.sql(
        f"select count(*) from read_parquet('{out}') where mapped = 'true'"
    ).fetchone()[0]
    assert n_mapped_legacy == 1
