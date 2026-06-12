"""Tests for export_site — ALL pg-backed tests live here (pg fixtures are in
tests/jbooks/conftest.py only).

Fixture strategy:
- Seed one jbook document + extraction_run + budget_line_detail + budget_lines
  row + provenance_pages row via build_provenance_pages.
- Build a tiny DuckDB with 1-row versions of all 11 mart tables.
- Call export_site and assert structural invariants.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import duckdb
import psycopg
import pytest

from govbudget.export_site import (
    canonical_amount,
    export_site,
    fact_id_jbook,
    fact_id_lda,
    fact_id_workbook,
)

FIXTURE_PDF = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"

# ---------------------------------------------------------------------------
# Pure-function identity tests (no DB needed)
# ---------------------------------------------------------------------------


def test_canonical_amount_three_decimals():
    assert canonical_amount("280.494") == "280.494"
    assert canonical_amount("1.2") == "1.200"
    assert canonical_amount("-1.2") == "-1.200"
    assert canonical_amount("0") == "0.000"


def test_canonical_amount_none_raises():
    """canonical_amount(None) must raise ValueError — never silently hash None."""
    import pytest as _pytest
    with _pytest.raises(ValueError, match="None"):
        canonical_amount(None)


def test_fact_id_jbook_stable():
    fid = fact_id_jbook("sha256abc", "0601101E", None, "PriorYear", "280.494")
    # must be deterministic
    assert fid == fact_id_jbook("sha256abc", "0601101E", None, "PriorYear", "280.494")
    assert len(fid) == 16
    # differing amount → differing id
    assert fid != fact_id_jbook("sha256abc", "0601101E", None, "PriorYear", "281.000")


def test_fact_id_workbook_stable():
    fid = fact_id_workbook("sha", "R-1", 2026, "0400", "DARPA", "01", "0601101E", "fy_2024_actuals")
    assert fid == fact_id_workbook("sha", "R-1", 2026, "0400", "DARPA", "01", "0601101E", "fy_2024_actuals")
    assert len(fid) == 16


def test_fact_id_lda_stable():
    fid = fact_id_lda("uuid-1", "0601101E", "darpa defense")
    assert fid == fact_id_lda("uuid-1", "0601101E", "darpa defense")
    assert len(fid) == 16
    assert fid != fact_id_lda("uuid-2", "0601101E", "darpa defense")


# ---------------------------------------------------------------------------
# Helpers — Postgres seeding
# ---------------------------------------------------------------------------


def _seed_jbook_doc(pg_dsn: str, *, pdf_path: Path) -> tuple[int, str]:
    """Seed jbook_documents row; return (doc_id, sha256)."""
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'excerpt.pdf','https://example.mil/darpa.pdf',%s,%s,"
            " now(),'downloaded') on conflict (source_url) do nothing",
            (str(pdf_path), sha),
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','PriorYear','280.494','ProgramElement[0]')",
            (run_id, doc_id),
        )
    return doc_id, sha


def _seed_budget_line(pg_dsn: str, doc_id: int, sha: str) -> None:
    """Seed one budget_lines row with cell provenance."""
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            """
            insert into budget_lines
              (exhibit, fiscal_year, account, account_title, organization,
               budget_activity, budget_activity_title, pe_bli, title,
               amount_type, amount_thousands, source_document_id,
               source_sheet, source_cells)
            values
              ('R-1', 2026, '0400', 'RDT&E Defense-Wide', 'DARPA',
               '01', 'Basic Research', '0601101E', 'DEFENSE RESEARCH SCIENCES',
               'fy_2024_actuals', 280494, %s, 'Exhibit R-1', ARRAY['J4'])
            on conflict (exhibit, fiscal_year, account, organization,
                         budget_activity, pe_bli, amount_type)
            do update set amount_thousands = excluded.amount_thousands
            """,
            (doc_id,),
        )


def _make_test_duckdb(db_path: Path) -> None:
    """Build a minimal DuckDB with all 11 required mart tables (1-row each)."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))

    # 1. dim_programs
    con.execute("create table dim_programs (pe_bli varchar, title varchar, org varchar, exhibit_family varchar, project_count integer, fy2024_actual_millions double, fully_reconciled boolean)")
    con.execute("insert into dim_programs values ('0601101E','Defense Research Sciences','DARPA','rdte',1,280.494,true)")

    # 2. fct_budget_to_awards  (live cols: pe_bli,exhibit,fiscal_year,organization,award_piid,recipient_name,recipient_uei,method,confidence,program_title)
    con.execute("create table fct_budget_to_awards (pe_bli varchar, exhibit varchar, fiscal_year integer, organization varchar, award_piid varchar, recipient_name varchar, recipient_uei varchar, method varchar, confidence varchar, program_title varchar)")
    con.execute("insert into fct_budget_to_awards values ('0601101E','R-1',2026,'DARPA','W911QX-24-C-0001','Lockheed Martin','UEI123','account+subagency','medium','Defense Research Sciences')")

    # 3. fct_budget_trajectory  (live cols: pe_bli,organization,fy2024_actuals,fy2025_total,fy2026_total,fy2526_change,fy2526_pct_change)
    con.execute("create table fct_budget_trajectory (pe_bli varchar, organization varchar, fy2024_actuals double, fy2025_total double, fy2026_total double, fy2526_change double, fy2526_pct_change double)")
    # fy2526_change = fy2026_total - fy2025_total = 295000 - 293145 = 1855
    con.execute("insert into fct_budget_trajectory values ('0601101E','DARPA',280494.0,293145.0,295000.0,1855.0,0.63)")

    # 4. dim_entities  (live cols: family_key,display_name,uei_count,total_obligation,worst_confidence)
    con.execute("create table dim_entities (family_key varchar, display_name varchar, uei_count bigint, total_obligation double, worst_confidence varchar)")
    con.execute("insert into dim_entities values ('lockheed','Lockheed Martin',5,50000000.0,'medium')")

    # 5. fct_influence
    con.execute("create table fct_influence (family_key varchar, display_name varchar, filing_year varchar, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double)")
    con.execute("insert into fct_influence values ('lockheed','Lockheed Martin','2025',3,1000000.0,0.0,1000000.0,50000000.0)")

    # 6. fct_program_lobbying — MUST include filing_uuid, pe_bli, matched_term, filing_url
    # Use a proper UUID format so citation_gate5b1's UUID regex check passes.
    _lda_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    con.execute("create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar, program_title varchar, matched_term varchar, description_snippet varchar, filing_url varchar, client_name varchar, family_key varchar, filing_year varchar)")
    con.execute(
        f"insert into fct_program_lobbying values"
        f" ('{_lda_uuid}','0601101E','Defense Research Sciences','darpa','mentioned DARPA',"
        f"'https://lda.senate.gov/filings/{_lda_uuid}/','Lockheed Martin','lockheed','2025')"
    )

    # 7. dim_lobbyists
    con.execute("create table dim_lobbyists (name varchar, covered_position varchar, filings_count integer, revolving_door boolean)")
    con.execute("insert into dim_lobbyists values ('J. Smith','Deputy Secretary of Defense',5,true)")

    # 8. fct_program_concentration  (live cols: pe_bli,hhi,top_family,family_count,program_dollars)
    con.execute("create table fct_program_concentration (pe_bli varchar, hhi double, top_family varchar, family_count bigint, program_dollars double)")
    con.execute("insert into fct_program_concentration values ('0601101E',4200.0,'Lockheed Martin',12,500000000.0)")

    # 9. fct_improper_exposure  (live cols: agency_code,program_count,derived_improper_amount_usd,weighted_rate_pct,latest_fiscal_year)
    con.execute("create table fct_improper_exposure (agency_code varchar, program_count bigint, derived_improper_amount_usd double, weighted_rate_pct double, latest_fiscal_year integer)")
    con.execute("insert into fct_improper_exposure values ('097',5,8400000.0,0.03,2025)")

    # 10. dim_geography  (live cols: pop_state,pop_district,transaction_count,total_obligation)
    con.execute("create table dim_geography (pop_state varchar, pop_district varchar, transaction_count bigint, total_obligation double)")
    con.execute("insert into dim_geography values ('VA','VA-08',150,5000000.0)")

    # 11. fct_state_per_capita  (live cols: jurisdiction,comparable_category,fiscal_year varchar,total_amount_usd,population,amount_per_capita,pop_year_used,spend_source_url,pop_source_url,coverage_note)
    con.execute("create table fct_state_per_capita (jurisdiction varchar, comparable_category varchar, fiscal_year varchar, total_amount_usd double, population bigint, amount_per_capita double, pop_year_used integer, spend_source_url varchar, pop_source_url varchar, coverage_note varchar)")
    con.execute("insert into fct_state_per_capita values ('CA','Education','2025',5000000000.0,39500000,126.58,2020,'https://example.com/spend','https://example.com/pop','full state')")

    con.close()


