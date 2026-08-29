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
    decade_parquet_gate5e,
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
            " review_queue, extraction_gaps, budget_line_awards,"
            " provenance_pages restart identity cascade"
        )


def seed_edition(
    dsn: str,
    fy: int,
    *,
    n_docs: int = 2,
    n_terminal: int | None = None,
    recon: bool = True,
    n_superseded: int = 0,
) -> list[int]:
    """Insert n_docs jbook_documents for edition fy; n_terminal reach
    status='downloaded', the next n_superseded reach status='superseded' (5G
    dedup — accounted-for terminal), the rest stay 'registered'; optionally one
    reconciliation check per edition."""
    if n_terminal is None:
        n_terminal = n_docs - n_superseded
    doc_ids: list[int] = []
    with psycopg.connect(dsn, autocommit=True) as con:
        for i in range(n_docs):
            if i < n_terminal:
                status = "downloaded"
            elif i < n_terminal + n_superseded:
                status = "superseded"
            else:
                status = "registered"
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


def test_edition_coverage_superseded_counts_as_terminal(pg5e, tmp_path):
    """5G: a superseded (deduplicated) doc is accounted-for, not a coverage
    gap — an edition of 2 downloaded + 1 superseded (with recon) is loaded."""
    seed_edition(pg5e, 2026, n_docs=3, n_terminal=2, n_superseded=1)
    manifest = write_manifest(tmp_path, {
        str(fy): {"status": "blocked", "reason": "pending"}
        for fy in range(2017, 2026)
    })
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["editions"][2026]["state"] == "loaded"
    assert g["editions"][2026]["terminal"] == 3  # downloaded + superseded
    assert g["ok"] is True


def test_edition_coverage_all_superseded_no_recon_still_missing(pg5e, tmp_path):
    """The recon>0 guard holds: an edition where every doc is superseded and
    nothing reconciled is NOT vacuously loaded — superseded can't be a loophole."""
    seed_edition(pg5e, 2026, n_docs=2, n_superseded=2, recon=False)
    manifest = write_manifest(tmp_path, {
        str(fy): {"status": "blocked", "reason": "pending"}
        for fy in range(2017, 2026)
    })
    g = edition_coverage_gate5e(pg5e, manifest)
    assert g["ok"] is False
    assert g["editions"][2026]["state"] == "missing"


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
    g = leakage_gate5e(pg5e, sample_size=5)
    assert g["ok"] is True
    assert g["sampled"] == 5
    assert g["mismatch_count"] == 0


def test_leakage_gate_fails_on_single_cross_edition_row(pg5e):
    docs = seed_edition(pg5e, 2026)
    seed_budget_line(pg5e, 2026, docs[0], pe_bli="0601101E")
    # leakage: a FY2025 line pointing at a PB2026 document
    seed_budget_line(pg5e, 2025, docs[0], pe_bli="0601102E")
    g = leakage_gate5e(pg5e, sample_size=2)
    assert g["ok"] is False
    assert g["mismatch_count"] == 1
    assert g["mismatches"][0][1] == 2025 and g["mismatches"][0][2] == 2026


def test_leakage_gate_fails_when_nothing_joinable(pg5e):
    g = leakage_gate5e(pg5e)
    assert g["ok"] is False
    assert "nothing to verify" in g["reason"]


def test_leakage_gate_fails_below_sample_size(pg5e):
    """Sub-sample guard: 2 joinable rows with sample_size=5 → FAIL, never a
    quiet PASS on a thin evidence base."""
    docs = seed_edition(pg5e, 2026)
    seed_budget_line(pg5e, 2026, docs[0], pe_bli="0601101E")
    seed_budget_line(pg5e, 2026, docs[0], pe_bli="0601102E")
    g = leakage_gate5e(pg5e, sample_size=5)
    assert g["ok"] is False
    assert g["sampled"] == 2
    assert "fewer than sample_size=5" in g["reason"]


# ---------------------------------------------------------------------------
# Gate 3: book-diff conservation (lake-grounded)
# ---------------------------------------------------------------------------


