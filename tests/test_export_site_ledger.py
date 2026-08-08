"""Uncited-ledger clearance tests (dim_geography, fct_budget_to_awards, dim_lobbyists).

Covers the three new citation emitters and the gate extensions that clear the
manifest's uncited_datasets ledger:

  - fact_id_lda_lobbyist          — identity scheme for lobbyist-grain citations
  - _build_geography_citation_rows — derived rows for dim_geography rows,
                                     the grand total, and district aggregates
  - _build_budget_to_awards_citation_rows — derived rows for crosswalk links
  - _export_dim_lobbyists / _build_lobbyist_citation_rows — enriched parquet
                                     + lda_filing citations (disclosing filing)
  - _emit_district_sidecars       — aggregate fact_ids in index + detail files
  - verify_phase5b1 lda set check — lobbyist grain re-derivation
                                     (incl. proof-it-can-fail)
  - _verify_derived acceptance    — new derived rows pass the gate checker;
                                     unresolvable inputs FAIL (proof-can-fail)
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import (
    _build_budget_to_awards_citation_rows,
    _build_geography_citation_rows,
    _build_lobbyist_citation_rows,
    _emit_district_sidecars,
    _export_dim_lobbyists,
    fact_id_derived,
    fact_id_lda,
    fact_id_lda_filing,
    fact_id_lda_lobbyist,
    fact_id_usaspending,
    fact_id_workbook,
)
from govbudget.verify_phase5b1 import (
    _verify_derived,
    _verify_lda,
    integrity_gate5b1,
)

# Citation row layout (27 columns) — mirrors export_site citations.parquet
_CIT_IDX = {
    name: i for i, name in enumerate([
        "fact_id", "kind", "units", "amount_text", "page_number",
        "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
        "resolution", "sheet", "cells", "amount_thousands", "sha256",
        "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
        "formula", "inputs", "query_body", "recorded_value",
        "pe_bli", "scenario", "amount_type",
    ])
}

_CIT_COL_DEFS = (
    "fact_id varchar, kind varchar, units varchar, amount_text varchar,"
    " page_number integer, x0 double, x1 double, top_pt double, bottom_pt double,"
    " page_width double, page_height double, resolution varchar,"
    " sheet varchar, cells varchar, amount_thousands double,"
    " sha256 varchar, hosted_pdf_url varchar, official_url varchar,"
    " xml_path varchar, retrieved_at varchar,"
    " formula varchar, inputs varchar, query_body varchar, recorded_value varchar,"
    " pe_bli varchar, scenario varchar, amount_type varchar"
)


def _write_parquet(path: Path, col_defs: str, rows: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(f"create table _t ({col_defs})")
        if rows:
            placeholders = ", ".join("?" for _ in rows[0])
            con.executemany(f"insert into _t values ({placeholders})", rows)
        path_str = str(path).replace("'", "''")
        con.execute(f"copy _t to '{path_str}' (format parquet, compression zstd)")
    finally:
        con.close()


# ---------------------------------------------------------------------------
# fact_id_lda_lobbyist
# ---------------------------------------------------------------------------

_UUID_A = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
_UUID_B = "b2c3d4e5-f6a7-8901-bcde-f12345678901"


class TestFactIdLdaLobbyist:
    def test_stable_and_16hex(self):
        fid1 = fact_id_lda_lobbyist(_UUID_A, "JANE DOE")
        fid2 = fact_id_lda_lobbyist(_UUID_A, "JANE DOE")
        assert fid1 == fid2
        assert len(fid1) == 16
        assert all(c in "0123456789abcdef" for c in fid1)

    def test_differs_by_name_and_uuid(self):
        assert fact_id_lda_lobbyist(_UUID_A, "JANE DOE") != fact_id_lda_lobbyist(_UUID_A, "JOHN DOE")
        assert fact_id_lda_lobbyist(_UUID_A, "JANE DOE") != fact_id_lda_lobbyist(_UUID_B, "JANE DOE")

    def test_distinct_from_other_lda_schemes(self):
        # Same raw components must not collide across grain prefixes
        assert fact_id_lda_lobbyist(_UUID_A, "income") != fact_id_lda_filing(_UUID_A, "income")
        assert fact_id_lda_lobbyist(_UUID_A, "JANE DOE") != fact_id_lda(_UUID_A, "JANE DOE", "")


# ---------------------------------------------------------------------------
# _build_geography_citation_rows
# ---------------------------------------------------------------------------


def _make_geo_duckdb(tmp_path: Path, *, with_geo=True, with_districts=True) -> Path:
    """DuckDB with LIVE-schema dim_geography + fct_district_programs +
    fct_district_totals (#51)."""
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    if with_geo:
        con.execute(
            "CREATE TABLE dim_geography ("
            "  pop_state varchar, pop_district varchar,"
            "  transaction_count bigint, total_obligation double"
            ")"
        )
        con.execute(
            "INSERT INTO dim_geography VALUES "
            "('VA', 'VA-08', 15, 500000000.0),"
            "('CA', 'CA-18', 7, 200000000.0),"
            "('TX', 'TX-01', 3, NULL)"  # null obligation → no per-row citation
        )
    if with_districts:
        con.execute(
            "CREATE TABLE fct_district_programs ("
            "  pop_state varchar, pop_district varchar, pe_bli varchar,"
            "  program_title varchar, organization varchar,"
            "  transaction_count bigint, award_count bigint, recipient_count bigint,"
            "  total_obligation double"
            ")"
        )
        con.execute(
            "INSERT INTO fct_district_programs VALUES "
            "('VA', 'VA-08', '0601101E', 'DARPA', 'DARPA', 15, 5, 3, 50000000.0),"
            "('VA', 'VA-08', '0602303E', 'Army Research', 'Army', 8, 3, 2, 20000000.0),"
            "('VA', 'VA-08', '0603999X', 'Null Prog', 'Army', 1, 1, 1, NULL),"
            "('CA', 'CA-18', '0601101E', 'DARPA', 'DARPA', 7, 2, 1, 15000000.0)"
        )
        # #51: no duplication in this fixture (VA-08's two programs are
        # genuinely distinct awards), so the award-distinct total equals the
        # naive sum exactly (50M + 20M = 70M; null contributes 0).
        con.execute(
            "CREATE TABLE fct_district_totals ("
            "  pop_state varchar, pop_district varchar,"
            "  award_count bigint, total_obligation double"
            ")"
        )
        con.execute(
            "INSERT INTO fct_district_totals VALUES "
            "('VA', 'VA-08', 8, 70000000.0),"
            "('CA', 'CA-18', 2, 15000000.0)"
        )
    con.close()
    return db_path


class TestGeographyCitationRows:
    def test_per_row_geography_citations(self, tmp_path):
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}

        fid_va = fact_id_derived("geography", "VA|VA-08", "total_obligation")
        assert fid_va in by_fid
        row = by_fid[fid_va]
        assert row[_CIT_IDX["kind"]] == "derived"
        assert row[_CIT_IDX["units"]] == "USD"
        assert row[_CIT_IDX["recorded_value"]] == "500000000.000"
        # query_body carries the USAspending place-of-performance filter
        qb = json.loads(row[_CIT_IDX["query_body"]])
        locs = qb["filters"]["place_of_performance_locations"]
        assert locs == [{"country": "USA", "state": "VA", "district_original": "VA-08"}]
        # inputs = the filter API endpoint URL
        inputs = json.loads(row[_CIT_IDX["inputs"]])
        assert inputs == ["https://api.usaspending.gov/api/v2/references/filter/"]

    def test_null_obligation_row_skipped(self, tmp_path):
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        fid_tx = fact_id_derived("geography", "TX|TX-01", "total_obligation")
        assert fid_tx not in {r[_CIT_IDX["fact_id"]] for r in rows}

    def test_grand_total_row(self, tmp_path):
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        fid_gt = fact_id_derived("geography", "grand_total", "total_obligation")
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
        assert fid_gt in by_fid
        row = by_fid[fid_gt]
        # 500M + 200M (null contributes nothing in SQL SUM)
        assert row[_CIT_IDX["recorded_value"]] == "700000000.000"
        assert json.loads(row[_CIT_IDX["inputs"]]) == []
        assert "sum(total_obligation)" in row[_CIT_IDX["query_body"]]

    def test_district_aggregate_rows(self, tmp_path):
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}

        fid_link = fact_id_derived("district", "VA-08", "total_linkable_dollars")
        fid_cited = fact_id_derived("district", "VA-08", "total_cited_dollars")
        assert fid_link in by_fid and fid_cited in by_fid

        # linkable = 50M + 20M + (null → 0); cited = 50M + 20M
        assert by_fid[fid_link][_CIT_IDX["recorded_value"]] == "70000000.000"
        assert by_fid[fid_cited][_CIT_IDX["recorded_value"]] == "70000000.000"

        # inputs chain to the USAspending district_program fact_ids
        # (only non-null obligation programs)
        expected_inputs = [
            fact_id_usaspending("district_program", "VA|VA-08|0601101E", "total_obligation"),
            fact_id_usaspending("district_program", "VA|VA-08|0602303E", "total_obligation"),
        ]
        assert sorted(json.loads(by_fid[fid_link][_CIT_IDX["inputs"]])) == sorted(expected_inputs)

    def test_district_formula_no_longer_claims_a_program_sum(self, tmp_path):
        """#51: the formula text must NOT start with
        'sum(fct_district_programs.total_obligation)' — that string is gate
        16 (yearsmatrix)'s breakdown-classifier prefix for a sum-decomposable
        fact, and this fact is no longer decomposable into its per-program
        inputs (their sum can legitimately exceed recorded_value when an
        award is duplicated across program elements). Keeping the OLD prefix
        while changing recorded_value would make the exporter's breakdown
        writer skip the fact on a sum mismatch, and the gate would then
        flag it as a required-but-missing breakdown file."""
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
        fid_link = fact_id_derived("district", "VA-08", "total_linkable_dollars")
        fid_cited = fact_id_derived("district", "VA-08", "total_cited_dollars")
        for fid in (fid_link, fid_cited):
            formula = by_fid[fid][_CIT_IDX["formula"]]
            assert not formula.startswith(
                "sum(fct_district_programs.total_obligation)"
            ), formula

    def test_district_aggregate_double_count_fixed(self, tmp_path):
        """#51: recorded_value comes from fct_district_totals, not from
        summing fct_district_programs — reproduces the AK-00 shape (one
        award attributed whole to two program elements)."""
        db_path = tmp_path / "dup.duckdb"
        con = duckdb.connect(str(db_path))
        con.execute(
            "CREATE TABLE fct_district_programs ("
            "  pop_state varchar, pop_district varchar, pe_bli varchar,"
            "  program_title varchar, organization varchar,"
            "  transaction_count bigint, award_count bigint, recipient_count bigint,"
            "  total_obligation double"
            ")"
        )
        con.execute(
            "INSERT INTO fct_district_programs VALUES "
            "('TX', 'TX-09', '0601101E', 'DARPA A', 'DARPA', 102, 1, 1, 100000000.0),"
            "('TX', 'TX-09', '0602303E', 'DARPA B', 'DARPA', 102, 1, 1, 100000000.0)"
        )
        con.execute(
            "CREATE TABLE fct_district_totals ("
            "  pop_state varchar, pop_district varchar,"
            "  award_count bigint, total_obligation double"
            ")"
        )
        con.execute(
            "INSERT INTO fct_district_totals VALUES ('TX', 'TX-09', 1, 100000000.0)"
        )
        con.close()

        rows = _build_geography_citation_rows(duckdb_path=db_path)
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
        fid_link = fact_id_derived("district", "TX-09", "total_linkable_dollars")
        fid_cited = fact_id_derived("district", "TX-09", "total_cited_dollars")
        # NOT "200000000.000" (the naive per-program sum).
        assert by_fid[fid_link][_CIT_IDX["recorded_value"]] == "100000000.000"
        # cited is clamped to the same award-distinct total (both rows are
        # "cited" by this function's own construction — see its docstring).
        assert by_fid[fid_cited][_CIT_IDX["recorded_value"]] == "100000000.000"

    def test_missing_marts_return_empty(self, tmp_path):
        db_path = tmp_path / "empty.duckdb"
        duckdb.connect(str(db_path)).close()
        assert _build_geography_citation_rows(duckdb_path=db_path) == []

    def test_rows_pass_verify_derived(self, tmp_path):
        """Every emitted row passes the gate's _verify_derived checker when
        the referenced USAspending inputs exist in the citation set."""
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        assert rows

        # Build a citation set including the usaspending input rows
        usas_rows = []
        for key in ("VA|VA-08|0601101E", "VA|VA-08|0602303E", "CA|CA-18|0601101E"):
            fid = fact_id_usaspending("district_program", key, "total_obligation")
            r = [None] * 27
            r[_CIT_IDX["fact_id"]] = fid
            r[_CIT_IDX["kind"]] = "usaspending"
            r[_CIT_IDX["recorded_value"]] = "1.000"
            usas_rows.append(tuple(r))
        all_cits = rows + usas_rows

        for row in rows:
            reason = _verify_derived(row, _CIT_IDX, all_cits, _CIT_IDX, {})
            assert reason is None, f"{row[_CIT_IDX['fact_id']]}: {reason}"

    def test_verify_derived_fails_on_unresolvable_inputs(self, tmp_path):
        """Proof-it-can-fail: district rows FAIL _verify_derived when their
        USAspending input fact_ids are absent from the citation set."""
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        fid_link = fact_id_derived("district", "VA-08", "total_linkable_dollars")
        district_row = next(r for r in rows if r[_CIT_IDX["fact_id"]] == fid_link)
        # citation set WITHOUT the usaspending inputs
        reason = _verify_derived(district_row, _CIT_IDX, rows, _CIT_IDX, {})
        assert reason is not None
        assert "not found in citations" in reason