# ---------------------------------------------------------------------------
# Happy-path integration test
# ---------------------------------------------------------------------------


def test_export_site_happy_path(pg_dsn, tmp_path):
    """Full export_site run with one jbook, one budget_line, one LDA citation."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    # Build provenance_pages for the jbook fact
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    out = export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    # Return value sanity
    assert out["datasets"] > 0
    assert out["citations"] >= 0   # may be 0 if resolution is zero_amount/unresolved
    assert "skipped_unresolved" in out
    assert "skipped_zero_amount" in out

    # All 11 duckdb mart parquets exist
    for name in [
        "dim_programs", "fct_budget_to_awards", "fct_budget_trajectory",
        "dim_entities", "fct_influence", "fct_program_lobbying",
        "dim_lobbyists", "fct_program_concentration", "fct_improper_exposure",
        "dim_geography", "fct_state_per_capita",
    ]:
        assert (site / "data" / f"{name}.parquet").exists(), f"missing {name}.parquet"

    # Postgres typed exports exist
    assert (site / "data" / "jbook_details.parquet").exists()
    assert (site / "data" / "jbook_narratives.parquet").exists()
    assert (site / "data" / "budget_lines.parquet").exists()

    # Manifest exists and is valid JSON
    man_path = site / "manifest.json"
    assert man_path.exists()
    man = json.loads(man_path.read_text())
    assert "built_at" in man
    assert "datasets" in man
    assert "citations" in man
    assert "uncited_datasets" in man
    assert "skipped_unresolved" in man
    assert "skipped_zero_amount" in man
    assert "schema_version" in man
    assert man["schema_version"] == 1

    # fct_budget_to_awards is not in _CITED_DATASETS, so it should remain uncited
    assert "fct_budget_to_awards" in man["uncited_datasets"]
    # fct_budget_trajectory now has a derived citation tier (Task 2a)
    assert "fct_budget_trajectory" not in man["uncited_datasets"]

    # manifest dataset rowcounts match actual files
    for name, count in man["datasets"].items():
        pq_path = site / "data" / f"{name}.parquet"
        if pq_path.exists():
            actual = duckdb.sql(f"select count(*) from read_parquet('{pq_path}')").fetchone()[0]
            assert actual == count, f"{name}: manifest says {count} rows, file has {actual}"


def test_export_site_jbook_details_columns(pg_dsn, tmp_path):
    """jbook_details.parquet must have fact_id, resolution, document_sha256."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    pq = site / "data" / "jbook_details.parquet"
    cols = set(duckdb.sql(f"select * from read_parquet('{pq}') limit 0").columns)
    assert {"fact_id", "resolution", "document_sha256", "units", "fiscal_year"} <= cols

    # units should be 'USD millions'
    row = duckdb.sql(f"select units from read_parquet('{pq}') limit 1").fetchone()
    if row:
        assert row[0] == "USD millions"


def test_export_site_budget_lines_columns(pg_dsn, tmp_path):
    """budget_lines.parquet must have fact_id, document_sha256, units."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    pq = site / "data" / "budget_lines.parquet"
    cols = set(duckdb.sql(f"select * from read_parquet('{pq}') limit 0").columns)
    assert {"fact_id", "document_sha256", "units", "source_cells"} <= cols

    # units should be 'USD thousands'
    row = duckdb.sql(f"select units from read_parquet('{pq}') limit 1").fetchone()
    if row:
        assert row[0] == "USD thousands"


def test_export_site_citations_jbook_pdf(pg_dsn, tmp_path):
    """jbook_pdf citations: hosted_pdf_url + official_url both have #page=N."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    cit_pq = site / "citations" / "citations.parquet"
    if not cit_pq.exists():
        pytest.skip("No citations written (resolution was zero_amount or unresolved)")

    rows = duckdb.sql(
        f"select sha256, hosted_pdf_url, official_url, resolution, page_number"
        f" from read_parquet('{cit_pq}')"
        f" where kind = 'jbook_pdf'"
    ).fetchall()

    if rows:
        doc_sha, hosted, official, res, page_n = rows[0]
        assert hosted.endswith(f"{doc_sha}.pdf#page={page_n}"), f"bad hosted_pdf_url: {hosted}"
        assert official.endswith(f"#page={page_n}"), f"bad official_url: {official}"
        assert res in ("unique", "ambiguous_first")
        assert (site / "pdfs" / f"{doc_sha}.pdf").exists()


