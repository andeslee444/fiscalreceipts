"""The decade-only page tier — ROADMAP #28.

553 program elements carry cited President's Budget history (FY2015-FY2025,
editions PB2017-PB2025) and no FY2026 R-1/P-1 workbook line at all. Before
this they generated no /program/ page: the decade existed in the warehouse
and was not browsable. The owner decided 2026-08-27 that a program which no
longer requests money should still have a browsable history page.

Two units are pinned here, and both are pinned at their EDGES, because a
decade-only page says nothing BUT absence and every edge is a way one of
those sentences becomes false:

  * `decade_only_page_pes` decides who gets a page. The exclusions are the
    interesting part — a naive fct_budget_lines-minus-built-pages cut returns
    1,840, of which 1,214 are era procurement keys ('3010F-AF-L1' alone sums
    $142.6B across PB2017-PB2023) whose own module docstring says
    cross-edition identity is deliberately NOT claimed for them. A /program/
    page IS a cross-edition identity claim.

  * `_decade_absent_block` is what the note renders from. `renumber` is the
    edge that matters most: #32(a) told 319 pages "PB2026 renumbered program
    elements at scale" as the reason their record stops, and two independent
    reviews found that note false on 179 of them. On a line last carried in
    PB2019 the sentence blames an event six editions later, so the flag is
    true ONLY when the line survived to PB2025 — the edition PB2026 replaced.
"""

import pytest

from govbudget.export_site import _decade_absent_block
from govbudget.jbooks.era_keys import is_era_procurement_key


def _pt(fy, edition, v=1000.0):
    return {"fy": fy, "edition": edition, "v": v, "fid": "a" * 16,
            "basis": "toa", "measure": "actuals"}


# --------------------------------------------------------------------------
# _decade_absent_block
# --------------------------------------------------------------------------

def test_spans_editions_and_fiscal_years_across_every_kind():
    block = _decade_absent_block({
        "actuals": [_pt(2015, 2017), _pt(2022, 2024)],
        "enacted": [_pt(2016, 2017)],
        "request": [_pt(2023, 2023)],
    })
    assert block == {
        "first_edition": 2017,
        "last_edition": 2024,
        "edition_count": 3,   # 2017, 2023, 2024 — distinct, not row count
        "fy_min": 2015,
        "fy_max": 2023,
        "renumber": False,
        "has_successor": False,
    }


def test_renumber_is_true_only_for_a_line_that_survived_to_pb2025():
    # PB2025 is the edition PB2026 replaced, so a line present there and
    # absent from PB2026 really did disappear in the PB2026 renumbering.
    assert _decade_absent_block({"actuals": [_pt(2023, 2025)]})["renumber"] is True


@pytest.mark.parametrize("last_edition", [2017, 2019, 2021, 2024])
def test_renumber_is_false_for_a_line_that_left_earlier(last_edition):
    # The #32(a) defect, refused: PB2026 cannot be the reason a line stopped
    # appearing several editions before PB2026 existed.
    block = _decade_absent_block({"actuals": [_pt(2015, 2017), _pt(2020, last_edition)]})
    assert block["renumber"] is False
    assert block["last_edition"] == last_edition


def test_successor_flag_follows_the_page_s_own_lineage_rail():
    series = {"actuals": [_pt(2020, 2022)]}
    assert _decade_absent_block(series, None)["has_successor"] is False
    assert _decade_absent_block(series, {"rail": {"successors": []}})["has_successor"] is False
    rail = {"rail": {"successors": [{"pe": "0207279F"}]}}
    assert _decade_absent_block(series, rail)["has_successor"] is True


def test_a_single_edition_page_reports_that_edition_once():
    block = _decade_absent_block({"actuals": [_pt(2017, 2019), _pt(2018, 2019)]})
    assert block["edition_count"] == 1
    assert block["first_edition"] == block["last_edition"] == 2019
    assert (block["fy_min"], block["fy_max"]) == (2017, 2018)


def test_no_series_yields_no_block():
    # A page with no cited figure would be nothing but absence claims. The
    # exporter skips it rather than publishing one.
    assert _decade_absent_block(None) is None
    assert _decade_absent_block({}) is None
    assert _decade_absent_block({"actuals": []}) is None


def test_points_with_no_edition_or_fy_do_not_produce_a_block():
    assert _decade_absent_block({"actuals": [{"v": 1.0}]}) is None


def test_zero_valued_points_still_count_toward_the_span():
    # The grid draws a cited $0 like any other cited figure, so the note's
    # span has to include it or it would describe a table the reader is not
    # looking at. (Whether the PAGE EXISTS at all is a different filter —
    # decade_only_page_pes requires at least one POSITIVE grain.)
    block = _decade_absent_block({"actuals": [_pt(2015, 2017, 0.0), _pt(2016, 2018, 5.0)]})
    assert (block["fy_min"], block["fy_max"]) == (2015, 2016)


# --------------------------------------------------------------------------
# the era-key exclusion — the trap this tier has to avoid
# --------------------------------------------------------------------------

@pytest.mark.parametrize("key", ["3010F-AF-L1", "0300D-CBDP-L70", "1611N-NAVY-L46-1"])
def test_era_procurement_keys_are_recognised(key):
    assert is_era_procurement_key(key) is True


@pytest.mark.parametrize(
    "key",
    ["0605230F", "1206442F", "0303140G", "ATA000", "1203154SF", "0604165D8Z"],
)
def test_real_program_elements_are_not_era_keys(key):
    assert is_era_procurement_key(key) is False


def test_era_key_predicate_tolerates_absence():
    assert is_era_procurement_key(None) is False
    assert is_era_procurement_key("") is False