def make_lake_parquet(tmp_path: Path, rows: list[tuple]) -> Path:
    """Rows: (pe_bli, fiscal_year, amount_type, amount_thousands[, exhibit
    [, account[, organization]]]) — written all-varchar to match the real
    jbooks lake export. exhibit defaults to 'R-1' (5-tuples opt in, e.g.
    'P-1R' sibling rows); account/organization default to the DARPA fixture
    values, and 6-/7-tuples opt in to a SPLIT key's real slot."""
    pq = tmp_path / "budget_lines.parquet"
    con = duckdb.connect()
    con.execute(
        "create table lake (exhibit varchar, fiscal_year varchar, account varchar,"
        " organization varchar, pe_bli varchar, amount_type varchar,"
        " amount_thousands varchar)"
    )
    if rows:
        con.executemany(
            "insert into lake values (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    r[4] if len(r) > 4 else "R-1",
                    str(r[1]),
                    r[5] if len(r) > 5 else "0400",
                    r[6] if len(r) > 6 else "DARPA",
                    r[0],
                    r[2],
                    str(r[3]),
                )
                for r in rows
            ],
        )
    con.execute(f"copy lake to '{pq}' (format parquet)")
    con.close()
    return pq


def make_book_diff_db(tmp_path: Path, rows: list[tuple]) -> Path:
    """Rows: (pe_bli, from_edition, to_edition, diff_kind, from_value,
    to_value, delta[, account[, organization]]). account/organization are the
    SPLIT axes the real mart carries (NULL for every non-split pe_bli); the
    gate scopes its lake recompute by them, so a 7-tuple keeps the pre-split
    behaviour byte-for-byte."""
    db = tmp_path / "wh.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_book_diff (pe_bli varchar, from_edition int,"
        " to_edition int, diff_kind varchar, from_value decimal(20,3),"
        " to_value decimal(20,3), delta decimal(20,3), account varchar,"
        " organization varchar)"
    )
    if rows:
        con.executemany(
            "insert into fct_book_diff values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [tuple(r) + (None,) * (9 - len(r)) for r in rows],
        )
    con.close()
    return db


def test_book_diff_gate_fails_when_mart_absent(tmp_path):
    db = tmp_path / "wh.duckdb"
    duckdb.connect(str(db)).close()  # warehouse exists, mart does not
    g = book_diff_gate5e(db, make_lake_parquet(tmp_path, []))
    assert g["ok"] is False
    assert "fct_book_diff mart absent" in g["reason"]


def test_book_diff_gate_fails_when_warehouse_missing(tmp_path):
    g = book_diff_gate5e(tmp_path / "nope.duckdb", make_lake_parquet(tmp_path, []))
    assert g["ok"] is False
    assert "duckdb warehouse missing" in g["reason"]


def test_book_diff_gate_fails_when_mart_empty(tmp_path):
    g = book_diff_gate5e(make_book_diff_db(tmp_path, []), make_lake_parquet(tmp_path, []))
    assert g["ok"] is False
    assert "empty" in g["reason"]


def test_book_diff_gate_fails_when_lake_missing(tmp_path):
    rows = [("0601101E", 2025, 2026, "request_vs_request", 100.0, 120.0, 20.0)]
    g = book_diff_gate5e(
        make_book_diff_db(tmp_path, rows), tmp_path / "nope.parquet", sample_size=1
    )
    assert g["ok"] is False
    assert "lake budget_lines parquet missing" in g["reason"]