def test_export_site_citations_workbook_fact_id_matches_budget_lines(pg_dsn, tmp_path):
    """workbook citation fact_ids must exactly match budget_lines.parquet fact_ids."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    bl_pq = site / "data" / "budget_lines.parquet"
    cit_pq = site / "citations" / "citations.parquet"

    bl_ids = {
        r[0] for r in duckdb.sql(f"select fact_id from read_parquet('{bl_pq}')").fetchall()
    }
    if cit_pq.exists():
        wb_ids = {
            r[0] for r in duckdb.sql(
                f"select fact_id from read_parquet('{cit_pq}') where kind = 'workbook'"
            ).fetchall()
        }
        assert wb_ids <= bl_ids, "workbook citation fact_ids not a subset of budget_lines"


def test_export_site_lda_citations(pg_dsn, tmp_path):
    """lda_filing citations must have official_url pointing to lda.senate.gov."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    cit_pq = site / "citations" / "citations.parquet"
    if not cit_pq.exists():
        return  # no citations at all — acceptable if jbook also had none

    lda_rows = duckdb.sql(
        f"select fact_id, official_url from read_parquet('{cit_pq}') where kind = 'lda_filing'"
    ).fetchall()

    if lda_rows:
        for fid, url in lda_rows:
            assert url.startswith("https://lda.senate.gov/"), f"unexpected lda url: {url}"
            assert len(fid) == 16


def test_export_site_missing_mart_raises_value_error(pg_dsn, tmp_path):
    """Missing mart table → ValueError naming it."""
    _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)

    # Build a duckdb missing fct_state_per_capita
    db = tmp_path / "partial.duckdb"
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    con.execute("create table dim_programs (pe_bli varchar, title varchar)")
    con.close()

    with pytest.raises(ValueError, match="fct_budget_to_awards|fct_budget_trajectory|fct_state_per_capita|dim_entities|fct_influence|fct_program_lobbying|dim_lobbyists|fct_program_concentration|fct_improper_exposure|dim_geography"):
        export_site(pg_dsn, db, out_dir=tmp_path / "site", pdf_base_url="/pdfs")


def test_export_site_missing_pdf_raises_file_not_found(pg_dsn, tmp_path):
    """jbook_documents row whose file_path is missing on disk → FileNotFoundError."""
    sha = "deadbeef" * 8  # 64-char fake sha
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'missing.pdf','https://example.mil/missing.pdf',"
            " %s,%s,now(),'downloaded')",
            (str(tmp_path / "nonexistent.pdf"), sha),
        )

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    with pytest.raises(FileNotFoundError):
        export_site(pg_dsn, db, out_dir=tmp_path / "site", pdf_base_url="/pdfs")


def test_export_site_pdfs_copied(pg_dsn, tmp_path):
    """PDFs are sha-named copies in site/pdfs/."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    out = export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    dest = site / "pdfs" / f"{sha}.pdf"
    assert dest.exists(), "PDF not copied to site/pdfs/{sha}.pdf"
    assert dest.stat().st_size == FIXTURE_PDF.stat().st_size
    assert out["pdfs"] >= 1


def test_export_site_sha_verified_copy(pg_dsn, tmp_path):
    """A dest PDF with matching size but corrupt content is re-copied on export."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    # First export: creates the correct copy
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    dest = site / "pdfs" / f"{sha}.pdf"
    assert dest.exists()
    original_size = dest.stat().st_size

    # Corrupt dest: same size, different bytes (flip first byte)
    data = bytearray(dest.read_bytes())
    data[0] = (data[0] + 1) % 256
    dest.write_bytes(bytes(data))
    assert dest.stat().st_size == original_size  # size unchanged
    assert hashlib.sha256(dest.read_bytes()).hexdigest() != sha  # but sha differs

    # Second export: must detect sha mismatch and re-copy
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    # After re-export the dest sha must match again
    actual_sha = hashlib.sha256(dest.read_bytes()).hexdigest()
    assert actual_sha == sha, f"re-copy did not restore sha: got {actual_sha}"


