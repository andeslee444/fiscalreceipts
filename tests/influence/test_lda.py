"""TDD tests for govbudget.influence.lda.

All tests use MockTransport — no live network calls.
Fixture: tests/fixtures/influence/lda_filing.json
  (one real Lockheed 2025 filing, trimmed; count=66 for pagination tests).
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import duckdb
import httpx
import pytest

from govbudget.influence.lda import (
    _build_query_strings,
    _load_aliases,
    _load_family_raw_names,
    _load_top_raw_names,
    _match_method,
    _normalize_dollar,
    _normalized_tier_match,
    _suffix_residue_match,
    _trim_filing,
    fetch_client_filings,
    pull_top_families,
    restamp_filings,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "influence"
FILING_FIXTURE = FIXTURE_DIR / "lda_filing.json"

_FIXTURE = json.loads(FILING_FIXTURE.read_text())
_RAW_FILING = _FIXTURE["results"][0]


# ---------------------------------------------------------------------------
# _normalize_dollar
# ---------------------------------------------------------------------------

def test_normalize_dollar_string_decimal():
    assert _normalize_dollar("30000.00") == "30000"


def test_normalize_dollar_none():
    assert _normalize_dollar(None) == ""


def test_normalize_dollar_large():
    # Python banker's rounding: round(1230000.50) == 1230000 (rounds to even)
    assert _normalize_dollar("1230000.50") == "1230000"


# ---------------------------------------------------------------------------
# _trim_filing — structural checks
# ---------------------------------------------------------------------------

def test_trim_filing_required_keys():
    trimmed = _trim_filing(_RAW_FILING)
    required = {
        "filing_uuid", "url", "filing_type", "filing_year", "filing_period",
        "income", "expenses", "client_name", "client_description",
        "registrant_name", "lobbying_activities",
    }
    assert required.issubset(trimmed.keys())


def test_trim_filing_uuid():
    trimmed = _trim_filing(_RAW_FILING)
    assert trimmed["filing_uuid"] == "57a5f526-d6e0-402e-9f23-d2d4bd696ce8"


def test_trim_filing_client_name():
    trimmed = _trim_filing(_RAW_FILING)
    assert trimmed["client_name"] == "LOCKHEED MARTIN CORPORATION"


def test_trim_filing_registrant_name():
    trimmed = _trim_filing(_RAW_FILING)
    assert trimmed["registrant_name"] == "ETHERTON AND ASSOCIATES, INC."


def test_trim_filing_income():
    trimmed = _trim_filing(_RAW_FILING)
    assert trimmed["income"] == "30000.00"


def test_trim_filing_expenses_none():
    """expenses is null for an outside-lobbying-firm filing (income is set instead)."""
    trimmed = _trim_filing(_RAW_FILING)
    assert trimmed["expenses"] is None


def test_trim_filing_activities_count():
    trimmed = _trim_filing(_RAW_FILING)
    assert len(trimmed["lobbying_activities"]) == 3


def test_trim_filing_activity_keys():
    trimmed = _trim_filing(_RAW_FILING)
    act = trimmed["lobbying_activities"][0]
    assert "issue_code" in act
    assert "description" in act
    assert "government_entities" in act
    assert "lobbyists" in act


def test_trim_filing_activity_lobbyist_name():
    trimmed = _trim_filing(_RAW_FILING)
    lb = trimmed["lobbying_activities"][0]["lobbyists"][0]
    assert lb["name"] == "MOSHE SCHWARTZ"


def test_trim_filing_government_entities_are_names():
    """government_entities should be a list of name strings, not dicts."""
    trimmed = _trim_filing(_RAW_FILING)
    entities = trimmed["lobbying_activities"][0]["government_entities"]
    assert isinstance(entities, list)
    assert all(isinstance(e, str) for e in entities)
    assert "SENATE" in entities


# ---------------------------------------------------------------------------
# _match_method
# ---------------------------------------------------------------------------

def test_match_method_exact_family():
    # normalize_name("LOCKHEED MARTIN CORPORATION") == "LOCKHEED MARTIN"
    assert _match_method("LOCKHEED MARTIN CORPORATION", "LOCKHEED MARTIN") == "exact_family"


def test_match_method_normalized_substring():
    # family "BOEING" is in normalize_name("THE BOEING COMPANY") = "BOEING"
    assert _match_method("THE BOEING COMPANY", "BOEING") == "exact_family"


def test_match_method_none():
    assert _match_method("UNRELATED COMPANY INC", "LOCKHEED MARTIN") == "none"


def test_match_method_empty():
    assert _match_method("", "LOCKHEED MARTIN") == "none"


# ---------------------------------------------------------------------------
# fetch_client_filings — MockTransport: single page
# ---------------------------------------------------------------------------

def _make_page_handler(pages: list[dict]):
    """Return a MockTransport handler that returns pages in sequence."""
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        idx = call_count["n"]
        call_count["n"] += 1
        if idx >= len(pages):
            return httpx.Response(404, json={"detail": "not found"})
        return httpx.Response(200, json=pages[idx])

    return handler


def test_fetch_client_filings_single_page(monkeypatch):
    """Single-page result — returns the one filing from fixture."""
    # Remove 'next' so no pagination
    fixture_no_next = {**_FIXTURE, "next": None}
    pages = [fixture_no_next]

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler(pages))) as client:
        filings = fetch_client_filings(client, "lockheed", years=[2025])

    assert len(filings) == 1
    assert filings[0]["filing_uuid"] == "57a5f526-d6e0-402e-9f23-d2d4bd696ce8"
    assert filings[0]["client_name"] == "LOCKHEED MARTIN CORPORATION"


def test_fetch_client_filings_pagination(monkeypatch):
    """Two pages — second page contains a second distinct filing."""
    filing_2 = {
        **_RAW_FILING,
        "filing_uuid": "aaaabbbb-0000-0000-0000-000000000001",
        "url": "https://lda.senate.gov/api/v1/filings/aaaabbbb-0000-0000-0000-000000000001/",
    }
    page1 = {
        "count": 2,
        "next": "https://lda.senate.gov/api/v1/filings/?page=2",
        "previous": None,
        "results": [_RAW_FILING],
    }
    page2 = {
        "count": 2,
        "next": None,
        "previous": "https://lda.senate.gov/api/v1/filings/?page=1",
        "results": [filing_2],
    }

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler([page1, page2]))) as client:
        filings = fetch_client_filings(client, "lockheed", years=[2025])

    assert len(filings) == 2
    uuids = {f["filing_uuid"] for f in filings}
    assert "57a5f526-d6e0-402e-9f23-d2d4bd696ce8" in uuids
    assert "aaaabbbb-0000-0000-0000-000000000001" in uuids


def test_fetch_client_filings_dedupes_across_years(monkeypatch):
    """Same UUID appearing in two year queries is deduplicated."""
    page_no_next = {**_FIXTURE, "next": None}

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler([page_no_next, page_no_next]))) as client:
        filings = fetch_client_filings(client, "lockheed", years=[2024, 2025])

    # Same UUID from both year calls — should be deduped to 1
    assert len(filings) == 1


def test_fetch_client_filings_backoff_on_429(monkeypatch):
    """429 response triggers backoff; subsequent success is returned."""
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(429, text="Too Many Requests")
        page_no_next = {**_FIXTURE, "next": None}
        return httpx.Response(200, json=page_no_next)

    slept = []
    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    monkeypatch.setattr("govbudget.influence.lda._BACKOFF_INITIAL_S", 0.01)
    monkeypatch.setattr("time.sleep", lambda s: slept.append(s))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        filings = fetch_client_filings(client, "lockheed", years=[2025])

    assert len(filings) == 1
    assert len(slept) >= 1  # at least one backoff sleep occurred


# ---------------------------------------------------------------------------
# pull_top_families — full parquet write from fixture data
# ---------------------------------------------------------------------------

def _make_fixture_duckdb(tmp_path: Path) -> Path:
    """Write a minimal dim_entities table with LOCKHEED MARTIN as top family."""
    db_path = tmp_path / "test.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "create table dim_entities ("
        "family_key varchar, display_name varchar, uei_count int,"
        "total_obligation double, worst_confidence varchar)"
    )
    con.execute(
        "insert into dim_entities values "
        "('LOCKHEED MARTIN', 'LOCKHEED MARTIN CORPORATION', 10, 135000000000.0, 'high'),"
        "('BOEING', 'THE BOEING COMPANY', 5, 75000000000.0, 'high')"
    )
    con.close()
    return db_path


def test_pull_top_families_writes_three_parquets(tmp_path, monkeypatch):
    """pull_top_families writes all three parquet files."""
    db_path = _make_fixture_duckdb(tmp_path)
    out_dir = tmp_path / "influence"

    # LDA returns the fixture filing for any query; stop after first page
    page_no_next = {**_FIXTURE, "next": None}
    pages = [page_no_next] * 10  # enough pages for all queries

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler(pages))) as mock_client:
        result = pull_top_families(
            db_path, out_dir=out_dir, top_n=2, years=[2025], _client=mock_client
        )

    filings_path, activities_path, lobbyists_path = result
    assert filings_path.exists(), "lda_filings.parquet not written"
    assert activities_path.exists(), "lda_activities.parquet not written"
    assert lobbyists_path.exists(), "lda_lobbyists.parquet not written"


def test_pull_top_families_filings_content(tmp_path, monkeypatch):
    """lda_filings.parquet has expected columns and the Lockheed filing row."""
    db_path = _make_fixture_duckdb(tmp_path)
    out_dir = tmp_path / "influence"

    page_no_next = {**_FIXTURE, "next": None}
    pages = [page_no_next] * 10

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler(pages))) as mock_client:
        filings_path, _, _ = pull_top_families(
            db_path, out_dir=out_dir, top_n=2, years=[2025], _client=mock_client
        )

    con = duckdb.connect()
    row = con.execute(
        f"select filing_uuid, client_name, family_key_guess, match_method, income_usd, expenses_usd"
        f" from read_parquet('{filings_path}')"
        f" where filing_uuid='57a5f526-d6e0-402e-9f23-d2d4bd696ce8'"
    ).fetchone()
    con.close()
    assert row is not None, "Lockheed filing not found in parquet"
    uuid, client_name, family_key_guess, match_method, income_usd, expenses_usd = row
    assert client_name == "LOCKHEED MARTIN CORPORATION"
    assert family_key_guess == "LOCKHEED MARTIN"
    assert match_method == "exact_family"
    assert income_usd == "30000"
    assert expenses_usd == ""  # null expenses = empty string


def test_pull_top_families_activities_content(tmp_path, monkeypatch):
    """lda_activities.parquet has one row per activity in the fixture (3 activities)."""
    db_path = _make_fixture_duckdb(tmp_path)
    out_dir = tmp_path / "influence"

    page_no_next = {**_FIXTURE, "next": None}
    pages = [page_no_next] * 10

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler(pages))) as mock_client:
        _, activities_path, _ = pull_top_families(
            db_path, out_dir=out_dir, top_n=2, years=[2025], _client=mock_client
        )

    con = duckdb.connect()
    count = con.execute(
        f"select count(*) from read_parquet('{activities_path}')"
        f" where filing_uuid='57a5f526-d6e0-402e-9f23-d2d4bd696ce8'"
    ).fetchone()[0]
    con.close()
    # fixture has 3 lobbying_activities
    assert count == 3


def test_pull_top_families_lobbyists_deduped(tmp_path, monkeypatch):
    """lda_lobbyists.parquet deduplicates MOSHE SCHWARTZ who appears in all 3 activities."""
    db_path = _make_fixture_duckdb(tmp_path)
    out_dir = tmp_path / "influence"

    page_no_next = {**_FIXTURE, "next": None}
    pages = [page_no_next] * 10

    monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
    with httpx.Client(transport=httpx.MockTransport(_make_page_handler(pages))) as mock_client:
        _, _, lobbyists_path = pull_top_families(
            db_path, out_dir=out_dir, top_n=2, years=[2025], _client=mock_client
        )

    con = duckdb.connect()
    count = con.execute(
        f"select count(*) from read_parquet('{lobbyists_path}')"
        f" where filing_uuid='57a5f526-d6e0-402e-9f23-d2d4bd696ce8'"
        f"   and name='MOSHE SCHWARTZ'"
    ).fetchone()[0]
    con.close()
    # MOSHE SCHWARTZ appears in all 3 activities but should be deduped to 1 row per filing
    assert count == 1, f"Expected 1 deduped lobbyist row, got {count}"


def test_pull_top_families_match_golden():
    """normalize_name('LOCKHEED MARTIN CORPORATION') should match family 'LOCKHEED MARTIN'."""
    from govbudget.entities import normalize_name
    assert normalize_name("LOCKHEED MARTIN CORPORATION") == "LOCKHEED MARTIN"
    assert _match_method("LOCKHEED MARTIN CORPORATION", "LOCKHEED MARTIN") == "exact_family"


# ===========================================================================
# Fixture DuckDB helper with entity_xwalk
# ===========================================================================

def _make_fixture_duckdb_with_xwalk(tmp_path: Path) -> Path:
    """Write dim_entities + entity_xwalk tables for testing query expansion."""
    db_path = tmp_path / "test_xwalk.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "create table dim_entities ("
        "family_key varchar, display_name varchar, uei_count int,"
        "total_obligation double, worst_confidence varchar)"
    )
    con.execute(
        "insert into dim_entities values "
        "('LOCKHEED MARTIN', 'LOCKHEED MARTIN CORPORATION', 10, 135000000000.0, 'high'),"
        "('BOOZ ALLEN HAMILTON HOLDING', 'BOOZ ALLEN HAMILTON HOLDING CORPORATION', 5, 6000000000.0, 'high'),"
        "('BAE SYSTEMS', 'BAE SYSTEMS PLC', 8, 18000000000.0, 'high')"
    )
    con.execute(
        "create table entity_xwalk ("
        "recipient_uei varchar, recipient_name varchar, parent_uei varchar,"
        "parent_name varchar, family_key varchar, method varchar,"
        "confidence varchar, total_obligation double)"
    )
    # LOCKHEED: two parent_name values; top by obligation is 'Lockheed Martin Corp'
    con.execute(
        "insert into entity_xwalk values "
        "('UEI001', 'Lockheed Martin Corp', NULL, 'Lockheed Martin Corp', 'LOCKHEED MARTIN', 'name', 'high', 100000000000.0),"
        "('UEI002', 'Lockheed Martin Aeronautics', NULL, 'Lockheed Martin Corp', 'LOCKHEED MARTIN', 'name', 'high', 20000000000.0),"
        "('UEI003', 'LM Aerojet', NULL, 'LM Corp', 'LOCKHEED MARTIN', 'name', 'high', 5000000000.0),"
        # BOOZ ALLEN: single parent, operating subsidiary as recipient
        "('UEI010', 'Booz Allen Hamilton Inc', NULL, 'Booz Allen Hamilton Holding Corporation', 'BOOZ ALLEN HAMILTON HOLDING', 'name', 'high', 6000000000.0),"
        # BAE: parent is BAE Systems PLC; recipients include subsidiary
        "('UEI020', 'BAE Systems Land & Armaments LP', NULL, 'BAE Systems PLC', 'BAE SYSTEMS', 'name', 'high', 10000000000.0)"
    )
    con.close()
    return db_path


# ===========================================================================
# _suffix_residue_match tests
# ===========================================================================

class TestSuffixResidueMatch:
    """Tests for suffix_residue matching tier."""

    def test_booz_allen_holding(self):
        """'BOOZ ALLEN HAMILTON' (filing client norm) matches 'BOOZ ALLEN HAMILTON HOLDING'."""
        assert _suffix_residue_match("BOOZ ALLEN HAMILTON", "BOOZ ALLEN HAMILTON HOLDING") is True

    def test_bae_systems_paren_inc(self):
        """'BAE SYSTEMS' (filing after normalize) matches 'BAE SYSTEMS' (already exact)."""
        # normalize_name('BAE Systems, Inc.') == 'BAE SYSTEMS' == family_key 'BAE SYSTEMS'
        # so this goes through exact_family, not suffix_residue; but suffix_residue
        # also returns True for identical cores
        assert _suffix_residue_match("BAE SYSTEMS", "BAE SYSTEMS") is True

    def test_group_token_stripped(self):
        """UNITEDHEALTH GROUP matches UNITEDHEALTH after GROUP removal."""
        assert _suffix_residue_match("UNITEDHEALTH GROUP", "UNITEDHEALTH") is True

    def test_negative_united_single_token(self):
        """'UNITED' (single token, 6 chars BUT core is just ['UNITED'] which is
        short-enough to be valid? No — 'UNITED' has 6 chars >= 4, so the core is
        valid on the client side. But family_key core must EQUAL client core.
        'UNITED LAUNCH ALLIANCE' → after removing no GENERIC_RESIDUE tokens:
        core is ['UNITED', 'LAUNCH', 'ALLIANCE'] ≠ ['UNITED']. So no match."""
        assert _suffix_residue_match("UNITED", "UNITED LAUNCH ALLIANCE") is False

    def test_negative_united_launch_alliance_vs_united(self):
        """'UNITED LAUNCH ALLIANCE' cannot suffix-residue-match 'UNITED'."""
        assert _suffix_residue_match("UNITED LAUNCH ALLIANCE", "UNITED") is False

    def test_negative_empty_core_after_strip(self):
        """If stripping leaves empty core on one side, no match."""
        # 'GROUP HOLDINGS' → strip GROUP, HOLDINGS → empty → False
        assert _suffix_residue_match("GROUP HOLDINGS", "LOCKHEED MARTIN") is False

    def test_negative_single_generic_token_only(self):
        """Single-token cores with < 4 chars are rejected."""
        # 'PLC' → stripped (in GENERIC_RESIDUE), empty core
        assert _suffix_residue_match("PLC", "BOEING") is False

    def test_holdings_vs_holding_no_match(self):
        """'LOCKHEED MARTIN HOLDING' vs 'LOCKHEED MARTIN HOLDINGS' — cores identical after strip."""
        # Both strip to LOCKHEED MARTIN — should match
        assert _suffix_residue_match("LOCKHEED MARTIN HOLDING", "LOCKHEED MARTIN HOLDINGS") is True

    def test_completely_different_names_no_match(self):
        """Unrelated companies do not match via suffix_residue."""
        assert _suffix_residue_match("RAYTHEON MISSILES DEFENSE", "NORTHROP GRUMMAN") is False


# ===========================================================================
# _match_method tier tests
# ===========================================================================

class TestMatchMethodTiers:
    """One test per tier, verifying priority order."""

    def test_tier_exact_family(self):
        assert _match_method("LOCKHEED MARTIN CORPORATION", "LOCKHEED MARTIN") == "exact_family"

    def test_tier_curated_alias(self):
        """curated_alias fires before normalized."""
        alias_norms = {"V2X"}  # normalize_name("V2X, Inc.") == "V2X"
        assert _match_method("V2X, Inc.", "VECTRUS", alias_norms=alias_norms) == "curated_alias"

    def test_tier_normalized(self):
        """family_key is substring of normalized client_name."""
        assert _match_method("THE BOEING COMPANY INC", "BOEING") == "exact_family"
        # 'BOEING' is in 'BOEING' after normalize — actually exact_family fires first
        # Use a case where substring applies but exact_family doesn't
        # e.g. "GENERAL DYNAMICS LAND SYSTEMS" → normalize → "GENERAL DYNAMICS LAND"
        # family_key "GENERAL DYNAMICS" is substring of "GENERAL DYNAMICS LAND"
        assert _match_method("GENERAL DYNAMICS LAND SYSTEMS", "GENERAL DYNAMICS") == "normalized"

    def test_tier_family_raw_name(self):
        """family_raw_name fires when client norm matches a raw entity_xwalk name."""
        # 'Booz Allen Hamilton Inc' normalizes to 'BOOZ ALLEN HAMILTON'
        # which is a recipient_name in entity_xwalk for family BOOZ ALLEN HAMILTON HOLDING
        raw_names = {"BOOZ ALLEN HAMILTON"}
        assert _match_method(
            "Booz Allen Hamilton Inc",
            "BOOZ ALLEN HAMILTON HOLDING",
            family_raw_names=raw_names,
        ) == "family_raw_name"

    def test_tier_suffix_residue(self):
        """suffix_residue fires when no higher tier matched."""
        # No raw_names set, no alias_norms → falls through to suffix_residue
        assert _match_method(
            "Booz Allen Hamilton Inc",
            "BOOZ ALLEN HAMILTON HOLDING",
        ) == "suffix_residue"

    def test_tier_none(self):
        """Returns 'none' for completely unrelated names."""
        assert _match_method("UNRELATED COMPANY INC", "LOCKHEED MARTIN") == "none"

    def test_tier_none_empty_client(self):
        assert _match_method("", "LOCKHEED MARTIN") == "none"

    def test_tier_none_empty_family(self):
        assert _match_method("LOCKHEED MARTIN CORPORATION", "") == "none"

    def test_curated_alias_priority_over_normalized(self):
        """curated_alias has higher priority than normalized (checked second)."""
        # 'BOEING DEFENSE' normalizes to 'BOEING DEFENSE'
        # family_key 'BOEING' is substring → would be normalized
        # but if alias_norms contains 'BOEING DEFENSE', it fires as curated_alias first
        alias_norms = {"BOEING DEFENSE"}
        result = _match_method("BOEING DEFENSE", "BOEING", alias_norms=alias_norms)
        assert result == "curated_alias"


# ===========================================================================
# _load_aliases tests
# ===========================================================================

class TestLoadAliases:
    def test_load_from_real_csv(self):
        """Real client_aliases.csv loads all 5 families correctly."""
        aliases = _load_aliases()
        assert "PERATON SOLUTIONS" in aliases
        assert "LEONARDO SPA" in aliases
        assert "ROLLS ROYCE HOLDINGS" in aliases
        assert "BP" in aliases
        assert "VECTRUS" in aliases

    def test_load_normalized_keys(self):
        """Aliases are stored as normalized strings."""
        from govbudget.entities import normalize_name
        aliases = _load_aliases()
        # normalize_name("Peraton Inc.") == "PERATON"
        assert normalize_name("Peraton Inc.") in aliases["PERATON SOLUTIONS"]
        # normalize_name("V2X, Inc.") == "V2X"
        assert normalize_name("V2X, Inc.") in aliases["VECTRUS"]

    def test_load_missing_file_returns_empty(self, tmp_path: Path):
        """Missing CSV returns empty dict without raising."""
        result = _load_aliases(tmp_path / "nonexistent.csv")
        assert result == {}

    def test_load_custom_csv(self, tmp_path: Path):
        """Can load from a custom CSV path."""
        csv_path = tmp_path / "test_aliases.csv"
        csv_path.write_text(
            "lda_client_name,family_key,note\n"
            "Test Corp Inc.,TEST FAMILY,test note\n"
        )
        aliases = _load_aliases(csv_path)
        assert "TEST FAMILY" in aliases
        from govbudget.entities import normalize_name
        assert normalize_name("Test Corp Inc.") in aliases["TEST FAMILY"]

    def test_load_alias_absent_family_not_in_graph_is_ignored(self, tmp_path: Path):
        """A seed row whose family is not in dim_entities simply ends up in the alias map
        but causes no error — it will never match because no family queries for it.
        Documented behavior: silent inclusion (filtering is the caller's responsibility)."""
        csv_path = tmp_path / "aliases.csv"
        csv_path.write_text(
            "lda_client_name,family_key,note\n"
            "Ghost Corp,GHOST FAMILY NOT IN GRAPH,phantom\n"
        )
        # _load_aliases does not validate against dim_entities — it just loads
        aliases = _load_aliases(csv_path)
        assert "GHOST FAMILY NOT IN GRAPH" in aliases


# ===========================================================================
# Query expansion tests
# ===========================================================================

class TestBuildQueryStrings:
    def test_display_name_always_first(self):
        queries = _build_query_strings("LOCKHEED MARTIN", "LOCKHEED MARTIN CORPORATION", [], set())
        assert queries[0] == "LOCKHEED MARTIN CORPORATION"

    def test_family_key_added_when_different(self):
        queries = _build_query_strings("LOCKHEED MARTIN", "LOCKHEED MARTIN CORPORATION", [], set())
        assert "LOCKHEED MARTIN" in queries

    def test_family_key_not_duplicated_when_same(self):
        """When display_name.upper() == family_key.upper(), key not added again."""
        queries = _build_query_strings("AECOM", "AECOM", [], set())
        assert queries.count("AECOM") == 1

    def test_raw_names_added(self):
        """Up to 2 raw parent_name norms appended."""
        raw_norms = ["LOCKHEED MARTIN CORP", "LM AEROJET"]
        queries = _build_query_strings("LOCKHEED MARTIN", "LOCKHEED MARTIN CORPORATION", raw_norms, set())
        assert "LOCKHEED MARTIN CORP" in queries
        assert "LM AEROJET" in queries

    def test_raw_names_capped_at_2(self):
        """Only first 2 raw names used."""
        raw_norms = ["ALPHA", "BETA", "GAMMA"]
        queries = _build_query_strings("TEST KEY", "Test Family Inc", raw_norms, set())
        assert "ALPHA" in queries
        assert "BETA" in queries
        assert "GAMMA" not in queries

    def test_alias_norms_appended(self):
        """Alias norms appear in query list."""
        alias_norms = {"PERATON"}
        queries = _build_query_strings("PERATON SOLUTIONS", "PERATON SOLUTIONS INC.", [], alias_norms)
        assert "PERATON" in queries

    def test_deduplication_case_insensitive(self):
        """Duplicate strings (case-insensitively) are not added twice."""
        # raw_norms contains the family_key again → should be deduped
        raw_norms = ["LOCKHEED MARTIN"]  # same as family_key
        queries = _build_query_strings("LOCKHEED MARTIN", "LOCKHEED MARTIN CORPORATION", raw_norms, set())
        upper_queries = [q.upper() for q in queries]
        assert upper_queries.count("LOCKHEED MARTIN") == 1

    def test_empty_raw_and_alias(self):
        """Works with empty raw_norms and empty alias_norms."""
        queries = _build_query_strings("BOEING", "THE BOEING COMPANY", [], set())
        assert len(queries) >= 1
        assert "THE BOEING COMPANY" in queries


class TestQueryExpansionWithFixtureDB:
    """Tests that use a real fixture DuckDB to verify full query expansion pipeline."""

    def test_top_raw_names_loaded(self, tmp_path: Path):
        """_load_top_raw_names returns up to 2 norms for LOCKHEED MARTIN."""
        db_path = _make_fixture_duckdb_with_xwalk(tmp_path)
        result = _load_top_raw_names(db_path, ["LOCKHEED MARTIN"])
        assert "LOCKHEED MARTIN" in result
        norms = result["LOCKHEED MARTIN"]
        # fixture has parent 'Lockheed Martin Corp' → norm = 'LOCKHEED MARTIN' (top by oblig)
        # and 'LM Corp' → norm = 'LM' (second); but 'LOCKHEED MARTIN' == family_key,
        # so it will be deduped by _build_query_strings — that's fine, we just verify load
        assert len(norms) <= 2

    def test_family_raw_names_loaded(self, tmp_path: Path):
        """_load_family_raw_names includes both parent and recipient normalized names."""
        db_path = _make_fixture_duckdb_with_xwalk(tmp_path)
        result = _load_family_raw_names(db_path, ["BOOZ ALLEN HAMILTON HOLDING"])
        fam = result.get("BOOZ ALLEN HAMILTON HOLDING", set())
        from govbudget.entities import normalize_name
        # recipient_name 'Booz Allen Hamilton Inc' → 'BOOZ ALLEN HAMILTON'
        assert normalize_name("Booz Allen Hamilton Inc") in fam
        # parent_name 'Booz Allen Hamilton Holding Corporation' → 'BOOZ ALLEN HAMILTON HOLDING'
        assert normalize_name("Booz Allen Hamilton Holding Corporation") in fam

    def test_full_query_expansion_multi_query_dedupes_by_uuid(self, tmp_path: Path, monkeypatch):
        """Multi-query-per-family: same UUID returned by two queries → deduped to 1 row."""
        db_path = _make_fixture_duckdb_with_xwalk(tmp_path)
        out_dir = tmp_path / "influence"

        # The fixture filing has uuid '57a5f526-d6e0-402e-9f23-d2d4bd696ce8'
        page_no_next = {**_FIXTURE, "next": None}
        # Return the same page for every request (all query strings → same filing)
        call_count = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            call_count["n"] += 1
            return httpx.Response(200, json=page_no_next)

        monkeypatch.setattr("govbudget.influence.lda._REQUEST_FLOOR_S", 0)
        with httpx.Client(transport=httpx.MockTransport(handler)) as mock_client:
            filings_path, _, _ = pull_top_families(
                db_path, out_dir=out_dir, top_n=1, years=[2025], _client=mock_client
            )

        con = duckdb.connect()
        count = con.execute(
            f"select count(*) from read_parquet('{filings_path}') "
            f"where filing_uuid='57a5f526-d6e0-402e-9f23-d2d4bd696ce8'"
        ).fetchone()[0]
        con.close()
        # Multiple query strings per family, each returning the same UUID → dedupe to 1
        assert count == 1, f"Expected 1 deduped filing row, got {count}"
        # And multiple queries were actually made (confirms expansion happened)
        assert call_count["n"] > 1, f"Expected >1 HTTP calls for query expansion, got {call_count['n']}"


# ===========================================================================
# Alias integration test
# ===========================================================================

class TestAliasMatchIntegration:
    """Integration tests for _load_aliases + _match_method with the real CSV."""

    def test_v2x_matches_vectrus(self):
        aliases = _load_aliases()
        result = _match_method("V2X, Inc.", "VECTRUS", alias_norms=aliases.get("VECTRUS"))
        assert result == "curated_alias"

    def test_peraton_inc_matches_peraton_solutions(self):
        aliases = _load_aliases()
        result = _match_method("Peraton Inc.", "PERATON SOLUTIONS", alias_norms=aliases.get("PERATON SOLUTIONS"))
        assert result == "curated_alias"

    def test_leonardo_drs_matches_leonardo_spa(self):
        aliases = _load_aliases()
        result = _match_method("Leonardo DRS, Inc.", "LEONARDO SPA", alias_norms=aliases.get("LEONARDO SPA"))
        assert result == "curated_alias"

    def test_rolls_royce_na_matches_holdings(self):
        aliases = _load_aliases()
        result = _match_method(
            "Rolls-Royce North America Inc.", "ROLLS ROYCE HOLDINGS",
            alias_norms=aliases.get("ROLLS ROYCE HOLDINGS"),
        )
        assert result == "curated_alias"

    def test_bp_america_matches_bp(self):
        aliases = _load_aliases()
        result = _match_method("BP America, Inc.", "BP", alias_norms=aliases.get("BP"))
        assert result == "curated_alias"

    def test_negative_alias_wrong_family(self):
        """V2X alias does not match a different family."""
        aliases = _load_aliases()
        result = _match_method("V2X, Inc.", "LOCKHEED MARTIN", alias_norms=aliases.get("LOCKHEED MARTIN"))
        assert result == "none"


# ===========================================================================
# Finding 1: _normalized_tier_match token-boundary tests
# ===========================================================================

class TestNormalizedTierMatch:
    """Tests for _normalized_tier_match (token-boundary containment + guard)."""

    # --- Guard: short single-token keys must be blocked ---

    def test_bp_does_not_match_bpu(self):
        """'BP' (1 token, 2 chars) must NOT match 'JAMESTOWN BPU' via normalized tier.

        The old substring test would match because 'BP' is inside 'BPU'.
        The token-boundary predicate must block this."""
        assert _normalized_tier_match("JAMESTOWN BPU", "BP") is False

    def test_bp_guard_rejected(self):
        """'BP' alone fails the guard (1 token, 2 chars < 4)."""
        assert _normalized_tier_match("BP ENERGY COMPANY", "BP") is False

    def test_single_short_token_rejected(self):
        """Any single token key with fewer than 4 chars is rejected by guard."""
        assert _normalized_tier_match("AB SOMETHING INC", "AB") is False
        assert _normalized_tier_match("XYZ CORP", "XY") is False

    # --- Contiguous token sequence matching ---

    def test_lockheed_martin_prefix_matches(self):
        """'LOCKHEED MARTIN' (2-token key) matches as contiguous prefix."""
        assert _normalized_tier_match("LOCKHEED MARTIN SPACE SYSTEMS", "LOCKHEED MARTIN") is True

    def test_general_dynamics_matches(self):
        """'GENERAL DYNAMICS' matches as contiguous prefix in longer name."""
        assert _normalized_tier_match("GENERAL DYNAMICS LAND", "GENERAL DYNAMICS") is True

    def test_raytheon_single_4char_token_matches(self):
        """Single token ≥ 4 chars ('RAYTHEON') is allowed by guard and matches."""
        assert _normalized_tier_match("RAYTHEON INTELLIGENCE SPACE", "RAYTHEON") is True

    def test_martin_marietta_non_contiguous_rejected(self):
        """'LOCKHEED MARTIN' tokens are not a contiguous subsequence of 'MARTIN MARIETTA'."""
        assert _normalized_tier_match("MARTIN MARIETTA", "LOCKHEED MARTIN") is False

    def test_middle_window_match(self):
        """Key tokens appearing in the middle of a longer name still match."""
        # "ALPHA LOCKHEED MARTIN BETA" → tokens [ALPHA, LOCKHEED, MARTIN, BETA]
        # key [LOCKHEED, MARTIN] appears at position 1
        assert _normalized_tier_match("ALPHA LOCKHEED MARTIN BETA", "LOCKHEED MARTIN") is True

    def test_single_token_key_at_start(self):
        """Single 4+-char token key matching the first token of client."""
        assert _normalized_tier_match("BOEING DEFENSE SPACE", "BOEING") is True

    def test_exact_match_returns_true(self):
        """When norm == family_key, _normalized_tier_match should return True."""
        assert _normalized_tier_match("LOCKHEED MARTIN", "LOCKHEED MARTIN") is True

    def test_empty_client_returns_false(self):
        assert _normalized_tier_match("", "LOCKHEED MARTIN") is False

    def test_empty_key_returns_false(self):
        assert _normalized_tier_match("LOCKHEED MARTIN CORP", "") is False

    # --- Integration: _match_method uses token-boundary tier ---

    def test_match_method_bp_jamestown_bpu_is_none(self):
        """'JAMESTOWN BPU' vs family 'BP' → 'none' (no curated alias; BP fails guard)."""
        result = _match_method("JAMESTOWN BPU", "BP")
        assert result != "normalized", (
            f"Expected 'none' (or non-'normalized'), got {result!r}"
        )

    def test_match_method_general_dynamics_land_systems_normalized(self):
        """'GENERAL DYNAMICS LAND SYSTEMS' vs 'GENERAL DYNAMICS' → 'normalized'."""
        result = _match_method("GENERAL DYNAMICS LAND SYSTEMS", "GENERAL DYNAMICS")
        assert result == "normalized"

    def test_match_method_lockheed_martin_space_normalized(self):
        """'LOCKHEED MARTIN SPACE SYSTEMS' vs 'LOCKHEED MARTIN' → 'normalized'."""
        result = _match_method("LOCKHEED MARTIN SPACE SYSTEMS", "LOCKHEED MARTIN")
        assert result == "normalized"

    def test_match_method_martin_marietta_vs_lockheed_martin_is_none(self):
        """'MARTIN MARIETTA' vs 'LOCKHEED MARTIN' → 'none' (non-contiguous)."""
        result = _match_method("MARTIN MARIETTA", "LOCKHEED MARTIN")
        assert result == "none"

    def test_match_method_raytheon_normalized(self):
        """'RAYTHEON INTELLIGENCE SPACE' vs 'RAYTHEON' → 'normalized' (4-char guard passes)."""
        result = _match_method("RAYTHEON INTELLIGENCE SPACE", "RAYTHEON")
        assert result == "normalized"


# ===========================================================================
# Finding 1b: restamp_filings tests
# ===========================================================================

def _make_fixture_duckdb_for_restamp(tmp_path: Path) -> Path:
    """Create a minimal duckdb with entity_xwalk for restamp testing."""
    db_path = tmp_path / "restamp_test.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "create table entity_xwalk ("
        "recipient_uei varchar, recipient_name varchar, parent_uei varchar,"
        "parent_name varchar, family_key varchar, method varchar,"
        "confidence varchar, total_obligation double)"
    )
    # No rows needed — restamp just needs the table to exist
    con.close()
    return db_path


def _write_filings_parquet(path: Path, rows: list[tuple]) -> None:
    """Write a minimal lda_filings.parquet fixture."""
    import duckdb as _duckdb

    path.parent.mkdir(parents=True, exist_ok=True)
    con = _duckdb.connect()
    con.execute(
        "create table _f (filing_uuid varchar, url varchar, client_name varchar,"
        " registrant_name varchar, filing_year varchar, filing_period varchar,"
        " filing_type varchar, income_usd varchar, expenses_usd varchar,"
        " family_key_guess varchar, match_method varchar)"
    )
    if rows:
        con.executemany("insert into _f values (?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.execute(f"copy _f to '{path}' (format parquet, compression zstd)")
    con.close()


class TestRestampFilings:
    """Tests for restamp_filings (Finding 1b)."""

    def test_bad_normalized_row_becomes_none(self, tmp_path):
        """A row stamped 'normalized' under old substring logic is re-stamped 'none'.

        'JAMESTOWN BPU' vs family 'BP': old code would stamp 'normalized' because
        'BP' is a character-substring of 'BPU'. After restamp it must become 'none'
        (BP fails the guard: 1 token, 2 chars < 4).
        """
        filings_path = tmp_path / "influence" / "lda_filings.parquet"
        db_path = _make_fixture_duckdb_for_restamp(tmp_path)

        rows = [
            # This row was incorrectly stamped 'normalized' by the old substring logic
            ("uuid-bad", "https://lda.senate.gov/f/1", "JAMESTOWN BPU",
             "LobbyFirm", "2025", "Q1", "LD2", "50000", "", "BP", "normalized"),
            # 'BP' client_name normalizes to 'BP' which equals family_key 'BP' → exact_family
            ("uuid-good", "https://lda.senate.gov/f/2", "BP",
             "LobbyFirm", "2025", "Q1", "LD2", "100000", "", "BP", "exact_family"),
        ]
        _write_filings_parquet(filings_path, rows)

        counts = restamp_filings(filings_path, db_path)

        # Before: 1 normalized, 1 exact_family
        assert counts["before"].get("normalized", 0) == 1
        assert counts["before"].get("exact_family", 0) == 1

        # After: 'JAMESTOWN BPU' / 'BP' must not be 'normalized'
        assert counts["after"].get("normalized", 0) == 0, (
            f"Expected 0 'normalized' rows after restamp, got: {counts['after']}"
        )

        # Verify parquet was rewritten correctly
        rcon = duckdb.connect()
        rows_after = rcon.execute(
            f"select filing_uuid, match_method from read_parquet('{filings_path}') "
            f"order by filing_uuid"
        ).fetchall()
        rcon.close()

        row_map = {uuid: mm for uuid, mm in rows_after}
        assert row_map["uuid-bad"] != "normalized", (
            f"Expected uuid-bad to be re-stamped away from 'normalized', got {row_map['uuid-bad']!r}"
        )
        # 'BP' exact match → exact_family
        assert row_map["uuid-good"] == "exact_family"

    def test_valid_normalized_row_stays_normalized(self, tmp_path):
        """A legitimately 'normalized' row (2-token key, token-contiguous) stays 'normalized'."""
        filings_path = tmp_path / "influence" / "lda_filings.parquet"
        db_path = _make_fixture_duckdb_for_restamp(tmp_path)

        rows = [
            # "GENERAL DYNAMICS LAND" has 'GENERAL DYNAMICS' as contiguous prefix → valid
            ("uuid-gd", "https://lda.senate.gov/f/3", "GENERAL DYNAMICS LAND SYSTEMS",
             "LobbyFirm", "2025", "Q1", "LD2", "200000", "", "GENERAL DYNAMICS", "normalized"),
        ]
        _write_filings_parquet(filings_path, rows)

        counts = restamp_filings(filings_path, db_path)

        assert counts["after"].get("normalized", 0) == 1

    def test_restamp_writes_parquet_atomically(self, tmp_path):
        """After restamp the parquet file still exists and is readable."""
        filings_path = tmp_path / "influence" / "lda_filings.parquet"
        db_path = _make_fixture_duckdb_for_restamp(tmp_path)

        rows = [
            ("uuid-x", "https://lda.senate.gov/f/x", "LOCKHEED MARTIN CORPORATION",
             "Firm", "2025", "Q1", "LD2", "1000", "", "LOCKHEED MARTIN", "exact_family"),
        ]
        _write_filings_parquet(filings_path, rows)
        restamp_filings(filings_path, db_path)

        assert filings_path.exists()
        rcon = duckdb.connect()
        count = rcon.execute(
            f"select count(*) from read_parquet('{filings_path}')"
        ).fetchone()[0]
        rcon.close()
        assert count == 1

    def test_restamp_returns_before_after_counts(self, tmp_path):
        """restamp_filings returns a dict with 'before' and 'after' keys."""
        filings_path = tmp_path / "influence" / "lda_filings.parquet"
        db_path = _make_fixture_duckdb_for_restamp(tmp_path)

        rows = [
            ("uuid-1", "https://lda.senate.gov/f/1", "RAYTHEON CORP",
             "Firm", "2025", "Q1", "LD2", "1000", "", "RAYTHEON", "normalized"),
        ]
        _write_filings_parquet(filings_path, rows)
        result = restamp_filings(filings_path, db_path)

        assert "before" in result
        assert "after" in result
        assert isinstance(result["before"], dict)
        assert isinstance(result["after"], dict)
