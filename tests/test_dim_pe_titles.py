"""Tests for backlog #14: dim_pe_titles mart — shared program-title resolution.

Scope:
  - The mart SQL's deterministic rule (largest fy_2024_actuals detail row's
    title, alphabetical tiebreak / no-fy24 fallback), executed from the actual
    model file so the documented rule and the shipped SQL cannot drift.
  - _emit_feed_sidecar consumes dim_pe_titles (not an inline fct_budget_lines
    lookup) for pe_blis outside dim_programs.
  - Graceful degradation when dim_pe_titles is absent (fixture DBs, partial
    builds): feed.json still emits, prog_titles / raw-code fallback holds.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import duckdb

from govbudget.export_site import _emit_feed_sidecar

ROOT = Path(__file__).resolve().parents[1]
MODEL_SQL = ROOT / "dbt" / "models" / "marts" / "dim_pe_titles.sql"


def _render_model_sql(source_table: str) -> str:
    """Render the dbt model file with ref() pointed at a fixture table."""
    sql = MODEL_SQL.read_text()
    sql = re.sub(r"\{\{\s*ref\('fct_budget_lines'\)\s*\}\}", source_table, sql)
    assert "{{" not in sql, "unrendered jinja left in model SQL"
    return sql


def _titles(rows: list[tuple]) -> dict[str, str]:
    """Run the model SQL over fixture (pe_bli, title, amount_type, amount) rows."""
    con = duckdb.connect()
    con.execute(
        "create table bl (pe_bli varchar, title varchar,"
        " amount_type varchar, amount_thousands double)"
    )
    con.executemany("insert into bl values (?, ?, ?, ?)", rows)
    out = con.execute(_render_model_sql("bl")).fetchall()
    con.close()
    return {r[0]: r[1] for r in out}


# ---------------------------------------------------------------------------
# Deterministic rule — executed from the shipped model file
# ---------------------------------------------------------------------------


class TestDimPeTitlesRule:
    def test_largest_fy24_row_wins(self):
        got = _titles([
            ("0601101E", "Small Project", "fy_2024_actuals", 10.0),
            ("0601101E", "Big Project", "fy_2024_actuals", 900.0),
            # Larger amount but wrong amount_type — must not win
            ("0601101E", "Huge FY26 Project", "fy_2026_total", 99999.0),
        ])
        assert got == {"0601101E": "Big Project"}

    def test_alphabetical_tiebreak_on_equal_fy24(self):
        got = _titles([
            ("0602303E", "Zulu Program", "fy_2024_actuals", 500.0),
            ("0602303E", "Alpha Program", "fy_2024_actuals", 500.0),
        ])
        assert got == {"0602303E": "Alpha Program"}

    def test_no_fy24_rows_falls_back_alphabetical(self):
        got = _titles([
            ("0101213F", "Beta Effort", "fy_2025_total", 100.0),
            ("0101213F", "Aardvark Effort", "fy_2026_total", 999.0),
        ])
        assert got == {"0101213F": "Aardvark Effort"}

    def test_untitled_and_null_pe_rows_excluded(self):
        got = _titles([
            ("0603456A", None, "fy_2024_actuals", 999.0),   # R-1 rollup row
            ("0603456A", "Titled Row", "fy_2024_actuals", 1.0),
            (None, "Orphan Title", "fy_2024_actuals", 5.0),
        ])
        assert got == {"0603456A": "Titled Row"}

    def test_one_row_per_pe_bli(self):
        """Same property the dbt unique test on pe_bli guards."""
        con = duckdb.connect()
        con.execute(
            "create table bl (pe_bli varchar, title varchar,"
            " amount_type varchar, amount_thousands double)"
        )
        con.executemany(
            "insert into bl values (?, ?, ?, ?)",
            [
                ("0601101E", "A", "fy_2024_actuals", 1.0),
                ("0601101E", "B", "fy_2025_total", 2.0),
                ("0602303E", "C", "fy_2024_actuals", 3.0),
            ],
        )
        dupes = con.execute(
            f"select count(*) from ({_render_model_sql('bl')})"
            " group by pe_bli having count(*) > 1"
        ).fetchall()
        con.close()
        assert dupes == []


# ---------------------------------------------------------------------------
# Feed exporter consumes the mart
# ---------------------------------------------------------------------------


def _make_feed_db(tmp_path: Path, *, with_titles_mart: bool) -> Path:
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE fct_feed_events ("
        "  event_type varchar, pe_bli varchar, organization varchar,"
        "  family_key varchar, headline_value double, comparison_value double,"
        "  pct_change double, fiscal_year integer, units varchar, detail_json varchar"
        ")"
    )
    # '0101213F' is a trajectory-only pe_bli: NOT in prog_titles (dim_programs)
    con.execute(
        "INSERT INTO fct_feed_events VALUES "
        "('yoy_swing', '0101213F', 'Air Force', NULL, 400000.0, 200000.0,"
        " 79.0, 2026, 'thousands_usd', NULL)"
    )
    if with_titles_mart:
        con.execute("CREATE TABLE dim_pe_titles (pe_bli varchar, title varchar)")
        con.execute(
            "INSERT INTO dim_pe_titles VALUES ('0101213F', 'Air Operations Center')"
        )
    con.close()
    return db_path


class TestFeedSidecarConsumesMart:
    def test_title_resolved_from_dim_pe_titles(self, tmp_path):
        """Trajectory-only pe_bli resolves via the mart — no inline lookup."""
        db_path = _make_feed_db(tmp_path, with_titles_mart=True)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(
                json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set()
            )
        finally:
            con.close()

        card = json.loads((json_dir / "feed.json").read_text())["cards"][0]
        assert card["title"] == "Air Operations Center"
        assert card["headline"].startswith("Air Operations Center ")

    def test_prog_titles_wins_over_mart(self, tmp_path):
        """dim_programs title (matches program-page heading) stays first."""
        db_path = _make_feed_db(tmp_path, with_titles_mart=True)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(
                json_dir=json_dir,
                con=con,
                prog_titles={"0101213F": "Program Page Title"},
                cited_fact_ids=set(),
            )
        finally:
            con.close()

        card = json.loads((json_dir / "feed.json").read_text())["cards"][0]
        assert card["title"] == "Program Page Title"

    def test_missing_mart_degrades_to_raw_code(self, tmp_path):
        """No dim_pe_titles table (fixture/partial DB): feed still emits."""
        db_path = _make_feed_db(tmp_path, with_titles_mart=False)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(
                json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set()
            )
        finally:
            con.close()

        card = json.loads((json_dir / "feed.json").read_text())["cards"][0]
        assert card["title"] is None
        assert card["headline"].startswith("0101213F ")
