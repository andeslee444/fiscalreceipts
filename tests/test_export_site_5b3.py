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
    _build_state_citation_rows,
    _build_usaspending_citation_rows,
    _emit_flows_sidecars,
    _slugify,
    fact_id_lda_filing,
    fact_id_state_file,
    fact_id_state_soql,
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
             "https://lda.gov/filings/public/filing/a1b2c3d4-e5f6-7890-abcd-ef1234567890/print/",
             "CLIENT A", "REG A", "2024", "Q1", "Q1", "50000", "", "FAM-A", "exact"),
            ("b2c3d4e5-f6a7-8901-bcde-f12345678901",
             "https://lda.gov/filings/public/filing/b2c3d4e5-f6a7-8901-bcde-f12345678901/print/",
             "CLIENT B", "REG B", "2024", "Q2", "Q2", "", "30000", "FAM-B", "exact"),
            ("c3d4e5f6-a7b8-9012-cdef-012345678902",
             "https://lda.gov/filings/public/filing/c3d4e5f6-a7b8-9012-cdef-012345678902/print/",
             "CLIENT C", "REG C", "2024", "Q3", "Q3", "20000", "15000", "FAM-C", "exact"),
            ("d4e5f6a7-b8c9-0123-defa-123456789012",
             "https://lda.gov/filings/public/filing/d4e5f6a7-b8c9-0123-defa-123456789012/print/",
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

        assert len(row) == 27, f"expected 27-element tuple, got {len(row)}"
        assert row[1] == "lda_filing", f"kind should be lda_filing, got {row[1]}"
        official_url = row[17]  # index 17 = official_url
        # Host-only was the WEAK check that let an API endpoint pass as an
        # "official_url" for months (fixed 2026-08-29): lda.senate.gov now
        # 301s to lda.gov, and both hosts are acceptable — what is not is an
        # /api/ path, which returns JSON a reader cannot read.
        assert official_url and (
            "lda.gov" in official_url or "lda.senate.gov" in official_url
        ) and "/api/" not in official_url, \
            f"official_url should be a readable LDA filing page: {official_url}"
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
        # district should be pop_district alone (e.g. 'CO-05'), NOT double-prefixed 'CO-CO-05'
        assert first["district"] == "CO-05", (
            f"district should be pop_district alone (no state prefix re-prepended): {first['district']!r}"
        )

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


# ---------------------------------------------------------------------------
# fact_id_state_soql / fact_id_state_file tests
# ---------------------------------------------------------------------------


class TestFactIdStateTiers:
    def test_state_soql_stable_16hex(self):
        fid = fact_id_state_soql("CT", "grants_and_subventions", "FY 2025")
        assert len(fid) == 16
        assert fid == fact_id_state_soql("CT", "grants_and_subventions", "FY 2025")

    def test_state_soql_differs_by_category(self):
        a = fact_id_state_soql("CT", "travel", "FY 2025")
        b = fact_id_state_soql("CT", "grants_and_subventions", "FY 2025")
        assert a != b

    def test_state_file_stable_16hex(self):
        fid = fact_id_state_file("CA", "grants_and_subventions", "FY 2025")
        assert len(fid) == 16
        assert fid == fact_id_state_file("CA", "grants_and_subventions", "FY 2025")

    def test_state_soql_and_state_file_differ(self):
        a = fact_id_state_soql("CT", "travel", "FY 2025")
        b = fact_id_state_file("CT", "travel", "FY 2025")
        assert a != b


# ---------------------------------------------------------------------------
# _build_state_citation_rows tests
# ---------------------------------------------------------------------------


def _make_state_per_capita_duckdb(tmp_path: Path) -> Path:
    """Create a minimal DuckDB with fct_state_per_capita for state citation tier tests."""
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE fct_state_per_capita ("
        "  jurisdiction varchar, comparable_category varchar,"
        "  total_amount_usd double, spend_source_url varchar,"
        "  pop_source_url varchar, amount_per_capita double,"
        "  fiscal_year varchar"
        ")"
    )
    con.executemany(
        "INSERT INTO fct_state_per_capita VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("CT", "grants_and_subventions", 5000000.0,
             "https://data.ct.gov/resource/ajdm-rvz7.json?$select=department",
             "https://census.gov/pop/ct", 1400.0, "FY 2025"),
            ("CA", "grants_and_subventions", 80000000.0,
             "https://open.fiscal.ca.gov/dept_spending_transaction.html (pointer: DepartmentSpendingTransactionPointer.csv)",
             "https://census.gov/pop/ca", 2100.0, "FY 2025"),
            ("CT", "travel", 200000.0,
             "https://data.ct.gov/resource/ajdm-rvz7.json?$select=department",
             "https://census.gov/pop/ct", 56.0, "FY 2025"),
        ],
    )
    con.close()
    return db_path


