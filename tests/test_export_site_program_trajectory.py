"""ROADMAP backlog #37 — a `programs.json` row is a PE, so its trajectory is
the PROGRAM's, not the declared org's slice.

`programs.json` holds one row per pe_bli (pe_bli is the row identity, the
/program/{pe_bli}/ URL and the dead-link contract), but `trajectory` was read
out of fct_budget_trajectory at (pe_bli, dim_programs.org) — a COMPONENT.
For the three BLI codes shared across organisations that published a part as
the whole (BLI 30: OSD's 408,006 of a 435,163 program).

Contract under test:
  - the exporter reads the PROGRAM grain (fct_program_trajectory), so the
    published trajectory is the sum of every component;
  - the citation KEY collapses to the component's own key when a program has
    exactly one component (no second fact id for one number), and becomes the
    program-scoped key when it has more;
  - a multi-org program's derived sum fact is emitted with the workbook rows
    of EVERY component as inputs, so verify-phase5b1 rule 4c recomputes it.
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import (
    _build_derived_citation_rows,
    _program_trajectory_index,
    _trajectory_citation_key,
    fact_id_derived,
)
from govbudget.verify_phase5b1 import _verify_derived


# ---------------------------------------------------------------------------
# Fixture — one single-org program and one shared BLI, shaped like BLI 30
# ---------------------------------------------------------------------------

# bl_rows column order (see export_site): (fact_id, exhibit, fiscal_year,
# account, account_title, organization, budget_activity, budget_activity_title,
# pe_bli, title, amount_type, amount_thousands, units, document_sha256,
# source_sheet, source_cells)
def _bl(fid, org, pe, amount_type, amount, title="A Line"):
    return (
        fid, "P-1", 2026, "0300", "Procurement, Defense-Wide", org, "01", "BA1",
        pe, title, amount_type, amount, "USD thousands", "sha", "Sheet1", "A1",
    )


BL_ROWS = [
    # 0601101E — one organisation only: the component IS the program
    _bl("aaaa000000000001", "DARPA", "0601101E", "fy_2024_actuals", 280494.0),
    _bl("aaaa000000000002", "DARPA", "0601101E", "fy_2025_total", 300000.0),
    _bl("aaaa000000000003", "DARPA", "0601101E", "fy_2026_total", 320000.0),
    # 30 — four organisations, the live shape of "Other Major Equipment"
    _bl("bbbb000000000001", "OSD", "30", "fy_2024_actuals", 408006.0),
    _bl("bbbb000000000002", "DMACT", "30", "fy_2024_actuals", 13012.0),
    _bl("bbbb000000000003", "DTRA", "30", "fy_2024_actuals", 12787.0),
    _bl("bbbb000000000004", "DODEA", "30", "fy_2024_actuals", 1358.0),
    _bl("bbbb000000000005", "OSD", "30", "fy_2026_total", 212900.0),
    _bl("bbbb000000000006", "DMACT", "30", "fy_2026_total", 7258.0),
    _bl("bbbb000000000007", "DTRA", "30", "fy_2026_total", 12023.0),
    # DoDEA publishes no FY2026 row — the program total must be the sum of the
    # three that do, never a zero credited to the fourth.
]


@pytest.fixture()
def traj_con(tmp_path: Path):
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "CREATE TABLE fct_budget_trajectory ("
        " pe_bli varchar, organization varchar, fy2024_actuals double,"
        " fy2025_total double, fy2026_total double, fy2526_change double,"
        " fy2526_pct_change double)"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES"
        " ('0601101E', 'DARPA', 280494.0, 300000.0, 320000.0, 20000.0, 6.67),"
        " ('30', 'OSD',   408006.0, NULL, 212900.0, NULL, NULL),"
        " ('30', 'DMACT',  13012.0, NULL,   7258.0, NULL, NULL),"
        " ('30', 'DTRA',   12787.0, NULL,  12023.0, NULL, NULL),"
        " ('30', 'DODEA',   1358.0, NULL,     NULL, NULL, NULL)"
    )
    # The PROGRAM grain, exactly as dbt materialises it.
    con.execute(
        "CREATE TABLE fct_program_trajectory as"
        " with c as ("
        "   select pe_bli, count(*) as n_org_components,"
        "          sum(fy2024_actuals) as fy2024_actuals,"
        "          sum(fy2025_total) as fy2025_total,"
        "          sum(fy2026_total) as fy2026_total"
        "   from fct_budget_trajectory group by pe_bli)"
        " select pe_bli, n_org_components, fy2024_actuals, fy2025_total,"
        "        fy2026_total, (fy2026_total - fy2025_total) as fy2526_change,"
        "        case when fy2025_total is null or fy2025_total = 0 then null"
        "             else round(100.0 * (fy2026_total - fy2025_total)"
        "                        / fy2025_total, 2) end as fy2526_pct_change"
        " from c"
    )
    con.close()
    yield db


# ---------------------------------------------------------------------------
# The program grain
# ---------------------------------------------------------------------------


def test_program_index_publishes_the_sum_not_a_component(traj_con):
    con = duckdb.connect(str(traj_con), read_only=True)
    try:
        idx = _program_trajectory_index(con)
    finally:
        con.close()

    prog = idx["30"]
    assert prog["fy2024_actuals"] == 435163.0, (
        "BLI 30's FY2024 actuals must be the whole program (OSD 408,006 +"
        " DMACT 13,012 + DTRA 12,787 + DoDEA 1,358), not OSD's slice"
    )
    # DoDEA has no FY2026 row: the total is the three that do, and the absent
    # component is absent — not a zero.
    assert prog["fy2026_total"] == 232181.0
    assert prog["n_org_components"] == 4


def test_all_null_metric_stays_null(traj_con):
    con = duckdb.connect(str(traj_con), read_only=True)
    try:
        idx = _program_trajectory_index(con)
    finally:
        con.close()
    assert idx["30"]["fy2025_total"] is None
    assert idx["30"]["fy2526_change"] is None


def test_single_component_program_is_unchanged(traj_con):
    con = duckdb.connect(str(traj_con), read_only=True)
    try:
        idx = _program_trajectory_index(con)
    finally:
        con.close()
    assert idx["0601101E"]["fy2024_actuals"] == 280494.0
    assert idx["0601101E"]["fy2526_change"] == 20000.0
    assert idx["0601101E"]["n_org_components"] == 1


# ---------------------------------------------------------------------------
# Citation identity
# ---------------------------------------------------------------------------


def test_citation_key_collapses_to_the_component_when_there_is_one():
    # One component → the program total IS that row; minting a second fact id
    # for one number would duplicate the citation.
    assert _trajectory_citation_key("0601101E", ["DARPA"]) == "0601101E|DARPA"


def test_citation_key_is_program_scoped_when_components_are_summed():
    assert _trajectory_citation_key("30", ["DMACT", "DODEA", "DTRA", "OSD"]) == "30"


# ---------------------------------------------------------------------------
# The derived sum fact
# ---------------------------------------------------------------------------


def test_multi_org_program_sum_fact_is_emitted_and_recomputes(traj_con):
    rows = _build_derived_citation_rows(
        duckdb_path=traj_con, bl_rows=BL_ROWS, citation_rows=[],
    )
    by_fid = {r[0]: r for r in rows}

    fid = fact_id_derived("trajectory", "30", "fy2024_actuals")
    assert fid in by_fid, "shared-BLI program total must have its own fact"
    row = by_fid[fid]
    assert row[23] == "435163.000"  # recorded_value

    inputs = json.loads(row[21])
    assert set(inputs) == {
        "bbbb000000000001", "bbbb000000000002",
        "bbbb000000000003", "bbbb000000000004",
    }, "inputs must be EVERY component's workbook rows, not one org's"

    # rule 4c must be able to recompute it from those workbook amounts
    # (workbook citations carry recorded_value=None and resolve through the
    # budget_lines amount map, exactly as they do in verify-phase5b1)
    idx = {"formula": 20, "inputs": 21, "recorded_value": 23}
    all_cits = [(r[0], None) for r in BL_ROWS]
    cit_idx = {"fact_id": 0, "recorded_value": 1}
    fid_to_bl = {r[0]: f"{r[11]:.3f}" for r in BL_ROWS}
    assert _verify_derived(row, idx, all_cits, cit_idx, fid_to_bl) is None


def test_single_org_program_mints_no_duplicate_program_fact(traj_con):
    rows = _build_derived_citation_rows(
        duckdb_path=traj_con, bl_rows=BL_ROWS, citation_rows=[],
    )
    fids = {r[0] for r in rows}
    assert fact_id_derived("trajectory", "0601101E|DARPA", "fy2024_actuals") in fids
    assert fact_id_derived("trajectory", "0601101E", "fy2024_actuals") not in fids


def test_component_facts_survive_alongside_the_program_fact(traj_con):
    # The per-org rows stay citable: they are what an AGENCY's share is, and
    # the agency sums use them as inputs.
    rows = _build_derived_citation_rows(
        duckdb_path=traj_con, bl_rows=BL_ROWS, citation_rows=[],
    )
    by_fid = {r[0]: r for r in rows}
    osd = by_fid[fact_id_derived("trajectory", "30|OSD", "fy2024_actuals")]
    assert osd[23] == "408006.000"