# ---------------------------------------------------------------------------
# _build_budget_to_awards_citation_rows
# ---------------------------------------------------------------------------


def _make_b2a_duckdb(tmp_path: Path) -> Path:
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE fct_budget_to_awards ("
        "  pe_bli varchar, exhibit varchar, fiscal_year integer,"
        "  organization varchar, award_piid varchar, recipient_name varchar,"
        "  recipient_uei varchar, method varchar, confidence varchar,"
        "  program_title varchar"
        ")"
    )
    con.execute(
        "INSERT INTO fct_budget_to_awards VALUES "
        "('0601101E', 'R-2', 2024, 'DARPA', 'HR001124C0001', 'ACME CORP',"
        " 'UEI1', 'account+tokens', 'high', 'Defense Research Sciences'),"
        # duplicate (pe_bli, award_piid) with a different exhibit — must collapse
        "('0601101E', 'R-2A', 2025, 'DARPA', 'HR001124C0001', 'ACME CORP',"
        " 'UEI1', 'account+tokens', 'high', 'Defense Research Sciences'),"
        "('0602303E', 'R-2', 2024, 'Army', 'W911NF24C0002', 'BETA LLC',"
        " 'UEI2', 'account+subagency', 'medium', 'Army Research')"
    )
    con.close()
    return db_path


