"""Tests for Phase 5B-3 Task 2b: USAspending citation tier, recipient-id cache,
entity-uei + flows sidecars, filing-level LDA amounts.

TDD scope:
  - Recipient ID cache mock-transport tests
  - Parent-UEI rule (fixture xwalk with multi-parent + null cases)
  - flows sidecar shape
  - Filing-amount rows
  - usaspending verify branch in citation_gate5b1 and integrity_gate5b1
"""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import duckdb
import pytest

from govbudget.export_site import (
    USASPENDING_ENDPOINT_ALLOWLIST,
    _build_entity_ueis_sidecar,
    _build_filing_lda_citation_rows,
    _build_usaspending_citation_rows,
    _emit_flows_sidecars,
    _slugify,
    fact_id_lda_filing,
    fact_id_usaspending,
)
from govbudget.verify_phase5b1 import (
    citation_gate5b1,
    integrity_gate5b1,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CIT_COL_DEFS = (
    "fact_id varchar, kind varchar, units varchar, amount_text varchar,"
    " page_number integer, x0 double, x1 double, top_pt double, bottom_pt double,"
    " page_width double, page_height double, resolution varchar,"
    " sheet varchar, cells varchar, amount_thousands double,"
    " sha256 varchar, hosted_pdf_url varchar, official_url varchar,"
    " xml_path varchar, retrieved_at varchar,"
    " formula varchar, inputs varchar, query_body varchar, recorded_value varchar"
)


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


def _write_manifest(site_dir: Path, **kwargs) -> None:
    defaults = {
        "built_at": "2026-06-12T00:00:00+00:00",
        "datasets": {},
        "citations": {},
        "skipped_unresolved": 0,
        "skipped_zero_amount": 0,
        "uncited_datasets": [],
        "pdf_base_url": "/pdfs",
        "schema_version": 1,
    }
    defaults.update(kwargs)
    (site_dir / "manifest.json").write_text(json.dumps(defaults, indent=2))


def _make_usaspending_row(
    fid: str,
    query_body: str,
    recorded_value: str,
    official_url: str = "https://api.usaspending.gov/api/v2/references/filter/",
) -> tuple:
    return (
        fid, "usaspending", "USD", None,
        None, None, None, None, None, None, None, None,
        None, None, None,
        None, None, official_url, None, None,
        None, None, query_body, recorded_value,
    )


# ---------------------------------------------------------------------------
# fact_id_usaspending tests
# ---------------------------------------------------------------------------


class TestFactIdUsaspending:
    def test_stable_and_16hex(self):
        fid = fact_id_usaspending("family_year", "LOCKHEED MARTIN|2025", "total_obligation")
        assert len(fid) == 16
        assert fid == fact_id_usaspending("family_year", "LOCKHEED MARTIN|2025", "total_obligation")

    def test_differs_by_surface(self):
        a = fact_id_usaspending("family_year", "k", "m")
        b = fact_id_usaspending("district_program", "k", "m")
        assert a != b

    def test_differs_by_key(self):
        a = fact_id_usaspending("family_year", "k1|2025", "total_obligation")
        b = fact_id_usaspending("family_year", "k2|2025", "total_obligation")
        assert a != b

    def test_hash_prefix(self):
        fid = fact_id_usaspending("x", "y", "z")
        expected = hashlib.sha256("usaspending|x|y|z".encode()).hexdigest()[:16]
        assert fid == expected


# ---------------------------------------------------------------------------
# fact_id_lda_filing tests
# ---------------------------------------------------------------------------


class TestFactIdLdaFiling:
    def test_stable_and_16hex(self):
        fid = fact_id_lda_filing("uuid-001", "income")
        assert len(fid) == 16
        assert fid == fact_id_lda_filing("uuid-001", "income")

    def test_income_vs_expenses_differ(self):
        inc = fact_id_lda_filing("uuid-001", "income")
        exp = fact_id_lda_filing("uuid-001", "expenses")
        assert inc != exp

    def test_hash_prefix(self):
        fid = fact_id_lda_filing("uuid-001", "income")
        expected = hashlib.sha256("lda_filing_amount|uuid-001|income".encode()).hexdigest()[:16]
        assert fid == expected

    def test_distinct_from_fact_id_lda(self):
        """fact_id_lda_filing must NOT collide with fact_id_lda for same uuid."""
        from govbudget.export_site import fact_id_lda
        fid_old = fact_id_lda("uuid-001", "0601101E", "darpa")
        fid_new = fact_id_lda_filing("uuid-001", "income")
        assert fid_old != fid_new


# ---------------------------------------------------------------------------
# _build_entity_ueis_sidecar (parent-UEI rule) tests
# ---------------------------------------------------------------------------


def _make_xwalk_duckdb(tmp_path: Path, rows: list[tuple]) -> Path:
    """Create a minimal DuckDB with entity_xwalk populated from rows.

    rows: [(recipient_uei, family_key, parent_uei, total_obligation)]
    """
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE entity_xwalk ("
        "  recipient_uei varchar,"
        "  recipient_name varchar,"
        "  parent_uei varchar,"
        "  parent_name varchar,"
        "  family_key varchar,"
        "  method varchar,"
        "  confidence varchar,"
        "  total_obligation double"
        ")"
    )
    con.executemany(
        "INSERT INTO entity_xwalk (recipient_uei, family_key, parent_uei, total_obligation)"
        " VALUES (?, ?, ?, ?)",
        rows,
    )
    con.close()
    return db_path


class TestParentUEIRule:
    """Deterministic parent-UEI selection: max-obligation member with non-null parent_uei."""

    def test_single_member_family(self, tmp_path):
        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-A", "FAMILY-1", "PARENT-A", 1000000.0),
        ])
        # Write empty recipient_ids.json cache
        cache_path = tmp_path / "usaspending_recipient_ids.json"
        cache_path.write_text("{}")

        result = _build_entity_ueis_sidecar(duckdb_path=db_path)
        assert "FAMILY-1" in result
        assert result["FAMILY-1"]["parent_uei"] == "PARENT-A"

    def test_multi_parent_picks_max_obligation(self, tmp_path):
        """Family with 1,331 pattern: multiple members, different parent_ueis.
        Rule: pick parent_uei of highest-obligation member with non-null parent_uei.
        """
        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-A", "FAMILY-2", "PARENT-A", 5000000.0),   # highest obligation
            ("UEI-B", "FAMILY-2", "PARENT-B", 1000000.0),
            ("UEI-C", "FAMILY-2", "PARENT-C", 2000000.0),
        ])
        cache_path = tmp_path / "usaspending_recipient_ids.json"
        cache_path.write_text("{}")

        result = _build_entity_ueis_sidecar(duckdb_path=db_path)
        # Should pick PARENT-A (highest obligation = 5M)
        assert result["FAMILY-2"]["parent_uei"] == "PARENT-A"

    def test_all_null_parent_uei(self, tmp_path):
        """Family where all members have null parent_uei → parent_uei: null."""
        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-X", "FAMILY-3", None, 500000.0),
            ("UEI-Y", "FAMILY-3", None, 200000.0),
        ])
        cache_path = tmp_path / "usaspending_recipient_ids.json"
        cache_path.write_text("{}")

        result = _build_entity_ueis_sidecar(duckdb_path=db_path)
        assert "FAMILY-3" in result
        assert result["FAMILY-3"]["parent_uei"] is None
        assert result["FAMILY-3"]["profile_id"] is None

    def test_mixed_null_and_non_null_parent_uei(self, tmp_path):
        """Members with mix of null and non-null parent_ueis → pick max non-null."""
        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-P", "FAMILY-4", None, 9000000.0),        # null parent, highest obl
            ("UEI-Q", "FAMILY-4", "PARENT-Q", 3000000.0), # non-null parent
        ])
        cache_path = tmp_path / "usaspending_recipient_ids.json"
        cache_path.write_text("{}")

        result = _build_entity_ueis_sidecar(duckdb_path=db_path)
        # UEI-P has null parent, so even though it has highest obligation,
        # PARENT-Q is picked (only non-null candidate)
        assert result["FAMILY-4"]["parent_uei"] == "PARENT-Q"

    def test_profile_id_loaded_from_cache(self, tmp_path):
        """Cache {parent_uei: profile_id} is loaded and wired into sidecar."""
        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-R", "FAMILY-5", "PARENT-R", 1000000.0),
        ])
        cache_path = tmp_path / "usaspending_recipient_ids.json"
        cache_path.write_text(json.dumps({"PARENT-R": "a43aff3e-1234-5678-abcd-000000000001-P"}))

        # Temporarily override cache path via patching
        with patch("govbudget.export_site.Path") as mock_path_cls:
            # Use real Path for everything except the cache path call
            real_path = Path
            def _path_side_effect(*args):
                p = real_path(*args)
                return p
            mock_path_cls.side_effect = _path_side_effect

            # Call with explicit duckdb_path; the function reads cache from
            # data/research/usaspending_recipient_ids.json by default.
            # We can't easily override the hardcoded path, so instead we test
            # by writing the cache to the expected location and patching chdir.
            pass  # drop the complex mock

        # Directly inject: build sidecar with the duckdb that has PARENT-R,
        # then ensure profile_id comes back from cache if written to the right place.
        # Since _build_entity_ueis_sidecar hardcodes the cache path, we write it there.
        real_cache = Path("data/research/usaspending_recipient_ids.json")
        original_content = real_cache.read_text() if real_cache.exists() else "{}"
        try:
            real_cache.parent.mkdir(parents=True, exist_ok=True)
            real_cache.write_text(json.dumps({"PARENT-R": "a43aff3e-profile-P"}))
            result = _build_entity_ueis_sidecar(duckdb_path=db_path)
            assert result["FAMILY-5"]["parent_uei"] == "PARENT-R"
            assert result["FAMILY-5"]["profile_id"] == "a43aff3e-profile-P"
        finally:
            real_cache.write_text(original_content)

    def test_profile_id_null_when_not_in_cache(self, tmp_path):
        """UEI not in cache → profile_id is None."""
        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-S", "FAMILY-6", "PARENT-S", 500000.0),
        ])
        # Cache is empty
        real_cache = Path("data/research/usaspending_recipient_ids.json")
        original_content = real_cache.read_text() if real_cache.exists() else "{}"
        try:
            real_cache.write_text("{}")
            result = _build_entity_ueis_sidecar(duckdb_path=db_path)
            assert result["FAMILY-6"]["parent_uei"] == "PARENT-S"
            assert result["FAMILY-6"]["profile_id"] is None
        finally:
            real_cache.write_text(original_content)


