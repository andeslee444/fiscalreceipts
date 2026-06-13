"""Tests for Phase 5B-3 Tasks 4 + 5: feed sidecar + district sidecars.

TDD scope:
  - _emit_feed_sidecar: shapes, card fields, event_type coverage, fact_id wiring
  - _emit_district_sidecars: index + per-district files, cited fact_ids, geo total
  - feed event derived citation rows (concentration_shift HHI)
  - search_quick.json includes feed + district entries (via integration smoke)
"""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import (
    _emit_feed_sidecar,
    _emit_district_sidecars,
    fact_id_derived,
    fact_id_usaspending,
    _write_json,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_duckdb_with_feed(tmp_path: Path) -> Path:
    """Create a DuckDB with fct_feed_events and supporting tables for feed tests."""
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))

    # dim_programs (referenced for prog_titles)
    con.execute(
        "CREATE TABLE dim_programs ("
        "  pe_bli varchar, org varchar, exhibit_family varchar, title varchar,"
        "  project_count integer, fy2024_actual_millions double, fully_reconciled boolean"
        ")"
    )
    con.execute(
        "INSERT INTO dim_programs VALUES "
        "('0601101E', 'DARPA', 'RDT&E', 'Defense Advanced Research Projects Agency', 1, 100.0, true),"
        "('0602303E', 'Army', 'RDT&E', 'Army Research Laboratory', 1, 50.0, false)"
    )

    # fct_budget_trajectory (for yoy_swing + zeroed)
    con.execute(
        "CREATE TABLE fct_budget_trajectory ("
        "  pe_bli varchar, organization varchar,"
        "  fy2024_actuals double, fy2025_total double, fy2026_total double,"
        "  fy2526_change double, fy2526_pct_change double"
        ")"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES "
        "('0601101E', 'DARPA', 100000.0, 200000.0, 400000.0, 200000.0, 100.0),"   # 100% swing
        "('0602303E', 'Army', 50000.0, 60000.0, 0.0, -60000.0, -100.0)"           # zeroed
    )

    # fct_feed_events
    con.execute(
        "CREATE TABLE fct_feed_events ("
        "  event_type varchar, pe_bli varchar, organization varchar,"
        "  family_key varchar, headline_value double, comparison_value double,"
        "  pct_change double, fiscal_year integer, units varchar, detail_json varchar"
        ")"
    )
    con.execute(
        "INSERT INTO fct_feed_events VALUES "
        "('yoy_swing', '0601101E', 'DARPA', NULL, 400000.0, 200000.0, 100.0, 2026, 'thousands_usd', NULL),"
        "('zeroed_fy2026', '0602303E', 'Army', NULL, 60000.0, 0.0, NULL, 2026, 'thousands_usd', NULL),"
        "('concentration_shift', '0601101E', NULL, NULL, 5000.0, 3000000.0, NULL, 2024, 'hhi_dollars', NULL),"
        "('new_entrant', NULL, NULL, 'ACME LLC', 2000000.0, 2024.0, NULL, 2024, 'dollars', NULL)"
    )

    con.close()
    return db_path


def _make_duckdb_with_districts(tmp_path: Path) -> Path:
    """Create a DuckDB with fct_district_programs and dim_geography."""
    db_path = tmp_path / "govbudget.duckdb"
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
        "('VA', 'VA-08', '0601101E', 'DARPA', 'DARPA', 15, 5, 3, 50000000.0),"
        "('VA', 'VA-08', '0602303E', 'Army Research', 'Army', 8, 3, 2, 20000000.0),"
        "('CA', 'CA-18', '0601101E', 'DARPA', 'DARPA', 7, 2, 1, 15000000.0)"
    )

    con.execute(
        "CREATE TABLE dim_geography ("
        "  state varchar, district varchar, total_obligation double, obligation_type varchar"
        ")"
    )
    con.execute(
        "INSERT INTO dim_geography VALUES "
        "('VA', 'VA-08', 500000000.0, 'contract'),"
        "('CA', 'CA-18', 200000000.0, 'contract')"
    )

    con.close()
    return db_path


# ---------------------------------------------------------------------------
# Feed sidecar tests
# ---------------------------------------------------------------------------


