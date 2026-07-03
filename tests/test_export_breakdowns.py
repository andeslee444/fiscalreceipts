"""Tests for Phase 5D Task 3b (exporter half): derived breakdown sidecars.

Spec §3b: breakdowns/{fact_id}.json for every SUM-DECOMPOSABLE derived fact
with ≥2 fact_id inputs — a "show your work" table whose rows account for
100% of the recorded_value:

  rows: {label, pe_bli, v, fid}
    - cited rows: fid resolves in the citation set (drill-through target)
    - uncited rows: fid null + "uncited": true (the ⁂ state) — e.g. the
      "N uncited" programs in agency FY2024 formulas
    - difference facts (Δ = FY26 − FY25): the subtracted input's row carries
      a NEGATIVE v + "subtracted": true so sum(rows.v) == recorded_value holds
      for every breakdown uniformly
  sum(rows.v) == recorded_value canonically (Decimal, |diff| ≤ 0.005)
  labels resolve via dim_pe_titles where pe_bli-keyed

Non-decomposable derived facts get NO breakdown (honesty, not omission):
  - crosswalk links (recorded_value is a confidence tier, not a number)
  - <2 inputs, URL inputs, mixed inputs
  - sum-mismatch rows (skipped loudly — the 5B-1 derived gate owns that
    failure; the breakdown writer never ships a table that doesn't sum)
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import (
    _emit_breakdowns,
    _null_derived_row,
    fact_id_derived,
    fact_id_usaspending,
)


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

W1 = "aa11000000000001"  # workbook line A (100000.0 thousands)
W2 = "ab11000000000002"  # workbook line B (200000.0 thousands)
J1 = "da11000000000003"  # jbook PriorYear root, 0601101E, 100.0 M — cited
J2 = "db11000000000004"  # jbook PriorYear root, 0602025E, 50.0 M — NOT cited

F24 = fact_id_derived("trajectory", "0601101E|DARPA", "fy2024_actuals")
F25 = fact_id_derived("trajectory", "0601101E|DARPA", "fy2025_total")
F26 = fact_id_derived("trajectory", "0601101E|DARPA", "fy2026_total")
CHG = fact_id_derived("trajectory", "0601101E|DARPA", "fy2526_change")
G26 = fact_id_derived("trajectory", "0602025E|DARPA", "fy2026_total")
A24 = fact_id_derived("agency", "DARPA", "fy2024_total_millions")
A26 = fact_id_derived("agency", "DARPA", "fy2026_total_thousands")
DLINK = fact_id_derived("budget_to_awards", "0601101E|HR001124C0001", "link")
DIST = fact_id_derived("district", "VA-08", "total_cited_dollars")
US1 = fact_id_usaspending("district_program", "VA|VA-08|0601101E", "total_obligation")
US2 = fact_id_usaspending("district_program", "VA|VA-08|0602025E", "total_obligation")


def _usaspending_row(fid, recorded_value):
    """Minimal 27-tuple usaspending citation row (only fields breakdowns read)."""
    return (
        fid, "usaspending", "USD",
        None, None, None, None, None, None, None, None,
        None, None, None, None, None, None, None, None, None,
        None, None, '{"filters": {}}', recorded_value,
        None, None, None,
    )


def _workbook_row(fid, pe_bli):
    return (
        fid, "workbook", "USD thousands",
        None, None, None, None, None, None, None, None,
        None, "Exhibit R-1", "D5", 100000.0 if fid == W1 else 200000.0,
        "sha_wb", None, "https://example.mil/r1.xlsx", None, None,
        None, None, None, None,
        pe_bli, None, None,
    )


def _jbook_row(fid, pe_bli):
    return (
        fid, "jbook_pdf", "USD millions",
        "100.000", 12, 1.0, 2.0, 3.0, 4.0, 792.0, 612.0,
        "unique", None, None, None,
        "sha_jb", "/pdfs/sha_jb.pdf#page=12", "https://example.mil/jb.pdf#page=12",
        None, None,
        None, None, None, None,
        pe_bli, "PriorYear", None,
    )


def _bl_rows() -> list[tuple]:
    return [
        (W1, "R-1", 2026, "2040", "RDT&E", "DARPA", "3", "Adv Tech",
         "0601101E", "Line A", "fy_2024_actuals", 100000.0, "USD thousands",
         "sha_wb", "Exhibit R-1", "D5"),
        (W2, "R-1", 2026, "2040", "RDT&E", "DARPA", "3", "Adv Tech",
         "0601101E", "Line B", "fy_2024_actuals", 200000.0, "USD thousands",
         "sha_wb", "Exhibit R-1", "D6"),
    ]


def _detail_rows() -> list[tuple]:
    """jbook detail rows: PriorYear roots for the two DARPA programs."""
    return [
        (J1, "0601101E", None, None, "PriorYear", 100.0, "USD millions",
         "ProgramElement[1]", "DARPA", "rdte", 2026, "sha_jb", "unique"),
        (J2, "0602025E", None, None, "PriorYear", 50.0, "USD millions",
         "ProgramElement[2]", "DARPA", "rdte", 2026, "sha_jb", "zero_amount"),
    ]


def _make_duckdb(tmp_path: Path) -> Path:
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE dim_pe_titles (pe_bli varchar, title varchar)")
    con.execute(
        "INSERT INTO dim_pe_titles VALUES "
        "('0601101E', 'DARPA Research'), ('0602025E', 'DARPA Manufacturing')"
    )
    con.execute(
        "CREATE TABLE fct_budget_trajectory ("
        "  pe_bli varchar, organization varchar,"
        "  fy2024_actuals double, fy2025_total double, fy2026_total double,"
        "  fy2526_change double, fy2526_pct_change double"
        ")"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES "
        "('0601101E', 'DARPA', 300000.0, 200000.0, 400000.0, 200000.0, 100.0),"
        "('0602025E', 'DARPA', NULL, NULL, 100000.0, NULL, NULL)"
    )
    con.execute(
        "CREATE TABLE dim_programs ("
        "  pe_bli varchar, org varchar, exhibit_family varchar, title varchar,"
        "  project_count integer, fy2024_actual_millions double, fully_reconciled boolean"
        ")"
    )
    con.execute(
        "INSERT INTO dim_programs VALUES "
        "('0601101E', 'DARPA', 'rdte', 'DARPA Research', 1, 100.0, true),"
        "('0602025E', 'DARPA', 'rdte', 'DARPA Manufacturing', 1, 50.0, false)"
    )
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
        "('VA', 'VA-08', '0601101E', 'DARPA Research', 'DARPA', 15, 5, 3, 50000000.0),"
        "('VA', 'VA-08', '0602025E', 'DARPA Manufacturing', 'DARPA', 8, 3, 2, 20000000.0)"
    )
    con.close()
    return db_path


def _citation_rows() -> list[tuple]:
    ts = "2026-07-02T00:00:00+00:00"
    return [
        _workbook_row(W1, "0601101E"),
        _workbook_row(W2, "0601101E"),
        _jbook_row(J1, "0601101E"),
        # NOTE: J2 has NO citation row (zero_amount) — it is UNCITED.
        _usaspending_row(US1, "50000000.000"),
        _usaspending_row(US2, "20000000.000"),
        # trajectory sum over two workbook lines
        _null_derived_row(
            F24, "derived", "USD thousands",
            "sum(budget_lines.amount_thousands where amount_type=fy_2024_actuals)",
            json.dumps([W1, W2]), "300000.000", ts,
        ),
        # peers for the difference
        _null_derived_row(
            F25, "derived", "USD thousands",
            "trajectory pivot of budget_lines (inputs unavailable for this org/type)",
            "[]", "200000.000", ts,
        ),
        _null_derived_row(
            F26, "derived", "USD thousands",
            "trajectory pivot of budget_lines (inputs unavailable for this org/type)",
            "[]", "400000.000", ts,
        ),
        _null_derived_row(
            G26, "derived", "USD thousands",
            "trajectory pivot of budget_lines (inputs unavailable for this org/type)",
            "[]", "100000.000", ts,
        ),
        # Δ = FY26 − FY25 (inputs ordered [fy26, fy25] like the live emitter)
        _null_derived_row(
            CHG, "derived", "USD thousands",
            "fy2026_total - fy2025_total",
            json.dumps([F26, F25]), "200000.000", ts,
        ),
        # agency FY2024 millions — program-grain decomposition w/ uncited row
        _null_derived_row(
            A24, "derived", "USD millions",
            "sum(dim_programs.fy2024_actual_millions) for org='DARPA'"
            " (1 programs cited via workbook; 1 uncited)",
            json.dumps([W1, W2]), "150.000", ts,
        ),
        # agency FY2026 thousands — inputs are peer trajectory derived fids
        _null_derived_row(
            A26, "derived", "USD thousands",
            "sum(fct_budget_trajectory.fy2026_total) for org='DARPA'"
            " (2 programs with trajectory rows)",
            json.dumps([F26, G26]), "500000.000", ts,
        ),
        # district cited-dollars sum — inputs are usaspending fids
        _null_derived_row(
            DIST, "derived", "USD",
            "sum(fct_district_programs.total_obligation) for"
            " pop_district='VA-08' over programs with a USAspending citation"
            " (2 of 2)",
            json.dumps([US1, US2]), "70000000.000", ts,
        ),
        # crosswalk link — recorded_value is a confidence tier, NOT a sum
        _null_derived_row(
            DLINK, "derived", None,
            "crosswalk link: pe_bli=0601101E matched to award PIID"
            " HR001124C0001 via method='exact', confidence='high'"
            " (dollars live at award grain in fct_award_transactions)",
            json.dumps([W1, W2]), "high", ts,
        ),
        # <2 inputs — no breakdown
        _null_derived_row(
            fact_id_derived("entity", "ACME", "total_obligation"),
            "derived", "USD",
            "sum(fct_award_transactions.obligation) across 3 UEIs via entity_xwalk",
            json.dumps([W1]), "12345.000", ts,
        ),
        # URL inputs — no breakdown
        _null_derived_row(
            fact_id_derived("influence", "ACME|2024", "lobbying_income_usd"),
            "derived", "USD",
            "sum(income) from LDA filings for this registrant-year",
            json.dumps(["https://lda.senate.gov/x", "https://lda.senate.gov/y"]),
            "990000.000", ts,
        ),
    ]


def _emit(tmp_path: Path, citation_rows: list | None = None) -> int:
    db_path = _make_duckdb(tmp_path)
    json_dir = tmp_path / "json"
    json_dir.mkdir(exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=True)
    try:
        return _emit_breakdowns(
            json_dir=json_dir,
            con=con,
            citation_rows=citation_rows or _citation_rows(),
            bl_rows=_bl_rows(),
            detail_rows=_detail_rows(),
        )
    finally:
        con.close()


def _load(tmp_path: Path, fid: str) -> dict:
    path = tmp_path / "json" / "breakdowns" / f"{fid}.json"
    assert path.exists(), f"breakdowns/{fid}.json missing"
    return json.loads(path.read_text())


def _sum_rows(obj: dict) -> Decimal:
    return sum((Decimal(str(r["v"])) for r in obj["rows"]), Decimal(0))


# ---------------------------------------------------------------------------
# Sum decompositions
# ---------------------------------------------------------------------------


class TestTrajectorySumBreakdown:
    def test_rows_and_exact_sum(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, F24)
        assert obj["fact_id"] == F24
        assert obj["op"] == "sum"
        assert obj["units"] == "USD thousands"
        assert obj["recorded_value"] == "300000.000"
        assert len(obj["rows"]) == 2
        assert abs(_sum_rows(obj) - Decimal("300000.000")) <= Decimal("0.005")

    def test_rows_carry_workbook_labels_and_fids(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, F24)
        by_fid = {r["fid"]: r for r in obj["rows"]}
        assert by_fid[W1]["v"] == 100000.0
        assert by_fid[W1]["label"] == "Line A"
        assert by_fid[W1]["pe_bli"] == "0601101E"
        assert by_fid[W2]["v"] == 200000.0
        assert not by_fid[W1].get("uncited")


class TestDifferenceBreakdown:
    def test_signed_rows_sum_to_delta(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, CHG)
        assert obj["op"] == "difference"
        assert len(obj["rows"]) == 2
        assert abs(_sum_rows(obj) - Decimal("200000.000")) <= Decimal("0.005")

    def test_subtracted_row_marked_and_negative(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, CHG)
        plus = next(r for r in obj["rows"] if r["fid"] == F26)
        minus = next(r for r in obj["rows"] if r["fid"] == F25)
        assert plus["v"] == 400000.0
        assert not plus.get("subtracted")
        assert minus["v"] == -200000.0
        assert minus["subtracted"] is True
        # metric labels, program pe_bli via the trajectory reverse index
        assert "FY2026" in plus["label"]
        assert "FY2025" in minus["label"]
        assert plus["pe_bli"] == "0601101E"


class TestAgencyFy24Breakdown:
    """Program-grain rows; uncited programs appear honestly (⁂ state)."""

    def test_program_rows_sum_with_uncited(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, A24)
        assert obj["op"] == "sum"
        assert len(obj["rows"]) == 2
        assert abs(_sum_rows(obj) - Decimal("150.000")) <= Decimal("0.005")

    def test_cited_row_carries_jbook_fid(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, A24)
        cited = next(r for r in obj["rows"] if r["pe_bli"] == "0601101E")
        assert cited["fid"] == J1
        assert cited["v"] == 100.0
        assert cited["label"] == "DARPA Research"  # dim_pe_titles
        assert not cited.get("uncited")

    def test_uncited_row_marked(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, A24)
        uncited = next(r for r in obj["rows"] if r["pe_bli"] == "0602025E")
        assert uncited["fid"] is None
        assert uncited["uncited"] is True
        assert uncited["v"] == 50.0
        assert uncited["label"] == "DARPA Manufacturing"


class TestAgencyFy26Breakdown:
    def test_rows_from_peer_trajectory_fids(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, A26)
        assert abs(_sum_rows(obj) - Decimal("500000.000")) <= Decimal("0.005")
        by_fid = {r["fid"]: r for r in obj["rows"]}
        assert by_fid[F26]["v"] == 400000.0
        assert by_fid[G26]["v"] == 100000.0
        # labels via dim_pe_titles (pe_bli resolved through the trajectory index)
        assert by_fid[F26]["label"] == "DARPA Research"
        assert by_fid[G26]["label"] == "DARPA Manufacturing"
        assert by_fid[G26]["pe_bli"] == "0602025E"


class TestDistrictBreakdown:
    def test_rows_from_usaspending_fids(self, tmp_path):
        _emit(tmp_path)
        obj = _load(tmp_path, DIST)
        assert abs(_sum_rows(obj) - Decimal("70000000.000")) <= Decimal("0.005")
        by_fid = {r["fid"]: r for r in obj["rows"]}
        assert by_fid[US1]["pe_bli"] == "0601101E"
        assert by_fid[US1]["v"] == 50000000.0
        assert by_fid[US1]["label"] == "DARPA Research"


# ---------------------------------------------------------------------------
# Honest exclusions
# ---------------------------------------------------------------------------


class TestExclusions:
    def test_crosswalk_link_gets_no_breakdown(self, tmp_path):
        _emit(tmp_path)
        assert not (tmp_path / "json" / "breakdowns" / f"{DLINK}.json").exists()

    def test_lt2_inputs_no_breakdown(self, tmp_path):
        _emit(tmp_path)
        fid = fact_id_derived("entity", "ACME", "total_obligation")
        assert not (tmp_path / "json" / "breakdowns" / f"{fid}.json").exists()

    def test_url_inputs_no_breakdown(self, tmp_path):
        _emit(tmp_path)
        fid = fact_id_derived("influence", "ACME|2024", "lobbying_income_usd")
        assert not (tmp_path / "json" / "breakdowns" / f"{fid}.json").exists()

    def test_sum_mismatch_skipped(self, tmp_path, capsys):
        """A derived row whose inputs do NOT sum to recorded_value never
        ships a breakdown (the 5B-1 derived gate owns that failure)."""
        ts = "2026-07-02T00:00:00+00:00"
        bad_fid = fact_id_derived("trajectory", "0699999E|DARPA", "fy2024_actuals")
        rows = _citation_rows() + [
            _null_derived_row(
                bad_fid, "derived", "USD thousands",
                "sum(budget_lines.amount_thousands where amount_type=fy_2024_actuals)",
                json.dumps([W1, W2]), "999999.000", ts,
            ),
        ]
        _emit(tmp_path, citation_rows=rows)
        assert not (tmp_path / "json" / "breakdowns" / f"{bad_fid}.json").exists()
        assert "mismatch" in capsys.readouterr().out.lower()

    def test_returns_breakdown_file_count(self, tmp_path):
        n = _emit(tmp_path)
        json_dir = tmp_path / "json" / "breakdowns"
        assert n == len(list(json_dir.glob("*.json")))
        # F24 sum, CHG difference, A24 agency, A26 agency-fy26, DIST district
        assert n == 5