def test_book_diff_conservation_and_lake_recompute_pass(tmp_path):
    """Both diff_kinds: mart values recompute from the lake AND conserve.
    request_vs_actuals: from = FY2024 request in PB2024 (BudgetYearOne),
    to = FY2024 actuals in PB2026 (PriorYear slug fy_2024_actuals)."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2025, "fy_2025_total", "100.5"),
        ("0601101E", 2026, "fy_2026_total", "120.25"),
        ("0601102E", 2024, "fy_2024_total", "50"),
        ("0601102E", 2026, "fy_2024_actuals", "40"),
    ])
    rows = [
        ("0601101E", 2025, 2026, "request_vs_request", 100.5, 120.25, 19.75),
        ("0601102E", 2024, 2026, "request_vs_actuals", 50.0, 40.0, -10.0),
    ]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=2)
    assert g["ok"] is True
    assert g["sampled"] == 2 and g["passed"] == 2


def test_book_diff_any_candidate_slug_matches(tmp_path):
    """scenario_map any-candidate rule: from_value matches the second
    BudgetYearOne candidate (fy_2025_disc_request), not the first."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2025, "fy_2025_total", "999"),
        ("0601101E", 2025, "fy_2025_disc_request", "80"),
        ("0601101E", 2026, "fy_2026_total", "120"),
    ])
    rows = [("0601101E", 2025, 2026, "request_vs_request", 80.0, 120.0, 40.0)]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=1)
    assert g["ok"] is True


def test_book_diff_conservation_fails_on_bad_delta(tmp_path):
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2025, "fy_2025_total", "100"),
        ("0601101E", 2026, "fy_2026_total", "120"),
        ("0601102E", 2025, "fy_2025_total", "100"),
        ("0601102E", 2026, "fy_2026_total", "120"),
    ])
    rows = [
        ("0601101E", 2025, 2026, "request_vs_request", 100.0, 120.0, 20.0),
        ("0601102E", 2025, 2026, "request_vs_request", 100.0, 120.0, 25.0),  # wrong
    ]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=2)
    assert g["ok"] is False
    assert len(g["failures"]) == 1
    assert "delta recompute mismatch" in g["failures"][0][1]


def test_book_diff_fails_when_mart_diverges_from_lake(tmp_path):
    """Anti-tautology: delta == to − from is internally consistent, but the
    mart's to_value does not recompute from the lake → FAIL."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2025, "fy_2025_total", "100"),
        ("0601101E", 2026, "fy_2026_total", "120"),
    ])
    rows = [("0601101E", 2025, 2026, "request_vs_request", 100.0, 130.0, 30.0)]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=1)
    assert g["ok"] is False
    assert "to_value lake recompute mismatch" in g["failures"][0][1]


def test_book_diff_fails_on_null_inputs_with_nonnull_delta(tmp_path):
    rows = [("0601101E", 2025, 2026, "request_vs_request", None, 120.0, 20.0)]
    g = book_diff_gate5e(
        make_book_diff_db(tmp_path, rows), make_lake_parquet(tmp_path, []),
        sample_size=1,
    )
    assert g["ok"] is False
    assert "null/non-numeric inputs" in g["failures"][0][1]


def test_book_diff_all_null_delta_fails(tmp_path):
    """Sub-sample guard: a mart whose deltas are all null yields zero
    sampled rows → FAIL, not a vacuous PASS."""
    rows = [
        ("0601101E", 2025, 2026, "request_vs_request", 100.0, None, None),
        ("0601102E", 2025, 2026, "request_vs_request", None, 120.0, None),
    ]
    g = book_diff_gate5e(
        make_book_diff_db(tmp_path, rows), make_lake_parquet(tmp_path, []),
        sample_size=1,
    )
    assert g["ok"] is False
    assert g["sampled"] == 0
    assert "fewer than sample_size=1" in g["reason"]


def test_book_diff_below_sample_size_fails(tmp_path):
    """Sub-sample guard: only 1 of 3 rows carries a non-null delta but the
    gate demands 2 → FAIL even though that row is valid."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2025, "fy_2025_total", "100"),
        ("0601101E", 2026, "fy_2026_total", "120"),
    ])
    rows = [
        ("0601101E", 2025, 2026, "request_vs_request", 100.0, 120.0, 20.0),
        ("0601102E", 2025, 2026, "request_vs_request", 100.0, None, None),
        ("0601103E", 2025, 2026, "request_vs_request", None, None, None),
    ]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=2)
    assert g["ok"] is False
    assert g["sampled"] == 1
    assert "fewer than sample_size=2" in g["reason"]