class TestBuildStateCitationRows:
    def test_ct_rows_are_state_soql(self, tmp_path):
        """CT rows emit kind='state_soql'."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        ct_rows = [r for r in rows if r[1] == "state_soql"]
        assert len(ct_rows) == 2, f"expected 2 CT state_soql rows, got {len(ct_rows)}"

    def test_ca_rows_are_state_file(self, tmp_path):
        """CA rows emit kind='state_file'."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        ca_rows = [r for r in rows if r[1] == "state_file"]
        assert len(ca_rows) == 1, f"expected 1 CA state_file row, got {len(ca_rows)}"

    def test_ct_official_url_is_data_ct_gov_soql(self, tmp_path):
        """CT official_url points to data.ct.gov with $select and $where."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        ct_rows = [r for r in rows if r[1] == "state_soql"]
        for row in ct_rows:
            official_url = row[17]  # index 17 = official_url
            assert official_url and "data.ct.gov" in official_url, \
                f"CT official_url should be data.ct.gov URL: {official_url!r}"
            assert "$select" in official_url or "%24select" in official_url, \
                f"CT official_url missing $select: {official_url!r}"

    def test_ca_official_url_is_clean_pointer_url(self, tmp_path):
        """CA official_url is the clean Open Fi$Cal pointer URL (no pointer note suffix)."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        ca_rows = [r for r in rows if r[1] == "state_file"]
        for row in ca_rows:
            official_url = row[17]
            assert official_url and "open.fiscal.ca.gov" in official_url, \
                f"CA official_url should be open.fiscal.ca.gov URL: {official_url!r}"
            # Must NOT contain the pointer note suffix
            assert "(pointer:" not in official_url, \
                f"CA official_url should not contain pointer note: {official_url!r}"

    def test_recorded_value_is_numeric(self, tmp_path):
        """All rows have parseable numeric recorded_value."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        for row in rows:
            rv = row[23]  # recorded_value
            assert rv is not None, f"recorded_value should not be None"
            float(rv)  # should not raise

    def test_retrieved_at_is_present(self, tmp_path):
        """All rows have a non-null retrieved_at."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        for row in rows:
            retrieved_at = row[19]  # retrieved_at
            assert retrieved_at, f"retrieved_at should be set: {retrieved_at!r}"

    def test_fact_ids_are_stable(self, tmp_path):
        """Fact IDs are deterministic and 16-hex."""
        db_path = _make_state_per_capita_duckdb(tmp_path)
        rows = _build_state_citation_rows(duckdb_path=db_path)
        fids = [r[0] for r in rows]
        for fid in fids:
            assert len(fid) == 16, f"fact_id should be 16 chars: {fid!r}"
            assert all(c in "0123456789abcdef" for c in fid), f"not hex: {fid!r}"
        # All fact_ids are distinct
        assert len(set(fids)) == len(fids), f"duplicate fact_ids: {fids}"

    def test_empty_when_no_table(self, tmp_path):
        """Returns empty list when fct_state_per_capita is absent."""
        db_path = tmp_path / "empty.duckdb"
        duckdb.connect(str(db_path)).close()
        rows = _build_state_citation_rows(duckdb_path=db_path)
        assert rows == []


# ---------------------------------------------------------------------------
# State citation gate (citation_gate5b1) integration tests
# ---------------------------------------------------------------------------