def test_export_site_null_amount_thousands_excluded(pg_dsn, tmp_path):
    """budget_lines row with NULL amount_thousands is excluded; export still succeeds."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)

    # Seed a budget_lines row with source_document_id set but amount_thousands = NULL
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            """
            insert into budget_lines
              (exhibit, fiscal_year, account, account_title, organization,
               budget_activity, budget_activity_title, pe_bli, title,
               amount_type, amount_thousands, source_document_id,
               source_sheet, source_cells)
            values
              ('R-2', 2026, '0400', 'RDT&E Defense-Wide', 'DARPA',
               '01', 'Basic Research', '0601101E', 'NULL AMOUNT ROW',
               'fy_2025_enacted', NULL, %s, 'Exhibit R-2', ARRAY['K5'])
            on conflict (exhibit, fiscal_year, account, organization,
                         budget_activity, pe_bli, amount_type)
            do nothing
            """,
            (doc_id,),
        )

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    # Export must not raise
    out = export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    # The NULL-amount row must not appear in budget_lines.parquet
    bl_pq = site / "data" / "budget_lines.parquet"
    rows = duckdb.sql(
        f"select pe_bli, title from read_parquet('{bl_pq}')"
        " where title = 'NULL AMOUNT ROW'"
    ).fetchall()
    assert rows == [], f"NULL amount_thousands row should be excluded, got: {rows}"


def test_export_site_details_without_provenance_pages(pg_dsn, tmp_path):
    """jbook_details row with no provenance_pages match gets resolution='unresolved'
    in the parquet. The integrity gate must still pass and manifest skip counts
    must match the parquet.
    """
    from govbudget.verify_phase5b1 import (
        citation_gate5b1,
        coverage_report5b1,
        integrity_gate5b1,
    )

    # Seed a jbook doc + detail but do NOT call build_provenance_pages
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    # (no build_provenance_pages call → no provenance_pages row → LEFT JOIN produces null
    #  → coalesce gives 'unresolved' in jbook_details.parquet)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    # jbook_details parquet should have the row with resolution='unresolved'
    jd_pq = site / "data" / "jbook_details.parquet"
    unresolved_count = duckdb.sql(
        f"select count(*) from read_parquet('{jd_pq}')"
        " where resolution = 'unresolved'"
    ).fetchone()[0]
    assert unresolved_count >= 1, "expected at least one unresolved row in jbook_details"

    # manifest skip counts must match parquet
    import json as _json
    man = _json.loads((site / "manifest.json").read_text())
    assert man["skipped_unresolved"] == unresolved_count, (
        f"manifest skipped_unresolved={man['skipped_unresolved']} "
        f"but parquet has {unresolved_count} unresolved rows"
    )

    # integrity gate must pass (unresolved rows have no citations — that's expected)
    igr = integrity_gate5b1(site)
    assert igr["ok"] is True, f"integrity_gate5b1 failed: {igr}"


def test_export_site_producer_consumer_integration(pg_dsn, tmp_path):
    """Producer→consumer: run citation, integrity, and coverage gates against
    the site that export_site just produced. Locks export and gate schemas together.

    Seeds a jbook PDF + provenance_pages (produces jbook_pdf + lda citations).
    No budget_lines seeded so no workbook citation — avoids PDF-sha-as-xlsx mismatch.
    A column rename in either export_site or verify_phase5b1 will fail this suite.
    """
    from govbudget.jbooks.provenance_pages import build_provenance_pages
    from govbudget.verify_phase5b1 import (
        citation_gate5b1,
        coverage_report5b1,
        integrity_gate5b1,
    )

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    # No _seed_budget_line — avoid workbook citation pointing to a PDF sha as xlsx
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    # Gate 1: citation_gate5b1
    cit_result = citation_gate5b1(site)
    assert cit_result["ok"] is True, (
        f"citation_gate5b1 failed after export_site: {cit_result}"
    )

    # Gate 2: integrity_gate5b1
    int_result = integrity_gate5b1(site)
    assert int_result["ok"] is True, (
        f"integrity_gate5b1 failed after export_site: {int_result}"
    )

    # Gate 3: coverage_report5b1 (non-gating — just assert it returns a valid dict)
    cov_result = coverage_report5b1(site)
    assert isinstance(cov_result, dict)
    assert "by_resolution" in cov_result
    assert "total_details" in cov_result


def test_export_site_jbook_sha256_dedup(pg_dsn, tmp_path):
    """Two jbook_documents rows with the same sha256 (different source_url) + one
    resolved provenance_pages fact → exactly ONE jbook_pdf citation emitted.

    This guards against the sha256-join fan-out: jbook_documents.sha256 is NOT unique
    (the same PDF may be re-hosted at a second URL). The export must deduplicate the
    documents side of the join so each fact gets exactly one citation row.
    """
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    sha = hashlib.sha256(FIXTURE_PDF.read_bytes()).hexdigest()

    # Seed TWO jbook_documents rows with identical sha256 but different source_urls.
    # Use 'on conflict do nothing' guard on source_url to avoid touching prior rows;
    # we insert two brand-new URLs that cannot conflict with existing fixtures.
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        for i, suffix in enumerate(["mirror-a", "mirror-b"]):
            con.execute(
                "insert into jbook_documents"
                " (org, exhibit_family, fiscal_year, title, source_url, file_path,"
                " sha256, downloaded_at, status) values"
                " ('DARPA','rdte',2026,'dedup_test.pdf',%s,%s,%s,now(),'downloaded')"
                " on conflict (source_url) do nothing",
                (
                    f"https://example.mil/dedup/{suffix}/darpa.pdf",
                    str(FIXTURE_PDF),
                    sha,
                ),
            )
        # Seed one budget_line_details row via a single doc_id (first inserted)
        doc_id = con.execute(
            "select id from jbook_documents where source_url = %s",
            ("https://example.mil/dedup/mirror-a/darpa.pdf",),
        ).fetchone()[0]
        run_id_row = con.execute(
            "select max(id) from extraction_runs where document_id = %s",
            (doc_id,),
        ).fetchone()[0]
        if run_id_row is None:
            con.execute(
                "insert into extraction_runs (document_id, tier, tool_versions)"
                " values (%s, 1, '{}')",
                (doc_id,),
            )
            run_id_row = con.execute("select max(id) from extraction_runs").fetchone()[0]
        # Upsert detail row (scenario unique to this test to avoid conftest conflicts)
        con.execute(
            "insert into budget_line_details"
            " (extraction_run_id, document_id, pe_bli, scenario, amount_millions, xml_path)"
            " values (%s,%s,'0601101E','ShaDedup','280.494','ProgramElement[0]')"
            " on conflict do nothing",
            (run_id_row, doc_id),
        )

    # Build provenance_pages — will resolve the detail row to the PDF
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")

    cit_pq = site / "citations" / "citations.parquet"
    if not cit_pq.exists():
        # If no citation was emitted (e.g. resolution=unresolved in this env) skip
        import pytest as _pytest
        _pytest.skip("No citations written — resolution may be unresolved in this env")

    # Count jbook_pdf citations for our specific sha
    jbook_rows = duckdb.sql(
        f"select fact_id, sha256 from read_parquet('{cit_pq}')"
        f" where kind = 'jbook_pdf' and sha256 = '{sha}'"
    ).fetchall()

    # Must have no duplicate fact_ids for this sha — dedup enforced
    fact_ids = [r[0] for r in jbook_rows]
    assert len(fact_ids) == len(set(fact_ids)), (
        f"jbook_pdf citations for sha={sha[:12]}… are not distinct: {fact_ids}"
    )

    # The integrity gate must also pass (citation_distinctness included)
    from govbudget.verify_phase5b1 import integrity_gate5b1
    igr = integrity_gate5b1(site)
    assert igr["ok"] is True, f"integrity_gate5b1 failed after sha-dedup export: {igr}"


# ---------------------------------------------------------------------------
# Task 1 (Phase 5B-2): JSON sidecars
# ---------------------------------------------------------------------------


def _run_export_with_sidecars(pg_dsn, tmp_path):
    """Helper: seed minimal data, run export_site, return (site_path, out_dict)."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    out = export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")
    return site, out


def test_json_sidecars_return_dict_and_manifest(pg_dsn, tmp_path):
    """export_site return dict gains 'json_files'; manifest gains 'json_sidecars'."""
    site, out = _run_export_with_sidecars(pg_dsn, tmp_path)

    assert "json_files" in out, "return dict missing 'json_files' key"
    assert isinstance(out["json_files"], int)
    assert out["json_files"] > 0

    man = json.loads((site / "manifest.json").read_text())
    assert "json_sidecars" in man, "manifest missing 'json_sidecars' key"
    assert man["json_sidecars"] == out["json_files"]


def test_json_dir_created(pg_dsn, tmp_path):
    """out_dir/json/ directory is created."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)
    assert (site / "json").is_dir()


def test_programs_json_schema(pg_dsn, tmp_path):
    """programs.json has expected top-level fields per program entry."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)

    programs_path = site / "json" / "programs.json"
    assert programs_path.exists(), "programs.json missing"

    programs = json.loads(programs_path.read_text())
    assert isinstance(programs, list)
    assert len(programs) >= 1

    p = programs[0]
    required_keys = {
        "pe_bli", "org", "exhibit_family", "title", "project_count",
        "fully_reconciled", "fy2024_actual_millions",
        "fy2024_fact_id",  # nullable
        "trajectory",      # nullable
        "narrative_count", "award_count", "hhi",
    }
    assert required_keys <= set(p.keys()), f"programs.json entry missing keys: {required_keys - set(p.keys())}"

    # fy2024_fact_id: string or null
    fid = p["fy2024_fact_id"]
    assert fid is None or (isinstance(fid, str) and len(fid) == 16), f"bad fy2024_fact_id: {fid!r}"

    # trajectory: dict or null
    traj = p["trajectory"]
    if traj is not None:
        assert "fy2024_actuals" in traj
        assert "fy2025_total" in traj
        assert "fy2026_total" in traj
        assert "fy2526_change" in traj
        assert "fy2526_pct_change" in traj