def test_book_diff_request_vs_actuals_span_invalid_fails(tmp_path):
    """request_vs_actuals requires to_edition == from_edition + 2 (FY-N
    actuals first appear as PriorYear in PB(N+2))."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2024, "fy_2024_total", "100"),
        ("0601101E", 2025, "fy_2023_actuals", "120"),
    ])
    rows = [("0601101E", 2024, 2025, "request_vs_actuals", 100.0, 120.0, 20.0)]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=1)
    assert g["ok"] is False
    assert "span invalid" in g["failures"][0][1]


def test_book_diff_unknown_diff_kind_fails(tmp_path):
    lake = make_lake_parquet(tmp_path, [("0601101E", 2025, "fy_2025_total", "100")])
    rows = [("0601101E", 2025, 2026, "request_vs_enacted", 100.0, 120.0, 20.0)]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=1)
    assert g["ok"] is False
    assert "unknown diff_kind" in g["failures"][0][1]


# ---------------------------------------------------------------------------
# Gate 4: decade-series integrity
# ---------------------------------------------------------------------------


def make_decade_series_db(tmp_path: Path, rows: list[tuple]) -> Path:
    """Rows: (pe_bli, fy, edition_year, amount, fact_id[, account[,
    organization]]). Same split axes as make_book_diff_db above: they are
    part of the mart's grain since #56/#67 and ROADMAP #45, and NULL for
    every pe_bli that is not shared by two programs."""
    db = tmp_path / "wh2.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_decade_series (pe_bli varchar, fy int,"
        " edition_year int, amount decimal(20,3), fact_id varchar,"
        " account varchar, organization varchar)"
    )
    if rows:
        con.executemany(
            "insert into fct_decade_series values (?, ?, ?, ?, ?, ?, ?)",
            [tuple(r) + (None,) * (7 - len(r)) for r in rows],
        )
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


def test_decade_series_recompute_excludes_p1r_rows(tmp_path):
    """P-1R recompute correction (Task 5 improvements): P-1R is the
    reserve-component SUBSET of the P-1 line (P-1 is the inclusive total —
    workbook ground truth, e.g. Aircraft Procurement Army FY2024 = $3.321B
    from P-1 alone). A modern P-1 grain with a nonzero P-1R sibling row
    under the same slug must recompute to the P-1-only value: the C-130J
    PB2025 FY2023-actuals shape (P-1 1,775,293 + P-1R 1,700,000)."""
    lake = make_lake_parquet(tmp_path, [
        ("C130J0", 2025, "fy_2023_actuals", "1775293", "P-1"),
        ("C130J0", 2025, "fy_2023_actuals", "1700000", "P-1R"),
    ])
    db = make_decade_series_db(tmp_path, [("C130J0", 2023, 2025, 1775293.0, "f1")])
    g = decade_series_gate5e(db, lake)
    assert g["ok"] is True, g["failures"]
    assert g["sampled"] == 1 and g["passed"] == 1
    # …and the P-1 + P-1R contaminated sum must NOT verify: publishing
    # 3,475,293 double-counts the reserve share.
    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    db_bad = make_decade_series_db(bad_dir, [("C130J0", 2023, 2025, 3475293.0, "f1")])
    g = decade_series_gate5e(db_bad, lake)
    assert g["ok"] is False
    assert "lake recompute mismatch" in g["failures"][0][1]


def test_book_diff_recompute_excludes_p1r_rows(tmp_path):
    """Same P-1R exclusion on the book-diff side: both diff sides are
    fct_decade_series amounts, so their lake recompute ignores P-1R rows."""
    lake = make_lake_parquet(tmp_path, [
        ("C130J0", 2023, "fy_2023_total", "1600000", "P-1"),
        ("C130J0", 2023, "fy_2023_total", "1500000", "P-1R"),
        ("C130J0", 2025, "fy_2023_actuals", "1775293", "P-1"),
        ("C130J0", 2025, "fy_2023_actuals", "1700000", "P-1R"),
    ])
    rows = [("C130J0", 2023, 2025, "request_vs_actuals",
             1600000.0, 1775293.0, 175293.0)]
    g = book_diff_gate5e(make_book_diff_db(tmp_path, rows), lake, sample_size=1)
    assert g["ok"] is True, g["failures"]


def test_decade_series_zero_duplicates_clean_recompute_passes(tmp_path):
    """Grain-check polarity: rows sharing pe_bli across fy, and sharing
    (fy, edition) across pe_bli, are NOT duplicates — with clean lake
    recomputes the gate passes with duplicate_grains == 0. An inverted
    grain check (flagging unique grains) cannot survive this test."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2026, "fy_2024_actuals", "100"),
        ("0601101E", 2026, "fy_2025_total", "110"),
        ("0601101E", 2026, "fy_2026_total", "120"),
        ("0601102E", 2026, "fy_2026_total", "200"),
    ])
    db = make_decade_series_db(tmp_path, [
        ("0601101E", 2024, 2026, 100.0, "f1"),
        ("0601101E", 2025, 2026, 110.0, "f2"),
        ("0601101E", 2026, 2026, 120.0, "f3"),
        ("0601102E", 2026, 2026, 200.0, "f4"),
    ])
    g = decade_series_gate5e(db, lake)
    assert g["ok"] is True
    assert g["duplicate_grains"] == 0
    assert g["failures"] == []
    assert g["sampled"] == 4 and g["passed"] == 4


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


