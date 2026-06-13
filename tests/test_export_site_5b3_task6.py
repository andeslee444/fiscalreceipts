"""Tests for Phase 5B-3 Task 6a: filing sidecars.

TDD scope:
  - _emit_filing_sidecars: per-uuid files + filings_index.json, amount⟺fact_id
    pairing invariant, mention program links, lobbyist passthrough, ordering
  - _stage_parquet_path: live + test layout resolution
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

from govbudget.export_site import (
    _emit_filing_sidecars,
    _stage_parquet_path,
    fact_id_lda_filing,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_parquet(path: Path, col_defs: str, rows: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(f"create table _t ({col_defs})")
        if rows:
            placeholders = ", ".join("?" for _ in rows[0])
            con.executemany(f"insert into _t values ({placeholders})", rows)
        path_str = str(path).replace("'", "''")
        con.execute(f"copy _t to '{path_str}' (format parquet, compression zstd)")
    finally:
        con.close()


_UUID1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"  # income + expenses, has mention
_UUID2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901"  # expenses only, no mentions
_UUID3 = "c3d4e5f6-a7b8-9012-cdef-012345678902"  # no amounts, mention to unknown program

_LDA_FILINGS_COLS = (
    "filing_uuid varchar, url varchar, client_name varchar, registrant_name varchar,"
    " filing_year varchar, filing_period varchar, filing_type varchar,"
    " income_usd varchar, expenses_usd varchar, family_key_guess varchar,"
    " match_method varchar"
)


def _make_filing_fixture(tmp_path: Path) -> Path:
    """Write lda_{filings,activities,lobbyists}.parquet next to a fake duckdb.

    Returns the duckdb path (parquets live at {parent}/parquet/influence/).
    """
    db_path = tmp_path / "govbudget.duckdb"
    duckdb.connect(str(db_path)).close()

    pq_dir = tmp_path / "parquet" / "influence"
    _write_parquet(
        pq_dir / "lda_filings.parquet",
        _LDA_FILINGS_COLS,
        [
            (_UUID1, f"https://lda.senate.gov/api/v1/filings/{_UUID1}/",
             "ACME CORP", "LOBBY SHOP LLC", "2025", "first_quarter", "Q1",
             "50000", "20000", "ACME", "exact"),
            (_UUID2, f"https://lda.senate.gov/api/v1/filings/{_UUID2}/",
             "BETA INC", "SELF", "2024", "second_quarter", "Q2",
             "", "30000", "BETA", "exact"),
            (_UUID3, f"https://lda.senate.gov/api/v1/filings/{_UUID3}/",
             "GAMMA LLC", "REG G", "2025", "third_quarter", "Q3",
             None, None, "GAMMA", "exact"),
        ],
    )
    _write_parquet(
        pq_dir / "lda_activities.parquet",
        "filing_uuid varchar, issue_code varchar, issue_display varchar,"
        " description varchar, agencies_json varchar",
        [
            (_UUID1, "DEF", "Defense", "Lobbied on hypersonics program", "[]"),
            (_UUID1, "BUD", "Budget/Appropriations", "FY26 approps", "[]"),
            (_UUID2, "DEF", "Defense", "General defense matters", "[]"),
        ],
    )
    _write_parquet(
        pq_dir / "lda_lobbyists.parquet",
        "filing_uuid varchar, name varchar, covered_position varchar",
        [
            (_UUID1, "JANE DOE", "Deputy Assistant Secretary of Defense"),
            (_UUID1, "JOHN SMITH", None),
            (_UUID1, "JOHN SMITH", None),  # exact duplicate — must collapse
            (_UUID2, "ALICE JONES", ""),
        ],
    )
    return db_path


def _lob_rows() -> list[tuple]:
    """fct_program_lobbying-shaped rows (mentions)."""
    return [
        # (filing_uuid, pe_bli, program_title, matched_term,
        #  description_snippet, filing_url, client_name, family_key, filing_year)
        (_UUID1, "0601101E", "Defense Research Sciences", "DARPA",
         "…DARPA research…", f"https://lda.senate.gov/api/v1/filings/{_UUID1}/",
         "ACME CORP", "ACME", "2025"),
        (_UUID3, "9999X", "Unknown Program", "unknown",
         "…unknown…", f"https://lda.senate.gov/api/v1/filings/{_UUID3}/",
         "GAMMA LLC", "GAMMA", "2025"),
    ]


_PROG_TITLES = {"0601101E": "Defense Research Sciences"}


def _cited_set() -> set[str]:
    return {
        fact_id_lda_filing(_UUID1, "income"),
        fact_id_lda_filing(_UUID1, "expenses"),
        fact_id_lda_filing(_UUID2, "expenses"),
    }


def _emit(tmp_path: Path, cited: set[str] | None = None) -> Path:
    db_path = _make_filing_fixture(tmp_path)
    json_dir = tmp_path / "json"
    json_dir.mkdir(exist_ok=True)
    n = _emit_filing_sidecars(
        json_dir=json_dir,
        duckdb_path=db_path,
        lob_rows=_lob_rows(),
        prog_titles=_PROG_TITLES,
        cited_fact_ids=cited if cited is not None else _cited_set(),
    )
    # 3 per-uuid files + 1 index
    assert n == 4
    return json_dir


# ---------------------------------------------------------------------------
# _stage_parquet_path
# ---------------------------------------------------------------------------


class TestStageParquetPath:
    def test_test_layout(self, tmp_path):
        db = tmp_path / "govbudget.duckdb"
        target = tmp_path / "parquet" / "influence" / "lda_filings.parquet"
        target.parent.mkdir(parents=True)
        target.touch()
        assert _stage_parquet_path(db, "influence", "lda_filings.parquet") == target

    def test_live_layout(self, tmp_path):
        # live: data/duckdb/govbudget.duckdb + data/parquet/influence/…
        db = tmp_path / "duckdb" / "govbudget.duckdb"
        db.parent.mkdir(parents=True)
        target = tmp_path / "parquet" / "influence" / "lda_filings.parquet"
        target.parent.mkdir(parents=True)
        target.touch()
        assert _stage_parquet_path(db, "influence", "lda_filings.parquet") == target

    def test_missing_returns_none(self, tmp_path):
        db = tmp_path / "govbudget.duckdb"
        assert _stage_parquet_path(db, "influence", "nope.parquet") is None


# ---------------------------------------------------------------------------
# Filing sidecars (Task 6a)
# ---------------------------------------------------------------------------


class TestEmitFilingSidecars:
    def test_creates_per_uuid_and_index(self, tmp_path):
        json_dir = _emit(tmp_path)
        for u in (_UUID1, _UUID2, _UUID3):
            assert (json_dir / "filings" / f"{u}.json").exists()
        assert (json_dir / "filings_index.json").exists()

    def test_filing_header_fields(self, tmp_path):
        json_dir = _emit(tmp_path)
        obj = json.loads((json_dir / "filings" / f"{_UUID1}.json").read_text())
        f = obj["filing"]
        assert f["client_name"] == "ACME CORP"
        assert f["registrant_name"] == "LOBBY SHOP LLC"
        assert f["filing_year"] == "2025"
        assert f["filing_period"] == "first_quarter"
        assert f["filing_type"] == "Q1"
        assert f["url"].endswith(f"/{_UUID1}/")

    def test_amounts_paired_with_fact_ids(self, tmp_path):
        json_dir = _emit(tmp_path)
        f1 = json.loads((json_dir / "filings" / f"{_UUID1}.json").read_text())["filing"]
        assert f1["income_usd"] == 50000.0
        assert f1["income_fact_id"] == fact_id_lda_filing(_UUID1, "income")
        assert f1["expenses_usd"] == 20000.0
        assert f1["expenses_fact_id"] == fact_id_lda_filing(_UUID1, "expenses")

    def test_empty_income_is_not_reported(self, tmp_path):
        """income_usd='' → null amount + null fact_id (renders 'not reported')."""
        json_dir = _emit(tmp_path)
        f2 = json.loads((json_dir / "filings" / f"{_UUID2}.json").read_text())["filing"]
        assert f2["income_usd"] is None
        assert f2["income_fact_id"] is None
        assert f2["expenses_usd"] == 30000.0
        assert f2["expenses_fact_id"] == fact_id_lda_filing(_UUID2, "expenses")

    def test_uncited_amount_nulled(self, tmp_path):
        """Amount whose fact_id is NOT in the cited set → both fields null.

        Guarantees the page never renders a state-C span for lda_filings
        (the dataset is off the uncited ledger).
        """
        json_dir = _emit(tmp_path, cited=set())
        f1 = json.loads((json_dir / "filings" / f"{_UUID1}.json").read_text())["filing"]
        assert f1["income_usd"] is None
        assert f1["income_fact_id"] is None

    def test_activities_listed(self, tmp_path):
        json_dir = _emit(tmp_path)
        obj = json.loads((json_dir / "filings" / f"{_UUID1}.json").read_text())
        assert len(obj["activities"]) == 2
        displays = {a["issue_display"] for a in obj["activities"]}
        assert "Defense" in displays

    def test_lobbyists_deduped_with_covered_position(self, tmp_path):
        json_dir = _emit(tmp_path)
        obj = json.loads((json_dir / "filings" / f"{_UUID1}.json").read_text())
        assert len(obj["lobbyists"]) == 2  # duplicate JOHN SMITH collapsed
        jane = next(l for l in obj["lobbyists"] if l["name"] == "JANE DOE")
        assert jane["covered_position"] == "Deputy Assistant Secretary of Defense"

    def test_mention_links_only_known_programs(self, tmp_path):
        json_dir = _emit(tmp_path)
        m1 = json.loads((json_dir / "filings" / f"{_UUID1}.json").read_text())["mentions"]
        assert m1[0]["pe_bli"] == "0601101E"
        assert m1[0]["program_url"] == "/program/0601101E/"
        m3 = json.loads((json_dir / "filings" / f"{_UUID3}.json").read_text())["mentions"]
        assert m3[0]["pe_bli"] == "9999X"
        assert m3[0]["program_url"] is None

    def test_index_has_mentions_flags(self, tmp_path):
        json_dir = _emit(tmp_path)
        idx = json.loads((json_dir / "filings_index.json").read_text())
        assert idx["total"] == 3
        by_uuid = {r["filing_uuid"]: r for r in idx["filings"]}
        assert by_uuid[_UUID1]["has_mentions"] is True
        assert by_uuid[_UUID1]["mention_count"] == 1
        assert by_uuid[_UUID2]["has_mentions"] is False
        assert by_uuid[_UUID3]["has_mentions"] is True

    def test_index_mentions_first_ordering(self, tmp_path):
        json_dir = _emit(tmp_path)
        idx = json.loads((json_dir / "filings_index.json").read_text())
        flags = [r["has_mentions"] for r in idx["filings"]]
        # all True before any False
        assert flags == sorted(flags, reverse=True)

    def test_missing_parquets_graceful(self, tmp_path):
        db_path = tmp_path / "govbudget.duckdb"
        duckdb.connect(str(db_path)).close()
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        n = _emit_filing_sidecars(
            json_dir=json_dir,
            duckdb_path=db_path,
            lob_rows=[],
            prog_titles={},
            cited_fact_ids=set(),
        )
        assert n == 0
        assert not (json_dir / "filings_index.json").exists()
