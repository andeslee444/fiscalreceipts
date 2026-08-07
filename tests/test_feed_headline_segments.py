"""ROADMAP backlog #44 — feed headline dollar figures reach the reader with a
citation affordance.

A feed headline is a sentence the export pipeline COMPOSES. Its dollar tokens
are site-computed figures on the syndication surface — the most-forwarded,
least-context view the site has — and while the headline was one flat string
they were the only figures on the site with no way to click through to a
source. `data-source-text="headline"` exempted them from the gate that would
have said so (backlog #38 named the gap; this closes it).

Contract under test:
  - the flat headline and the segments are ONE sentence: the segment texts
    re-join to `headline` exactly;
  - every dollar token is an amount segment carrying a fact id;
  - a figure with no resolving fact does not go in a headline at all — the
    money clause is dropped, never printed uncitable.
"""
from __future__ import annotations

import re

import json

import duckdb

from govbudget.export_site import (
    _compose_headline,
    _emit_feed_sidecar,
    fact_id_derived,
)


CURRENCY_RE = re.compile(r"\$[\d,]+(?:\.\d+)?\s*[BMKT]?")


def _texts(segments):
    return "".join(s.get("text", s.get("amount", "")) for s in segments)


def test_text_only_headline_is_one_segment():
    flat, segs = _compose_headline("F-35 increased 12% FY25→26")
    assert flat == "F-35 increased 12% FY25→26"
    assert segs == [{"text": "F-35 increased 12% FY25→26"}]


def test_amount_token_becomes_its_own_cited_segment():
    flat, segs = _compose_headline(
        "ACME new defense contractor (first award FY2025, ",
        ("$3.1M", "abcdef0123456789"),
        " total)",
    )
    assert flat == "ACME new defense contractor (first award FY2025, $3.1M total)"
    assert segs[1] == {"amount": "$3.1M", "fact_id": "abcdef0123456789"}


def test_segments_rejoin_to_the_flat_headline_exactly():
    # The flat string still ships — RSS/Atom/JSON feeds, search, the display
    # title swap. A headline that says two different things in two places
    # would be worse than the gap this replaces.
    for parts in (
        ("A ", ("$1.2B", "f" * 16), " b"),
        ("no money here",),
        ("x", ("$5K", "a" * 16)),
        (("$9M", "b" * 16), " leading amount"),
    ):
        flat, segs = _compose_headline(*parts)
        assert _texts(segs) == flat


def test_every_currency_token_is_covered_by_an_amount_segment():
    flat, segs = _compose_headline(
        "Some Program FY2023 actuals came in ",
        ("$1.2B", "c" * 16),
        " below the PB2023 request (per the PB2025 book)",
    )
    n_tokens = len(CURRENCY_RE.findall(flat))
    n_amounts = sum(1 for s in segs if "amount" in s)
    assert n_tokens == n_amounts == 1


def test_adjacent_text_runs_merge():
    _flat, segs = _compose_headline("a", "b", ("$1M", "d" * 16), "c", "d")
    assert segs == [
        {"text": "ab"},
        {"amount": "$1M", "fact_id": "d" * 16},
        {"text": "cd"},
    ]


def test_empty_and_none_parts_are_dropped():
    flat, segs = _compose_headline("a", "", None, "b")
    assert flat == "ab"
    assert segs == [{"text": "ab"}]


# ---------------------------------------------------------------------------
# The honest-absence rule, end to end through the sidecar
# ---------------------------------------------------------------------------


def _feed_con(tmp_path):
    con = duckdb.connect(str(tmp_path / "feed.duckdb"))
    con.execute(
        "CREATE TABLE fct_feed_events ("
        " event_type varchar, pe_bli varchar, organization varchar,"
        " family_key varchar, headline_value double, comparison_value double,"
        " pct_change double, fiscal_year integer, units varchar,"
        " detail_json varchar)"
    )
    con.execute(
        "INSERT INTO fct_feed_events VALUES"
        " ('new_entrant', NULL, NULL, 'ACME CORP', 3100000.0, 2025.0, NULL,"
        "  2025, 'dollars', NULL)"
    )
    con.execute("CREATE TABLE dim_pe_titles (pe_bli varchar, title varchar)")
    return con


def _new_entrant_card(tmp_path, cited):
    con = _feed_con(tmp_path)
    try:
        _emit_feed_sidecar(
            json_dir=tmp_path, con=con, prog_titles={}, cited_fact_ids=cited,
        )
    finally:
        con.close()
    cards = json.loads((tmp_path / "feed.json").read_text())["cards"]
    return next(c for c in cards if c["event_type"] == "new_entrant")


def test_cited_figure_is_printed_with_its_receipt(tmp_path):
    fid = fact_id_derived("feed", "new_entrant|ACME CORP", "total_obligation")
    card = _new_entrant_card(tmp_path, {fid})
    amounts = [s for s in card["headline_segments"] if "amount" in s]
    assert len(amounts) == 1
    assert amounts[0]["fact_id"] == fid
    assert amounts[0]["amount"] in card["headline"]
    assert _texts(card["headline_segments"]) == card["headline"]


def test_uncitable_figure_is_dropped_from_the_headline_entirely(tmp_path):
    # The money clause goes, the event stays. An uncitable dollar figure never
    # reaches a reader — the same honest-absence rule every other surface
    # follows, and the reason the gate can demand an anchor on every token.
    card = _new_entrant_card(tmp_path, set())
    assert CURRENCY_RE.search(card["headline"]) is None, card["headline"]
    assert card["headline"] == "ACME CORP new defense contractor (first award FY2025)"
    assert all("amount" not in s for s in card["headline_segments"])
