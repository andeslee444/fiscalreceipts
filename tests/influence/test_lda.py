"""TDD tests for govbudget.influence.lda.

All tests use MockTransport — no live network calls.
Fixture: tests/fixtures/influence/lda_filing.json
  (one real Lockheed 2025 filing, trimmed; count=66 for pagination tests).
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb
import httpx
import pytest

from govbudget.influence.lda import (
    _match_method,
    _normalize_dollar,
    _trim_filing,
    fetch_client_filings,
    pull_top_families,
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
