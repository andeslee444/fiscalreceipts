"""Tests for backlog #17: program pages for trajectory-only feed PEs.

`_trajectory_only_feed_programs` synthesizes dim_programs-shaped rows for
pe_blis that have feed events + trajectory data but no dim_programs entry
(no R-2/P-40 J-book detail). These rows feed programs.json /
program_details/{pe}.json / search_quick.json so the 136 feed dead-ends
get real pages.

Contract under test:
  - only feed-referenced pe_blis OUTSIDE the existing (dim_programs) set
  - title comes from dim_pe_titles; titleless pe_blis are skipped (loud, honest)
  - pe_blis without any trajectory row are skipped (nothing to render)
  - exhibit_family derived from fct_budget_lines exhibits (R-* -> rdte,
    P-* -> procurement)
  - tuple shape mirrors the dim_programs sidecar row exactly:
    (pe_bli, org, exhibit_family, title, project_count=0,
     fy2024_actual_millions=None, fully_reconciled=False)
  - deterministic: ordered by pe_bli; multi-org PEs resolve to ONE row
    (largest fy2026_total wins, org ascending tiebreak)
"""
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import _trajectory_only_feed_programs


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def feed_con(tmp_path: Path):
    """DuckDB with the marts the helper reads.

    Layout:
      0601101E — in dim_programs (existing set) + feed event  -> excluded
      0602144A — trajectory + feed + title, R-1 lines         -> included (rdte)
      0604999F — trajectory + feed + title, P-1 lines          -> included (procurement)
      0605000N — trajectory + title, NO feed event             -> excluded
      0606000A — feed + trajectory, NO dim_pe_titles row       -> excluded (loud skip)
      0607000F — feed, NO trajectory row                       -> excluded
      0608000A — feed + trajectory under TWO orgs              -> ONE row, org w/ larger fy26
    """
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))

    con.execute(
        "CREATE TABLE fct_feed_events ("
        " event_type varchar, pe_bli varchar, organization varchar,"
        " family_key varchar, headline_value double, comparison_value double,"
        " pct_change double, fiscal_year integer, units varchar, detail_json varchar)"
    )
    con.execute(
        "INSERT INTO fct_feed_events VALUES"
        " ('yoy_swing', '0601101E', 'DARPA', NULL, 1.0, 1.0, 10.0, 2026, 'thousands_usd', NULL),"
        " ('yoy_swing', '0602144A', 'A', NULL, 1.0, 1.0, -64.0, 2026, 'thousands_usd', NULL),"
        " ('zeroed_fy2026', '0602144A', 'A', NULL, 1.0, 0.0, NULL, 2026, 'thousands_usd', NULL),"
        " ('yoy_swing', '0604999F', 'F', NULL, 1.0, 1.0, 55.0, 2026, 'thousands_usd', NULL),"
        " ('yoy_swing', '0606000A', 'A', NULL, 1.0, 1.0, 20.0, 2026, 'thousands_usd', NULL),"
        " ('yoy_swing', '0607000F', 'F', NULL, 1.0, 1.0, 30.0, 2026, 'thousands_usd', NULL),"
        " ('yoy_swing', '0608000A', 'A', NULL, 1.0, 1.0, 40.0, 2026, 'thousands_usd', NULL),"
        " ('new_entrant', NULL, NULL, 'ACME', 1.0, 2024.0, NULL, 2024, 'dollars', NULL)"
    )

    con.execute(
        "CREATE TABLE fct_budget_trajectory ("
        " pe_bli varchar, organization varchar, fy2024_actuals double,"
        " fy2025_total double, fy2026_total double, fy2526_change double,"
        " fy2526_pct_change double)"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES"
        " ('0601101E', 'DARPA', 1.0, 2.0, 3.0, 1.0, 50.0),"
        " ('0602144A', 'A', 266663.0, 155829.0, 56342.0, -99487.0, -63.8),"
        " ('0604999F', 'F', 10.0, 20.0, 31.0, 11.0, 55.0),"
        " ('0605000N', 'N', 5.0, 6.0, 7.0, 1.0, 16.7),"
        " ('0606000A', 'A', 1.0, 2.0, 3.0, 1.0, 50.0),"
        " ('0608000A', 'A', 1.0, 2.0, 100.0, 98.0, 4900.0),"
        " ('0608000A', 'OSD', 1.0, 2.0, 3.0, 1.0, 50.0)"
    )

    con.execute("CREATE TABLE dim_pe_titles (pe_bli varchar, title varchar)")
    con.execute(
        "INSERT INTO dim_pe_titles VALUES"
        " ('0601101E', 'DARPA Core'),"
        " ('0602144A', 'Ground Technology'),"
        " ('0604999F', 'Some Procurement Line'),"
        " ('0605000N', 'No Feed Program'),"
        " ('0607000F', 'No Trajectory Program'),"
        " ('0608000A', 'Two Org Program')"
        # 0606000A deliberately absent (titleless -> skipped)
    )

    con.execute(
        "CREATE TABLE fct_budget_lines ("
        " exhibit varchar, pe_bli varchar, organization varchar,"
        " amount_type varchar, amount_thousands double, title varchar)"
    )
    con.execute(
        "INSERT INTO fct_budget_lines VALUES"
        " ('R-1', '0602144A', 'A', 'fy_2026_total', 56342.0, 'Ground Technology'),"
        " ('P-1', '0604999F', 'F', 'fy_2026_total', 31.0, 'Some Procurement Line'),"
        " ('P-1R', '0604999F', 'F', 'fy_2025_total', 20.0, 'Some Procurement Line'),"
        " ('R-1', '0608000A', 'A', 'fy_2026_total', 100.0, 'Two Org Program')"
        # 0606000A / 0607000F rows irrelevant (excluded earlier)
    )

    yield con
    con.close()