# ---------------------------------------------------------------------------
# refresh_usaspending_ids (mock transport) tests
# ---------------------------------------------------------------------------


class TestRefreshUsaspendingIds:
    """Cache lookup via mock HTTP transport — never touches real API."""

    def test_cache_hit_skips_network(self, tmp_path):
        """UEIs already in cache are never fetched."""
        from govbudget.export_site import refresh_usaspending_ids

        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-X", "FAM-1", "PARENT-X", 1000.0),
        ])
        cache_file = tmp_path / "cache.json"
        cache_file.write_text(json.dumps({"PARENT-X": "some-profile-id"}))

        with patch("urllib.request.urlopen") as mock_open:
            result = refresh_usaspending_ids(
                duckdb_path=db_path,
                cache_path=str(cache_file),
            )
        # Network was NOT called since PARENT-X is already cached
        mock_open.assert_not_called()
        assert result["PARENT-X"] == "some-profile-id"

    def test_network_success_writes_cache(self, tmp_path):
        """Successful API call writes profile_id to cache."""
        from govbudget.export_site import refresh_usaspending_ids

        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-Y", "FAM-2", "PARENT-Y", 2000.0),
        ])
        cache_file = tmp_path / "cache.json"
        cache_file.write_text("{}")  # empty cache

        # Mock API response
        mock_response_data = json.dumps({
            "results": [
                {"id": "abcdef01-2345-6789-abcd-000000000001-P",
                 "recipient_level": "P",
                 "recipient_name": "SOME PARENT CORP"},
            ]
        }).encode()

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response_data
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = refresh_usaspending_ids(
                duckdb_path=db_path,
                cache_path=str(cache_file),
                polite_delay=0.0,
            )

        assert result["PARENT-Y"] == "abcdef01-2345-6789-abcd-000000000001-P"
        # Cache file updated
        saved = json.loads(cache_file.read_text())
        assert saved["PARENT-Y"] == "abcdef01-2345-6789-abcd-000000000001-P"

    def test_network_failure_writes_null_not_fails(self, tmp_path):
        """Network error → null profile_id, export continues (never raises)."""
        from govbudget.export_site import refresh_usaspending_ids

        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-Z", "FAM-3", "PARENT-Z", 3000.0),
        ])
        cache_file = tmp_path / "cache.json"
        cache_file.write_text("{}")

        with patch("urllib.request.urlopen", side_effect=OSError("timeout")):
            result = refresh_usaspending_ids(
                duckdb_path=db_path,
                cache_path=str(cache_file),
                polite_delay=0.0,
            )

        assert result["PARENT-Z"] is None
        saved = json.loads(cache_file.read_text())
        assert "PARENT-Z" in saved
        assert saved["PARENT-Z"] is None

    def test_prefers_p_level_recipient(self, tmp_path):
        """When multiple results returned, prefers level='P' over others."""
        from govbudget.export_site import refresh_usaspending_ids

        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-W", "FAM-4", "PARENT-W", 4000.0),
        ])
        cache_file = tmp_path / "cache.json"
        cache_file.write_text("{}")

        mock_response_data = json.dumps({
            "results": [
                {"id": "child-id-C", "recipient_level": "C", "recipient_name": "Child"},
                {"id": "parent-id-P", "recipient_level": "P", "recipient_name": "Parent"},
            ]
        }).encode()

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response_data
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = refresh_usaspending_ids(
                duckdb_path=db_path,
                cache_path=str(cache_file),
                polite_delay=0.0,
            )

        # Should prefer the P-level result
        assert result["PARENT-W"] == "parent-id-P"