class TestStateCitationGates:
    """citation_gate5b1 and integrity_gate5b1 handle state_soql and state_file kinds."""

    def _ct_row(self, fid: str, official_url: str, recorded_value: str) -> tuple:
        return (
            fid, "state_soql", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, official_url, None, "2026-06-12T00:00:00+00:00",
            None, None, None, recorded_value,
        )

    def _ca_row(self, fid: str, official_url: str, recorded_value: str) -> tuple:
        return (
            fid, "state_file", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, official_url, None, "2026-06-12T00:00:00+00:00",
            "CA Open Fi$Cal pointer page", None, None, recorded_value,
        )

    def test_state_soql_happy_path(self, tmp_path):
        """Valid state_soql row passes citation gate."""
        site = tmp_path / "site"
        fid = fact_id_state_soql("CT", "grants_and_subventions", "FY 2025")
        url = (
            "https://data.ct.gov/resource/ajdm-rvz7.json"
            "?%24select=sum%28amount%29+as+total"
            "&%24where=fiscal_year%3D%27FY+2025%27"
        )
        row = self._ct_row(fid, url, "5000000.000")

        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is True, f"failures: {result.get('failures')}"

    def test_state_soql_missing_recorded_value_fails(self, tmp_path):
        """state_soql with null recorded_value → gate FAIL."""
        site = tmp_path / "site"
        fid = fact_id_state_soql("CT", "travel", "FY 2025")
        url = "https://data.ct.gov/resource/ajdm-rvz7.json?%24select=sum%28amount%29+as+total&%24where=fiscal_year%3D%27FY+2025%27"
        row = (
            fid, "state_soql", "USD", None,
            None, None, None, None, None, None, None, None,
            None, None, None,
            None, None, url, None, "2026-06-12T00:00:00+00:00",
            None, None, None, None,  # recorded_value=None
        )
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is False, "null recorded_value should fail"

    def test_state_file_happy_path(self, tmp_path):
        """Valid state_file row passes citation gate."""
        site = tmp_path / "site"
        fid = fact_id_state_file("CA", "grants_and_subventions", "FY 2025")
        url = "https://open.fiscal.ca.gov/dept_spending_transaction.html"
        row = self._ca_row(fid, url, "80000000.000")

        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is True, f"failures: {result.get('failures')}"

    def test_state_file_non_https_fails(self, tmp_path):
        """state_file with http:// official_url → gate FAIL."""
        site = tmp_path / "site"
        fid = fact_id_state_file("CA", "travel", "FY 2025")
        row = self._ca_row(fid, "http://open.fiscal.ca.gov/page.html", "500.000")
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = citation_gate5b1(site)
        assert result["ok"] is False, "non-https official_url should fail"

    def test_integrity_gate_state_soql_passes(self, tmp_path):
        """integrity_gate5b1 state_soql_url_and_value check passes on valid row."""
        site = tmp_path / "site"
        fid = fact_id_state_soql("CT", "consulting_professional", "FY 2025")
        url = "https://data.ct.gov/resource/ajdm-rvz7.json?%24select=sum%28amount%29+as+total&%24where=x"
        row = self._ct_row(fid, url, "999.000")
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = integrity_gate5b1(site)
        assert result["checks"].get("state_soql_url_and_value") is True, \
            f"expected pass: {result}"

    def test_integrity_gate_state_file_passes(self, tmp_path):
        """integrity_gate5b1 state_file_url_and_value check passes on valid row."""
        site = tmp_path / "site"
        fid = fact_id_state_file("CA", "consulting_professional", "FY 2025")
        url = "https://open.fiscal.ca.gov/dept_spending_transaction.html"
        row = self._ca_row(fid, url, "12345.000")
        _write_parquet(site / "citations" / "citations.parquet", _CIT_COL_DEFS, [row])
        _write_manifest(site)

        result = integrity_gate5b1(site)
        assert result["checks"].get("state_file_url_and_value") is True, \
            f"expected pass: {result}"


# ---------------------------------------------------------------------------
# Connecticut build_figure_soql_url tests
# ---------------------------------------------------------------------------


class TestBuildFigureSoqlUrl:
    """Verify the per-figure CT SoQL URL builder (Task 2c §F)."""

    def test_ct_grants_soql_url_shape(self):
        from govbudget.states.connecticut import build_figure_soql_url
        url = build_figure_soql_url("grants_and_subventions", "FY 2025")
        assert "data.ct.gov" in url
        assert "select" in url.lower() or "%24select" in url
        assert "where" in url.lower() or "%24where" in url
        assert "FY 2025" in url or "FY+2025" in url

    def test_ct_travel_soql_url_includes_in_state_travel(self):
        """The travel category URL includes CT raw travel categories in the WHERE clause."""
        from govbudget.states.connecticut import build_figure_soql_url
        url = build_figure_soql_url("travel", "FY 2025")
        # Should contain at least one of the raw CT travel category values
        assert "In-State Travel" in url or "In-State" in url or "Travel" in url, \
            f"Expected travel categories in URL: {url}"

    def test_ct_soql_url_backwards_compat(self):
        """build_soql_url without overrides behaves identically to before."""
        from govbudget.states.connecticut import SOCRATA_BASE, build_soql_url
        url_old = build_soql_url()
        assert url_old.startswith(SOCRATA_BASE)
        assert "$group" in url_old or "%24group" in url_old

    def test_ct_soql_url_with_fiscal_year_compat(self):
        """build_soql_url(fiscal_year=...) still works as before."""
        from govbudget.states.connecticut import build_soql_url
        url = build_soql_url(fiscal_year="FY 2025")
        assert "FY 2025" in url or "FY+2025" in url


# ---------------------------------------------------------------------------
# config.RESEARCH_DIR tests
# ---------------------------------------------------------------------------


class TestResearchDirConfig:
    def test_research_dir_is_defined(self):
        from govbudget.config import RESEARCH_DIR
        assert RESEARCH_DIR is not None

    def test_research_dir_is_absolute(self):
        from govbudget.config import RESEARCH_DIR
        from pathlib import Path
        assert Path(RESEARCH_DIR).is_absolute()

    def test_research_dir_ends_with_data_research(self):
        from govbudget.config import RESEARCH_DIR
        # Should be ROOT/data/research
        assert str(RESEARCH_DIR).endswith("data/research") or \
               str(RESEARCH_DIR).endswith("data\\research"), \
               f"RESEARCH_DIR should end with data/research: {RESEARCH_DIR}"

    def test_recipient_ids_cache_uses_research_dir(self, tmp_path):
        """_build_entity_ueis_sidecar uses RESEARCH_DIR not CWD-relative path."""
        from govbudget import config
        from govbudget.export_site import _build_entity_ueis_sidecar
        import unittest.mock as mock

        # Point RESEARCH_DIR to tmp_path so the cache is writable
        fake_research_dir = tmp_path / "research"
        fake_research_dir.mkdir()

        # Write a test cache
        cache_file = fake_research_dir / "usaspending_recipient_ids.json"
        cache_file.write_text(json.dumps({"PARENT-TEST": "test-profile-id"}))

        db_path = _make_xwalk_duckdb(tmp_path, [
            ("UEI-TEST", "FAM-TEST", "PARENT-TEST", 100.0),
        ])

        with mock.patch.object(config, "RESEARCH_DIR", fake_research_dir):
            result = _build_entity_ueis_sidecar(duckdb_path=db_path)

        assert "FAM-TEST" in result
        assert result["FAM-TEST"]["parent_uei"] == "PARENT-TEST"
        assert result["FAM-TEST"]["profile_id"] == "test-profile-id"


