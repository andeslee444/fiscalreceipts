"""Announcement citations (ROADMAP #71): defense.gov articles as a first-class kind.

Links found via the defense.gov daily Contracts corpus
(`budget_line_awards.method = 'announcement+lexicon'`) used to cite only the
generic derived crosswalk row — the reader never saw the article that is the
actual evidence. They now mint `kind='announcement'` citation rows carrying
the article URL, the Wayback snapshot of the archived copy, and that copy's
sha256.

Scope rulings pinned here:
  - ONLY `announcement+lexicon` links flip. `subaward+lexicon` links are one
    hop removed (an FSRS sub's description, not a defense.gov article), so
    they keep the generic derived row — an announcement card claiming
    "Official DoD contract announcement" would be false for them.
  - Fact-id minting is untouched: the announcement rows mint the same fact_ids
    the derived rows did, so every program-page `data-fact-id` resolves
    exactly as before.
  - A link with no `award_link_sources` row (or a source row with no URL)
    FAILS THE EXPORT (fix round 1). It used to fall back to the derived row,
    which turned an out-of-step pipeline into a clean green export that was
    silently worse than the last one.
  - `match_basis` rides from packet → table → query_body → card, because only
    the 'exact-name' basis means the announcement named the program as
    written.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import (
    _announcement_row,
    _build_budget_to_awards_citation_rows,
    fact_id_derived,
)
from govbudget.verify_phase5b1 import _verify_announcement
from load_announcement_links import load_snapshot_manifest, source_row

# Citation row layout (27 columns) — mirrors export_site citations.parquet
_CIT_IDX = {
    name: i for i, name in enumerate([
        "fact_id", "kind", "units", "amount_text", "page_number",
        "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
        "resolution", "sheet", "cells", "amount_thousands", "sha256",
        "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
        "formula", "inputs", "query_body", "recorded_value",
        "pe_bli", "scenario", "amount_type",
    ])
}

_ARTICLE_URL = "https://www.defense.gov/News/Contracts/Contract/Article/1006508/"
_ARCHIVE_URL = (
    "https://web.archive.org/web/20250510074748/"
    "https://www.defense.gov/News/Contracts/Contract/Article/1006508/"
)
_SHA = "ff" * 32
_FORMULA = (
    "crosswalk link: pe_bli=0601101E matched to award PIID HR001124C0001"
    " via method='announcement+lexicon', confidence='high'"
    " (dollars live at award grain in fct_award_transactions)"
)


# ---------------------------------------------------------------------------
# _announcement_row — the 27-column row shape
# ---------------------------------------------------------------------------


def test_announcement_row_shape():
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL,
                            archive_url=_ARCHIVE_URL, sha256=_SHA)
    assert len(row) == 27
    assert row[1] == "announcement"
    assert row[17] == _ARTICLE_URL
    assert json.loads(row[22])["sha256"] == _SHA


def test_announcement_row_column_positions():
    """sha256/official_url/query_body sit where citations.parquet expects them."""
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL,
                            archive_url=_ARCHIVE_URL, sha256=_SHA,
                            match_basis="exact-name", formula=_FORMULA)
    assert row[_CIT_IDX["fact_id"]] == "abcd1234abcd1234"
    assert row[_CIT_IDX["kind"]] == "announcement"
    assert row[_CIT_IDX["sha256"]] == _SHA
    assert row[_CIT_IDX["official_url"]] == _ARTICLE_URL
    assert row[_CIT_IDX["formula"]] == _FORMULA
    body = json.loads(row[_CIT_IDX["query_body"]])
    assert body == {
        "archive_url": _ARCHIVE_URL,
        "article_id": "1006508",
        "match_basis": "exact-name",
        "sha256": _SHA,
    }
    # The cited fact is the LINK, not a dollar figure — no recorded value,
    # no amount, no page geometry.
    assert row[_CIT_IDX["recorded_value"]] is None
    assert row[_CIT_IDX["amount_text"]] is None
    assert row[_CIT_IDX["amount_thousands"]] is None
    assert row[_CIT_IDX["page_number"]] is None


def test_announcement_row_missing_archive_is_null_not_invented():
    """An article with no manifest line keeps null archive fields."""
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL, archive_url=None, sha256=None)
    assert row[_CIT_IDX["sha256"]] is None
    body = json.loads(row[_CIT_IDX["query_body"]])
    assert body["archive_url"] is None
    assert body["sha256"] is None
    assert body["article_id"] == "1006508"


def test_announcement_row_unrecorded_basis_is_null_not_the_strongest_one():
    """An absent match_basis must reach the card as null, not 'exact-name'.

    The loader's rationale prose defaults an absent basis to 'exact-name';
    the citation must not, or ~397 links would read as verbatim name matches
    on the strength of a default.
    """
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL, archive_url=None, sha256=None)
    assert json.loads(row[_CIT_IDX["query_body"]])["match_basis"] is None


# ---------------------------------------------------------------------------
# _build_budget_to_awards_citation_rows — which links flip
# ---------------------------------------------------------------------------


def _make_b2a_duckdb(tmp_path: Path) -> Path:
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE fct_budget_to_awards ("
        "  pe_bli varchar, exhibit varchar, fiscal_year integer,"
        "  organization varchar, award_piid varchar, recipient_name varchar,"
        "  recipient_uei varchar, method varchar, confidence varchar,"
        "  program_title varchar"
        ")"
    )
    con.execute(
        "INSERT INTO fct_budget_to_awards VALUES "
        "('0601101E', 'R-2', 2026, 'DARPA', 'HR001124C0001', 'ACME CORP',"
        " 'UEI1', 'announcement+lexicon', 'high', 'Defense Research Sciences'),"
        "('0605502N', 'R-2', 2026, 'Navy', 'N6833517C0392', 'BETA LLC',"
        " 'UEI2', 'subaward+lexicon', 'medium', 'STTR'),"
        "('0602303E', 'R-2', 2026, 'Army', 'W911NF24C0002', 'GAMMA INC',"
        " 'UEI3', 'account+tokens', 'high', 'Army Research')"
    )
    con.close()
    return db_path


_LINK_SOURCES = {
    ("HR001124C0001", "0601101E"): {
        "source_id": "1006508",
        "source_url": _ARTICLE_URL,
        "archive_url": _ARCHIVE_URL,
        "sha256": _SHA,
        "match_basis": "llm-alias",
    },
}

_ANN_FID = fact_id_derived("budget_to_awards", "0601101E|HR001124C0001", "link")
_SUB_FID = fact_id_derived("budget_to_awards", "0605502N|N6833517C0392", "link")
_ACC_FID = fact_id_derived("budget_to_awards", "0602303E|W911NF24C0002", "link")


def test_announcement_link_gets_announcement_row(tmp_path):
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        link_sources=_LINK_SOURCES,
    )
    by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
    ann = by_fid[_ANN_FID]
    assert ann[_CIT_IDX["kind"]] == "announcement"
    assert ann[_CIT_IDX["official_url"]] == _ARTICLE_URL
    assert ann[_CIT_IDX["sha256"]] == _SHA
    assert json.loads(ann[_CIT_IDX["query_body"]])["article_id"] == "1006508"


def test_announcement_row_carries_the_match_basis_and_the_link_formula(tmp_path):
    """The card can only be honest if both reach it (fix round 1)."""
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        link_sources=_LINK_SOURCES,
    )
    ann = next(r for r in rows if r[_CIT_IDX["fact_id"]] == _ANN_FID)
    assert json.loads(ann[_CIT_IDX["query_body"]])["match_basis"] == "llm-alias"
    formula = ann[_CIT_IDX["formula"]]
    # The same provenance sentence the derived row carried: method + tier.
    assert "announcement+lexicon" in formula
    assert "'high'" in formula
    assert "0601101E" in formula and "HR001124C0001" in formula


def test_announcement_row_records_no_basis_when_the_source_row_has_none(tmp_path):
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        link_sources={("HR001124C0001", "0601101E"): {
            "source_id": "1006508", "source_url": _ARTICLE_URL,
            "archive_url": None, "sha256": None, "match_basis": None,
        }},
    )
    ann = next(r for r in rows if r[_CIT_IDX["fact_id"]] == _ANN_FID)
    assert json.loads(ann[_CIT_IDX["query_body"]])["match_basis"] is None


def test_subaward_and_mechanical_links_keep_the_derived_row(tmp_path):
    """Ruling: only announcement+lexicon flips — the card says 'defense.gov'."""
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        link_sources=_LINK_SOURCES,
    )
    by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
    assert by_fid[_SUB_FID][_CIT_IDX["kind"]] == "derived"
    assert by_fid[_ACC_FID][_CIT_IDX["kind"]] == "derived"
    # the derived rows are untouched: formula + recorded confidence intact
    assert by_fid[_SUB_FID][_CIT_IDX["recorded_value"]] == "medium"
    assert "subaward+lexicon" in by_fid[_SUB_FID][_CIT_IDX["formula"]]


def test_fact_ids_are_the_derived_ids_the_program_pages_already_reference(tmp_path):
    """Gate 2's Cite-state contract: program-page data-fact-ids must not move.

    Compared against fact_id_derived directly rather than against a
    no-source-rows run, because that run now (correctly) raises.
    """
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        link_sources=_LINK_SOURCES,
    )
    assert {r[_CIT_IDX["fact_id"]] for r in rows} == {
        _ANN_FID, _SUB_FID, _ACC_FID}
    # and the flipped link keeps the id its derived row had
    ann = next(r for r in rows if r[_CIT_IDX["kind"]] == "announcement")
    assert ann[_CIT_IDX["fact_id"]] == fact_id_derived(
        "budget_to_awards", "0601101E|HR001124C0001", "link")


def test_announcement_link_without_a_source_row_fails_the_export(tmp_path):
    """Loud failure: an unloaded award_link_sources must not export green.

    This is the silent-degradation branch. Before the fix an empty source map
    produced a complete, correct-looking export in which every announcement
    link had quietly reverted to a generic derived row.
    """
    with pytest.raises(RuntimeError) as exc:
        _build_budget_to_awards_citation_rows(
            duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[], link_sources={},
        )
    msg = str(exc.value)
    assert "1 'announcement+lexicon' link" in msg
    assert "load_announcement_links.py" in msg


def test_announcement_link_with_no_source_map_at_all_fails_the_export(tmp_path):
    """The default (link_sources=None) is not an escape hatch either."""
    with pytest.raises(RuntimeError):
        _build_budget_to_awards_citation_rows(
            duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        )


def test_source_row_without_a_url_fails_the_export(tmp_path):
    """A source row with no URL has no article to cite — also loud."""
    with pytest.raises(RuntimeError):
        _build_budget_to_awards_citation_rows(
            duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
            link_sources={("HR001124C0001", "0601101E"): {
                "source_id": "1006508", "source_url": None,
                "archive_url": None, "sha256": None, "match_basis": None,
            }},
        )


def test_a_mart_with_no_announcement_links_needs_no_source_rows(tmp_path):
    """Proof the raise is scoped: mechanical links alone still export."""
    db_path = tmp_path / "no_ann.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE fct_budget_to_awards ("
        "  pe_bli varchar, exhibit varchar, fiscal_year integer,"
        "  organization varchar, award_piid varchar, recipient_name varchar,"
        "  recipient_uei varchar, method varchar, confidence varchar,"
        "  program_title varchar)"
    )
    con.execute(
        "INSERT INTO fct_budget_to_awards VALUES "
        "('0602303E', 'R-2', 2026, 'Army', 'W911NF24C0002', 'GAMMA INC',"
        " 'UEI3', 'account+tokens', 'high', 'Army Research')"
    )
    con.close()
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=db_path, bl_rows=[], link_sources={})
    assert [r[_CIT_IDX["kind"]] for r in rows] == ["derived"]


# ---------------------------------------------------------------------------
# verify_phase5b1 — the new kind must be verifiable, not "unknown"
# ---------------------------------------------------------------------------


def test_verify_announcement_accepts_a_well_formed_row():
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL,
                            archive_url=_ARCHIVE_URL, sha256=_SHA)
    assert _verify_announcement(row, _CIT_IDX) is None


def test_verify_announcement_accepts_a_row_with_no_archive():
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL, archive_url=None, sha256=None)
    assert _verify_announcement(row, _CIT_IDX) is None


def test_verify_announcement_fails_when_the_article_id_is_not_in_the_url():
    """Proof-it-can-fail: a body that does not describe the cited URL FAILS."""
    row = list(_announcement_row("abcd1234abcd1234", article_id="9999999",
                                 url=_ARTICLE_URL,
                                 archive_url=_ARCHIVE_URL, sha256=_SHA))
    reason = _verify_announcement(tuple(row), _CIT_IDX)
    assert reason is not None
    assert "article_id" in reason


def test_verify_announcement_fails_on_a_non_defense_gov_url():
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url="https://example.com/Article/1006508/",
                            archive_url=None, sha256=None)
    reason = _verify_announcement(row, _CIT_IDX)
    assert reason is not None
    assert "defense.gov" in reason


def test_verify_announcement_fails_on_a_malformed_sha256():
    row = list(_announcement_row("abcd1234abcd1234", article_id="1006508",
                                 url=_ARTICLE_URL,
                                 archive_url=_ARCHIVE_URL, sha256=_SHA))
    row[_CIT_IDX["sha256"]] = "not-a-hash"
    reason = _verify_announcement(tuple(row), _CIT_IDX)
    assert reason is not None
    assert "sha256" in reason


@pytest.mark.parametrize("bad_url", [
    # the substring check `"defense.gov" in url` passed every one of these
    "https://evil.example.com/?ref=defense.gov&id=1006508",
    "https://www.defense.gov/Search/?q=1006508",
    "https://www.defense.gov/News/Contracts/Contract/Article/1006508/extra",
    "http://www.defense.gov/News/Contracts/Contract/Article/1006508/",
    "https://defense.gov/News/Contracts/Contract/Article/1006508/",
])
def test_verify_announcement_rejects_urls_the_substring_check_accepted(bad_url):
    """Proof-it-can-fail: the anchored pattern, not `'defense.gov' in url`."""
    row = list(_announcement_row("abcd1234abcd1234", article_id="1006508",
                                 url=_ARTICLE_URL, archive_url=None,
                                 sha256=None))
    row[_CIT_IDX["official_url"]] = bad_url
    reason = _verify_announcement(tuple(row), _CIT_IDX)
    assert reason is not None
    assert "official_url" in reason


@pytest.mark.parametrize("bad_archive", [
    "https://evil.example.com/web.archive.org/1006508",
    "https://web.archive.org/1006508",                       # no /web/ stamp
    "https://web.archive.org/web/2025/" + _ARTICLE_URL,      # stamp too short
    "https://web.archive.org/web/20250510074748/https://example.com/1006508",
])
def test_verify_announcement_rejects_weak_archive_urls(bad_archive):
    """Anchored Wayback pattern; the snapshot target must be the article."""
    row = list(_announcement_row("abcd1234abcd1234", article_id="1006508",
                                 url=_ARTICLE_URL, archive_url=_ARCHIVE_URL,
                                 sha256=None))
    body = json.loads(row[_CIT_IDX["query_body"]])
    body["archive_url"] = bad_archive
    row[_CIT_IDX["query_body"]] = json.dumps(body, sort_keys=True)
    reason = _verify_announcement(tuple(row), _CIT_IDX)
    assert reason is not None
    assert "archive_url" in reason


@pytest.mark.parametrize("suffix", [
    "/", "?ref=utahmoneywatch.com", "source/GovDelivery/",
])
def test_verify_announcement_tolerates_tracking_suffixes_on_the_snapshot(suffix):
    """The archived target is whatever the crawler fetched.

    101 of the 701 real snapshots carry a trailing '/', a '?ref=' query or a
    '/source/GovDelivery/' segment. They are the same article, and anchoring
    the TARGET as strictly as official_url would fail every one of them.
    """
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL,
                            archive_url=_ARCHIVE_URL + suffix, sha256=None)
    assert _verify_announcement(row, _CIT_IDX) is None


def test_verify_announcement_tolerates_snapshot_path_casing():
    """One real snapshot is '…/Contracts/contract/article/2661059/'."""
    lower = ("https://web.archive.org/web/20250630111639/"
             "https://www.defense.gov/News/Contracts/contract/article/2661059/")
    row = _announcement_row(
        "abcd1234abcd1234", article_id="2661059",
        url="https://www.defense.gov/News/Contracts/Contract/Article/2661059/",
        archive_url=lower, sha256=None)
    assert _verify_announcement(row, _CIT_IDX) is None


def test_verify_announcement_rejects_a_lookalike_article_segment():
    """Tolerating suffixes must not tolerate '…/Article/1006508evil.com/'."""
    bad = ("https://web.archive.org/web/20250510074748/"
           "https://www.defense.gov/News/Contracts/Contract/Article/"
           "1006508evil.com/")
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL, archive_url=bad, sha256=None)
    reason = _verify_announcement(row, _CIT_IDX)
    assert reason is not None
    assert "archive_url" in reason


def test_verify_announcement_fails_when_the_snapshot_is_of_another_article():
    other = ("https://web.archive.org/web/20250510074748/"
             "https://www.defense.gov/News/Contracts/Contract/Article/9999999/")
    row = list(_announcement_row("abcd1234abcd1234", article_id="1006508",
                                 url=_ARTICLE_URL, archive_url=other,
                                 sha256=None))
    reason = _verify_announcement(tuple(row), _CIT_IDX)
    assert reason is not None
    assert "does not name article" in reason


def test_verify_announcement_accepts_a_row_carrying_basis_and_formula():
    """The fix round's new fields must not fail the gate."""
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url=_ARTICLE_URL, archive_url=_ARCHIVE_URL,
                            sha256=_SHA, match_basis="llm-description",
                            formula=_FORMULA)
    assert _verify_announcement(row, _CIT_IDX) is None