def _bl_row(fid: str, org: str, pe_bli: str, amount_type: str = "fy_2024_actuals") -> tuple:
    """budget_lines row tuple in the export bl_rows shape (16 cols)."""
    return (
        fid, "R-1", 2026, "0400", "RDT&E", org, "01", "Basic Research",
        pe_bli, "SOME TITLE", amount_type, 1000.0, "USD thousands",
        "sha", "Exhibit R-1", "J2",
    )


class TestBudgetToAwardsCitationRows:
    def test_link_rows_emitted(self, tmp_path):
        db = _make_b2a_duckdb(tmp_path)
        wb_fid = fact_id_workbook("sha", "R-1", 2026, "0400", "DARPA", "01",
                                  "0601101E", "fy_2024_actuals")
        bl_rows = [_bl_row(wb_fid, "DARPA", "0601101E")]
        rows = _build_budget_to_awards_citation_rows(duckdb_path=db, bl_rows=bl_rows)

        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
        fid1 = fact_id_derived("budget_to_awards", "0601101E|HR001124C0001", "link")
        fid2 = fact_id_derived("budget_to_awards", "0602303E|W911NF24C0002", "link")
        assert set(by_fid) == {fid1, fid2}  # duplicate link collapsed

        row = by_fid[fid1]
        assert row[_CIT_IDX["kind"]] == "derived"
        assert row[_CIT_IDX["recorded_value"]] == "high"
        assert "account+tokens" in row[_CIT_IDX["formula"]]
        # rule-4b guard: a link formula must never look like a subtraction
        assert " - " not in row[_CIT_IDX["formula"]]
        # budget-side inputs resolve to the workbook fact_id
        assert json.loads(row[_CIT_IDX["inputs"]]) == [wb_fid]
        # award-side durable artifact
        qb = json.loads(row[_CIT_IDX["query_body"]])
        assert qb["filters"]["award_ids"] == ["HR001124C0001"]

    def test_no_budget_inputs_when_org_unmatched(self, tmp_path):
        db = _make_b2a_duckdb(tmp_path)
        rows = _build_budget_to_awards_citation_rows(duckdb_path=db, bl_rows=[])
        for row in rows:
            assert json.loads(row[_CIT_IDX["inputs"]]) == []

    def test_inputs_capped_at_8(self, tmp_path):
        db = _make_b2a_duckdb(tmp_path)
        bl_rows = [
            _bl_row(f"{i:016x}", "DARPA", "0601101E", amount_type=f"t{i}")
            for i in range(12)
        ]
        rows = _build_budget_to_awards_citation_rows(duckdb_path=db, bl_rows=bl_rows)
        fid1 = fact_id_derived("budget_to_awards", "0601101E|HR001124C0001", "link")
        row = next(r for r in rows if r[_CIT_IDX["fact_id"]] == fid1)
        assert len(json.loads(row[_CIT_IDX["inputs"]])) == 8

    def test_missing_mart_returns_empty(self, tmp_path):
        db_path = tmp_path / "empty.duckdb"
        duckdb.connect(str(db_path)).close()
        assert _build_budget_to_awards_citation_rows(duckdb_path=db_path, bl_rows=[]) == []

    def test_rows_pass_verify_derived(self, tmp_path):
        db = _make_b2a_duckdb(tmp_path)
        wb_fid = fact_id_workbook("sha", "R-1", 2026, "0400", "DARPA", "01",
                                  "0601101E", "fy_2024_actuals")
        bl_rows = [_bl_row(wb_fid, "DARPA", "0601101E")]
        rows = _build_budget_to_awards_citation_rows(duckdb_path=db, bl_rows=bl_rows)

        # citation set including the workbook input
        wb_row = [None] * 27
        wb_row[_CIT_IDX["fact_id"]] = wb_fid
        wb_row[_CIT_IDX["kind"]] = "workbook"
        all_cits = rows + [tuple(wb_row)]

        for row in rows:
            reason = _verify_derived(row, _CIT_IDX, all_cits, _CIT_IDX,
                                     {wb_fid: "1000.0"})
            assert reason is None, f"{row[_CIT_IDX['fact_id']]}: {reason}"

    def test_verify_derived_fails_on_unresolvable_inputs(self, tmp_path):
        """Proof-it-can-fail: link rows with dangling budget inputs FAIL."""
        db = _make_b2a_duckdb(tmp_path)
        wb_fid = fact_id_workbook("sha", "R-1", 2026, "0400", "DARPA", "01",
                                  "0601101E", "fy_2024_actuals")
        bl_rows = [_bl_row(wb_fid, "DARPA", "0601101E")]
        rows = _build_budget_to_awards_citation_rows(duckdb_path=db, bl_rows=bl_rows)
        fid1 = fact_id_derived("budget_to_awards", "0601101E|HR001124C0001", "link")
        row = next(r for r in rows if r[_CIT_IDX["fact_id"]] == fid1)
        # citation set WITHOUT the workbook input row
        reason = _verify_derived(row, _CIT_IDX, rows, _CIT_IDX, {})
        assert reason is not None
        assert "not found in citations" in reason


