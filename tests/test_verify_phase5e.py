"""Phase 5E gate tests (Task 3, evaluator-first).

Postgres-backed gates (edition coverage, leakage) use a dedicated throwaway
database (govbudget_test_5e) migrated from migrations/*.sql — same pattern as
tests/jbooks/conftest.py, separate DB name so the two suites never collide.
DuckDB-backed gates (book-diff, decade-series) use temp warehouses + a temp
all-varchar lake parquet matching data/parquet/jbooks/budget_lines.parquet.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import duckdb
import psycopg
import pytest

from govbudget.verify_phase5e import (
    TARGET_EDITIONS,
    book_diff_gate5e,
    decade_series_gate5e,
    edition_coverage_gate5e,
    leakage_gate5e,
)

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test_5e"


# ---------------------------------------------------------------------------
# Postgres fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def pg_dsn_5e():
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres unavailable ({e}); start local postgres to run 5E gate tests")
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()

    parts = urlsplit(ADMIN_DSN)
    dsn = urlunsplit(parts._replace(path="/" + TEST_DB))

    from govbudget.jbooks.db import migrate

    migrate(dsn)
    yield dsn


@pytest.fixture()
def pg5e(pg_dsn_5e):
    yield pg_dsn_5e
    with psycopg.connect(pg_dsn_5e, autocommit=True) as con:
        con.execute(
            "truncate jbook_documents, budget_lines, extraction_runs,"
            " budget_line_details, detail_narratives, reconciliation_checks,"
            " review_queue, extraction_gaps restart identity cascade"
        )


def seed_edition(
    dsn: str,
    fy: int,
    *,
    n_docs: int = 2,
    n_terminal: int | None = None,
    recon: bool = True,
) -> list[int]:
    """Insert n_docs jbook_documents for edition fy; n_terminal of them reach
    status='downloaded'; optionally one reconciliation check per edition."""
    if n_terminal is None:
        n_terminal = n_docs
    doc_ids: list[int] = []
    with psycopg.connect(dsn, autocommit=True) as con:
        for i in range(n_docs):
            status = "downloaded" if i < n_terminal else "registered"
            doc_id = con.execute(
                "insert into jbook_documents (org, exhibit_family, fiscal_year,"
                " title, source_url, status) values (%s, %s, %s, %s, %s, %s)"
                " returning id",
                ("DARPA", "rdte", fy, f"doc-{fy}-{i}",
                 f"https://example.test/{fy}/doc{i}.pdf", status),
            ).fetchone()[0]
            doc_ids.append(doc_id)
        if recon:
            run_id = con.execute(
                "insert into extraction_runs (document_id, tier, tool_versions,"
                " status) values (%s, 1, '{}', 'finished') returning id",
                (doc_ids[0],),
            ).fetchone()[0]
            con.execute(
                "insert into reconciliation_checks (extraction_run_id, gate,"
                " pe_bli, scenario, expected, actual, passed)"
                " values (%s, 'B', '0601101E', 'BudgetYearOne', 1, 1, true)",
                (run_id,),
            )
    return doc_ids


def seed_budget_line(dsn: str, fy: int, doc_id: int, pe_bli: str = "0601101E") -> None:
    with psycopg.connect(dsn, autocommit=True) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account,"
            " organization, pe_bli, amount_type, amount_thousands,"
            " source_document_id) values ('R-1', %s, '0400', 'DARPA', %s,"
            " %s, 100, %s)",
            (fy, pe_bli, f"fy_{fy}_total", doc_id),
        )


def write_manifest(tmp_path: Path, editions: dict) -> Path:
    p = tmp_path / "edition_manifest.json"
    p.write_text(json.dumps({"editions": editions}))
    return p


# ---------------------------------------------------------------------------
# Gate 1: edition coverage
# ---------------------------------------------------------------------------


def test_edition_coverage_manifest_excused_warn_passes(pg5e, tmp_path):
    """Only 2026 loaded; 2017–2025 manifest-excused → PASS with 9 WARNs."""
    docs = seed_edition(pg5e, 2026, n_docs=3)
    assert docs
    manifest = write_manifest(tmp_path, {
        str(fy): {"status": "blocked", "reason": f"PB{fy} backfill pending (Task 4)"}
        for fy in range(2017, 2026)
    })
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["ok"] is True
    assert g["failures"] == []
    assert len(g["warns"]) == 9
    assert g["editions"][2026]["state"] == "loaded"
    assert g["editions"][2017]["state"] == "excused"
    assert g["editions"][2017]["reason"] == "PB2017 backfill pending (Task 4)"


def test_edition_coverage_missing_edition_fails(pg5e, tmp_path):
    """Only 2026 loaded, empty manifest → FAIL naming the absent editions."""
    seed_edition(pg5e, 2026)
    manifest = write_manifest(tmp_path, {})
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["ok"] is False
    assert len(g["failures"]) == 9  # 2017..2025
    assert g["editions"][2017]["state"] == "missing"
    assert any("edition 2017" in f for f in g["failures"])
    assert g["editions"][2026]["state"] == "loaded"


def test_edition_coverage_partial_acquisition_fails(pg5e, tmp_path):
    """discovered != terminal count → not loaded, not excused → FAIL."""
    seed_edition(pg5e, 2026, n_docs=3, n_terminal=2)
    manifest = write_manifest(tmp_path, {
        str(fy): {"status": "blocked", "reason": "pending"}
        for fy in range(2017, 2026)
    })
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["ok"] is False
    assert g["editions"][2026]["state"] == "missing"
    assert any("2/3 documents in terminal state" in f for f in g["failures"])


def test_edition_coverage_no_recon_checks_fails(pg5e, tmp_path):
    """Edition downloaded but never reconciled → FAIL."""
    seed_edition(pg5e, 2026, recon=False)
    manifest = write_manifest(tmp_path, {
        str(fy): {"status": "blocked", "reason": "pending"}
        for fy in range(2017, 2026)
    })
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["ok"] is False
    assert any("no reconciliation checks" in f for f in g["failures"])


def test_edition_coverage_manifest_entry_without_reason_fails(pg5e, tmp_path):
    """A manifest entry must carry BOTH status and reason to excuse."""
    seed_edition(pg5e, 2026)
    editions = {
        str(fy): {"status": "blocked", "reason": "pending"}
        for fy in range(2017, 2026)
    }
    editions["2017"] = {"status": "blocked"}  # reason missing
    manifest = write_manifest(tmp_path, editions)
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["ok"] is False
    assert any("manifest entry invalid" in f for f in g["failures"])
    assert len(g["warns"]) == 8


def test_edition_coverage_missing_manifest_file_still_evaluates(pg5e, tmp_path):
    """No manifest file at all → nothing is excused; absent editions FAIL."""
    seed_edition(pg5e, 2026)
    g = edition_coverage_gate5e(pg5e, tmp_path / "nope.json")
    assert g["ok"] is False
    assert len(g["failures"]) == 9


def test_edition_coverage_target_editions_span_decade():
    assert TARGET_EDITIONS == tuple(range(2017, 2027))


# ---------------------------------------------------------------------------
# Gate 2: no cross-edition leakage
# ---------------------------------------------------------------------------


def test_leakage_gate_passes_when_editions_align(pg5e):
    docs = seed_edition(pg5e, 2026)
    for i in range(5):
        seed_budget_line(pg5e, 2026, docs[0], pe_bli=f"060110{i}E")
    g = leakage_gate5e(pg5e)
    assert g["ok"] is True
    assert g["sampled"] == 5
    assert g["mismatch_count"] == 0


def test_leakage_gate_fails_on_single_cross_edition_row(pg5e):
    docs = seed_edition(pg5e, 2026)
    seed_budget_line(pg5e, 2026, docs[0], pe_bli="0601101E")
    # leakage: a FY2025 line pointing at a PB2026 document
    seed_budget_line(pg5e, 2025, docs[0], pe_bli="0601102E")
    g = leakage_gate5e(pg5e)
    assert g["ok"] is False
    assert g["mismatch_count"] == 1
    assert g["mismatches"][0][1] == 2025 and g["mismatches"][0][2] == 2026


def test_leakage_gate_fails_when_nothing_joinable(pg5e):
    g = leakage_gate5e(pg5e)
    assert g["ok"] is False
    assert "nothing to verify" in g["reason"]


# ---------------------------------------------------------------------------
# Gate 3: book-diff conservation
# ---------------------------------------------------------------------------


def make_book_diff_db(tmp_path: Path, rows: list[tuple]) -> Path:
    db = tmp_path / "wh.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_book_diff (pe_bli varchar, from_edition int,"
        " to_edition int, diff_kind varchar, from_value decimal(20,3),"
        " to_value decimal(20,3), delta decimal(20,3))"
    )
    if rows:
        con.executemany("insert into fct_book_diff values (?, ?, ?, ?, ?, ?, ?)", rows)
    con.close()
    return db


def test_book_diff_gate_fails_when_mart_absent(tmp_path):
    db = tmp_path / "wh.duckdb"
    duckdb.connect(str(db)).close()  # warehouse exists, mart does not
    g = book_diff_gate5e(db)
    assert g["ok"] is False
    assert "fct_book_diff mart absent" in g["reason"]


def test_book_diff_gate_fails_when_warehouse_missing(tmp_path):
    g = book_diff_gate5e(tmp_path / "nope.duckdb")
    assert g["ok"] is False
    assert "duckdb warehouse missing" in g["reason"]


def test_book_diff_gate_fails_when_mart_empty(tmp_path):
    g = book_diff_gate5e(make_book_diff_db(tmp_path, []))
    assert g["ok"] is False
    assert "empty" in g["reason"]


def test_book_diff_conservation_passes(tmp_path):
    rows = [
        ("0601101E", 2025, 2026, "request_vs_request", 100.5, 120.25, 19.75),
        ("0601102E", 2024, 2026, "request_vs_actuals", 50.0, 40.0, -10.0),
    ]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows))
    assert g["ok"] is True
    assert g["sampled"] == 2 and g["passed"] == 2


def test_book_diff_conservation_fails_on_bad_delta(tmp_path):
    rows = [
        ("0601101E", 2025, 2026, "request_vs_request", 100.0, 120.0, 20.0),
        ("0601102E", 2025, 2026, "request_vs_request", 100.0, 120.0, 21.0),  # wrong
    ]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows))
    assert g["ok"] is False
    assert len(g["failures"]) == 1
    assert "recompute mismatch" in g["failures"][0][1]


def test_book_diff_fails_on_null_inputs_with_nonnull_delta(tmp_path):
    rows = [("0601101E", 2025, 2026, "request_vs_request", None, 120.0, 20.0)]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows))
    assert g["ok"] is False
    assert "null/non-numeric inputs" in g["failures"][0][1]


# ---------------------------------------------------------------------------
# Gate 4: decade-series integrity
# ---------------------------------------------------------------------------


def make_lake_parquet(tmp_path: Path, rows: list[tuple[str, int, str, str]]) -> Path:
    """Rows: (pe_bli, fiscal_year, amount_type, amount_thousands) — written
    all-varchar to match the real jbooks lake export."""
    pq = tmp_path / "budget_lines.parquet"
    con = duckdb.connect()
    con.execute(
        "create table lake (exhibit varchar, fiscal_year varchar, account varchar,"
        " organization varchar, pe_bli varchar, amount_type varchar,"
        " amount_thousands varchar)"
    )
    if rows:
        con.executemany(
            "insert into lake values ('R-1', ?, '0400', 'DARPA', ?, ?, ?)",
            [(str(fy), pe, at, str(amt)) for pe, fy, at, amt in rows],
        )
    con.execute(f"copy lake to '{pq}' (format parquet)")
    con.close()
    return pq


def make_decade_series_db(tmp_path: Path, rows: list[tuple]) -> Path:
    db = tmp_path / "wh2.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_decade_series (pe_bli varchar, fy int,"
        " edition_year int, amount decimal(20,3), fact_id varchar)"
    )
    if rows:
        con.executemany("insert into fct_decade_series values (?, ?, ?, ?, ?)", rows)
    con.close()
    return db


def test_decade_series_gate_fails_when_mart_absent(tmp_path):
    db = tmp_path / "wh2.duckdb"
    duckdb.connect(str(db)).close()
    g = decade_series_gate5e(db, make_lake_parquet(tmp_path, []))
    assert g["ok"] is False
    assert "fct_decade_series mart absent" in g["reason"]


def test_decade_series_recompute_passes(tmp_path):
    # PB2026 edition: FY2024 actuals (rel=2), FY2026 total (rel=0);
    # FY2024 amount is split across two lake rows that must sum.
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2026, "fy_2024_actuals", "150.5"),
        ("0601101E", 2026, "fy_2024_actuals", "49.5"),
        ("0601101E", 2026, "fy_2026_total", "300"),
    ])
    db = make_decade_series_db(tmp_path, [
        ("0601101E", 2024, 2026, 200.0, "f1"),
        ("0601101E", 2026, 2026, 300.0, "f2"),
    ])
    g = decade_series_gate5e(db, lake)
    assert g["ok"] is True
    assert g["sampled"] == 2 and g["passed"] == 2
    assert g["duplicate_grains"] == 0


def test_decade_series_duplicate_grain_fails(tmp_path):
    lake = make_lake_parquet(tmp_path, [("0601101E", 2026, "fy_2026_total", "300")])
    db = make_decade_series_db(tmp_path, [
        ("0601101E", 2026, 2026, 300.0, "f1"),
        ("0601101E", 2026, 2026, 300.0, "f2"),  # duplicate grain
    ])
    g = decade_series_gate5e(db, lake)
    assert g["ok"] is False
    assert g["duplicate_grains"] == 1
    assert any("duplicate" in reason for _, reason in g["failures"])


def test_decade_series_recompute_mismatch_fails(tmp_path):
    lake = make_lake_parquet(tmp_path, [("0601101E", 2026, "fy_2026_total", "300")])
    db = make_decade_series_db(tmp_path, [("0601101E", 2026, 2026, 999.0, "f1")])
    g = decade_series_gate5e(db, lake)
    assert g["ok"] is False
    assert "lake recompute mismatch" in g["failures"][0][1]


def test_decade_series_fy_outside_edition_window_fails(tmp_path):
    lake = make_lake_parquet(tmp_path, [("0601101E", 2026, "fy_2026_total", "300")])
    db = make_decade_series_db(tmp_path, [("0601101E", 2020, 2026, 300.0, "f1")])
    g = decade_series_gate5e(db, lake)
    assert g["ok"] is False
    assert "outside edition window" in g["failures"][0][1]


def test_decade_series_missing_lake_fails(tmp_path):
    db = make_decade_series_db(tmp_path, [("0601101E", 2026, 2026, 300.0, "f1")])
    g = decade_series_gate5e(db, tmp_path / "nope.parquet")
    assert g["ok"] is False
    assert "lake budget_lines parquet missing" in g["reason"]