class TestEmitFeedSidecar:
    def test_creates_feed_json(self, tmp_path):
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        prog_titles = {"0601101E": "Defense Advanced Research Projects Agency",
                       "0602303E": "Army Research Laboratory"}
        cited_fact_ids: set = set()
        try:
            _emit_feed_sidecar(
                json_dir=json_dir,
                con=con,
                prog_titles=prog_titles,
                cited_fact_ids=cited_fact_ids,
            )
        finally:
            con.close()

        feed_path = json_dir / "feed.json"
        assert feed_path.exists(), "feed.json was not created"
        data = json.loads(feed_path.read_text())
        assert "cards" in data
        assert "total" in data
        assert data["total"] == 4  # 4 rows in fct_feed_events

    def test_all_event_types_present(self, tmp_path):
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(
                json_dir=json_dir,
                con=con,
                prog_titles={},
                cited_fact_ids=set(),
            )
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        types = {c["event_type"] for c in data["cards"]}
        assert "yoy_swing" in types
        assert "zeroed_fy2026" in types
        assert "concentration_shift" in types
        assert "new_entrant" in types

    def test_card_required_fields(self, tmp_path):
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        required = {"event_type", "headline", "figure_value", "figure_units",
                    "why_url", "figure_fact_id"}
        for card in data["cards"]:
            for field in required:
                assert field in card, f"Card missing field {field!r}: {card}"

    def test_why_url_contains_event_type(self, tmp_path):
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        for card in data["cards"]:
            assert card["event_type"] in card["why_url"], (
                f"why_url {card['why_url']!r} does not contain event_type {card['event_type']!r}"
            )

    def test_yoy_swing_program_url(self, tmp_path):
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        yoy = [c for c in data["cards"] if c["event_type"] == "yoy_swing"]
        assert len(yoy) > 0
        # program_url should be set when pe_bli is present
        assert yoy[0]["program_url"] == "/program/0601101E/"

    def test_concentration_shift_fact_id_wired(self, tmp_path):
        """When a concentration_shift derived fact_id is in cited_fact_ids, it is wired."""
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()

        # Pre-compute the fact_id that should be wired
        fid = fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(
                json_dir=json_dir,
                con=con,
                prog_titles={},
                cited_fact_ids={fid},
            )
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        conc = [c for c in data["cards"] if c["event_type"] == "concentration_shift"]
        assert len(conc) > 0
        # The fact_id should be wired since it's in cited_fact_ids
        assert conc[0]["figure_fact_id"] == fid

    def test_new_entrant_no_pe_bli(self, tmp_path):
        """new_entrant cards have pe_bli=None and family_key set."""
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        new_e = [c for c in data["cards"] if c["event_type"] == "new_entrant"]
        assert len(new_e) > 0
        assert new_e[0]["pe_bli"] is None
        assert new_e[0]["family_key"] == "ACME LLC"
        # No program_url for new_entrant (no pe_bli)
        assert new_e[0]["program_url"] is None

    def test_empty_table_produces_empty_feed(self, tmp_path):
        """If fct_feed_events is empty, feed.json has total=0 and empty cards."""
        db_path = tmp_path / "empty.duckdb"
        con = duckdb.connect(str(db_path))
        con.execute(
            "CREATE TABLE fct_feed_events ("
            "  event_type varchar, pe_bli varchar, organization varchar,"
            "  family_key varchar, headline_value double, comparison_value double,"
            "  pct_change double, fiscal_year integer, units varchar, detail_json varchar"
            ")"
        )
        con.close()

        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        data = json.loads((json_dir / "feed.json").read_text())
        assert data["total"] == 0
        assert data["cards"] == []

    def test_missing_table_produces_empty_feed(self, tmp_path):
        """If fct_feed_events doesn't exist, feed.json still created with empty cards."""
        db_path = tmp_path / "no_feed.duckdb"
        duckdb.connect(str(db_path)).close()  # empty db

        json_dir = tmp_path / "json"
        json_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(json_dir=json_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        feed_path = json_dir / "feed.json"
        assert feed_path.exists()
        data = json.loads(feed_path.read_text())
        assert data["total"] == 0


# ---------------------------------------------------------------------------
# District sidecar tests
# ---------------------------------------------------------------------------


class TestEmitDistrictSidecars:
    def test_creates_index_and_district_files(self, tmp_path):
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        prog_titles = {"0601101E": "DARPA", "0602303E": "Army Research"}
        cited_fact_ids: set = set()

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            n = _emit_district_sidecars(
                dist_dir=dist_dir,
                con=con,
                prog_titles=prog_titles,
                cited_fact_ids=cited_fact_ids,
            )
        finally:
            con.close()

        # 2 districts + 1 index = 3
        assert n == 3
        assert (dist_dir / "index.json").exists()
        assert (dist_dir / "VA-08.json").exists()
        assert (dist_dir / "CA-18.json").exists()

    def test_index_has_correct_totals(self, tmp_path):
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(dist_dir=dist_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        index = json.loads((dist_dir / "index.json").read_text())
        assert index["total_districts"] == 2
        assert len(index["districts"]) == 2
        # geo_grand_total should be 700M (500M + 200M)
        assert index["geo_grand_total"] == pytest.approx(700_000_000.0)
        assert index["geo_grand_total_dataset"] == "dim_geography"

    def test_district_file_has_programs(self, tmp_path):
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(dist_dir=dist_dir, con=con,
                                     prog_titles={"0601101E": "DARPA"},
                                     cited_fact_ids=set())
        finally:
            con.close()

        va = json.loads((dist_dir / "VA-08.json").read_text())
        assert va["pop_district"] == "VA-08"
        assert va["pop_state"] == "VA"
        assert va["program_count"] == 2
        assert len(va["programs"]) == 2

    def test_program_url_format(self, tmp_path):
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(dist_dir=dist_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        va = json.loads((dist_dir / "VA-08.json").read_text())
        for prog in va["programs"]:
            assert prog["program_url"] == f"/program/{prog['pe_bli']}/"

    def test_fact_id_wired_when_in_cited_set(self, tmp_path):
        """When a usaspending fact_id is in cited_fact_ids, it appears in the program."""
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()

        # Pre-compute the fact_id for VA-08 / 0601101E
        fid = fact_id_usaspending("district_program", "VA|VA-08|0601101E", "total_obligation")

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(
                dist_dir=dist_dir,
                con=con,
                prog_titles={},
                cited_fact_ids={fid},
            )
        finally:
            con.close()

        va = json.loads((dist_dir / "VA-08.json").read_text())
        darpa_prog = next(p for p in va["programs"] if p["pe_bli"] == "0601101E")
        assert darpa_prog["fact_id"] == fid

    def test_fact_id_null_when_not_in_cited_set(self, tmp_path):
        """When fact_id is NOT in cited_fact_ids, the program's fact_id is null."""
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(
                dist_dir=dist_dir, con=con, prog_titles={}, cited_fact_ids=set()
            )
        finally:
            con.close()

        va = json.loads((dist_dir / "VA-08.json").read_text())
        for prog in va["programs"]:
            assert prog["fact_id"] is None

    def test_cited_dollars_sum(self, tmp_path):
        """total_cited_dollars is sum of obligations where fact_id is in cited set."""
        db_path = _make_duckdb_with_districts(tmp_path)
        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()

        # Wire one fact_id (DARPA in VA-08)
        fid = fact_id_usaspending("district_program", "VA|VA-08|0601101E", "total_obligation")

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(
                dist_dir=dist_dir, con=con, prog_titles={}, cited_fact_ids={fid}
            )
        finally:
            con.close()

        va = json.loads((dist_dir / "VA-08.json").read_text())
        # Only DARPA (50M) is cited; Army (20M) is not
        assert va["total_cited_dollars"] == pytest.approx(50_000_000.0)
        assert va["total_linkable_dollars"] == pytest.approx(70_000_000.0)

    def test_empty_table_produces_empty_index(self, tmp_path):
        db_path = tmp_path / "empty.duckdb"
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
            "CREATE TABLE dim_geography ("
            "  state varchar, district varchar, total_obligation double, obligation_type varchar"
            ")"
        )
        con.close()

        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            n = _emit_district_sidecars(dist_dir=dist_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        # Only the index file (1)
        assert n == 1
        index = json.loads((dist_dir / "index.json").read_text())
        assert index["total_districts"] == 0
        assert index["districts"] == []

    def test_missing_dim_geography_graceful(self, tmp_path):
        """If dim_geography is missing, geo_grand_total is None and export succeeds."""
        db_path = tmp_path / "no_geo.duckdb"
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
            "INSERT INTO fct_district_programs VALUES ('TX', 'TX-01', '0601101E', 'DARPA', 'DARPA', 3, 1, 1, 5000000.0)"
        )
        con.close()

        dist_dir = tmp_path / "districts"
        dist_dir.mkdir()
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_district_sidecars(dist_dir=dist_dir, con=con, prog_titles={}, cited_fact_ids=set())
        finally:
            con.close()

        index = json.loads((dist_dir / "index.json").read_text())
        assert index["geo_grand_total"] is None


# ---------------------------------------------------------------------------
# fact_id_derived for feed concentration shift
# ---------------------------------------------------------------------------


class TestFeedDerivedCitationKey:
    def test_stable_and_16hex(self):
        fid = fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")
        assert len(fid) == 16
        assert all(c in "0123456789abcdef" for c in fid)
        # Stable
        assert fid == fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")

    def test_differs_by_year(self):
        a = fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")
        b = fact_id_derived("feed", "concentration_shift|0601101E|2025", "hhi")
        assert a != b

    def test_differs_by_pe_bli(self):
        a = fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")
        b = fact_id_derived("feed", "concentration_shift|0602303E|2024", "hhi")
        assert a != b

    def test_hhi_vs_matched_dollars_differ(self):
        a = fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")
        b = fact_id_derived("feed", "concentration_shift|0601101E|2024", "matched_dollars")
        assert a != b

    def test_hash_prefix_correct(self):
        fid = fact_id_derived("feed", "concentration_shift|X|2024", "hhi")
        expected = hashlib.sha256(
            "derived|feed|concentration_shift|X|2024|hhi".encode()
        ).hexdigest()[:16]
        assert fid == expected


class TestFeedFiguresCited:
    """Regression: every dollar/HHI feed figure must be citable (live-schema fix).

    fct_feed_events has NO hhi/matched_dollars columns — concentration values
    live in headline_value/comparison_value.  The derived builder must read
    those (a naive select threw and silently dropped every feed citation,
    leaving /feed state-C for a dataset off the uncited ledger).  new_entrant
    dollar figures get their own derived rows.
    """

    def _derived_rows(self, tmp_path):
        from govbudget.export_site import _build_derived_citation_rows

        db_path = _make_duckdb_with_feed(tmp_path)
        return _build_derived_citation_rows(
            duckdb_path=db_path, bl_rows=[], citation_rows=[]
        )

    def test_concentration_rows_emitted_from_live_schema(self, tmp_path):
        rows = self._derived_rows(tmp_path)
        fids = {r[0] for r in rows}
        # fixture: ('concentration_shift', '0601101E', …, 5000.0, 3000000.0, …, 2024, …)
        hhi_fid = fact_id_derived("feed", "concentration_shift|0601101E|2024", "hhi")
        dollars_fid = fact_id_derived(
            "feed", "concentration_shift|0601101E|2024", "matched_dollars"
        )
        assert hhi_fid in fids
        assert dollars_fid in fids
        hhi_row = next(r for r in rows if r[0] == hhi_fid)
        assert hhi_row[23] == "5000.000"  # recorded_value = headline_value

    def test_new_entrant_rows_emitted(self, tmp_path):
        rows = self._derived_rows(tmp_path)
        ne_fid = fact_id_derived("feed", "new_entrant|ACME LLC", "total_obligation")
        ne_row = next((r for r in rows if r[0] == ne_fid), None)
        assert ne_row is not None
        assert ne_row[2] == "USD"
        assert ne_row[23] == "2000000.000"  # recorded_value = headline_value
        # Recompute-safe shape: formula non-empty, not a budget_lines sum
        assert ne_row[20]
        assert not ne_row[20].startswith("sum(budget_lines")

    def test_new_entrant_figure_fact_id_wired(self, tmp_path):
        db_path = _make_duckdb_with_feed(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        ne_fid = fact_id_derived("feed", "new_entrant|ACME LLC", "total_obligation")
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_feed_sidecar(
                json_dir=json_dir, con=con, prog_titles={},
                cited_fact_ids={ne_fid},
            )
        finally:
            con.close()
        data = json.loads((json_dir / "feed.json").read_text())
        new_e = [c for c in data["cards"] if c["event_type"] == "new_entrant"]
        assert new_e[0]["figure_fact_id"] == ne_fid
