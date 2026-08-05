"""PM-review Sprint 3 Task 2 — feed items must carry DOLLAR magnitudes.

§P1-8: "/feed/ items read 'Minuteman Squadrons increased 79% FY25→26' with
+79% as the only figure. A +79% swing on a $50M line and on a $5B line are
different stories; percent-only hides which one this is. Show both:
$X → $Y (+79%)."

A percentage without a base is precisely the failure this site exists to
correct, so the fix belongs in the CARD PAYLOAD (which the page, the RSS
item and the gate all read) — not only in the feed XML.

The pair is sourced from the SAME facts gate 24 leg h re-derives from
budget_lines.parquet: fct_budget_trajectory's fy2025_total / fy2026_total for
(pe_bli, organization), whose derived citations the exporter already mints.
Each side therefore carries its OWN cited fact id — the reader can open the
receipt for the base, for the new figure, and for the change independently.
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

from govbudget.export_site import _emit_feed_sidecar, fact_id_derived


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _cards(tmp_path: Path, rows_sql: str, cited: set[str] | None = None) -> list[dict]:
    """Emit feed.json from a fixture fct_feed_events table and return cards."""
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_feed_events ("
        " event_type varchar, pe_bli varchar, organization varchar,"
        " family_key varchar, headline_value double, comparison_value double,"
        " pct_change double, fiscal_year integer, units varchar,"
        " detail_json varchar)"
    )
    con.execute(f"insert into fct_feed_events values {rows_sql}")
    con.execute("create table dim_pe_titles (pe_bli varchar, title varchar)")
    con.execute("insert into dim_pe_titles values ('0101213F', 'Minuteman Squadrons')")
    json_dir = tmp_path / "json"
    json_dir.mkdir()
    try:
        _emit_feed_sidecar(
            json_dir=json_dir, con=con, prog_titles={},
            cited_fact_ids=cited if cited is not None else set(),
        )
    finally:
        con.close()
    return json.loads((json_dir / "feed.json").read_text())["cards"]


# The live shape of the §P1-8 example card, to scale: Minuteman Squadrons,
# FY25 $59,317.5K → FY26 $106,029.5K, +78.75%.
_SWING_ROW = (
    "('yoy_swing', '0101213F', 'F', NULL, 106029.5, 59317.5, 78.75, 2026,"
    " 'thousands_usd', NULL)"
)
_TRAJ_KEY = "0101213F|F"


class TestYoySwingCarriesADollarPair:
    def test_magnitude_pair_is_emitted(self, tmp_path):
        (card,) = _cards(tmp_path, _SWING_ROW)
        mag = card.get("magnitude")
        assert mag is not None, (
            "a yoy_swing card must carry a magnitude payload — '+79%' with no "
            "base is the §P1-8 defect"
        )
        assert mag["kind"] == "pair"
        assert mag["units"] == "thousands_usd"
        assert mag["from"]["value"] == 59317.5, mag
        assert mag["to"]["value"] == 106029.5, mag

    def test_from_side_is_the_fy2025_base_and_to_side_the_fy2026_figure(self, tmp_path):
        """Direction matters: the pair must read FY25 → FY26, never reversed.

        This is the same wrong-variable class of defect that made the zeroed
        class print $0 for $7.07B of real money (Sprint 3 Task 1b, Defect B).
        """
        (card,) = _cards(tmp_path, _SWING_ROW)
        mag = card["magnitude"]
        assert mag["from"]["fy"] == 2025 and mag["to"]["fy"] == 2026, mag
        assert mag["from"]["value"] < mag["to"]["value"], (
            "the card says 'increased', so the FY2025 base must be the smaller "
            f"side: {mag}"
        )

    def test_delta_equals_to_minus_from(self, tmp_path):
        (card,) = _cards(tmp_path, _SWING_ROW)
        mag = card["magnitude"]
        assert abs(mag["delta"]["value"] - (106029.5 - 59317.5)) < 1e-6, mag

    def test_pair_reproduces_the_percentage_the_headline_states(self, tmp_path):
        """The pair and the prose must be the same claim.

        Gate 24 leg h re-derives the stated percentage from
        budget_lines.parquet. If the pair did not reproduce that percentage,
        the card would carry two different stories about one program.
        """
        (card,) = _cards(tmp_path, _SWING_ROW)
        mag = card["magnitude"]
        pct = 100.0 * (mag["to"]["value"] - mag["from"]["value"]) / mag["from"]["value"]
        assert abs(pct - card["figure_value"]) < 0.01, (
            f"pair recomputes {pct}%, card states {card['figure_value']}%"
        )
        assert f"{abs(pct):.0f}%" in card["headline"], card["headline"]

    def test_each_side_carries_its_own_cited_fact_id(self, tmp_path):
        """Three figures, three receipts — the base, the new figure, the change."""
        fid25 = fact_id_derived("trajectory", _TRAJ_KEY, "fy2025_total")
        fid26 = fact_id_derived("trajectory", _TRAJ_KEY, "fy2026_total")
        fidch = fact_id_derived("trajectory", _TRAJ_KEY, "fy2526_change")
        (card,) = _cards(tmp_path, _SWING_ROW, cited={fid25, fid26, fidch})
        mag = card["magnitude"]
        assert mag["from"]["fact_id"] == fid25, mag
        assert mag["to"]["fact_id"] == fid26, mag
        assert mag["delta"]["fact_id"] == fidch, mag

    def test_uncited_sides_degrade_to_null_never_to_a_wrong_id(self, tmp_path):
        """State C is honest; a fact id that does not resolve is not."""
        (card,) = _cards(tmp_path, _SWING_ROW, cited=set())
        mag = card["magnitude"]
        assert mag["from"]["fact_id"] is None
        assert mag["to"]["fact_id"] is None
        assert mag["delta"]["fact_id"] is None


class TestEveryCardCarriesADollarMagnitude:
    """§P1-8's rule applied to the whole feed, not just the swing class.

    Where an event genuinely has two endpoints the card carries a PAIR; where
    it has one dollar magnitude (an award total) it says so with kind='single'
    rather than inventing a second endpoint.
    """

    def test_concentration_shift_states_its_matched_dollars(self, tmp_path):
        fid = fact_id_derived(
            "feed", "concentration_shift|0101213F|2024", "matched_dollars"
        )
        (card,) = _cards(
            tmp_path,
            "('concentration_shift', '0101213F', NULL, NULL, 3200.0, 41000000.0,"
            " NULL, 2024, 'hhi_dollars', NULL)",
            cited={fid},
        )
        mag = card["magnitude"]
        assert mag["kind"] == "single", mag
        assert mag["units"] == "dollars"
        assert mag["from"] is None and mag["delta"] is None
        assert mag["to"]["value"] == 41000000.0, mag
        assert mag["to"]["fact_id"] == fid, mag

    def test_new_entrant_states_its_total_obligations(self, tmp_path):
        fid = fact_id_derived("feed", "new_entrant|ACME ROBOTICS", "total_obligation")
        (card,) = _cards(
            tmp_path,
            "('new_entrant', NULL, NULL, 'ACME ROBOTICS', 3100000.0, 2025.0,"
            " NULL, 2025, 'dollars', NULL)",
            cited={fid},
        )
        mag = card["magnitude"]
        assert mag["kind"] == "single", mag
        assert mag["to"]["value"] == 3100000.0, mag
        assert mag["to"]["fact_id"] == fid, mag

    def test_request_vs_actuals_gap_states_both_sides_of_the_gap(self, tmp_path):
        """"$1.2B above the request" is unreadable without the request."""
        db = tmp_path / "rva.duckdb"
        con = duckdb.connect(str(db))
        con.execute(
            "create table fct_feed_events ("
            " event_type varchar, pe_bli varchar, organization varchar,"
            " family_key varchar, headline_value double, comparison_value double,"
            " pct_change double, fiscal_year integer, units varchar,"
            " detail_json varchar)"
        )
        con.execute("create table dim_pe_titles (pe_bli varchar, title varchar)")
        con.execute(
            "create table fct_book_diff (pe_bli varchar, from_edition integer,"
            " to_edition integer, diff_kind varchar, from_fy integer,"
            " to_fy integer, from_value double, to_value double, delta double,"
            " from_amount_type varchar, to_amount_type varchar)"
        )
        con.execute(
            "insert into fct_book_diff values ('0101213F', 2022, 2024,"
            " 'request_vs_actuals', 2022, 2022, 400000.0, 1600000.0, 1200000.0,"
            " 'fy_2022_request', 'fy_2022_actuals')"
        )
        con.execute(
            "create table fct_decade_series (pe_bli varchar, fy integer,"
            " edition_year integer, amount_type_kind varchar, amount double,"
            " amount_type varchar, n_source_rows integer, source_fact_id varchar)"
        )
        con.execute(
            "insert into fct_decade_series values"
            " ('0101213F', 2022, 2022, 'request', 400000.0, 'fy_2022_request', 1, 'aaaa1111bbbb2222'),"
            " ('0101213F', 2022, 2024, 'actuals', 1600000.0, 'fy_2022_actuals', 3, NULL)"
        )
        diff_fid = fact_id_derived(
            "book_diff", "0101213F|2022|2024", "request_vs_actuals"
        )
        to_fid = fact_id_derived("decade", "0101213F|2024", "fy_2022_actuals")
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        try:
            _emit_feed_sidecar(
                json_dir=json_dir, con=con, prog_titles={},
                cited_fact_ids={diff_fid, "aaaa1111bbbb2222", to_fid},
            )
        finally:
            con.close()
        cards = json.loads((json_dir / "feed.json").read_text())["cards"]
        (card,) = [c for c in cards if c["event_type"] == "request_vs_actuals_gap"]
        mag = card["magnitude"]
        assert mag["kind"] == "pair", mag
        assert mag["from"]["value"] == 400000.0, mag
        assert mag["to"]["value"] == 1600000.0, mag
        assert mag["delta"]["value"] == 1200000.0, mag
        assert mag["from"]["fact_id"] == "aaaa1111bbbb2222", mag
        assert mag["to"]["fact_id"] == to_fid, mag
        assert mag["delta"]["fact_id"] == diff_fid, mag

    def test_no_card_ships_without_a_magnitude(self, tmp_path):
        cards = _cards(
            tmp_path,
            _SWING_ROW
            + ", ('concentration_shift', '0101213F', NULL, NULL, 3200.0, 41000000.0,"
            "    NULL, 2024, 'hhi_dollars', NULL)"
            + ", ('new_entrant', NULL, NULL, 'ACME ROBOTICS', 3100000.0, 2025.0,"
            "    NULL, 2025, 'dollars', NULL)",
        )
        assert len(cards) == 3
        for c in cards:
            assert c.get("magnitude") is not None, c
            assert c["magnitude"]["to"]["value"] is not None, c
