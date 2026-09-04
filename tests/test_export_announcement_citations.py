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
  - Fact-id minting is untouched: the same (pe_bli, award_piid) links mint the
    same fact_ids whether or not a source row exists, so every program-page
    `data-fact-id` resolves exactly as before.
  - A link with no `award_link_sources` row (or a source row with no URL)
    falls back to the derived row — never a fabricated citation.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb

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
                            archive_url=_ARCHIVE_URL, sha256=_SHA)
    assert row[_CIT_IDX["fact_id"]] == "abcd1234abcd1234"
    assert row[_CIT_IDX["kind"]] == "announcement"
    assert row[_CIT_IDX["sha256"]] == _SHA
    assert row[_CIT_IDX["official_url"]] == _ARTICLE_URL
    body = json.loads(row[_CIT_IDX["query_body"]])
    assert body == {
        "archive_url": _ARCHIVE_URL,
        "article_id": "1006508",
        "sha256": _SHA,
    }
    # The cited fact is the LINK, not a dollar figure — no recorded value,
    # no amount, no page geometry.
    assert row[_CIT_IDX["recorded_value"]] is None
    assert row[_CIT_IDX["amount_text"]] is None
    assert row[_CIT_IDX["amount_thousands"]] is None
    assert row[_CIT_IDX["formula"]] is None
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


def test_fact_ids_unchanged_by_the_kind_flip(tmp_path):
    """Gate 2's Cite-state contract: program-page data-fact-ids must not move."""
    db = _make_b2a_duckdb(tmp_path)
    before = {r[_CIT_IDX["fact_id"]] for r in
              _build_budget_to_awards_citation_rows(duckdb_path=db, bl_rows=[])}
    after = {r[_CIT_IDX["fact_id"]] for r in
             _build_budget_to_awards_citation_rows(
                 duckdb_path=db, bl_rows=[], link_sources=_LINK_SOURCES)}
    assert before == after == {_ANN_FID, _SUB_FID, _ACC_FID}


def test_announcement_link_without_a_source_row_falls_back_to_derived(tmp_path):
    """No award_link_sources row → the generic derived row, never a fake URL."""
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[], link_sources={},
    )
    by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
    assert by_fid[_ANN_FID][_CIT_IDX["kind"]] == "derived"
    assert all(r[_CIT_IDX["kind"]] == "derived" for r in rows)


def test_source_row_without_a_url_falls_back_to_derived(tmp_path):
    rows = _build_budget_to_awards_citation_rows(
        duckdb_path=_make_b2a_duckdb(tmp_path), bl_rows=[],
        link_sources={("HR001124C0001", "0601101E"): {
            "source_id": "1006508", "source_url": None,
            "archive_url": None, "sha256": None,
        }},
    )
    by_fid = {r[_CIT_IDX["fact_id"]]: r for r in rows}
    assert by_fid[_ANN_FID][_CIT_IDX["kind"]] == "derived"


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
    row = source_row("HR001124C0001", "0601101E", {"article_id": "1006508"},
                     "announcement+lexicon", manifest)
    assert row == ("HR001124C0001", "0601101E", "announcement", "1006508",
                   _ARTICLE_URL, _ARCHIVE_URL, None, _SHA)


def test_source_row_for_an_unarchived_announcement_has_null_archive_fields():
    row = source_row("HR001124C0001", "0601101E", {"article_id": "1006508"},
                     "announcement+lexicon", {})
    assert row[4] == _ARTICLE_URL
    assert row[5:] == (None, None, None)


def test_source_row_for_a_subaward_link_records_the_subaward_number():
    """The wave-3 packets carry the STRING 'None' for article_id."""
    packet = {"article_id": "None", "subaward_number": "000000821",
              "match_basis": "subaward-description-exact"}
    row = source_row("N6833517C0392", "0605502N", packet,
                     "subaward+lexicon", {})
    assert row == ("N6833517C0392", "0605502N", "subaward", "000000821",
                   None, None, None, None)


def test_source_row_never_builds_a_url_out_of_the_string_none():
    """A packet with no real article id yields no row, not .../Article/None/."""
    assert source_row("P1", "PE1", {"article_id": "None"},
                      "announcement+lexicon", {}) is None
    assert source_row("P1", "PE1", {}, "announcement+lexicon", {}) is None
    assert source_row("P1", "PE1", {"subaward_number": ""},
                      "subaward+lexicon", {}) is None