# ---------------------------------------------------------------------------
# Fix 1: Federal fiscal-year boundary (FY2025 = 2024-10-01 → 2025-09-30)
# ---------------------------------------------------------------------------


class TestFiscalYearBoundary:
    """FY boundary: FY{N} spans {N-1}-10-01 to {N}-09-30.

    Before fix: code used f"{fiscal_year}-10-01" / f"{fiscal_year+1}-09-30"
    which gave FY2025 → 2025-10-01 → 2026-09-30 (wrong — that is FY2026).
    After fix:  f"{fiscal_year-1}-10-01" / f"{fiscal_year}-09-30"
    which gives FY2025 → 2024-10-01 → 2025-09-30 (correct).
    """

    def _get_time_period_for(self, db_path, fiscal_year: int) -> dict:
        """Return the time_period dict from a family-year query_body for the given FY.

        Identifies the row by its fact_id (which embeds fiscal_year in the key).
        """
        rows = _build_usaspending_citation_rows(duckdb_path=db_path)
        for row in rows:
            fid = row[0]
            qb_raw = row[22]
            if qb_raw is None:
                continue
            # The family-year fact_id key is "{family_key}|{fiscal_year}"
            # We detect the right row by checking if the key ends with "|{fiscal_year}"
            from govbudget.export_site import fact_id_usaspending
            # Re-derive what fid should be for FAM-A at this fiscal_year
            expected_fid = fact_id_usaspending("family_year", f"FAM-A|{fiscal_year}", "total_obligation")
            if fid == expected_fid:
                qb = json.loads(qb_raw)
                tp_list = qb.get("filters", {}).get("time_period", [])
                if tp_list:
                    return tp_list[0]
        return {}

    def test_fy2025_start_date_is_2024_10_01(self, tmp_path):
        """FY2025 query_body must have start_date='2024-10-01'."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        tp = self._get_time_period_for(db_path, 2025)
        assert tp, "expected a FY2025 time_period entry"
        assert tp["start_date"] == "2024-10-01", (
            f"FY2025 start_date should be 2024-10-01, got {tp['start_date']!r}"
        )

    def test_fy2025_end_date_is_2025_09_30(self, tmp_path):
        """FY2025 query_body must have end_date='2025-09-30'."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        tp = self._get_time_period_for(db_path, 2025)
        assert tp, "expected a FY2025 time_period entry"
        assert tp["end_date"] == "2025-09-30", (
            f"FY2025 end_date should be 2025-09-30, got {tp['end_date']!r}"
        )

    def test_fy2024_start_date_is_2023_10_01(self, tmp_path):
        """FY2024 query_body must have start_date='2023-10-01'."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        tp = self._get_time_period_for(db_path, 2024)
        assert tp, "expected a FY2024 time_period entry"
        assert tp["start_date"] == "2023-10-01", (
            f"FY2024 start_date should be 2023-10-01, got {tp['start_date']!r}"
        )

    def test_fy2024_end_date_is_2024_09_30(self, tmp_path):
        """FY2024 query_body must have end_date='2024-09-30'."""
        db_path = _make_usaspending_mart_duckdb(tmp_path)
        tp = self._get_time_period_for(db_path, 2024)
        assert tp, "expected a FY2024 time_period entry"
        assert tp["end_date"] == "2024-09-30", (
            f"FY2024 end_date should be 2024-09-30, got {tp['end_date']!r}"
        )


# ---------------------------------------------------------------------------
# Fix 2a: fy2526_change inputs = [fy2026_total peer fid, fy2025_total peer fid]
# Fix 2b: trajectory total rows with no budget_lines inputs use alternate formula
# Fix 2b (verify side): sum formula with empty inputs → fail; pivot formula → pass
# ---------------------------------------------------------------------------


def _make_trajectory_duckdb(
    tmp_path: Path,
    *,
    add_budget_lines: bool = True,
) -> Path:
    """Minimal DuckDB for derived citation tests.

    Trajectory row: pe_bli='0601101E', org='DARPA',
      fy2024_actuals=700000.0, fy2025_total=780000.0, fy2026_total=846900.0,
      fy2526_change=66900.0.

    If add_budget_lines=True, populate budget_lines with matching org/pe_bli/type rows.
    """
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))

    con.execute(
        "CREATE TABLE fct_budget_trajectory (pe_bli varchar, organization varchar,"
        " fy2024_actuals double, fy2025_total double, fy2026_total double,"
        " fy2526_change double, fy2526_pct_change double)"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES"
        " ('0601101E', 'DARPA', 700000.0, 780000.0, 846900.0, 66900.0, 8.58)"
    )

    # dim_programs needed for agency sum path
    con.execute(
        "CREATE TABLE dim_programs (pe_bli varchar, org varchar, exhibit_family varchar,"
        " title varchar, project_count integer, fy2024_actual_millions double,"
        " fully_reconciled boolean)"
    )
    con.execute(
        "INSERT INTO dim_programs VALUES ('0601101E', 'DARPA', 'rdte', 'Defense Research', 1, 700.0, true)"
    )

    # fct_program_concentration (stub)
    con.execute(
        "CREATE TABLE fct_program_concentration (pe_bli varchar, hhi double,"
        " top_family varchar, family_count integer, program_dollars double)"
    )

    # fct_improper_exposure (stub)
    con.execute(
        "CREATE TABLE fct_improper_exposure (agency_code varchar,"
        " derived_improper_amount_usd double, weighted_rate_pct double)"
    )

    # fct_state_per_capita (stub)
    con.execute(
        "CREATE TABLE fct_state_per_capita (jurisdiction varchar,"
        " comparable_category varchar, amount_per_capita double,"
        " spend_source_url varchar, pop_source_url varchar,"
        " total_amount_usd double, fiscal_year varchar)"
    )

    # dim_entities (stub)
    con.execute(
        "CREATE TABLE dim_entities (family_key varchar, display_name varchar,"
        " uei_count integer, total_obligation double, worst_confidence varchar)"
    )

    # fct_influence (stub)
    con.execute(
        "CREATE TABLE fct_influence (family_key varchar, filing_year integer,"
        " filings_count integer, lobbying_income_usd double,"
        " lobbying_expense_usd double, lobbying_total_usd double,"
        " family_obligations_usd double)"
    )

    # fct_program_lobbying (stub)
    con.execute(
        "CREATE TABLE fct_program_lobbying (filing_uuid varchar, pe_bli varchar,"
        " matched_term varchar, filing_url varchar)"
    )

    con.close()
    return db_path


def _make_budget_lines_rows(
    *,
    pe_bli: str = "0601101E",
    org: str = "DARPA",
    sha256: str = "a" * 64,
) -> list:
    """Build minimal bl_rows matching the trajectory row."""
    from govbudget.export_site import fact_id_workbook
    rows = []
    for fy_year, amt_type, amount in [
        (2024, "fy_2024_actuals", 700000.0),
        (2025, "fy_2025_total", 780000.0),
        (2026, "fy_2026_total", 846900.0),
    ]:
        fid = fact_id_workbook(sha256, "R-1", fy_year, "0400", org, "01", pe_bli, amt_type)
        rows.append((
            fid, "R-1", fy_year, "0400", "RDT&E", org, "01", "Basic Research",
            pe_bli, "Defense Research", amt_type, float(amount),
            "USD thousands", sha256, "Sheet1", "J2",
        ))
    return rows


class TestFy2526ChangeInputs:
    """fy2526_change inputs must be the TWO peer derived fact_ids, not budget_lines."""

    def test_fy2526_change_inputs_are_two_derived_fids(self, tmp_path):
        """fy2526_change inputs == [fy2026_total_fid, fy2025_total_fid]."""
        from govbudget.export_site import (
            _build_derived_citation_rows,
            fact_id_derived,
        )
        db_path = _make_trajectory_duckdb(tmp_path)
        bl_rows = _make_budget_lines_rows()

        derived = _build_derived_citation_rows(
            duckdb_path=db_path,
            bl_rows=bl_rows,
            citation_rows=[],
        )

        pe_bli = "0601101E"
        org = "DARPA"
        key = f"{pe_bli}|{org}"

        change_fid = fact_id_derived("trajectory", key, "fy2526_change")
        chg_row = next((r for r in derived if r[0] == change_fid), None)
        assert chg_row is not None, f"fy2526_change row not found in derived rows"

        inputs_raw = chg_row[21]  # index 21 = inputs
        inputs = json.loads(inputs_raw)
        assert len(inputs) == 2, (
            f"fy2526_change must have exactly 2 inputs (peer derived fids), got {len(inputs)}: {inputs}"
        )

        fy26_fid = fact_id_derived("trajectory", key, "fy2026_total")
        fy25_fid = fact_id_derived("trajectory", key, "fy2025_total")
        assert fy26_fid in inputs, f"fy2026_total fid {fy26_fid!r} not in inputs {inputs}"
        assert fy25_fid in inputs, f"fy2025_total fid {fy25_fid!r} not in inputs {inputs}"

    def test_fy2526_change_only_emitted_when_both_peers_exist(self, tmp_path):
        """fy2526_change row absent when fy2025 or fy2026 peer is missing."""
        from govbudget.export_site import (
            _build_derived_citation_rows,
            fact_id_derived,
        )

        db_path = tmp_path / "govbudget_partial.duckdb"
        con = duckdb.connect(str(db_path))
        con.execute(
            "CREATE TABLE fct_budget_trajectory (pe_bli varchar, organization varchar,"
            " fy2024_actuals double, fy2025_total double, fy2026_total double,"
            " fy2526_change double, fy2526_pct_change double)"
        )
        # fy2526_change is set but fy2025_total is NULL → both peers don't exist
        con.execute(
            "INSERT INTO fct_budget_trajectory VALUES"
            " ('0601101E', 'DARPA', 700000.0, NULL, 846900.0, NULL, NULL)"
        )
        for tbl in [
            "dim_programs", "fct_program_concentration", "fct_improper_exposure",
            "fct_state_per_capita", "dim_entities", "fct_influence", "fct_program_lobbying",
        ]:
            # create stubs
            pass
        _stubs = _make_trajectory_duckdb.__wrapped__ if hasattr(_make_trajectory_duckdb, "__wrapped__") else None
        # Add stub tables manually
        con.execute(
            "CREATE TABLE dim_programs (pe_bli varchar, org varchar, exhibit_family varchar,"
            " title varchar, project_count integer, fy2024_actual_millions double,"
            " fully_reconciled boolean)"
        )
        for tbl, cols in [
            ("fct_program_concentration", "pe_bli varchar, hhi double, top_family varchar, family_count integer, program_dollars double"),
            ("fct_improper_exposure", "agency_code varchar, derived_improper_amount_usd double, weighted_rate_pct double"),
            ("fct_state_per_capita", "jurisdiction varchar, comparable_category varchar, amount_per_capita double, spend_source_url varchar, pop_source_url varchar, total_amount_usd double, fiscal_year varchar"),
            ("dim_entities", "family_key varchar, display_name varchar, uei_count integer, total_obligation double, worst_confidence varchar"),
            ("fct_influence", "family_key varchar, filing_year integer, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double"),
            ("fct_program_lobbying", "filing_uuid varchar, pe_bli varchar, matched_term varchar, filing_url varchar"),
        ]:
            con.execute(f"CREATE TABLE {tbl} ({cols})")
        con.close()

        derived = _build_derived_citation_rows(
            duckdb_path=db_path,
            bl_rows=[],
            citation_rows=[],
        )
        key = "0601101E|DARPA"
        change_fid = fact_id_derived("trajectory", key, "fy2526_change")
        chg_row = next((r for r in derived if r[0] == change_fid), None)
        assert chg_row is None, (
            "fy2526_change row should NOT be emitted when fy2525_total is NULL (peer missing)"
        )

    def test_verify_derived_difference_recomputes_via_peer_fids(self, tmp_path):
        """_verify_derived rule 4b recomputes fy26 - fy25 from the peer recorded_values."""
        from govbudget.verify_phase5b1 import _verify_derived

        # Build a minimal citation set with three rows:
        #   fy2025_total: recorded_value='780000.000'
        #   fy2026_total: recorded_value='846900.000'
        #   fy2526_change: inputs=[fy2026_fid, fy2025_fid], recorded_value='66900.000'
        from govbudget.export_site import fact_id_derived

        key = "0601101E|DARPA"
        fy25_fid = fact_id_derived("trajectory", key, "fy2025_total")
        fy26_fid = fact_id_derived("trajectory", key, "fy2026_total")
        chg_fid  = fact_id_derived("trajectory", key, "fy2526_change")

        def _row(fid, formula, inputs_json, recorded_value):
            return (
                fid, "derived", "USD thousands", None,
                None, None, None, None, None, None, None, None,
                None, None, None, None, None, None, None, None,
                formula, inputs_json, None, recorded_value,
            )

        fy25_row = _row(fy25_fid,
                        "sum(budget_lines.amount_thousands where amount_type in (fy_2025_total, fy_2025_enacted))",
                        "[]", "780000.000")
        fy26_row = _row(fy26_fid,
                        "sum(budget_lines.amount_thousands where amount_type in (fy_2026_total, fy_2026_request))",
                        "[]", "846900.000")
        chg_row  = _row(chg_fid,
                        "fy2026_total - fy2025_total",
                        json.dumps([fy26_fid, fy25_fid]),
                        "66900.000")

        all_cits = [fy25_row, fy26_row, chg_row]
        col_names = [
            "fact_id", "kind", "units", "amount_text",
            "page_number", "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
            "resolution", "sheet", "cells", "amount_thousands", "sha256",
            "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
            "formula", "inputs", "query_body", "recorded_value",
        ]
        idx = {name: i for i, name in enumerate(col_names)}

        reason = _verify_derived(chg_row, idx, all_cits, idx)
        assert reason is None, f"_verify_derived should pass for correct difference: {reason}"

    def test_verify_derived_difference_recompute_mismatch_fails(self, tmp_path):
        """_verify_derived rule 4b fails when recorded_value != fy26 - fy25."""
        from govbudget.verify_phase5b1 import _verify_derived
        from govbudget.export_site import fact_id_derived

        key = "0601101E|DARPA"
        fy25_fid = fact_id_derived("trajectory", key, "fy2025_total")
        fy26_fid = fact_id_derived("trajectory", key, "fy2026_total")
        chg_fid  = fact_id_derived("trajectory", key, "fy2526_change")

        def _row(fid, formula, inputs_json, recorded_value):
            return (
                fid, "derived", "USD thousands", None,
                None, None, None, None, None, None, None, None,
                None, None, None, None, None, None, None, None,
                formula, inputs_json, None, recorded_value,
            )

        fy25_row = _row(fy25_fid,
                        "sum(budget_lines.amount_thousands where amount_type in (fy_2025_total, fy_2025_enacted))",
                        "[]", "780000.000")
        fy26_row = _row(fy26_fid,
                        "sum(budget_lines.amount_thousands where amount_type in (fy_2026_total, fy_2026_request))",
                        "[]", "846900.000")
        # Wrong recorded_value: should be 66900.000, write 99999.000
        chg_row  = _row(chg_fid,
                        "fy2026_total - fy2025_total",
                        json.dumps([fy26_fid, fy25_fid]),
                        "99999.000")  # deliberate mismatch

        all_cits = [fy25_row, fy26_row, chg_row]
        col_names = [
            "fact_id", "kind", "units", "amount_text",
            "page_number", "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
            "resolution", "sheet", "cells", "amount_thousands", "sha256",
            "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
            "formula", "inputs", "query_body", "recorded_value",
        ]
        idx = {name: i for i, name in enumerate(col_names)}

        reason = _verify_derived(chg_row, idx, all_cits, idx)
        assert reason is not None, "_verify_derived should FAIL for wrong difference value"
        assert "mismatch" in reason.lower() or "recompute" in reason.lower(), (
            f"expected 'mismatch' or 'recompute' in reason: {reason!r}"
        )


class TestTrajectoryTotalPivotFormula:
    """Trajectory total rows with no matching budget_lines use the pivot formula string."""

    def test_total_rows_with_no_bl_inputs_use_pivot_formula(self, tmp_path):
        """When no bl_rows exist for an org, trajectory totals use 'trajectory pivot' formula."""
        from govbudget.export_site import (
            _build_derived_citation_rows,
            fact_id_derived,
        )
        db_path = _make_trajectory_duckdb(tmp_path)
        # Pass empty bl_rows → no inputs can be found
        derived = _build_derived_citation_rows(
            duckdb_path=db_path,
            bl_rows=[],
            citation_rows=[],
        )

        key = "0601101E|DARPA"
        for metric in ("fy2025_total", "fy2026_total"):
            fid = fact_id_derived("trajectory", key, metric)
            row = next((r for r in derived if r[0] == fid), None)
            assert row is not None, f"row for {metric} not found"
            formula = row[20]  # index 20 = formula
            inputs_raw = row[21]  # index 21 = inputs
            inputs = json.loads(inputs_raw)
            assert inputs == [], f"inputs should be empty list when no bl_rows: {inputs}"
            # Formula must use the pivot formula (not the sum formula)
            assert "pivot" in formula.lower() or "unavailable" in formula.lower(), (
                f"Formula should indicate pivot/unavailable when no budget_lines inputs, got: {formula!r}"
            )

    def test_total_rows_with_bl_inputs_use_sum_formula(self, tmp_path):
        """When bl_rows exist for org, trajectory totals use sum formula."""
        from govbudget.export_site import (
            _build_derived_citation_rows,
            fact_id_derived,
        )
        db_path = _make_trajectory_duckdb(tmp_path)
        bl_rows = _make_budget_lines_rows()
        derived = _build_derived_citation_rows(
            duckdb_path=db_path,
            bl_rows=bl_rows,
            citation_rows=[],
        )

        key = "0601101E|DARPA"
        for metric in ("fy2025_total", "fy2026_total"):
            fid = fact_id_derived("trajectory", key, metric)
            row = next((r for r in derived if r[0] == fid), None)
            assert row is not None, f"row for {metric} not found"
            formula = row[20]
            assert formula.startswith("sum(budget_lines"), (
                f"Formula should start with 'sum(budget_lines' when inputs exist, got: {formula!r}"
            )

    def test_verify_derived_sum_empty_inputs_fails(self):
        """_verify_derived: sum formula with inputs==[] fails with 'empty inputs' message."""
        from govbudget.verify_phase5b1 import _verify_derived
        from govbudget.export_site import fact_id_derived

        fid = fact_id_derived("trajectory", "0601101E|DARPA", "fy2025_total")
        row = (
            fid, "derived", "USD thousands", None,
            None, None, None, None, None, None, None, None,
            None, None, None, None, None, None, None, None,
            "sum(budget_lines.amount_thousands where amount_type in (fy_2025_total, fy_2025_enacted))",
            "[]",  # empty inputs — problematic sum formula
            None, "780000.000",
        )
        col_names = [
            "fact_id", "kind", "units", "amount_text",
            "page_number", "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
            "resolution", "sheet", "cells", "amount_thousands", "sha256",
            "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
            "formula", "inputs", "query_body", "recorded_value",
        ]
        idx = {name: i for i, name in enumerate(col_names)}

        reason = _verify_derived(row, idx, [row], idx)
        assert reason is not None, (
            "_verify_derived should FAIL for sum formula with empty inputs"
        )
        assert "empty" in reason.lower() or "input" in reason.lower(), (
            f"expected 'empty' or 'input' in reason: {reason!r}"
        )

    def test_verify_derived_pivot_formula_passes_shape_check(self):
        """_verify_derived: pivot formula with inputs==[] passes (honest shape row)."""
        from govbudget.verify_phase5b1 import _verify_derived
        from govbudget.export_site import fact_id_derived

        fid = fact_id_derived("trajectory", "0601101E|DARPA", "fy2025_total")
        row = (
            fid, "derived", "USD thousands", None,
            None, None, None, None, None, None, None, None,
            None, None, None, None, None, None, None, None,
            "trajectory pivot of budget_lines (inputs unavailable for this org/type)",
            "[]",  # empty inputs — OK for pivot formula
            None, "780000.000",
        )
        col_names = [
            "fact_id", "kind", "units", "amount_text",
            "page_number", "x0", "x1", "top_pt", "bottom_pt", "page_width", "page_height",
            "resolution", "sheet", "cells", "amount_thousands", "sha256",
            "hosted_pdf_url", "official_url", "xml_path", "retrieved_at",
            "formula", "inputs", "query_body", "recorded_value",
        ]
        idx = {name: i for i, name in enumerate(col_names)}

        reason = _verify_derived(row, idx, [row], idx)
        assert reason is None, (
            f"_verify_derived should PASS for pivot formula with empty inputs: {reason}"
        )


# ---------------------------------------------------------------------------
# Fix 4: Agency formula n_cited counts programs (not budget-lines)
# ---------------------------------------------------------------------------


def _make_agency_duckdb(tmp_path: Path) -> tuple[Path, list]:
    """DuckDB + bl_rows for agency-sum citation tests."""
    db_path = _make_trajectory_duckdb(tmp_path)
    # Add a second program under the same org with NO matching budget_lines
    con = duckdb.connect(str(db_path))
    con.execute(
        "INSERT INTO dim_programs VALUES "
        "('0601102E', 'DARPA', 'rdte', 'Program Two', 1, 300.0, false)"
    )
    con.close()

    # bl_rows only for '0601101E', not '0601102E'
    bl_rows = _make_budget_lines_rows(pe_bli="0601101E")
    return db_path, bl_rows


class TestAgencyFormulaCounts:
    """n_cited must count programs-with-≥1-cited-line, not raw budget-line count."""

    def test_n_cited_counts_programs_not_lines(self, tmp_path):
        """n_cited reflects programs with ≥1 cited budget_line, not total lines."""
        from govbudget.export_site import (
            _build_derived_citation_rows,
            fact_id_derived,
        )
        db_path, bl_rows = _make_agency_duckdb(tmp_path)
        derived = _build_derived_citation_rows(
            duckdb_path=db_path,
            bl_rows=bl_rows,
            citation_rows=[],
        )

        agency_fid = fact_id_derived("agency", "DARPA", "fy2024_total_millions")
        agency_row = next((r for r in derived if r[0] == agency_fid), None)
        assert agency_row is not None, "agency sum row for DARPA not found"

        formula = agency_row[20]  # formula field
        # n_cited must be 1 (only '0601101E' has budget_lines), n_programs=2, n_uncited=1
        # Formula: "... (1 programs cited via workbook; 1 uncited)"
        assert "1 programs cited" in formula, (
            f"n_cited should be '1 programs' (not {len(bl_rows)} lines), formula: {formula!r}"
        )
        assert "1 uncited" in formula, (
            f"n_uncited should be '1' (program 0601102E has no lines), formula: {formula!r}"
        )

    def test_n_cited_never_negative(self, tmp_path):
        """n_uncited = n_programs - n_cited is never negative."""
        from govbudget.export_site import (
            _build_derived_citation_rows,
            fact_id_derived,
        )
        db_path, bl_rows = _make_agency_duckdb(tmp_path)
        derived = _build_derived_citation_rows(
            duckdb_path=db_path,
            bl_rows=bl_rows,
            citation_rows=[],
        )

        # Extract all agency-derived rows and check formula for "uncited"
        import re
        for row in derived:
            if row[1] != "derived":
                continue
            formula = row[20] or ""
            match = re.search(r"(\d+) uncited", formula)
            if match:
                uncited_val = int(match.group(1))
                assert uncited_val >= 0, (
                    f"n_uncited is negative ({uncited_val}) in formula: {formula!r}"
                )