# ---------------------------------------------------------------------------
# _export_dim_lobbyists + _build_lobbyist_citation_rows
# ---------------------------------------------------------------------------

_UUID_1 = "11111111-aaaa-4bbb-8ccc-000000000001"
_UUID_2 = "22222222-aaaa-4bbb-8ccc-000000000002"
_UUID_3 = "33333333-aaaa-4bbb-8ccc-000000000003"


def _make_lobbyist_fixture(tmp_path: Path, *, with_parquets=True) -> tuple[Path, Path]:
    """DuckDB with dim_lobbyists mart + influence-stage parquets.

    Returns (db_path, data_dir).
    """
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE dim_lobbyists ("
        "  name varchar, covered_position varchar,"
        "  filings_count bigint, revolving_door boolean"
        ")"
    )
    con.execute(
        "INSERT INTO dim_lobbyists VALUES "
        "('JANE DOE', 'Chief of Staff, Sen. X', 3, true),"
        "('JOHN ROE', '', 2, false)"
    )
    con.close()

    if with_parquets:
        pq_dir = tmp_path / "parquet" / "influence"
        pq_dir.mkdir(parents=True)
        # JANE DOE appears in 3 filings; only _UUID_2 and _UUID_3 disclose the
        # covered position — the disclosing filing must be min(uuid) among the
        # MATCHING rows (_UUID_2), not the global min (_UUID_1).
        _write_parquet(
            pq_dir / "lda_lobbyists.parquet",
            "filing_uuid varchar, name varchar, covered_position varchar",
            [
                (_UUID_1, "JANE DOE", ""),
                (_UUID_3, "JANE DOE", "Chief of Staff, Sen. X"),
                (_UUID_2, "JANE DOE", "Chief of Staff, Sen. X"),
                # JOHN ROE: empty covered_position → min uuid across all rows
                (_UUID_3, "JOHN ROE", ""),
                (_UUID_2, "JOHN ROE", ""),
            ],
        )
        _write_parquet(
            pq_dir / "lda_filings.parquet",
            "filing_uuid varchar, url varchar, client_name varchar,"
            " registrant_name varchar, filing_year varchar, filing_period varchar,"
            " filing_type varchar, income_usd varchar, expenses_usd varchar,"
            " family_key_guess varchar, match_method varchar",
            [
                (u, f"https://lda.senate.gov/api/v1/filings/{u}/",
                 "CLIENT", "REG", "2024", "Q1", "Q1", None, None, "FAM", "exact")
                for u in (_UUID_1, _UUID_2, _UUID_3)
            ],
        )

    data_dir = tmp_path / "site_data"
    data_dir.mkdir()
    return db_path, data_dir


