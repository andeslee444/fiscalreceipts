"""PM-review Sprint 3 Task 1b — the zeroed_fy2026 feed class published false claims.

Two stacked defects shipped 87 cards reading e.g. "Defense Research Sciences
zeroed out in FY2026 (had $0 in FY25)". Both halves were false.

Defect A — the mart conflated ABSENT with ZERO.
  fct_feed_events' `zeroed` CTE filtered `coalesce(fy2026_total, 0) = 0`
  against fct_budget_trajectory. All 87 live rows had fy2026_total NULL; not
  one was a genuine zero. NULL there means "this PE carries no FY2026 row",
  which in the source workbook means the FY2026 cells are BLANK.

  Ground truth (data/raw_docs/fy2026/dod/r1_display.xlsx, the official DoD
  FY2026 R-1 display workbook, verified directly):
    0601101E "Defense Research Sciences" — FY2024 Actuals 280494,
      FY2025 Enacted 293145, FY2025 Total 293145,
      FY 2026 Disc Request '', FY 2026 Total ''      <- BLANK, not 0
    E00700 "E-7" (p1_display.xlsx) — FY2025 Total 200000,
      FY2026 Total 0                                  <- LITERAL 0
  DoD distinguishes blank from zero inside one file, and rollup_loader.py
  preserves that distinction (it skips None/'' cells and stores literal 0s;
  the corpus holds 64,719 explicit zero rows). So absence is NOT evidence of
  zeroing, and the predicate must demand positive evidence.

Defect B — the exporter formatted the WRONG variable.
  The mart sets headline_value = fy2025_total (the real FY25 money) and
  comparison_value = 0. export_site.py printed comparison_value as the FY25
  amount, so $7.07B of real FY25 money rendered as "$0" on every card.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import duckdb

from govbudget.export_site import _emit_feed_sidecar

ROOT = Path(__file__).resolve().parents[1]
MODEL_SQL = ROOT / "dbt" / "models" / "marts" / "fct_feed_events.sql"


def _render_model_sql() -> str:
    """Render the SHIPPED mart file with every ref() pointed at a fixture.

    Executing the real model file (the dim_pe_titles test's technique) is the
    point: a predicate documented in a comment but not shipped in SQL cannot
    satisfy these tests.
    """
    sql = MODEL_SQL.read_text()
    for model in (
        "fct_budget_trajectory",
        "fct_award_transactions",
        "fct_budget_to_awards",
        "entity_xwalk",
    ):
        sql = re.sub(r"\{\{\s*ref\('" + model + r"'\)\s*\}\}", model, sql)
    assert "{{" not in sql, "unrendered jinja left in model SQL"
    return sql


def _run_mart(traj_rows: list[tuple]) -> list[tuple]:
    """Run the shipped mart over fixture trajectory rows.

    traj_rows: (pe_bli, organization, fy2024_actuals, fy2025_total,
                fy2026_total, fy2526_change, fy2526_pct_change)
    The award-side CTEs are fed empty tables — this fixture exercises the
    budget-derived event classes only.
    """
    con = duckdb.connect()
    con.execute(
        "create table fct_budget_trajectory ("
        " pe_bli varchar, organization varchar, fy2024_actuals double,"
        " fy2025_total double, fy2026_total double, fy2526_change double,"
        " fy2526_pct_change double)"
    )
    if traj_rows:
        con.executemany(
            "insert into fct_budget_trajectory values (?,?,?,?,?,?,?)", traj_rows
        )
    con.execute(
        "create table fct_award_transactions ("
        " award_id_piid varchar, fiscal_year integer, recipient_uei varchar,"
        " obligation double)"
    )
    con.execute(
        "create table fct_budget_to_awards ("
        " award_piid varchar, pe_bli varchar, confidence varchar)"
    )
    con.execute("create table entity_xwalk (recipient_uei varchar, family_key varchar)")
    out = con.execute(_render_model_sql()).fetchall()
    con.close()
    return out


def _zeroed(traj_rows: list[tuple]) -> list[tuple]:
    return [r for r in _run_mart(traj_rows) if r[0] == "zeroed_fy2026"]


# ---------------------------------------------------------------------------
# Defect A — the predicate must demand positive evidence of a zero
# ---------------------------------------------------------------------------


class TestZeroedRequiresPositiveEvidence:
    def test_absent_from_fy2026_emits_no_card(self):
        """The live defect: all 87 shipped cards were this shape.

        0601101E's FY2026 workbook cells are BLANK, so no fy_2026_total row
        exists and the trajectory pivot yields NULL. A program we hold no
        FY2026 figure for has not been shown to be zeroed.
        """
        got = _zeroed([("0601101E", "DARPA", 280494.0, 293145.0, None, None, None)])
        assert got == [], (
            "a PE with NULL fy2026_total (absent from the FY2026 extract) must "
            f"NOT be claimed as zeroed — absence of evidence is not evidence of "
            f"zero; got {got}"
        )

    def test_literal_zero_with_fy25_money_emits_a_card(self):
        """The honest positive case: the workbook says 0, so we may say zeroed."""
        got = _zeroed([("E00700", "F", None, 200000.0, 0.0, -200000.0, -100.0)])
        assert len(got) == 1, (
            f"a PE the corpus records as literally 0 in FY2026 with positive "
            f"FY2025 money IS a genuine zeroing and must emit; got {got}"
        )

    def test_positive_fy2026_emits_no_card(self):
        got = _zeroed([("0601122E", "DARPA", None, 100.0, 360456.0, 360356.0, 360356.0)])
        assert got == [], f"a funded FY2026 program must never be called zeroed; got {got}"

    def test_headline_value_carries_the_fy25_money_not_zero(self):
        """headline_value is the newsworthy magnitude; comparison_value is the 0."""
        (row,) = _zeroed([("E00700", "F", None, 200000.0, 0.0, -200000.0, -100.0)])
        headline_value, comparison_value = row[4], row[5]
        assert headline_value == 200000.0, (
            f"headline_value must carry FY2025 money, got {headline_value}"
        )
        assert comparison_value == 0.0, (
            f"comparison_value must carry the FY2026 zero, got {comparison_value}"
        )

    def test_the_live_87_shaped_corpus_yields_nothing(self):
        """A whole fixture corpus shaped like the live one emits zero cards.

        Every row is 'had FY2025 money, absent from FY2026' — the exact shape
        of all 87 live rows. The honest predicate must empty the class rather
        than keep the count up.
        """
        rows = [
            (f"060{i:04d}A", "A", 1000.0, 5000.0, None, None, None) for i in range(20)
        ]
        assert _zeroed(rows) == []


# ---------------------------------------------------------------------------
# Defect B — the headline must print the real FY25 money
# ---------------------------------------------------------------------------


def _feed_cards(tmp_path: Path, feed_rows_sql: str) -> list[dict]:
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_feed_events ("
        " event_type varchar, pe_bli varchar, organization varchar,"
        " family_key varchar, headline_value double, comparison_value double,"
        " pct_change double, fiscal_year integer, units varchar,"
        " detail_json varchar)"
    )
    con.execute(f"insert into fct_feed_events values {feed_rows_sql}")
    con.execute("create table dim_pe_titles (pe_bli varchar, title varchar)")
    con.execute("insert into dim_pe_titles values ('E00700', 'E-7')")
    json_dir = tmp_path / "json"
    json_dir.mkdir()
    try:
        _emit_feed_sidecar(
            json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set()
        )
    finally:
        con.close()
    return json.loads((json_dir / "feed.json").read_text())["cards"]


class TestZeroedHeadlineUsesRealMoney:
    def test_headline_states_the_fy25_money_not_zero(self, tmp_path):
        """The shipped bug printed comparison_value (always 0) as the FY25 amount."""
        cards = _feed_cards(
            tmp_path,
            "('zeroed_fy2026', 'E00700', 'F', NULL, 200000.0, 0.0, NULL, 2026,"
            " 'thousands_usd', NULL)",
        )
        (card,) = [c for c in cards if c["event_type"] == "zeroed_fy2026"]
        assert "$200.0M" in card["headline"], (
            "the headline must state the real FY2025 money ($200.0M from "
            f"headline_value), not comparison_value: {card['headline']!r}"
        )
        assert "$0" not in card["headline"], (
            f"the headline must never claim $0 of FY2025 money: {card['headline']!r}"
        )

    def test_figure_value_is_the_fy25_money(self, tmp_path):
        cards = _feed_cards(
            tmp_path,
            "('zeroed_fy2026', 'E00700', 'F', NULL, 200000.0, 0.0, NULL, 2026,"
            " 'thousands_usd', NULL)",
        )
        (card,) = [c for c in cards if c["event_type"] == "zeroed_fy2026"]
        assert card["figure_value"] == 200000.0, (
            f"the cited figure must be the FY2025 money, got {card['figure_value']}"
        )