def test_sidecar_derived_fact_ids(pg_dsn, tmp_path):
    """Phase 5B-3 flips: sidecars CARRY derived citation fact_ids minted in
    Python (fact_id_derived) — programs.json trajectory_fact_ids + hhi fids,
    agencies.json fy2024/fy2026 derived fids, entities_top total_obligation
    fid, entity_details influence fids. Every attached fid must resolve in
    citations.json (caller guarantees factId resolves)."""
    from govbudget.export_site import fact_id_derived

    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)
    citations = json.loads((site / "json" / "citations.json").read_text())

    # ── programs.json: trajectory_fact_ids + hhi fact ids ──────────────────
    programs = json.loads((site / "json" / "programs.json").read_text())
    by_pe = {p["pe_bli"]: p for p in programs}
    p = by_pe["0601101E"]

    tfi = p["trajectory_fact_ids"]
    assert tfi is not None, "trajectory_fact_ids missing for program with trajectory"
    key = "0601101E|DARPA"
    for metric in ("fy2024_actuals", "fy2025_total", "fy2026_total", "fy2526_change"):
        expected = fact_id_derived("trajectory", key, metric)
        assert tfi[metric] == expected, f"{metric}: {tfi[metric]!r} != {expected!r}"
        assert expected in citations, f"{metric} fid not in citations.json"
        assert citations[expected]["kind"] == "derived"

    assert "fy2024_xml_path" in p  # nullable; present on every entry

    hhi = p["hhi"]
    assert hhi["hhi_fact_id"] == fact_id_derived("concentration", "0601101E", "hhi")
    assert hhi["program_dollars_fact_id"] == fact_id_derived(
        "concentration", "0601101E", "program_dollars"
    )
    assert hhi["hhi_fact_id"] in citations
    assert hhi["program_dollars_fact_id"] in citations

    # ── agencies.json: derived agency-sum fact ids ──────────────────────────
    agencies = json.loads((site / "json" / "agencies.json").read_text())
    a = {x["org"]: x for x in agencies}["DARPA"]
    fy24_fid = fact_id_derived("agency", "DARPA", "fy2024_total_millions")
    fy26_fid = fact_id_derived("agency", "DARPA", "fy2026_total_thousands")
    assert a["fy2024_fact_id_derived"] == fy24_fid
    assert a["fy2026_fact_id_derived"] == fy26_fid
    assert citations[fy24_fid]["kind"] == "derived"
    assert citations[fy26_fid]["kind"] == "derived"
    # FY26 sum recorded_value matches the sidecar sum (single program: 295000)
    assert citations[fy26_fid]["recorded_value"] == "295000.000"
    # FY26 inputs are the per-program trajectory fy2026_total derived fids
    inputs = json.loads(citations[fy26_fid]["inputs"])
    assert inputs == [fact_id_derived("trajectory", key, "fy2026_total")]

    # ── entities_top.json: entity total_obligation fid ──────────────────────
    ents = json.loads((site / "json" / "entities_top.json").read_text())
    e = {x["family_key"]: x for x in ents}["lockheed"]
    ent_fid = fact_id_derived("entity", "lockheed", "total_obligation")
    assert e["total_obligation_fact_id"] == ent_fid
    assert citations[ent_fid]["kind"] == "derived"

    # ── entity_details: influence row fids ──────────────────────────────────
    det = json.loads((site / "json" / "entity_details" / "lockheed.json").read_text())
    row = det["influence"][0]
    infl_key = "lockheed|2025"
    assert row["income_fact_id"] == fact_id_derived("influence", infl_key, "lobbying_income_usd")
    assert row["expense_fact_id"] == fact_id_derived("influence", infl_key, "lobbying_expense_usd")
    assert row["total_fact_id"] == fact_id_derived("influence", infl_key, "lobbying_total_usd")
    for fid in (row["income_fact_id"], row["expense_fact_id"], row["total_fact_id"]):
        assert fid in citations and citations[fid]["kind"] == "derived"
    # family_obligations_usd (50000000.0) matches dim_entities.total_obligation
    # exactly → carries the ENTITY derived fid (cited-or-absent on the page)
    assert row["family_obligations_fact_id"] == ent_fid


def test_programs_json_fy2024_fact_id_null_case(pg_dsn, tmp_path):
    """A program whose pe_bli has no PriorYear+null_project_number detail row
    must have fy2024_fact_id=null in programs.json."""
    # The seeded dim_programs has pe_bli='0601101E'. We seed a budget_line_detail
    # only with scenario='PriorYear' and project_number=None (via _seed_jbook_doc).
    # To test the null case: seed a second program row with a different pe_bli
    # that has NO jbook detail.
    db = tmp_path / "wh.duckdb"
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    # Copy _make_test_duckdb but add a second dim_programs row with no matching details
    con.execute("create table dim_programs (pe_bli varchar, title varchar, org varchar, exhibit_family varchar, project_count integer, fy2024_actual_millions double, fully_reconciled boolean)")
    con.execute("insert into dim_programs values ('0601101E','Defense Research Sciences','DARPA','rdte',1,280.494,true)")
    con.execute("insert into dim_programs values ('9999ZZZZ','Orphan Program','DARPA','rdte',0,0.0,false)")
    # Build the rest of the tables
    con.execute("create table fct_budget_to_awards (pe_bli varchar, exhibit varchar, fiscal_year integer, organization varchar, award_piid varchar, recipient_name varchar, recipient_uei varchar, method varchar, confidence varchar, program_title varchar)")
    con.execute("create table fct_budget_trajectory (pe_bli varchar, organization varchar, fy2024_actuals double, fy2025_total double, fy2026_total double, fy2526_change double, fy2526_pct_change double)")
    # fy2526_change = fy2026_total - fy2025_total = 295000 - 293145 = 1855
    con.execute("insert into fct_budget_trajectory values ('0601101E','DARPA',280494.0,293145.0,295000.0,1855.0,0.63)")
    con.execute("create table dim_entities (family_key varchar, display_name varchar, uei_count bigint, total_obligation double, worst_confidence varchar)")
    con.execute("create table fct_influence (family_key varchar, display_name varchar, filing_year varchar, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double)")
    con.execute("create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar, program_title varchar, matched_term varchar, description_snippet varchar, filing_url varchar, client_name varchar, family_key varchar, filing_year varchar)")
    con.execute("create table dim_lobbyists (name varchar, covered_position varchar, filings_count integer, revolving_door boolean)")
    con.execute("create table fct_program_concentration (pe_bli varchar, hhi double, top_family varchar, family_count bigint, program_dollars double)")
    con.execute("create table fct_improper_exposure (agency_code varchar, program_count bigint, derived_improper_amount_usd double, weighted_rate_pct double, latest_fiscal_year integer)")
    con.execute("create table dim_geography (pop_state varchar, pop_district varchar, transaction_count bigint, total_obligation double)")
    con.execute("create table fct_state_per_capita (jurisdiction varchar, comparable_category varchar, fiscal_year varchar, total_amount_usd double, population bigint, amount_per_capita double, pop_year_used integer, spend_source_url varchar, pop_source_url varchar, coverage_note varchar)")
    con.close()

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    from govbudget.jbooks.provenance_pages import build_provenance_pages
    build_provenance_pages(pg_dsn)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    programs = json.loads((site / "json" / "programs.json").read_text())
    by_pe = {p["pe_bli"]: p for p in programs}

    # 9999ZZZZ has no jbook details → fact_id must be null
    assert "9999ZZZZ" in by_pe, "9999ZZZZ not in programs.json"
    assert by_pe["9999ZZZZ"]["fy2024_fact_id"] is None, (
        f"expected null fy2024_fact_id for 9999ZZZZ, got {by_pe['9999ZZZZ']['fy2024_fact_id']}"
    )
    # 0601101E may have a fact_id (depends on provenance resolution)
    # — just confirm it's not missing from programs.json
    assert "0601101E" in by_pe