class TestExportDimLobbyists:
    def _run(self, tmp_path, **kw):
        db_path, data_dir = _make_lobbyist_fixture(tmp_path, **kw)
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            rows = _export_dim_lobbyists(con=con, duckdb_path=db_path, data_dir=data_dir)
        finally:
            con.close()
        return rows, data_dir

    def test_enriched_parquet_columns(self, tmp_path):
        rows, data_dir = self._run(tmp_path)
        pq = data_dir / "dim_lobbyists.parquet"
        assert pq.exists()
        cols = [d[0] for d in duckdb.sql(
            f"describe select * from read_parquet('{pq}')").fetchall()]
        assert cols == ["name", "covered_position", "filings_count",
                        "revolving_door", "disclosing_filing_uuid",
                        "disclosing_filing_url", "fact_id"]
        assert duckdb.sql(
            f"select count(*) from read_parquet('{pq}')").fetchone()[0] == 2

    def test_disclosing_filing_prefers_covered_position_match(self, tmp_path):
        rows, _ = self._run(tmp_path)
        jane = next(r for r in rows if r[0] == "JANE DOE")
        # min(uuid) among covered_position matches — NOT the global min _UUID_1
        assert jane[4] == _UUID_2
        assert jane[6] == fact_id_lda_lobbyist(_UUID_2, "JANE DOE")

    def test_empty_covered_position_falls_back_to_min_uuid(self, tmp_path):
        rows, _ = self._run(tmp_path)
        john = next(r for r in rows if r[0] == "JOHN ROE")
        assert john[4] == _UUID_2  # min of {_UUID_2, _UUID_3}

    def test_disclosing_url_from_filings_parquet(self, tmp_path):
        rows, _ = self._run(tmp_path)
        jane = next(r for r in rows if r[0] == "JANE DOE")
        assert jane[5] == f"https://lda.senate.gov/api/v1/filings/{_UUID_2}/"

    def test_missing_parquets_null_columns(self, tmp_path):
        rows, _ = self._run(tmp_path, with_parquets=False)
        assert len(rows) == 2
        for r in rows:
            assert r[4] is None and r[5] is None and r[6] is None