# ---------------------------------------------------------------------------
# scripts/load_announcement_links.py — the award_link_sources writer
# ---------------------------------------------------------------------------
# scripts/ is on sys.path via tests/conftest.py.


def test_load_snapshot_manifest_derives_wayback_url_and_timestamp(tmp_path):
    p = tmp_path / "manifest.jsonl"
    p.write_text(
        json.dumps({"article_id": "1006508", "original_url": _ARTICLE_URL,
                    "snapshot_ts": "20250510074748", "sha256": _SHA,
                    "bytes": 119485}) + "\n\n"
    )
    m = load_snapshot_manifest(p)
    assert m["1006508"]["archive_url"] == (
        "https://web.archive.org/web/20250510074748/" + _ARTICLE_URL)
    assert m["1006508"]["archived_at"] == datetime(
        2025, 5, 10, 7, 47, 48, tzinfo=timezone.utc)
    assert m["1006508"]["sha256"] == _SHA


def test_load_snapshot_manifest_missing_file_is_empty(tmp_path):
    assert load_snapshot_manifest(tmp_path / "nope.jsonl") == {}


def test_source_row_for_an_announcement_link(tmp_path):
    manifest = {"1006508": {"archive_url": _ARCHIVE_URL,
                            "archived_at": None, "sha256": _SHA}}
    row = source_row("HR001124C0001", "0601101E",
                     {"article_id": "1006508", "match_basis": "exact-name"},
                     "announcement+lexicon", manifest)
    assert row == ("HR001124C0001", "0601101E", "announcement", "1006508",
                   _ARTICLE_URL, _ARCHIVE_URL, None, _SHA, "exact-name")