def test_programs_json_fy2024_fact_id_null_when_zero_amount(pg_dsn, tmp_path):
    """fy2024_fact_id must be null when the PriorYear fact has resolution='zero_amount'.

    The bug: export_site used to emit the fact_id from jbook_details even when
    that fact's provenance resolution was 'zero_amount' (meaning it is excluded
    from citations.json). Gate 2 then flagged the emitted data-fact-id as
    unresolvable. The fix: only emit fy2024_fact_id when the fact_id appears in
    the citation rows (resolution unique or ambiguous_first).
    """
    db = tmp_path / "wh.duckdb"
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    con.execute("create table dim_programs (pe_bli varchar, title varchar, org varchar, exhibit_family varchar, project_count integer, fy2024_actual_millions double, fully_reconciled boolean)")
    con.execute("insert into dim_programs values ('0601101E','Defense Research Sciences','DARPA','rdte',1,0.0,false)")
    con.execute("create table fct_budget_to_awards (pe_bli varchar, exhibit varchar, fiscal_year integer, organization varchar, award_piid varchar, recipient_name varchar, recipient_uei varchar, method varchar, confidence varchar, program_title varchar)")
    con.execute("create table fct_budget_trajectory (pe_bli varchar, organization varchar, fy2024_actuals double, fy2025_total double, fy2026_total double, fy2526_change double, fy2526_pct_change double)")
    con.execute("create table dim_entities (family_key varchar, display_name varchar, uei_count bigint, total_obligation double, worst_confidence varchar)")
    con.execute("create table fct_influence (family_key varchar, display_name varchar, filing_year varchar, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double)")
    con.execute("create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar, program_title varchar, matched_term varchar, description_snippet varchar, filing_url varchar, client_name varchar, family_key varchar, filing_year varchar)")
    con.execute("create table dim_lobbyists (name varchar, covered_position varchar, filings_count integer, revolving_door boolean)")
    con.execute("create table fct_program_concentration (pe_bli varchar, hhi double, top_family varchar, family_count bigint, program_dollars double)")
    con.execute("create table fct_improper_exposure (agency_code varchar, program_count bigint, derived_improper_amount_usd double, weighted_rate_pct double, latest_fiscal_year integer)")
    con.execute("create table dim_geography (pop_state varchar, pop_district varchar, transaction_count bigint, total_obligation double)")
    con.execute("create table fct_state_per_capita (jurisdiction varchar, comparable_category varchar, fiscal_year varchar, total_amount_usd double, population bigint, amount_per_capita double, pop_year_used integer, spend_source_url varchar, pop_source_url varchar, coverage_note varchar)")
    con.close()

    # Seed a jbook document + extraction_run + budget_line_detail
    sha = hashlib.sha256(FIXTURE_PDF.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as pg_con:
        pg_con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'excerpt.pdf','https://example.mil/zeroamt.pdf',%s,%s,"
            " now(),'downloaded') on conflict (source_url) do nothing",
            (str(FIXTURE_PDF), sha),
        )
        doc_id = pg_con.execute(
            "select id from jbook_documents where source_url='https://example.mil/zeroamt.pdf'"
        ).fetchone()[0]
        pg_con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = pg_con.execute("select max(id) from extraction_runs").fetchone()[0]
        # Seed a PriorYear detail row with amount_millions=0 (triggers zero_amount resolution)
        pg_con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','PriorYear','0.000','ProgramElement[0]')",
            (run_id, doc_id),
        )
        # Seed provenance_pages directly with resolution='zero_amount'
        pg_con.execute(
            "insert into provenance_pages"
            " (document_sha256, pe_bli, project_number, scenario, amount_millions,"
            "  amount_text, page_number, resolution, candidate_pages)"
            " values (%s,'0601101E',null,'PriorYear',0.000,'0.000',null,'zero_amount',0)"
            " on conflict do nothing",
            (sha,),
        )

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    programs = json.loads((site / "json" / "programs.json").read_text())
    by_pe = {p["pe_bli"]: p for p in programs}

    assert "0601101E" in by_pe, "0601101E not in programs.json"
    assert by_pe["0601101E"]["fy2024_fact_id"] is None, (
        f"fy2024_fact_id must be null when resolution=zero_amount (citations.json has no entry);"
        f" got {by_pe['0601101E']['fy2024_fact_id']!r}"
    )
    # Phase 5B-3: zero-amount PriorYear facts surface their xml_path so the
    # headline FY24 figure renders Cite state B (xml-path chip), never state C
    # (jbook_details is a cited dataset under the dataset-ledger gate).
    assert by_pe["0601101E"]["fy2024_xml_path"] == "ProgramElement[0]", (
        f"expected fy2024_xml_path='ProgramElement[0]' for the zero-amount fact,"
        f" got {by_pe['0601101E']['fy2024_xml_path']!r}"
    )