# ---------------------------------------------------------------------------
# Gate 5: decade-parquet ↔ lake integrity (backlog #23)
# ---------------------------------------------------------------------------


def make_decade_parquet(tmp_path: Path, rows: list[tuple]) -> Path:
    """Typed site-export fixture matching data/site/data/
    budget_lines_decade.parquet (the 16-column _write_typed_parquet schema).
    Rows: (fact_id, pe_bli, edition_year, amount_type, amount_thousands)."""
    pq = tmp_path / "budget_lines_decade.parquet"
    con = duckdb.connect()
    con.execute(
        "create table t (fact_id varchar, exhibit varchar, fiscal_year integer,"
        " account varchar, account_title varchar, organization varchar,"
        " budget_activity varchar, budget_activity_title varchar,"
        " pe_bli varchar, title varchar, amount_type varchar,"
        " amount_thousands double, units varchar, document_sha256 varchar,"
        " source_sheet varchar, source_cells varchar)"
    )
    if rows:
        con.executemany(
            "insert into t values (?, 'R-1', ?, '0400', 'RDT&E Defense-Wide',"
            " 'DARPA', '01', 'Basic Research', ?, 'TITLE', ?, ?,"
            " 'USD thousands', 'sha', 'Exhibit R-1', 'J2')",
            [(r[0], int(r[2]), r[1], r[3], float(r[4])) for r in rows],
        )
    con.execute(f"copy t to '{pq}' (format parquet)")
    con.close()
    return pq


def test_decade_parquet_gate_fails_when_parquet_missing(tmp_path):
    g = decade_parquet_gate5e(tmp_path / "nope.parquet", make_lake_parquet(tmp_path, []))
    assert g["ok"] is False
    assert "budget_lines_decade.parquet missing" in g["reason"]


def test_decade_parquet_gate_fails_when_lake_missing(tmp_path):
    pq = make_decade_parquet(tmp_path, [("f1", "0601101E", 2026, "fy_2026_total", 300.0)])
    g = decade_parquet_gate5e(pq, tmp_path / "nope.parquet", sample_size=1)
    assert g["ok"] is False
    assert "lake budget_lines parquet missing" in g["reason"]


def test_decade_parquet_gate_fails_when_empty(tmp_path):
    pq = make_decade_parquet(tmp_path, [])
    g = decade_parquet_gate5e(pq, make_lake_parquet(tmp_path, []), sample_size=1)
    assert g["ok"] is False
    assert "empty" in g["reason"]


def test_decade_parquet_gate_below_sample_size_fails(tmp_path):
    """Sub-sample guard: 1 row with sample_size=5 → FAIL, never a quiet
    PASS on a thin evidence base."""
    lake = make_lake_parquet(tmp_path, [("0601101E", 2026, "fy_2026_total", "300")])
    pq = make_decade_parquet(tmp_path, [("f1", "0601101E", 2026, "fy_2026_total", 300.0)])
    g = decade_parquet_gate5e(pq, lake, sample_size=5)
    assert g["ok"] is False
    assert g["sampled"] == 1
    assert "fewer than sample_size=5" in g["reason"]


