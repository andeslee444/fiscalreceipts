"""Compact-amount ladders and the derived award FY range — PM Sprint 2, §P1-6.

Two defects, one root cause: figures were formatted and framed by code that
had no idea how big or how old the corpus had become.

  * The compact ladder stopped at B, so the dim_geography grand total rendered
    "$3657.4B". Every mirror of the ladder (site/src/lib/format.ts, the gate-12
    mirror, the OG generator, flow_chart.py's width estimator, and the two feed
    helpers pinned here) must reach T.
  * Aggregate KPIs carried no period at all, and where the site did state one
    it stated three different things. The range is now DERIVED from
    fct_award_transactions and travels in site_meta.
"""

import duckdb
import pytest

from govbudget.export_site import (
    _build_award_fy_range,
    _fmt_dollars,
    _fmt_thousands,
    award_fy_range_label,
)
from govbudget.flow_chart import _fmt_amount_no_currency


def _awards_con(rows):
    """In-memory fct_award_transactions with (fiscal_year, action_date) rows."""
    con = duckdb.connect(":memory:")
    con.execute(
        "create table fct_award_transactions"
        " (fiscal_year integer, action_date date, obligation double)"
    )
    for fy, action_date in rows:
        con.execute(
            "insert into fct_award_transactions values (?, ?, 1.0)",
            [fy, action_date],
        )
    return con


class TestFmtThousands:
    """Feed headline text for thousands-USD values."""

    @pytest.mark.parametrize(
        "value_thousands,expected",
        [
            (0, "$0"),
            (0.5, "$500"),
            (5, "$5.0K"),
            (5_000, "$5.0M"),
            (5_000_000, "$5.0B"),
            # §P1-6: the rung that did not exist.
            (1_000_000_000, "$1.0T"),
            (3_657_411_328, "$3.7T"),
            (-3_657_411_328, "$-3.7T"),
        ],
    )
    def test_ladder(self, value_thousands, expected):
        assert _fmt_thousands(value_thousands) == expected

    def test_none_is_not_a_number(self):
        assert _fmt_thousands(None) == "N/A"

    def test_boundary_stays_in_b_just_below_a_trillion(self):
        # 999,900,000 thousands = $999.9B — one rung below T.
        assert _fmt_thousands(999_900_000) == "$999.9B"


class TestFmtDollars:
    """Feed headline text for raw-USD values."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            (0, "$0"),
            (5_000_000, "$5.0M"),
            (5_000_000_000, "$5.0B"),
            (999_900_000_000, "$999.9B"),
            (1_000_000_000_000, "$1.0T"),
            (3_657_411_328_834.89, "$3.7T"),
        ],
    )
    def test_ladder(self, raw, expected):
        assert _fmt_dollars(raw) == expected

    def test_none_is_not_a_number(self):
        assert _fmt_dollars(None) == "N/A"


class TestFlowChartWidthEstimator:
    """flow_chart.py mirrors the client formatter to SIZE labels."""

    def test_reaches_trillions(self):
        assert _fmt_amount_no_currency(3_657_411_328_834.89, "USD") == "3.66T"

    def test_units_drive_scale_not_magnitude(self):
        assert _fmt_amount_no_currency(3_657_411_328.83489, "USD thousands") == "3.66T"
        assert _fmt_amount_no_currency(3_657_411.32883489, "USD millions") == "3.66T"

    def test_billions_unchanged(self):
        assert _fmt_amount_no_currency(1_234_567_890, "USD") == "1.23B"

    def test_negative_uses_the_minus_glyph(self):
        assert _fmt_amount_no_currency(-1_500_000_000_000, "USD") == "−1.50T"


class TestAwardFyRangeLabel:
    """ONE wording for the aggregate period — shared with the site's TS copy."""

    def test_canonical_shape(self):
        assert award_fy_range_label(2017, 2026) == "FY2017–FY2026"

    def test_single_year_collapses(self):
        assert award_fy_range_label(2025, 2025) == "FY2025"

    def test_uses_an_en_dash_not_a_hyphen(self):
        # The site's typographic convention; the gate matches on it.
        assert "-" not in award_fy_range_label(2017, 2026)

    def test_rejects_an_inverted_range(self):
        with pytest.raises(ValueError):
            award_fy_range_label(2026, 2017)


class TestBuildAwardFyRange:
    """The range is read out of the awards mart, never authored."""

    def test_derives_extent_from_the_data(self):
        con = _awards_con([(2017, "2016-10-05"), (2025, "2025-09-30")])
        assert _build_award_fy_range(con) == {
            "fy_min": 2017,
            "fy_max": 2025,
            "label": "FY2017–FY2025",
            "latest_action_date": "2025-09-30",
            "max_partial": False,
        }

    def test_marks_an_in_progress_final_year_partial(self):
        # FY2026 closes 2026-09-30; the newest ingested action is April.
        con = _awards_con([(2017, "2016-10-05"), (2026, "2026-04-23")])
        got = _build_award_fy_range(con)
        assert got["label"] == "FY2017–FY2026"
        assert got["max_partial"] is True
        assert got["latest_action_date"] == "2026-04-23"

    def test_range_grows_with_the_corpus(self):
        # The literal "FY2017–FY2025" on /companies/ was already a year stale.
        con = _awards_con([(2017, "2016-10-05"), (2027, "2027-09-30")])
        assert _build_award_fy_range(con)["label"] == "FY2017–FY2027"

    def test_missing_mart_yields_no_range_rather_than_a_guess(self):
        con = duckdb.connect(":memory:")
        assert _build_award_fy_range(con) is None

    def test_empty_mart_yields_no_range(self):
        assert _build_award_fy_range(_awards_con([])) is None
