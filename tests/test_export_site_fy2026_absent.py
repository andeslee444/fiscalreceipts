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
    assert _fy2026_absent_block(rows) == {"last_fy": 2025}


def test_last_fy_is_the_latest_funded_year_not_the_first():
    rows = [_bl(2024, 1000.0), _bl(2025, 0.0)]
    assert _fy2026_absent_block(rows) == {"last_fy": 2024}


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