# ---------------------------------------------------------------------------
# _build_filing_lda_citation_rows tests
# ---------------------------------------------------------------------------


def _make_lda_filings_duckdb_and_parquet(tmp_path: Path) -> tuple[Path, Path]:
    """Create a minimal DuckDB + lda_filings.parquet fixture.

    Returns (db_path, lda_pq_path).
    """
    db_path = tmp_path / "govbudget.duckdb"
    duckdb.connect(str(db_path)).close()  # empty db

    pq_dir = tmp_path / "parquet" / "influence"
    pq_dir.mkdir(parents=True)
    lda_pq = pq_dir / "lda_filings.parquet"
    # Use real UUID format so _verify_lda UUID check passes
    _write_parquet(
        lda_pq,
        "filing_uuid varchar, url varchar, client_name varchar, registrant_name varchar,"
        " filing_year varchar, filing_period varchar, filing_type varchar,"
        " income_usd varchar, expenses_usd varchar, family_key_guess varchar,"
        " match_method varchar",
        [
            ("a1b2c3d4-e5f6-7890-abcd-ef1234567890",
             "https://lda.senate.gov/api/v1/filings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/",
             "CLIENT A", "REG A", "2024", "Q1", "Q1", "50000", "", "FAM-A", "exact"),
            ("b2c3d4e5-f6a7-8901-bcde-f12345678901",
             "https://lda.senate.gov/api/v1/filings/b2c3d4e5-f6a7-8901-bcde-f12345678901/",
             "CLIENT B", "REG B", "2024", "Q2", "Q2", "", "30000", "FAM-B", "exact"),
            ("c3d4e5f6-a7b8-9012-cdef-012345678902",
             "https://lda.senate.gov/api/v1/filings/c3d4e5f6-a7b8-9012-cdef-012345678902/",
             "CLIENT C", "REG C", "2024", "Q3", "Q3", "20000", "15000", "FAM-C", "exact"),
            ("d4e5f6a7-b8c9-0123-defa-123456789012",
             "https://lda.senate.gov/api/v1/filings/d4e5f6a7-b8c9-0123-defa-123456789012/",
             "CLIENT D", "REG D", "2024", "Q4", "Q4", None, None, "FAM-D", "exact"),
        ],
    )
    return db_path, lda_pq


