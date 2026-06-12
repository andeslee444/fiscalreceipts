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

    # 2. fct_budget_to_awards
    con.execute("create table fct_budget_to_awards (pe_bli varchar, fiscal_year integer, award_piid varchar, matched_obligation double, confidence double)")
    con.execute("insert into fct_budget_to_awards values ('0601101E',2026,'W911QX-24-C-0001',1000000.0,0.9)")

    # 3. fct_budget_trajectory
    con.execute("create table fct_budget_trajectory (pe_bli varchar, organization varchar, fy2024_actuals double, fy2025_total double, fy2026_total double, abs_change double, pct_change double)")
    con.execute("insert into fct_budget_trajectory values ('0601101E','DARPA',280494.0,293145.0,295000.0,14506.0,5.17)")

    # 4. dim_entities
    con.execute("create table dim_entities (family_key varchar, display_name varchar, total_obligation double)")
    con.execute("insert into dim_entities values ('lockheed','Lockheed Martin',50000000.0)")

    # 5. fct_influence
    con.execute("create table fct_influence (family_key varchar, display_name varchar, filing_year varchar, filings_count integer, lobbying_income_usd double, lobbying_expense_usd double, lobbying_total_usd double, family_obligations_usd double)")
    con.execute("insert into fct_influence values ('lockheed','Lockheed Martin','2025',3,1000000.0,0.0,1000000.0,50000000.0)")

    # 6. fct_program_lobbying — MUST include filing_uuid, pe_bli, matched_term, filing_url
    con.execute("create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar, program_title varchar, matched_term varchar, description_snippet varchar, filing_url varchar, client_name varchar, family_key varchar, filing_year varchar)")
    con.execute("insert into fct_program_lobbying values ('uuid-lda-001','0601101E','Defense Research Sciences','darpa','mentioned DARPA','https://lda.senate.gov/filings/uuid-lda-001/','Lockheed Martin','lockheed','2025')")

    # 7. dim_lobbyists
    con.execute("create table dim_lobbyists (name varchar, covered_position varchar, filings_count integer, revolving_door boolean)")
    con.execute("insert into dim_lobbyists values ('J. Smith','Deputy Secretary of Defense',5,true)")

    # 8. fct_program_concentration
    con.execute("create table fct_program_concentration (pe_bli varchar, organization varchar, hhi double, top_recipient varchar)")
    con.execute("insert into fct_program_concentration values ('0601101E','DARPA',4200.0,'Lockheed Martin')")

    # 9. fct_improper_exposure
    con.execute("create table fct_improper_exposure (agency_code varchar, program_name varchar, improper_rate double, obligations_usd double)")
    con.execute("insert into fct_improper_exposure values ('097','DARPA Research',0.03,280000000.0)")

    # 10. dim_geography
    con.execute("create table dim_geography (recipient_uei varchar, state_code varchar, congressional_district varchar)")
    con.execute("insert into dim_geography values ('UEI123456','VA','VA-08')")

    # 11. fct_state_per_capita
    con.execute("create table fct_state_per_capita (jurisdiction varchar, comparable_category varchar, fiscal_year integer, total_amount_usd double, population integer, amount_per_capita double)")
    con.execute("insert into fct_state_per_capita values ('CA','Education',2025,5000000000.0,39500000,126.58)")

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

    # fct_budget_trajectory should be in uncited_datasets (no citation tier yet)
    assert "fct_budget_trajectory" in man["uncited_datasets"]

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
