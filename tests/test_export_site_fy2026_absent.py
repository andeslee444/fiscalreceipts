"""The PB2026 renumber flag — ROADMAP #32(a).

PB2026 renumbered program elements at scale: 319 program pages carry
FY2024/FY2025 money in the PB2026 R-1/P-1 workbook and no FY2026 row at all.
Verified against the primary source (data/raw_docs/fy2026/dod/r1_display.xlsx),
those FY2026 cells are genuinely blank — the parser is right, the MODEL had no
way to say so, and a reader who followed a line for a decade hit figures that
stopped at FY2025 with no explanation.

`_fy2026_absent_block` is the flag the page note renders from. What is pinned
here is the predicate's EDGES, because each one is a way the note could become
a false claim on a real page:

  * an FY2026 row of ANY amount_type disqualifies, including a zero one — a
    line PB2026 still enumerates has not been renumbered away;
  * a zero-valued FY2024/FY2025 row is not "money", so a line that was already
    empty does not get a note saying its funding stopped;
  * `last_fy` is the LATEST funded year, never the first — the note names the
    year the record actually stops at, and gate 21 leg (g) fails the build if
    the rendered year and this one disagree.
"""

from govbudget.export_site import _fy2026_absent_block


def _bl(fy, amount, amount_type=None):
    return {
        "fy": fy,
        "amount_thousands": amount,
        "amount_type": amount_type or f"fy_{fy}_total",
    }


def test_no_fy2026_row_with_fy2025_money_is_flagged():
    rows = [_bl(2024, 280494.0, "fy_2024_actuals"), _bl(2025, 293145.0, "fy_2025_enacted")]
    assert _fy2026_absent_block(rows) == {
        "last_fy": 2025,
        "jbook_fy2026_zero": False,
        "has_successor": False,
    }


def test_last_fy_is_the_latest_funded_year_not_the_first():
    rows = [_bl(2024, 1000.0), _bl(2025, 0.0)]
    assert _fy2026_absent_block(rows) == {
        "last_fy": 2024,
        "jbook_fy2026_zero": False,
        "has_successor": False,
    }


def test_any_fy2026_row_disqualifies_even_a_zero_one():
    """A line PB2026 still enumerates has not been renumbered away. The note
    would be a false claim about this page's money."""
    rows = [_bl(2025, 293145.0), _bl(2026, 0.0, "fy_2026_total")]
    assert _fy2026_absent_block(rows) is None


def test_fy2026_reconciliation_row_disqualifies():
    rows = [_bl(2025, 100.0), _bl(2026, 7_700_000.0, "fy_2026_reconciliation_request")]
    assert _fy2026_absent_block(rows) is None


def test_zero_prior_money_is_not_flagged():
    """A line that was already empty did not stop being funded."""
    assert _fy2026_absent_block([_bl(2024, 0.0), _bl(2025, 0.0)]) is None


def test_null_amount_is_not_money():
    assert _fy2026_absent_block([_bl(2025, None)]) is None


def test_older_history_alone_is_not_flagged():
    """FY2023 and earlier are not in the PB2026 workbook's own year columns;
    the predicate reads only the years the page's cards render."""
    assert _fy2026_absent_block([_bl(2022, 5000.0), _bl(2023, 5000.0)]) is None


def test_empty_sidecar_is_not_flagged():
    assert _fy2026_absent_block([]) is None


# --- The three defect classes two reviews found in the shipped note. ---
# Each of these would have PASSED before 2026-08-27, because the predicate
# read only budget_lines and never opened the page's own J-book detail or
# its lineage rail.


def _det(fy, amount, **kw):
    d = {"fy": fy, "amount_millions": amount, "measure": "request"}
    d.update(kw)
    return d


def test_positive_jbook_fy2026_money_suppresses_the_note_entirely():
    """The Microelectronics Commons defect.

    /program/0603669D8Z/ rendered a bold "No FY2026 request for this program
    element" directly above its own R-2/P-40 table showing an FY26 Request of
    $260.7M, a cited jbook_details fact. The workbook is blank; the J-book is
    not. A page that publishes FY2026 money may never carry an absence note.
    """
    rows = [_bl(2024, 280494.0, "fy_2024_actuals")]
    assert _fy2026_absent_block(rows, [_det(2026, 260.731)]) is None


def test_documented_fy2026_zero_is_disclosed_not_hidden():
    """A workbook blank and a documented zero are different records.

    173 pages carry an FY2026 J-book row at exactly 0.000 -- verbatim
    <r2:BudgetYearOne>0.000</r2:BudgetYearOne> in the PB2026 XML. Reporting
    only the workbook blank is the error that produced the 87 withdrawn
    "zeroed out in FY2026" feed cards, whose rule fct_feed_events.sql states
    using 0601101E as the worked example -- one of the pages that was
    contradicting it.
    """
    rows = [_bl(2025, 293145.0, "fy_2025_enacted")]
    got = _fy2026_absent_block(rows, [_det(2026, 0.0, resolution="zero_amount")])
    assert got["jbook_fy2026_zero"] is True
    assert got["last_fy"] == 2025


def test_a_cited_successor_rail_is_reported_not_denied():
    """The note used to say "no ingested budget document states one" on five
    pages whose lineage rail quoted the document verbatim -- 837170's rail
    quotes "The FY 2026 efforts in this Program Element (PE) were transferred
    to PE 0207279F". Both halves of that sentence were false there.
    """
    rows = [_bl(2025, 293145.0, "fy_2025_enacted")]
    lineage = {"rail": {"successors": [{"pe_bli": "0207279F", "confidence": "stated"}]}}
    assert _fy2026_absent_block(rows, [], lineage)["has_successor"] is True


def test_an_empty_rail_is_not_a_successor():
    rows = [_bl(2025, 293145.0, "fy_2025_enacted")]
    for lineage in ({}, {"rail": {}}, {"rail": {"successors": []}}):
        assert _fy2026_absent_block(rows, [], lineage)["has_successor"] is False


def test_details_and_lineage_are_optional():
    """Both call sites pass them, but the rollup-tier sidecar may carry
    neither. Absent inputs must not silently become a positive claim."""
    rows = [_bl(2025, 293145.0, "fy_2025_enacted")]
    got = _fy2026_absent_block(rows)
    assert got["jbook_fy2026_zero"] is False and got["has_successor"] is False