class TestLobbyistCitationRows:
    def test_citations_from_export_rows(self, tmp_path):
        db_path, data_dir = _make_lobbyist_fixture(tmp_path)
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            export_rows = _export_dim_lobbyists(
                con=con, duckdb_path=db_path, data_dir=data_dir)
        finally:
            con.close()

        cits = _build_lobbyist_citation_rows(lobbyist_rows=export_rows)
        assert len(cits) == 2
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in cits}
        jane_fid = fact_id_lda_lobbyist(_UUID_2, "JANE DOE")
        assert jane_fid in by_fid
        row = by_fid[jane_fid]
        assert row[_CIT_IDX["kind"]] == "lda_filing"
        assert row[_CIT_IDX["official_url"]] == (
            f"https://lda.senate.gov/api/v1/filings/{_UUID_2}/"
        )

    def test_rows_pass_verify_lda(self, tmp_path):
        """Lobbyist citations pass the gate's lda_filing shape checker."""
        db_path, data_dir = _make_lobbyist_fixture(tmp_path)
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            export_rows = _export_dim_lobbyists(
                con=con, duckdb_path=db_path, data_dir=data_dir)
        finally:
            con.close()
        for row in _build_lobbyist_citation_rows(lobbyist_rows=export_rows):
            assert _verify_lda(row, _CIT_IDX) is None

    def test_no_citations_without_disclosing_filing(self, tmp_path):
        db_path, data_dir = _make_lobbyist_fixture(tmp_path, with_parquets=False)
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            export_rows = _export_dim_lobbyists(
                con=con, duckdb_path=db_path, data_dir=data_dir)
        finally:
            con.close()
        assert _build_lobbyist_citation_rows(lobbyist_rows=export_rows) == []


