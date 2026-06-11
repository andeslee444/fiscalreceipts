"""Tests for CT OpenCheckbook ingestion.

Golden values hand-read from committed fixture:
  tests/fixtures/states/ct_checkbook_fixture.json
  (5 rows, FY2023 aggregate, top spend categories)

No live network calls.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from govbudget.states.connecticut import (
    SOCRATA_BASE,
    build_soql_url,
    fetch_ct_checkbook,
    parse_ct_rows,
    write_ct_checkbook_parquet,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "states"
CT_FIXTURE = FIXTURE_DIR / "ct_checkbook_fixture.json"

# Golden values hand-read from fixture
# [0] Dept of Social Services / Trnsfr Grant Expend-St Agency / 2023 = 5795772370.40
GOLDEN_SOCIAL_SERVICES_TRANSFER = 5795772370.40
GOLDEN_SOC_SVCS_STATE_AID = 3704401730.99


def _fixture_rows() -> list[dict]:
    return json.loads(CT_FIXTURE.read_text(encoding="utf-8"))


def _handler(request):
    return httpx.Response(200, json=_fixture_rows())


# ---------------------------------------------------------------------------
# build_soql_url
# ---------------------------------------------------------------------------


def test_build_soql_url_contains_group():
    url = build_soql_url()
    assert "$group" in url or "group" in url.lower()


def test_build_soql_url_with_fiscal_year():
    url = build_soql_url(fiscal_year="2023")
    assert "2023" in url


def test_build_soql_url_starts_with_socrata_base():
    url = build_soql_url()
    assert url.startswith(SOCRATA_BASE)


# ---------------------------------------------------------------------------
# fetch_ct_checkbook — mock transport
# ---------------------------------------------------------------------------


def test_fetch_ct_checkbook_returns_rows_and_url():
    with httpx.Client(transport=httpx.MockTransport(_handler)) as client:
        rows, url = fetch_ct_checkbook(client)
    assert len(rows) == 5
    assert url.startswith(SOCRATA_BASE)


def test_fetch_ct_checkbook_url_is_soql():
    """source_url includes SoQL query for provenance (reproducible)."""
    with httpx.Client(transport=httpx.MockTransport(_handler)) as client:
        rows, url = fetch_ct_checkbook(client)
    assert "$select" in url or "%24select" in url or "select" in url.lower()


# ---------------------------------------------------------------------------
# parse_ct_rows — golden values from fixture
# ---------------------------------------------------------------------------


def test_parse_ct_rows_count():
    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    assert len(rows) == 5


def test_parse_ct_rows_jurisdiction():
    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    assert all(r[0] == "CT" for r in rows)


def test_parse_ct_rows_social_services_transfer_amount():
    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    # First row: Dept of Social Services / Trnsfr Grant Expend-St Agency
    match = [r for r in rows if "Social Services" in r[1] and "Trnsfr" in r[2]]
    assert match, "Expected Social Services Transfer row not found"
    assert abs(match[0][4] - GOLDEN_SOCIAL_SERVICES_TRANSFER) < 0.01


def test_parse_ct_rows_state_aid_amount():
    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    match = [r for r in rows if "Social Services" in r[1] and "State Aid" in r[2]]
    assert match, "Expected Social Services State Aid row not found"
    assert abs(match[0][4] - GOLDEN_SOC_SVCS_STATE_AID) < 0.01


def test_parse_ct_rows_source_url():
    src = "https://data.ct.gov/test-url"
    rows = parse_ct_rows(_fixture_rows(), src)
    assert all(r[5] == src for r in rows)


def test_parse_ct_rows_tuple_length():
    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    # (jurisdiction, department, category, fiscal_year, amount, source_url)
    assert all(len(r) == 6 for r in rows)


# ---------------------------------------------------------------------------
# write_ct_checkbook_parquet — schema + content
# ---------------------------------------------------------------------------


def test_write_ct_checkbook_parquet_schema():
    import duckdb

    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ct_checkbook_agg.parquet"
        write_ct_checkbook_parquet(rows, out)
        con = duckdb.connect()
        cols = {r[0] for r in con.execute(f"describe select * from '{out}'").fetchall()}
        con.close()
    expected = {"jurisdiction", "department", "category", "fiscal_year", "amount_usd", "source_url"}
    assert expected == cols


def test_write_ct_checkbook_parquet_all_varchar():
    import duckdb

    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ct_checkbook_agg.parquet"
        write_ct_checkbook_parquet(rows, out)
        con = duckdb.connect()
        dtypes = {
            r[0]: r[1]
            for r in con.execute(f"describe select * from '{out}'").fetchall()
        }
        con.close()
    assert all(v == "VARCHAR" for v in dtypes.values()), f"Non-varchar columns: {dtypes}"


def test_write_ct_checkbook_parquet_row_count():
    import duckdb

    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ct_checkbook_agg.parquet"
        write_ct_checkbook_parquet(rows, out)
        con = duckdb.connect()
        count = con.execute(f"select count(*) from '{out}'").fetchone()[0]
        con.close()
    assert count == 5


def test_write_ct_checkbook_parquet_source_url_on_all_rows():
    import duckdb

    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ct_checkbook_agg.parquet"
        write_ct_checkbook_parquet(rows, out)
        con = duckdb.connect()
        nulls = con.execute(
            f"select count(*) from '{out}' where source_url is null or source_url=''"
        ).fetchone()[0]
        con.close()
    assert nulls == 0


def test_write_ct_checkbook_parquet_jurisdiction_is_ct():
    import duckdb

    rows = parse_ct_rows(_fixture_rows(), "https://data.ct.gov/test")
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ct_checkbook_agg.parquet"
        write_ct_checkbook_parquet(rows, out)
        con = duckdb.connect()
        non_ct = con.execute(
            f"select count(*) from '{out}' where jurisdiction <> 'CT'"
        ).fetchone()[0]
        con.close()
    assert non_ct == 0