def test_source_row_for_an_unarchived_announcement_has_null_archive_fields():
    row = source_row("HR001124C0001", "0601101E", {"article_id": "1006508"},
                     "announcement+lexicon", {})
    assert row[4] == _ARTICLE_URL
    # archive_url, archived_at, sha256, match_basis all absent — never
    # defaulted to the strongest basis the packet could have carried.
    assert row[5:] == (None, None, None, None)


def test_source_row_for_a_subaward_link_records_the_subaward_number():
    """The wave-3 packets carry the STRING 'None' for article_id."""
    packet = {"article_id": "None", "subaward_number": "000000821",
              "match_basis": "subaward-description-exact"}
    row = source_row("N6833517C0392", "0605502N", packet,
                     "subaward+lexicon", {})
    assert row == ("N6833517C0392", "0605502N", "subaward", "000000821",
                   None, None, None, None, "subaward-description-exact")


def test_source_row_carries_every_match_basis_the_corpus_uses():
    for basis in ("exact-name", "designator-normalized", "llm-alias",
                  "llm-designator-variant", "llm-description"):
        row = source_row("P1", "PE1", {"article_id": "1", "match_basis": basis},
                         "announcement+lexicon", {})
        assert row[8] == basis


def test_source_row_returns_none_for_a_method_this_loader_does_not_own():
    """'not subaward' must not mean 'announcement'.

    A future third method would otherwise have been handed a fabricated
    defense.gov article URL built from whatever article_id happened to be in
    the packet.
    """
    assert source_row("P1", "PE1", {"article_id": "1006508"},
                      "account+tokens", {}) is None
    assert source_row("P1", "PE1", {"article_id": "1006508"},
                      "fpds-ap", {}) is None


def test_source_row_never_builds_a_url_out_of_the_string_none():
    """A packet with no real article id yields no row, not .../Article/None/."""
    assert source_row("P1", "PE1", {"article_id": "None"},
                      "announcement+lexicon", {}) is None
    assert source_row("P1", "PE1", {}, "announcement+lexicon", {}) is None
    assert source_row("P1", "PE1", {"subaward_number": ""},
                      "subaward+lexicon", {}) is None