def test_decade_parquet_recompute_passes(tmp_path):
    """Multi-row grains: the parquet's per-grain SUM recomputes from the
    lake (PB2024 PriorYear split across two lake rows), single-row grains
    match directly, and the any-candidate rule applies (fy_2026_disc_request
    is the second BudgetYearOne candidate)."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2024, "fy_2022_actuals", "150.5"),
        ("0601101E", 2024, "fy_2022_actuals", "49.5"),
        ("0601102E", 2026, "fy_2026_disc_request", "80"),
    ])
    pq = make_decade_parquet(tmp_path, [
        ("f1", "0601101E", 2024, "fy_2022_actuals", 150.5),
        ("f2", "0601101E", 2024, "fy_2022_actuals", 49.5),
        ("f3", "0601102E", 2026, "fy_2026_disc_request", 80.0),
    ])
    g = decade_parquet_gate5e(pq, lake, sample_size=3)
    assert g["ok"] is True, g["failures"]
    assert g["total_rows"] == 3
    assert g["sampled"] == 3 and g["passed"] == 3


def test_decade_parquet_tampered_amount_fails(tmp_path):
    """Proof-can-fail: one shipped row's amount_thousands tampered (+1000)
    → its grain sum no longer recomputes from the lake."""
    lake = make_lake_parquet(tmp_path, [
        ("0601101E", 2024, "fy_2022_actuals", "150.5"),
        ("0601101E", 2024, "fy_2022_actuals", "49.5"),
    ])
    pq = make_decade_parquet(tmp_path, [
        ("f1", "0601101E", 2024, "fy_2022_actuals", 1150.5),  # tampered
        ("f2", "0601101E", 2024, "fy_2022_actuals", 49.5),
    ])
    g = decade_parquet_gate5e(pq, lake, sample_size=2)
    assert g["ok"] is False
    assert any("lake recompute mismatch" in reason for _, reason in g["failures"])


def test_decade_parquet_fabricated_extra_row_fails(tmp_path):
    """A fabricated EXTRA parquet row inflates its grain sum past the lake
    — the whole-parquet grain sum catches additions, not just edits."""
    lake = make_lake_parquet(tmp_path, [("0601101E", 2026, "fy_2026_total", "300")])
    pq = make_decade_parquet(tmp_path, [
        ("f1", "0601101E", 2026, "fy_2026_total", 300.0),
        ("f9", "0601101E", 2026, "fy_2026_total", 25.0),  # fabricated
    ])
    g = decade_parquet_gate5e(pq, lake, sample_size=2)
    assert g["ok"] is False
    assert all("lake recompute mismatch" in reason for _, reason in g["failures"])


def test_decade_parquet_unknown_amount_type_fails(tmp_path):
    """A slug outside scenario_map(edition) is a fabricated column — FAIL,
    never silently unmatched."""
    lake = make_lake_parquet(tmp_path, [("0601101E", 2026, "fy_2019_total", "300")])
    pq = make_decade_parquet(tmp_path, [("f1", "0601101E", 2026, "fy_2019_total", 300.0)])
    g = decade_parquet_gate5e(pq, lake, sample_size=1)
    assert g["ok"] is False
    assert "not a scenario_map candidate" in g["failures"][0][1]


def test_decade_parquet_recompute_excludes_p1r_rows(tmp_path):
    """P-1R exclusion (same rule as gates 3/4): the decade parquet ships
    only R-1/P-1 source rows, so the lake recompute must ignore the P-1R
    reserve-component subset — and a parquet carrying the contaminated
    P-1 + P-1R sum must FAIL."""
    lake = make_lake_parquet(tmp_path, [
        ("C130J0", 2025, "fy_2023_actuals", "1775293", "P-1"),
        ("C130J0", 2025, "fy_2023_actuals", "1700000", "P-1R"),
    ])
    pq = make_decade_parquet(tmp_path, [
        ("f1", "C130J0", 2025, "fy_2023_actuals", 1775293.0),
    ])
    g = decade_parquet_gate5e(pq, lake, sample_size=1)
    assert g["ok"] is True, g["failures"]
    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    pq_bad = make_decade_parquet(bad_dir, [
        ("f1", "C130J0", 2025, "fy_2023_actuals", 3475293.0),  # P-1 + P-1R
    ])
    g = decade_parquet_gate5e(pq_bad, lake, sample_size=1)
    assert g["ok"] is False
    assert "lake recompute mismatch" in g["failures"][0][1]


# ---------------------------------------------------------------------------
# Split keys: (pe_bli, fy, edition_year) is NOT the decade grain
# ---------------------------------------------------------------------------
#
# Thirteen pe_bli values are shared by two or more different programs — ten on
# the ACCOUNT axis (#56/#67) and three on the ORGANIZATION axis ('20', '30',
# '500', ROADMAP #45) — and fct_decade_series publishes one row per real slot
# for them. Both gates below kept checking the pre-split grain and summing the
# whole pe_bli out of the lake, so they reported the mart's correct rows as
# duplicates and recomputed each of them against the OTHER program's money
# added in. Measured on the 2026-08-29 warehouse: 100 "duplicate" grains, 27
# of them from the three organization keys alone — the same 27 the mart's own
# dbt test records for the pre-#45 grain, which dates the staleness to
# 2026-08-21, before the Wave 5 ingestion that surfaced it.


def test_decade_series_split_key_is_not_a_duplicate_and_recomputes_per_account(
    tmp_path,
):
    """Two accounts, one BLI code, one fiscal year — two legitimate rows."""
    lake = make_lake_parquet(tmp_path, [
        # '3302' is ASW Range Support in Weapons Procurement AND Joint
        # Communications Support Element in Other Procurement.
        ("3302", 2026, "fy_2026_total", "4328", "P-1", "1507N", "N"),
        ("3302", 2026, "fy_2026_total", "3389", "P-1", "1810N", "N"),
    ])
    db = make_decade_series_db(tmp_path, [
        ("3302", 2026, 2026, 4328.0, "f1", "1507N", None),
        ("3302", 2026, 2026, 3389.0, "f2", "1810N", None),
    ])
    g = decade_series_gate5e(db, lake, sample_size=2)
    assert g["duplicate_grains"] == 0, g
    # and each row recomputes against ITS OWN account's lake rows, not the sum
    assert g["ok"] is True, g["failures"]
    assert g["passed"] == 2


def test_decade_series_split_key_wrong_amount_still_fails(tmp_path):
    """The scoping must not become a way to pass: a row whose amount matches
    neither its own account NOR the fused sum is still a failure."""
    lake = make_lake_parquet(tmp_path, [
        ("3302", 2026, "fy_2026_total", "4328", "P-1", "1507N", "N"),
        ("3302", 2026, "fy_2026_total", "3389", "P-1", "1810N", "N"),
    ])
    db = make_decade_series_db(tmp_path, [
        ("3302", 2026, 2026, 7717.0, "f1", "1507N", None),  # the fused sum
    ])
    g = decade_series_gate5e(db, lake, sample_size=1)
    assert g["ok"] is False
    assert any("lake recompute mismatch" in reason for _, reason in g["failures"])


def test_book_diff_split_key_recomputes_per_account(tmp_path):
    lake = make_lake_parquet(tmp_path, [
        ("3302", 2025, "fy_2025_request", "4039", "P-1", "1507N", "N"),
        ("3302", 2025, "fy_2025_request", "4551", "P-1", "1810N", "N"),
        ("3302", 2026, "fy_2026_total", "4328", "P-1", "1507N", "N"),
        ("3302", 2026, "fy_2026_total", "3389", "P-1", "1810N", "N"),
    ])
    db = make_book_diff_db(tmp_path, [
        ("3302", 2025, 2026, "request_vs_request", 4039.0, 4328.0, 289.0,
         "1507N", None),
    ])
    g = book_diff_gate5e(db, lake, sample_size=1)
    assert g["ok"] is True, g["failures"]