class TestFilingLdaCitationRows:
    """_build_filing_lda_citation_rows produces correct lda_filing rows."""

    # Real UUIDs used in the fixture (must match _make_lda_filings_duckdb_and_parquet)
    _UUID1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"  # income=50000, expenses=""
    _UUID2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901"  # income="", expenses=30000
    _UUID3 = "c3d4e5f6-a7b8-9012-cdef-012345678902"  # income=20000, expenses=15000
    _UUID4 = "d4e5f6a7-b8c9-0123-defa-123456789012"  # income=None, expenses=None

    def test_income_only_filing(self, tmp_path):
        """Filing with income but no expenses → only income row emitted."""
        db_path, _ = _make_lda_filings_duckdb_and_parquet(tmp_path)
        rows = _build_filing_lda_citation_rows(duckdb_path=db_path)

        inc_fid = fact_id_lda_filing(self._UUID1, "income")
        exp_fid = fact_id_lda_filing(self._UUID1, "expenses")
        fids = {r[0] for r in rows}

        assert inc_fid in fids, f"income fid should be in rows: {fids}"
        assert exp_fid not in fids, "expenses fid should NOT be in rows (expenses is empty)"

    def test_expenses_only_filing(self, tmp_path):
        """Filing with expenses but no income → only expenses row emitted."""
        db_path, _ = _make_lda_filings_duckdb_and_parquet(tmp_path)
        rows = _build_filing_lda_citation_rows(duckdb_path=db_path)

        inc_fid = fact_id_lda_filing(self._UUID2, "income")
        exp_fid = fact_id_lda_filing(self._UUID2, "expenses")
        fids = {r[0] for r in rows}

        assert exp_fid in fids, f"expenses fid should be in rows: {fids}"
        assert inc_fid not in fids, "income fid should NOT be in rows (income is empty)"

    def test_both_income_and_expenses(self, tmp_path):
        """Filing with both income and expenses → two rows emitted."""
        db_path, _ = _make_lda_filings_duckdb_and_parquet(tmp_path)
        rows = _build_filing_lda_citation_rows(duckdb_path=db_path)

        inc_fid = fact_id_lda_filing(self._UUID3, "income")
        exp_fid = fact_id_lda_filing(self._UUID3, "expenses")
        fids = {r[0] for r in rows}

        assert inc_fid in fids, f"income fid should be in rows"
        assert exp_fid in fids, f"expenses fid should be in rows"

    def test_null_amounts_not_emitted(self, tmp_path):
        """Filing with null income and expenses → no rows emitted for that filing."""
        db_path, _ = _make_lda_filings_duckdb_and_parquet(tmp_path)
        rows = _build_filing_lda_citation_rows(duckdb_path=db_path)

        inc_fid = fact_id_lda_filing(self._UUID4, "income")
        exp_fid = fact_id_lda_filing(self._UUID4, "expenses")
        fids = {r[0] for r in rows}

        assert inc_fid not in fids, "null income should not produce a row"
        assert exp_fid not in fids, "null expenses should not produce a row"

    def test_row_structure(self, tmp_path):
        """Row is 24-element tuple with kind='lda_filing' and lda.senate.gov URL."""
        db_path, _ = _make_lda_filings_duckdb_and_parquet(tmp_path)
        rows = _build_filing_lda_citation_rows(duckdb_path=db_path)

        inc_fid = fact_id_lda_filing(self._UUID1, "income")
        row = next(r for r in rows if r[0] == inc_fid)

        assert len(row) == 24, f"expected 24-element tuple, got {len(row)}"
        assert row[1] == "lda_filing", f"kind should be lda_filing, got {row[1]}"
        official_url = row[17]  # index 17 = official_url
        assert official_url and "lda.senate.gov" in official_url, \
            f"official_url should be lda.senate.gov URL: {official_url}"
        recorded_value = row[23]  # index 23 = recorded_value
        assert recorded_value == "50000", f"recorded_value should be '50000', got {recorded_value}"

    def test_lda_verify_branch_passes_for_filing_rows(self, tmp_path):
        """Filing-level lda_filing rows pass the existing _verify_lda gate."""
        from govbudget.verify_phase5b1 import _verify_lda

        db_path, _ = _make_lda_filings_duckdb_and_parquet(tmp_path)
        rows = _build_filing_lda_citation_rows(duckdb_path=db_path)

        # Build col_idx matching the 24-column schema
        col_names = [
            "fact_id", "kind", "units", "amount_text",
            "page_number", "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
            "resolution", "sheet", "cells", "amount_thousands", "sha256",
            "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
            "formula", "inputs", "query_body", "recorded_value",
        ]
        idx = {name: i for i, name in enumerate(col_names)}

        for row in rows:
            reason = _verify_lda(row, idx)
            assert reason is None, f"_verify_lda failed for {row[0]}: {reason}"