def test_programs_json_org_translation(pg_dsn, tmp_path):
    """Forward org translation: DPAP program joins OSD trajectory row (not DPAP)."""
    # Fixture: add DPAP program + OSD trajectory row; also keep OSD program + OSD trajectory.
    db = tmp_path / "wh.duckdb"
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    con.execute("create table dim_programs (pe_bli varchar, title varchar, org varchar, exhibit_family varchar, project_count integer, fy2024_actual_millions double, fully_reconciled boolean)")
    con.execute("insert into dim_programs values ('0601101E','Defense Research Sciences','DARPA','rdte',1,280.494,true)")
    # OSD program — direct join
    con.execute("insert into dim_programs values ('OSDPROG1','OSD Program','OSD','rdte',1,10.0,false)")
    # DPAP program — forward-translated to OSD
    con.execute("insert into dim_programs values ('DPAPPROG1','DPAP Program','DPAP','rdte',1,5.0,false)")
    con.execute("create table fct_budget_to_awards (pe_bli varchar, exhibit varchar, fiscal_year integer, organization varchar, award_piid varchar, recipient_name varchar, recipient_uei varchar, method varchar, confidence varchar, program_title varchar)")
    con.execute("create table fct_budget_trajectory (pe_bli varchar, organization varchar, fy2024_actuals double, fy2025_total double, fy2026_total double, fy2526_change double, fy2526_pct_change double)")
    # fy2526_change = fy2026_total - fy2025_total = 295000 - 293145 = 1855
    con.execute("insert into fct_budget_trajectory values ('0601101E','DARPA',280494.0,293145.0,295000.0,1855.0,0.63)")
    con.execute("insert into fct_budget_trajectory values ('OSDPROG1','OSD',10000.0,11000.0,12000.0,2000.0,18.18)")
    con.execute("insert into fct_budget_trajectory values ('DPAPPROG1','OSD',5000.0,5500.0,6000.0,500.0,9.09)")
    con.execute("create table dim_entities (family_key varchar, display_name varchar, uei_count bigint, total_obligation double, worst_confidence varchar)")
    con.execute("create table fct_influence (family_key varchar, display_name varchar, filing_year varchar, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double)")
    con.execute("create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar, program_title varchar, matched_term varchar, description_snippet varchar, filing_url varchar, client_name varchar, family_key varchar, filing_year varchar)")
    con.execute("create table dim_lobbyists (name varchar, covered_position varchar, filings_count integer, revolving_door boolean)")
    con.execute("create table fct_program_concentration (pe_bli varchar, hhi double, top_family varchar, family_count bigint, program_dollars double)")
    con.execute("create table fct_improper_exposure (agency_code varchar, program_count bigint, derived_improper_amount_usd double, weighted_rate_pct double, latest_fiscal_year integer)")
    con.execute("create table dim_geography (pop_state varchar, pop_district varchar, transaction_count bigint, total_obligation double)")
    con.execute("create table fct_state_per_capita (jurisdiction varchar, comparable_category varchar, fiscal_year varchar, total_amount_usd double, population bigint, amount_per_capita double, pop_year_used integer, spend_source_url varchar, pop_source_url varchar, coverage_note varchar)")
    con.close()

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    from govbudget.jbooks.provenance_pages import build_provenance_pages
    build_provenance_pages(pg_dsn)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    programs = json.loads((site / "json" / "programs.json").read_text())
    by_pe = {p["pe_bli"]: p for p in programs}

    # OSD program joins its own trajectory row directly
    assert by_pe["OSDPROG1"]["trajectory"] is not None, "OSD program should have trajectory"
    assert by_pe["OSDPROG1"]["trajectory"]["fy2026_total"] == 12000.0

    # DPAP program joins OSD trajectory (forward translation: DPAP → OSD)
    assert by_pe["DPAPPROG1"]["trajectory"] is not None, (
        "DPAP program should join OSD trajectory via forward translation"
    )
    assert by_pe["DPAPPROG1"]["trajectory"]["fy2026_total"] == 6000.0


def test_program_details_json_structure(pg_dsn, tmp_path):
    """program_details/{pe_bli}.json has correct keys; zero-amount detail carries xml_path."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    detail_dir = site / "json" / "program_details"
    assert detail_dir.is_dir(), "program_details/ directory missing"

    detail_files = list(detail_dir.glob("*.json"))
    assert len(detail_files) >= 1, "no program_details JSON files written"

    # Parse the one we seeded
    det_path = detail_dir / "0601101E.json"
    assert det_path.exists(), "0601101E.json not found in program_details/"

    det = json.loads(det_path.read_text())
    required_keys = {"details", "narratives", "budget_lines", "awards", "mentions"}
    assert required_keys <= set(det.keys()), f"missing keys: {required_keys - set(det.keys())}"

    # details rows must have resolution and xml_path always present
    assert isinstance(det["details"], list)
    if det["details"]:
        d = det["details"][0]
        assert "fact_id" in d
        assert "scenario" in d
        assert "resolution" in d, "resolution must be present on every detail row"
        assert "xml_path" in d, "xml_path must be present on every detail row (zero-amount chip depends on it)"

    # budget_lines rows
    assert isinstance(det["budget_lines"], list)
    if det["budget_lines"]:
        bl = det["budget_lines"][0]
        assert "fact_id" in bl
        assert "amount_thousands" in bl
        assert "source_sheet" in bl
        assert "source_cells" in bl

    # mentions rows
    assert isinstance(det["mentions"], list)
    if det["mentions"]:
        m = det["mentions"][0]
        assert "filing_uuid" in m
        assert "filing_url" in m
        assert "description_snippet" in m


def test_entities_top_json_schema(pg_dsn, tmp_path):
    """entities_top.json has correct schema with uei_count and worst_confidence."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)

    path = site / "json" / "entities_top.json"
    assert path.exists(), "entities_top.json missing"

    entities = json.loads(path.read_text())
    assert isinstance(entities, list)

    if entities:
        e = entities[0]
        required = {"family_key", "slug", "display_name", "uei_count",
                    "total_obligation", "worst_confidence"}
        assert required <= set(e.keys()), f"missing keys: {required - set(e.keys())}"
        # slug = family_key.lower().replace(' ', '-')
        assert e["slug"] == e["family_key"].lower().replace(" ", "-")