EXISTING = {"0601101E"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_includes_only_pageless_feed_pes(feed_con):
    rows = _trajectory_only_feed_programs(feed_con, EXISTING)
    pes = [r[0] for r in rows]
    assert "0602144A" in pes  # feed + trajectory + title
    assert "0604999F" in pes
    assert "0601101E" not in pes  # already in dim_programs
    assert "0605000N" not in pes  # trajectory but no feed event


def test_excludes_titleless_and_trajectoryless(feed_con):
    rows = _trajectory_only_feed_programs(feed_con, EXISTING)
    pes = [r[0] for r in rows]
    assert "0606000A" not in pes  # no dim_pe_titles row -> honest skip
    assert "0607000F" not in pes  # no trajectory row -> nothing to render


def test_row_shape_mirrors_dim_programs_sidecar_row(feed_con):
    rows = _trajectory_only_feed_programs(feed_con, EXISTING)
    by_pe = {r[0]: r for r in rows}
    row = by_pe["0602144A"]
    assert len(row) == 7
    pe_bli, org, exhibit_family, title, project_count, fy24_m, fully_reconciled = row
    assert org == "A"
    assert exhibit_family == "rdte"
    assert title == "Ground Technology"
    # honest absences: no J-book detail behind these pages
    assert project_count == 0
    assert fy24_m is None
    assert fully_reconciled is False


def test_exhibit_family_from_budget_lines(feed_con):
    rows = _trajectory_only_feed_programs(feed_con, EXISTING)
    by_pe = {r[0]: r for r in rows}
    assert by_pe["0602144A"][2] == "rdte"          # R-1
    assert by_pe["0604999F"][2] == "procurement"   # P-1 / P-1R


def test_multi_org_pe_resolves_to_single_row_largest_fy26(feed_con):
    rows = _trajectory_only_feed_programs(feed_con, EXISTING)
    matches = [r for r in rows if r[0] == "0608000A"]
    assert len(matches) == 1
    assert matches[0][1] == "A"  # fy2026_total 100.0 > OSD's 3.0


def test_deterministic_pe_bli_ordering(feed_con):
    rows = _trajectory_only_feed_programs(feed_con, EXISTING)
    pes = [r[0] for r in rows]
    assert pes == sorted(pes)