# ---------------------------------------------------------------------------
# USAspending citation gate (citation_gate5b1) tests
# ---------------------------------------------------------------------------


class TestUsaspendingCitationGate:
    """citation_gate5b1 and integrity_gate5b1 handle usaspending kind."""

    def _valid_query_body(self) -> str:
        return json.dumps({
            "filters": {"recipient_search_text": ["UEI1"], "time_period": []},
            "version": "2020-06-01",
        })

    def test_usaspending_happy_path(self, tmp_path):
        """Valid usaspending row passes citation gate."""
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-1|2025", "total_obligation")
        query_body = self._valid_query_body()
        row = _make_usaspending_row(fid, query_body, "12345678.000")

        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is True, f"failures: {result.get('failures')}"
        assert result["sampled"] >= 1

    def test_usaspending_missing_query_body_fails(self, tmp_path):
        """usaspending row with null query_body → citation gate FAIL."""
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-2|2025", "total_obligation")
        # query_body=None
        row = (
            fid, "usaspending", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, "https://api.usaspending.gov/api/v2/references/filter/", None, None,
            None, None, None, "99999.000",  # query_body=None
        )
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is False, "null query_body should fail"
        assert len(result["failures"]) >= 1

    def test_usaspending_invalid_query_body_json_fails(self, tmp_path):
        """usaspending row with non-JSON query_body → citation gate FAIL."""
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-3|2025", "total_obligation")
        row = _make_usaspending_row(fid, "not-valid-json", "99999.000")
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is False, "invalid JSON query_body should fail"

    def test_usaspending_missing_recorded_value_fails(self, tmp_path):
        """usaspending row with null recorded_value → gate FAIL."""
        site = tmp_path / "site"
        fid = fact_id_usaspending("district_program", "CA|CA-05|0603760E", "total_obligation")
        # recorded_value=None
        row = (
            fid, "usaspending", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, "https://api.usaspending.gov/api/v2/references/filter/", None, None,
            None, None, self._valid_query_body(), None,  # recorded_value=None
        )
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is False, "null recorded_value should fail"

    def test_usaspending_null_official_url_passes(self, tmp_path):
        """official_url is optional for usaspending — null is permitted."""
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-4|2025", "total_obligation")
        # official_url=None (offline export, hash minting skipped)
        row = (
            fid, "usaspending", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, None, None, None,  # official_url=None
            None, None, self._valid_query_body(), "55555.000",
        )
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is True, f"null official_url should pass: {result.get('failures')}"

    def test_usaspending_bad_endpoint_url_fails(self, tmp_path):
        """official_url referencing a non-usaspending domain → gate FAIL."""
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-5|2025", "total_obligation")
        row = _make_usaspending_row(
            fid, self._valid_query_body(), "12345.000",
            official_url="https://evil.example.com/api/v2/references/filter/",
        )
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is False, "non-usaspending URL should fail"


# ---------------------------------------------------------------------------
# USAspending integrity gate tests
# ---------------------------------------------------------------------------