# ---------------------------------------------------------------------------
# integrity_gate5b1 — lobbyist-grain lda set check (incl. proof-it-can-fail)
# ---------------------------------------------------------------------------


def _make_site_with_lobbyist_citation(site_dir: Path, *, corrupt=False) -> str:
    """Site dir with a lobbyist-grain lda_filing citation + enriched parquet.

    When corrupt=True the citation's fact_id is minted from a uuid that is NOT
    in the parquet — the set check must fail.
    """
    site_dir.mkdir(parents=True, exist_ok=True)
    name = "JANE DOE"
    disclosing = _UUID_2
    minted_from = _UUID_3 if corrupt else disclosing
    fid = fact_id_lda_lobbyist(minted_from, name)
    url = f"https://lda.senate.gov/api/v1/filings/{minted_from}/"

    # fct_program_lobbying.parquet must exist for the lda branch to arm
    _write_parquet(
        site_dir / "data" / "fct_program_lobbying.parquet",
        "filing_uuid varchar, pe_bli varchar, program_title varchar,"
        " matched_term varchar, description_snippet varchar,"
        " filing_url varchar, client_name varchar,"
        " family_key varchar, filing_year varchar",
        [],
    )

    _write_parquet(
        site_dir / "data" / "dim_lobbyists.parquet",
        "name varchar, covered_position varchar, filings_count bigint,"
        " revolving_door boolean, disclosing_filing_uuid varchar,"
        " disclosing_filing_url varchar, fact_id varchar",
        [(name, "Chief of Staff, Sen. X", 3, True, disclosing,
          f"https://lda.senate.gov/api/v1/filings/{disclosing}/",
          fact_id_lda_lobbyist(disclosing, name))],
    )

    cit_row = [None] * 27
    cit_row[_CIT_IDX["fact_id"]] = fid
    cit_row[_CIT_IDX["kind"]] = "lda_filing"
    cit_row[_CIT_IDX["official_url"]] = url
    _write_parquet(
        site_dir / "citations" / "citations.parquet",
        _CIT_COL_DEFS,
        [tuple(cit_row)],
    )

    (site_dir / "manifest.json").write_text(json.dumps({
        "built_at": "2026-07-01T00:00:00+00:00",
        "datasets": {},
        "citations": {"lda_filing": 1},
        "skipped_unresolved": 0,
        "skipped_zero_amount": 0,
        "uncited_datasets": [],
        "pdf_base_url": "/pdfs",
        "schema_version": 1,
    }))
    return fid