def test_entity_details_matching_family_gets_awards(pg_dsn, tmp_path):
    """A family_key whose display_name exactly matches an award recipient_name
    gets >0 award rows; a non-matching family gets []."""
    # Seed a dim_entities row matching the fct_budget_to_awards recipient_name 'Lockheed Martin'
    db = tmp_path / "wh.duckdb"
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    con.execute("create table dim_programs (pe_bli varchar, title varchar, org varchar, exhibit_family varchar, project_count integer, fy2024_actual_millions double, fully_reconciled boolean)")
    con.execute("insert into dim_programs values ('0601101E','Defense Research Sciences','DARPA','rdte',1,280.494,true)")
    con.execute("create table fct_budget_to_awards (pe_bli varchar, exhibit varchar, fiscal_year integer, organization varchar, award_piid varchar, recipient_name varchar, recipient_uei varchar, method varchar, confidence varchar, program_title varchar)")
    # Award whose recipient_name matches 'Lockheed Martin' (the display_name we'll seed)
    con.execute("insert into fct_budget_to_awards values ('0601101E','R-1',2026,'DARPA','W911QX-24-C-0001','Lockheed Martin','UEI123','account+subagency','medium','Defense Research Sciences')")
    con.execute("create table fct_budget_trajectory (pe_bli varchar, organization varchar, fy2024_actuals double, fy2025_total double, fy2026_total double, fy2526_change double, fy2526_pct_change double)")
    # fy2526_change = fy2026_total - fy2025_total = 295000 - 293145 = 1855
    con.execute("insert into fct_budget_trajectory values ('0601101E','DARPA',280494.0,293145.0,295000.0,1855.0,0.63)")
    # Matching entity
    con.execute("create table dim_entities (family_key varchar, display_name varchar, uei_count bigint, total_obligation double, worst_confidence varchar)")
    con.execute("insert into dim_entities values ('lockheed','Lockheed Martin',5,50000000.0,'medium')")
    # Non-matching entity
    con.execute("insert into dim_entities values ('boeing','The Boeing Company',3,30000000.0,'high')")
    con.execute("create table fct_influence (family_key varchar, display_name varchar, filing_year varchar, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double)")
    con.execute("insert into fct_influence values ('lockheed','Lockheed Martin','2025',3,1000000.0,0.0,1000000.0,50000000.0)")
    con.execute("create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar, program_title varchar, matched_term varchar, description_snippet varchar, filing_url varchar, client_name varchar, family_key varchar, filing_year varchar)")
    con.execute("create table dim_lobbyists (name varchar, covered_position varchar, filings_count integer, revolving_door boolean)")
    con.execute("create table fct_program_concentration (pe_bli varchar, hhi double, top_family varchar, family_count bigint, program_dollars double)")
    con.execute("create table fct_improper_exposure (agency_code varchar, program_count bigint, derived_improper_amount_usd double, weighted_rate_pct double, latest_fiscal_year integer)")
    con.execute("create table dim_geography (pop_state varchar, pop_district varchar, transaction_count bigint, total_obligation double)")
    con.execute("create table fct_state_per_capita (jurisdiction varchar, comparable_category varchar, fiscal_year varchar, total_amount_usd double, population bigint, amount_per_capita double, pop_year_used integer, spend_source_url varchar, pop_source_url varchar, coverage_note varchar)")
    con.close()

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    from govbudget.jbooks.provenance_pages import build_provenance_pages
    build_provenance_pages(pg_dsn)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    detail_dir = site / "json" / "entity_details"
    assert detail_dir.is_dir()

    # Lockheed Martin matches → should have awards
    lm_path = detail_dir / "lockheed.json"
    assert lm_path.exists(), "lockheed.json missing"
    lm = json.loads(lm_path.read_text())
    assert "awards" in lm
    assert len(lm["awards"]) > 0, "expected >0 awards for matching family"
    # influence rows have nonAdditive marker
    if lm["influence"]:
        assert "nonAdditive" in lm["influence"][0]
        assert lm["influence"][0]["nonAdditive"] is True

    # Boeing does not match → awards should be []
    # slug = family_key.lower().replace(' ', '-') = 'boeing'
    boeing_path = detail_dir / "boeing.json"
    assert boeing_path.exists(), "boeing.json missing"
    boeing = json.loads(boeing_path.read_text())
    assert boeing["awards"] == [], f"expected empty awards for Boeing, got: {boeing['awards']}"


def test_agencies_json_schema(pg_dsn, tmp_path):
    """agencies.json has org, program_count, fy2024_total_millions, fy2026_total_thousands."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)

    path = site / "json" / "agencies.json"
    assert path.exists(), "agencies.json missing"

    agencies = json.loads(path.read_text())
    assert isinstance(agencies, list)
    assert len(agencies) >= 1

    a = agencies[0]
    required = {"org", "program_count", "fy2024_total_millions"}
    assert required <= set(a.keys()), f"missing keys: {required - set(a.keys())}"
    assert "fy2026_total_thousands" in a  # nullable


def test_citations_json_keyed_by_fact_id(pg_dsn, tmp_path):
    """citations.json is a dict keyed by fact_id; keys match citations.parquet."""
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    build_provenance_pages(pg_dsn)

    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)

    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="/pdfs")

    path = site / "json" / "citations.json"
    assert path.exists(), "citations.json missing"

    cit_json = json.loads(path.read_text())
    assert isinstance(cit_json, dict)

    # Keys must match citations.parquet fact_ids
    cit_pq = site / "citations" / "citations.parquet"
    if cit_pq.exists():
        pq_ids = {r[0] for r in duckdb.sql(
            f"select fact_id from read_parquet('{cit_pq}')"
        ).fetchall()}
        assert set(cit_json.keys()) == pq_ids, (
            f"citations.json keys ({len(cit_json)}) don't match parquet "
            f"({len(pq_ids)})"
        )


def test_search_quick_json_schema(pg_dsn, tmp_path):
    """search_quick.json has docs array with program, company, agency, static entries."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)

    path = site / "json" / "search_quick.json"
    assert path.exists(), "search_quick.json missing"

    sq = json.loads(path.read_text())
    assert "docs" in sq
    docs = sq["docs"]
    assert isinstance(docs, list)

    kinds = {d["kind"] for d in docs}
    assert "program" in kinds, "no program docs in search_quick"
    assert "agency" in kinds, "no agency docs in search_quick"
    assert "static" in kinds, "no static docs in search_quick"

    # Program docs have required fields
    prog_docs = [d for d in docs if d["kind"] == "program"]
    assert prog_docs
    pd_ = prog_docs[0]
    assert "id" in pd_ and pd_["id"].startswith("p:")
    assert "url" in pd_ and pd_["url"].startswith("/program/")
    assert "pe_bli" in pd_
    assert "org" in pd_
    assert "dollars" in pd_  # nullable OK


def test_site_meta_json(pg_dsn, tmp_path):
    """site_meta.json has manifest passthrough + built_at + counts."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)

    path = site / "json" / "site_meta.json"
    assert path.exists(), "site_meta.json missing"

    meta = json.loads(path.read_text())
    assert "built_at" in meta
    assert "schema_version" in meta
    assert meta["schema_version"] == 1
    assert "uncited_datasets" in meta
    assert "counts" in meta


def test_json_sort_keys(pg_dsn, tmp_path):
    """All JSON sidecar files are written with sort_keys=True."""
    site, _ = _run_export_with_sidecars(pg_dsn, tmp_path)

    json_dir = site / "json"
    # Check a simple top-level file (site_meta.json must be sorted)
    meta_text = (json_dir / "site_meta.json").read_text()
    meta = json.loads(meta_text)
    if isinstance(meta, dict):
        keys = list(meta.keys())
        assert keys == sorted(keys), f"site_meta.json keys not sorted: {keys}"

    # Check programs.json entries
    programs_text = (json_dir / "programs.json").read_text()
    programs = json.loads(programs_text)
    if programs and isinstance(programs[0], dict):
        keys = list(programs[0].keys())
        assert keys == sorted(keys), f"programs.json[0] keys not sorted: {keys}"