class TestUsaspendingIntegrityGate:
    def _valid_qb(self) -> str:
        return json.dumps({"filters": {}, "version": "2020-06-01"})

    def test_usaspending_query_and_value_passes(self, tmp_path):
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-OK|2025", "total_obligation")
        row = _make_usaspending_row(fid, self._valid_qb(), "999.000")
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = integrity_gate5b1(site)
        assert result["checks"].get("usaspending_query_and_value") is True, \
            f"expected pass: {result}"

    def test_usaspending_missing_query_body_fails_integrity(self, tmp_path):
        site = tmp_path / "site"
        fid = fact_id_usaspending("family_year", "FAM-BAD|2025", "total_obligation")
        # query_body=None
        row = (
            fid, "usaspending", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, None, None, None,
            None, None, None, "999.000",
        )
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = integrity_gate5b1(site)
        assert result["checks"].get("usaspending_query_and_value") is False, \
            f"expected fail for null query_body: {result}"


# ---------------------------------------------------------------------------
# Flows sidecar shape tests
# ---------------------------------------------------------------------------


def _make_flows_duckdb(tmp_path: Path) -> Path:
    """Create a minimal DuckDB with the tables needed for _emit_flows_sidecars."""
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))

    # dim_programs
    con.execute(
        "CREATE TABLE dim_programs (pe_bli varchar, title varchar, org varchar,"
        " exhibit_family varchar, project_count integer, fy2024_actual_millions double,"
        " fully_reconciled boolean)"
    )
    con.execute(
        "INSERT INTO dim_programs VALUES ('0603760E', 'Command Control', 'DARPA', 'rdte', 5, 100.0, true)"
    )

    # fct_budget_trajectory
    con.execute(
        "CREATE TABLE fct_budget_trajectory (pe_bli varchar, organization varchar,"
        " fy2026_total double, fy2025_total double, fy2024_actuals double,"
        " fy2526_change double, fy2526_pct_change double)"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES ('0603760E', 'DARPA', 846900.0, 780000.0, 700000.0, 66900.0, 8.6)"
    )

    # fct_budget_to_awards (confidence=high)
    con.execute(
        "CREATE TABLE fct_budget_to_awards (award_piid varchar, pe_bli varchar,"
        " program_title varchar, organization varchar, confidence varchar)"
    )
    con.executemany(
        "INSERT INTO fct_budget_to_awards VALUES (?, '0603760E', 'CC', 'DARPA', 'high')",
        [("PIID-001",), ("PIID-002",), ("PIID-003",)],
    )

    # fct_award_transactions
    con.execute(
        "CREATE TABLE fct_award_transactions (award_id_piid varchar, recipient_uei varchar,"
        " obligation double, pop_state varchar, pop_district varchar, fiscal_year integer,"
        " transaction_key varchar)"
    )
    con.executemany(
        "INSERT INTO fct_award_transactions VALUES (?, ?, ?, 'CO', 'CO-05', 2025, ?)",
        [
            ("PIID-001", "UEI-A", 100000.0, "TXN-1"),
            ("PIID-002", "UEI-B", 200000.0, "TXN-2"),
            ("PIID-003", "UEI-C", 50000.0, "TXN-3"),
        ],
    )

    # entity_xwalk
    con.execute(
        "CREATE TABLE entity_xwalk (recipient_uei varchar, recipient_name varchar,"
        " parent_uei varchar, parent_name varchar, family_key varchar,"
        " method varchar, confidence varchar, total_obligation double)"
    )
    con.executemany(
        "INSERT INTO entity_xwalk (recipient_uei, recipient_name, family_key) VALUES (?, ?, ?)",
        [
            ("UEI-A", "LOCKHEED MARTIN", "LOCKHEED MARTIN"),
            ("UEI-B", "RAYTHEON", "RAYTHEON"),
            ("UEI-C", "BOOZ ALLEN", "BOOZ ALLEN"),
        ],
    )

    # fct_district_programs
    con.execute(
        "CREATE TABLE fct_district_programs (pop_state varchar, pop_district varchar,"
        " pe_bli varchar, program_title varchar, organization varchar,"
        " transaction_count integer, award_count integer, recipient_count integer,"
        " total_obligation double)"
    )
    con.execute(
        "INSERT INTO fct_district_programs VALUES ('CO', 'CO-05', '0603760E', 'CC', 'DARPA', 3, 3, 3, 350000.0)"
    )

    con.close()
    return db_path