class TestIntegrityGateLobbyistGrain:
    def test_lobbyist_citation_rederives_from_parquet(self, tmp_path):
        site = tmp_path / "site"
        _make_site_with_lobbyist_citation(site)
        result = integrity_gate5b1(site)
        assert result["checks"]["lda_fact_ids_in_mart"] is True, result["failures"]

    def test_corrupt_lobbyist_citation_fails(self, tmp_path):
        """Proof-it-can-fail: a lobbyist citation whose fact_id cannot be
        re-derived from dim_lobbyists.parquet FAILS the lda set check."""
        site = tmp_path / "site"
        _make_site_with_lobbyist_citation(site, corrupt=True)
        result = integrity_gate5b1(site)
        assert result["checks"]["lda_fact_ids_in_mart"] is False
        assert any("lda" in f for f in result["failures"])


# ---------------------------------------------------------------------------
# _emit_district_sidecars — aggregate fact_ids
# ---------------------------------------------------------------------------


class TestDistrictSidecarAggregateFactIds:
    def _emit(self, tmp_path, cited_fact_ids: set):
        db = _make_geo_duckdb(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db), read_only=True)
        try:
            _emit_district_sidecars(
                dist_dir=dist_dir, con=con, prog_titles={},
                cited_fact_ids=cited_fact_ids,
            )
        finally:
            con.close()
        return dist_dir

    def test_fact_ids_attached_when_cited(self, tmp_path):
        fid_link = fact_id_derived("district", "VA-08", "total_linkable_dollars")
        fid_cited = fact_id_derived("district", "VA-08", "total_cited_dollars")
        fid_gt = fact_id_derived("geography", "grand_total", "total_obligation")
        dist_dir = self._emit(tmp_path, {fid_link, fid_cited, fid_gt})

        va = json.loads((dist_dir / "VA-08.json").read_text())
        assert va["total_linkable_fact_id"] == fid_link
        assert va["total_cited_fact_id"] == fid_cited

        index = json.loads((dist_dir / "index.json").read_text())
        assert index["geo_grand_total_fact_id"] == fid_gt
        # geo grand total computed WITHOUT the (nonexistent) obligation_type
        # filter — live dim_geography schema
        assert index["geo_grand_total"] == pytest.approx(700_000_000.0)
        va_row = next(d for d in index["districts"] if d["pop_district"] == "VA-08")
        assert va_row["total_linkable_fact_id"] == fid_link

    def test_fact_ids_null_when_not_cited(self, tmp_path):
        dist_dir = self._emit(tmp_path, set())
        va = json.loads((dist_dir / "VA-08.json").read_text())
        assert va["total_linkable_fact_id"] is None
        assert va["total_cited_fact_id"] is None
        index = json.loads((dist_dir / "index.json").read_text())
        assert index["geo_grand_total_fact_id"] is None

    def test_sidecar_sums_match_citation_recorded_values(self, tmp_path):
        """The derived recorded_value and the sidecar sum agree (same query,
        same accumulation)."""
        db = _make_geo_duckdb(tmp_path)
        rows = _build_geography_citation_rows(duckdb_path=db)
        by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}

        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db), read_only=True)
        try:
            _emit_district_sidecars(
                dist_dir=dist_dir, con=con, prog_titles={},
                cited_fact_ids=set(by_fid),
            )
        finally:
            con.close()

        va = json.loads((dist_dir / "VA-08.json").read_text())
        fid_link = fact_id_derived("district", "VA-08", "total_linkable_dollars")
        assert f"{va['total_linkable_dollars']:.3f}" == (
            by_fid[fid_link][_CIT_IDX["recorded_value"]]
        )

        index = json.loads((dist_dir / "index.json").read_text())
        fid_gt = fact_id_derived("geography", "grand_total", "total_obligation")
        assert f"{index['geo_grand_total']:.3f}" == (
            by_fid[fid_gt][_CIT_IDX["recorded_value"]]
        )
