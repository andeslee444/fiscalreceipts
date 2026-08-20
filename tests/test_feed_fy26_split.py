"""backlog #54 — #50's reconciliation split, threaded onto /feed/ yoy_swing cards.

Sprint A'4 (#50) computed the FY2026 discretionary/reconciliation split
(build_fy26_split / _build_fy26_split_index) and disclosed it on
/program/*/ only. Measured on the shipped corpus: 31 of 99 yoy_swing feed
cards are for a PE that carries reconciliation money, and 27 of those 31
combined pct_change figures differ from the discretionary-only rate by more
than 20 percentage points — e.g. Long Range Kill Chains (1203154SF)
headlines "+3052.9%" while its discretionary-only rate is -99.2%, a
direction reversal, not just a magnitude difference.

_emit_feed_sidecar now accepts the SAME fy26_split_by_pe index the main
export pass already builds (_build_fy26_split_index) and threads through to
program_details sidecars, and attaches it to a yoy_swing card's
`fy26_split` field exactly when that PE's split has_reconciliation. Every
other card (a yoy_swing PE with no reconciliation money, or any other event
type) must carry `fy26_split: None` — never a fabricated split.
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

from govbudget.export_site import _emit_feed_sidecar, build_fy26_split


def _cards(
    tmp_path: Path,
    rows_sql: str,
    fy26_split_by_pe: dict | None = None,
    cited: set[str] | None = None,
) -> list[dict]:
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
    json_dir = tmp_path / "json"
    json_dir.mkdir()
    try:
        _emit_feed_sidecar(
            json_dir=json_dir, con=con, prog_titles={},
            cited_fact_ids=cited if cited is not None else set(),
            fy26_split_by_pe=fy26_split_by_pe,
        )
    finally:
        con.close()
    return json.loads((json_dir / "feed.json").read_text())["cards"]


# Long Range Kill Chains' own shape (measured 2026-08-19): FY25 enacted
# $244,121K, FY2026 disc $1,916K, FY2026 reconciliation $7,695,000K.
_RECON_SPLIT = build_fy26_split(
    fy25_enacted_k=244_121.0, disc_k=1_916.0, recon_k=7_695_000.0,
)
_RECON_SPLIT["disc"] = {
    "v": 1_916.0, "units": "USD thousands", "fid": "disc-fid",
    "public_id": "disc-fid"[:8], "dataset": "budget_lines",
    "basis": "toa", "fy": 2026, "measure": "disc-request", "edition": 2026,
}
_RECON_SPLIT["reconciliation"] = {
    "v": 7_695_000.0, "units": "USD thousands", "fid": "recon-fid",
    "public_id": "recon-fid"[:8], "dataset": "budget_lines",
    "basis": "toa", "fy": 2026, "measure": "reconciliation-request",
    "edition": 2026,
}

_SWING_ROW = (
    "('yoy_swing', '1203154SF', 'F', NULL, 7696916.0, 244121.0, 3052.9, 2026,"
    " 'thousands_usd', NULL)"
)
_SWING_ROW_NO_RECON = (
    "('yoy_swing', '0101213F', 'F', NULL, 106029.5, 59317.5, 78.75, 2026,"
    " 'thousands_usd', NULL)"
)


def test_yoy_swing_card_carries_the_split_when_pe_has_reconciliation(tmp_path):
    (card,) = _cards(
        tmp_path, _SWING_ROW, fy26_split_by_pe={"1203154SF": _RECON_SPLIT},
    )
    assert card["fy26_split"] is not None
    assert card["fy26_split"]["has_reconciliation"] is True
    assert card["fy26_split"]["disc_pct_change"] == -99.2


def test_yoy_swing_card_carries_no_split_when_pe_absent_from_the_index(tmp_path):
    (card,) = _cards(tmp_path, _SWING_ROW_NO_RECON, fy26_split_by_pe={})
    assert card["fy26_split"] is None


def test_yoy_swing_card_carries_no_split_when_split_has_no_reconciliation(
    tmp_path,
):
    pure_disc = build_fy26_split(fy25_enacted_k=100.0, disc_k=150.0, recon_k=0.0)
    (card,) = _cards(
        tmp_path, _SWING_ROW_NO_RECON,
        fy26_split_by_pe={"0101213F": pure_disc},
    )
    assert pure_disc["has_reconciliation"] is False
    assert card["fy26_split"] is None


def test_default_fy26_split_by_pe_is_none_never_a_crash(tmp_path):
    """Callers that never had a split to thread (defensive default) must not
    crash — card.fy26_split degrades to None, never a KeyError."""
    (card,) = _cards(tmp_path, _SWING_ROW, fy26_split_by_pe=None)
    assert card["fy26_split"] is None