class TestFlowsSidecar:
    def test_flows_emitted_for_crosswalked_programs(self, tmp_path):
        """_emit_flows_sidecars creates one file per pe_bli in fct_district_programs."""
        flows_dir = tmp_path / "flows"
        flows_dir.mkdir()
        db_path = _make_flows_duckdb(tmp_path)

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            n = _emit_flows_sidecars(flows_dir=flows_dir, con=con)
        finally:
            con.close()

        assert n == 1, f"expected 1 flow file, got {n}"
        flow_file = flows_dir / "0603760E.json"
        assert flow_file.exists(), f"flow file not found: {flow_file}"

    def test_flows_header_shape(self, tmp_path):
        """flows/{pe_bli}.json has correct header fields."""
        flows_dir = tmp_path / "flows"
        flows_dir.mkdir()
        db_path = _make_flows_duckdb(tmp_path)

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_flows_sidecars(flows_dir=flows_dir, con=con)
        finally:
            con.close()

        obj = json.loads((flows_dir / "0603760E.json").read_text())
        header = obj["header"]
        assert header["pe_bli"] == "0603760E"
        assert header["title"] == "Command Control"
        assert header["org"] == "DARPA"
        assert header["fy2026_total"] == 846900.0

    def test_flows_awards_shape(self, tmp_path):
        """awards list has correct fields per award."""
        flows_dir = tmp_path / "flows"
        flows_dir.mkdir()
        db_path = _make_flows_duckdb(tmp_path)

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_flows_sidecars(flows_dir=flows_dir, con=con)
        finally:
            con.close()

        obj = json.loads((flows_dir / "0603760E.json").read_text())
        awards = obj["awards"]
        assert isinstance(awards, list), "awards should be a list"
        assert len(awards) <= 12, "at most 12 awards"
        assert len(awards) >= 1, "at least 1 award"

        first = awards[0]
        required_keys = {"piid", "recipient_name", "family_slug", "district", "dollars", "confidence"}
        assert required_keys.issubset(first.keys()), f"missing keys: {required_keys - first.keys()}"
        assert first["confidence"] == "high"
        assert first["district"] == "CO-CO-05"

    def test_flows_family_slug_format(self, tmp_path):
        """family_slug follows lower/hyphen rule."""
        flows_dir = tmp_path / "flows"
        flows_dir.mkdir()
        db_path = _make_flows_duckdb(tmp_path)

        con = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_flows_sidecars(flows_dir=flows_dir, con=con)
        finally:
            con.close()

        obj = json.loads((flows_dir / "0603760E.json").read_text())
        for award in obj["awards"]:
            slug = award["family_slug"]
            assert slug == slug.lower(), f"slug not lowercase: {slug}"
            assert " " not in slug, f"slug has spaces: {slug}"

    def test_flows_top_n_at_most_12(self, tmp_path):
        """Even with 20 awards, flows file has at most 12."""
        db_path = _make_flows_duckdb(tmp_path)

        # Add 20 more awards to the db
        con = duckdb.connect(str(db_path))
        for i in range(20):
            piid = f"PIID-EX{i:03d}"
            uei = f"UEI-EX{i:03d}"
            con.execute(
                "INSERT INTO fct_budget_to_awards VALUES (?, '0603760E', 'CC', 'DARPA', 'high')",
                [piid],
            )
            con.execute(
                "INSERT INTO fct_award_transactions VALUES (?, ?, 10000.0, 'CO', 'CO-05', 2025, ?)",
                [piid, uei, f"TXN-EX{i:03d}"],
            )
            con.execute(
                "INSERT INTO entity_xwalk (recipient_uei, recipient_name, family_key) VALUES (?, ?, ?)",
                [uei, f"VENDOR {i}", f"VENDOR {i}"],
            )
        con.close()

        flows_dir = tmp_path / "flows"
        flows_dir.mkdir()
        con2 = duckdb.connect(str(db_path), read_only=True)
        try:
            _emit_flows_sidecars(flows_dir=flows_dir, con=con2)
        finally:
            con2.close()

        obj = json.loads((flows_dir / "0603760E.json").read_text())
        assert len(obj["awards"]) <= 12, f"expected ≤12 awards, got {len(obj['awards'])}"


# ---------------------------------------------------------------------------
# _slugify tests
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_lowercase(self):
        assert _slugify("LOCKHEED MARTIN") == "lockheed-martin"

    def test_hyphens(self):
        assert _slugify("Booz Allen & Hamilton") == "booz-allen-hamilton"

    def test_no_leading_trailing_hyphens(self):
        s = _slugify("  Test Corp  ")
        assert not s.startswith("-")
        assert not s.endswith("-")

    def test_numbers_preserved(self):
        assert _slugify("F-35 Lightning II") == "f-35-lightning-ii"


# ---------------------------------------------------------------------------
# _build_usaspending_citation_rows basic shape tests
# ---------------------------------------------------------------------------


