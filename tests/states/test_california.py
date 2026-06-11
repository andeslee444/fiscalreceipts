"""Tests for CA Open Fi$Cal ingestion.

Golden values hand-read from committed fixture:
  tests/fixtures/states/ca_spending_fixture.csv
  (20 rows, Commission on States Mandates, FY2025)

No live network calls.
"""
from __future__ import annotations

import csv
import json
import tempfile
from pathlib import Path

import httpx
import pytest

from govbudget.states.california import (
    POINTER_URL,
    aggregate_checkbook,
    list_department_files,
    parse_spending_csv,
    write_ca_budget_parquet,
    write_ca_checkbook_parquet,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "states"
SPENDING_FIXTURE = FIXTURE_DIR / "ca_spending_fixture.csv"

# Golden values hand-read from fixture
# fixture: 20 rows, all Commission on States Mandates, fiscal_year_begin=2025
FIXTURE_FILE_URL = "https://example.com/Spending_8885_FY25.csv"

# Categories present in fixture (hand-read):
# Other Items of Expense: 1328.380
# Salaries & Wages: 400.000
# Staff Benefits: 80572.860
GOLDEN_OTHER_ITEMS = 1328.380
GOLDEN_SALARIES = 400.000
GOLDEN_STAFF_BENEFITS = 80572.860


def _pointer_csv_text() -> str:
    """Minimal pointer CSV with two entries.

    File names match real Open Fi$Cal format: Spending_<BU>_<Name>_FY<YY>.csv
    """
    return (
        'FileName,UploadDate,FileSize,Download\n'
        '"Spending_8885_Commission_FY25.csv","2026-04-05","2 MB",'
        '"https://example.com/Spending_8885_Commission_FY25.csv"\n'
        '"Spending_8885_Commission_FY24.csv","2026-04-05","2 MB",'
        '"https://example.com/Spending_8885_Commission_FY24.csv"\n'
        '"Spending_9999_BigDept_FY25.csv","2026-04-05","50 MB",'
        '"https://example.com/Spending_9999_BigDept_FY25.csv"\n'
    )


# ---------------------------------------------------------------------------
# list_department_files
# ---------------------------------------------------------------------------


def test_list_department_files_filters_fiscal_year():
    def handler(req):
        return httpx.Response(200, text=_pointer_csv_text())

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        entries = list_department_files(client, fiscal_year="FY25", max_mb=5.0)

    # Only FY25 files
    assert all("FY25" in e["file_name"] for e in entries)
    # Big file (50 MB) filtered out
    file_names = [e["file_name"] for e in entries]
    assert not any("BigDept" in fn for fn in file_names)


def test_list_department_files_excludes_other_years():
    def handler(req):
        return httpx.Response(200, text=_pointer_csv_text())

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        entries = list_department_files(client, fiscal_year="FY24", max_mb=5.0)

    assert len(entries) == 1
    assert "FY24" in entries[0]["file_name"]


# ---------------------------------------------------------------------------
# parse_spending_csv — golden values from fixture
# ---------------------------------------------------------------------------


def test_parse_spending_csv_row_count():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    assert len(rows) == 20


def test_parse_spending_csv_tuple_length():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    # (department, agency, category, fund, fiscal_year, amount, source_url)
    assert all(len(r) == 7 for r in rows)


def test_parse_spending_csv_source_url():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    assert all(r[6] == FIXTURE_FILE_URL for r in rows)


def test_parse_spending_csv_department():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    departments = {r[0] for r in rows}
    assert "Commission on States Mandates" in departments


def test_parse_spending_csv_fiscal_year():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    fiscal_years = {r[4] for r in rows}
    assert "2025" in fiscal_years


# ---------------------------------------------------------------------------
# aggregate_checkbook — golden aggregation from fixture rows
# ---------------------------------------------------------------------------


def test_aggregate_checkbook_other_items_total():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    agg = aggregate_checkbook(rows, FIXTURE_FILE_URL)
    # Find Other Items of Expense row
    target = [r for r in agg if r[2] == "Other Items of Expense"]
    assert target, "No 'Other Items of Expense' row in aggregate"
    total = sum(r[4] for r in target)
    assert abs(total - GOLDEN_OTHER_ITEMS) < 0.01


def test_aggregate_checkbook_staff_benefits_total():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    agg = aggregate_checkbook(rows, FIXTURE_FILE_URL)
    target = [r for r in agg if r[2] == "Staff Benefits"]
    assert target, "No 'Staff Benefits' row in aggregate"
    total = sum(r[4] for r in target)
    assert abs(total - GOLDEN_STAFF_BENEFITS) < 0.01


def test_aggregate_checkbook_jurisdiction():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    agg = aggregate_checkbook(rows, FIXTURE_FILE_URL)
    assert all(r[0] == "CA" for r in agg)


def test_aggregate_checkbook_source_url():
    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    agg = aggregate_checkbook(rows, FIXTURE_FILE_URL)
    assert all(r[5] == FIXTURE_FILE_URL for r in agg)


# ---------------------------------------------------------------------------
# write_ca_checkbook_parquet — parquet output shape
# ---------------------------------------------------------------------------


def test_write_ca_checkbook_parquet_schema():
    import duckdb

    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ca_checkbook_agg.parquet"
        write_ca_checkbook_parquet(rows, out, FIXTURE_FILE_URL)
        con = duckdb.connect()
        cols = {r[0] for r in con.execute(f"describe select * from '{out}'").fetchall()}
        con.close()
    expected = {"jurisdiction", "department", "category", "fiscal_year", "amount_usd", "source_url"}
    assert expected == cols


def test_write_ca_checkbook_parquet_all_varchar():
    import duckdb

    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ca_checkbook_agg.parquet"
        write_ca_checkbook_parquet(rows, out, FIXTURE_FILE_URL)
        con = duckdb.connect()
        dtypes = {
            r[0]: r[1]
            for r in con.execute(f"describe select * from '{out}'").fetchall()
        }
        con.close()
    assert all(v == "VARCHAR" for v in dtypes.values()), f"Non-varchar columns: {dtypes}"


def test_write_ca_checkbook_parquet_source_url_on_all_rows():
    import duckdb

    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ca_checkbook_agg.parquet"
        write_ca_checkbook_parquet(rows, out, FIXTURE_FILE_URL)
        con = duckdb.connect()
        nulls = con.execute(
            f"select count(*) from '{out}' where source_url is null or source_url=''"
        ).fetchone()[0]
        con.close()
    assert nulls == 0


# ---------------------------------------------------------------------------
# write_ca_budget_parquet — schema + is_total
# ---------------------------------------------------------------------------


def test_write_ca_budget_parquet_schema():
    import duckdb

    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ca_budget.parquet"
        write_ca_budget_parquet(rows, out, FIXTURE_FILE_URL)
        con = duckdb.connect()
        cols = {r[0] for r in con.execute(f"describe select * from '{out}'").fetchall()}
        con.close()
    expected = {"department", "agency", "category", "fund", "fiscal_year", "amount_usd", "is_total", "source_url"}
    assert expected == cols


def test_write_ca_budget_parquet_is_total_false():
    import duckdb

    text = SPENDING_FIXTURE.read_text(encoding="utf-8")
    rows = parse_spending_csv(text, FIXTURE_FILE_URL)
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "ca_budget.parquet"
        write_ca_budget_parquet(rows, out, FIXTURE_FILE_URL)
        con = duckdb.connect()
        bad = con.execute(
            f"select count(*) from '{out}' where is_total <> 'False'"
        ).fetchone()[0]
        con.close()
    assert bad == 0