def _make_usaspending_mart_duckdb(tmp_path: Path) -> Path:
    """Create a DuckDB with the tables needed for _build_usaspending_citation_rows."""
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))

    # dim_entities (top-200 will include FAM-A and FAM-B)
    con.execute(
        "CREATE TABLE dim_entities (family_key varchar, display_name varchar,"
        " uei_count integer, total_obligation double, worst_confidence varchar)"
    )
    con.executemany(
        "INSERT INTO dim_entities VALUES (?, ?, 1, ?, 'high')",
        [("FAM-A", "Company A", 100000000.0), ("FAM-B", "Company B", 50000000.0)],
    )

    # entity_xwalk
    con.execute(
        "CREATE TABLE entity_xwalk (recipient_uei varchar, recipient_name varchar,"
        " parent_uei varchar, parent_name varchar, family_key varchar,"
        " method varchar, confidence varchar, total_obligation double)"
    )
    con.executemany(
        "INSERT INTO entity_xwalk (recipient_uei, family_key) VALUES (?, ?)",
        [("UEI-A1", "FAM-A"), ("UEI-A2", "FAM-A"), ("UEI-B1", "FAM-B")],
    )

    # fct_family_obligations_by_year
    con.execute(
        "CREATE TABLE fct_family_obligations_by_year (family_key varchar, fiscal_year integer,"
        " total_obligation double, transaction_count integer, uei_count integer)"
    )
    con.executemany(
        "INSERT INTO fct_family_obligations_by_year VALUES (?, ?, ?, 1, 1)",
        [
            ("FAM-A", 2024, 60000000.0),
            ("FAM-A", 2025, 100000000.0),
            ("FAM-B", 2025, 50000000.0),
            ("FAM-C", 2025, 1000.0),  # NOT in top-200 → should be excluded
        ],
    )

    # fct_district_programs
    con.execute(
        "CREATE TABLE fct_district_programs (pop_state varchar, pop_district varchar,"
        " pe_bli varchar, program_title varchar, organization varchar,"
        " transaction_count integer, award_count integer, recipient_count integer,"
        " total_obligation double)"
    )
    con.execute(
        "INSERT INTO fct_district_programs VALUES ('CO', 'CO-05', '0603760E', 'CC', 'DARPA', 3, 3, 3, 350000.0)"
    )

    # fct_budget_to_awards (needed for district PIID lookup)
    con.execute(
        "CREATE TABLE fct_budget_to_awards (award_piid varchar, pe_bli varchar,"
        " program_title varchar, organization varchar, confidence varchar)"
    )
    con.execute(
        "INSERT INTO fct_budget_to_awards VALUES ('PIID-001', '0603760E', 'CC', 'DARPA', 'high')"
    )

    # fct_award_transactions (needed for district PIID lookup)
    con.execute(
        "CREATE TABLE fct_award_transactions (award_id_piid varchar, recipient_uei varchar,"
        " obligation double, pop_state varchar, pop_district varchar, fiscal_year integer,"
        " transaction_key varchar)"
    )
    con.execute(
        "INSERT INTO fct_award_transactions VALUES ('PIID-001', 'UEI-A1', 100000.0, 'CO', 'CO-05', 2025, 'TXN-1')"
    )

    con.close()
    return db_path


class TestBuildUsaspendingCitationRows:
    def test_emits_family_year_rows_for_top200(self, tmp_path):
        """Rows emitted for FAM-A and FAM-B (in top-200) but not FAM-C."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        rows = _build_usaspending_citation_rows(duckdb_path=db_path)

        kinds = {r[1] for r in rows}
        assert kinds == {"usaspending"}, f"all rows should be usaspending kind"

        # Family-year keys present
        fam_a_2025_fid = fact_id_usaspending("family_year", "FAM-A|2025", "total_obligation")
        fam_c_2025_fid = fact_id_usaspending("family_year", "FAM-C|2025", "total_obligation")
        fids = {r[0] for r in rows}

        assert fam_a_2025_fid in fids, "FAM-A 2025 should be in rows"
        assert fam_c_2025_fid not in fids, "FAM-C should NOT be in rows (not top-200)"

    def test_emits_district_program_rows(self, tmp_path):
        """Row emitted for the district program CO|CO-05|0603760E."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        rows = _build_usaspending_citation_rows(duckdb_path=db_path)

        dp_fid = fact_id_usaspending("district_program", "CO|CO-05|0603760E", "total_obligation")
        fids = {r[0] for r in rows}
        assert dp_fid in fids, "district program row should be in rows"

    def test_query_body_is_valid_json(self, tmp_path):
        """All query_body fields parse as JSON dicts."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        rows = _build_usaspending_citation_rows(duckdb_path=db_path)

        for row in rows:
            query_body = row[22]  # index 22 = query_body
            assert query_body is not None, f"query_body should not be None for {row[0]}"
            parsed = json.loads(query_body)
            assert isinstance(parsed, dict), f"query_body should be a dict: {parsed}"

    def test_recorded_value_is_numeric_string(self, tmp_path):
        """All recorded_value fields are numeric strings."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        rows = _build_usaspending_citation_rows(duckdb_path=db_path)

        for row in rows:
            rv = row[23]  # index 23 = recorded_value
            assert rv is not None, f"recorded_value should not be None for {row[0]}"
            float(rv)  # should not raise

    def test_official_url_contains_usaspending(self, tmp_path):
        """official_url (when present) references usaspending.gov."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        rows = _build_usaspending_citation_rows(duckdb_path=db_path)

        for row in rows:
            official_url = row[17]  # index 17 = official_url
            if official_url:
                assert "usaspending.gov" in official_url or "api.usaspending.gov" in official_url, \
                    f"official_url should reference usaspending.gov: {official_url}"
