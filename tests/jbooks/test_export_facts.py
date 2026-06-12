from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.export_facts import export_facts
from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import reconcile_document
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def _seed_full(pg_dsn, tmp_path):
    """Seed one downloaded document with sha256 + extraction_run + budget_lines + details."""
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        # Mark as downloaded with sha256
        con.execute(
            "update jbook_documents set status='downloaded', sha256='abc123', file_path=%s"
            " where id=%s",
            (str(tmp_path / "darpa.pdf"), doc_id),
        )
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands, source_document_id)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals',%s,%s)",
            (Decimal("280494"), doc_id),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    return doc_id


def test_export_facts_writes_parquet(pg_dsn, tmp_path):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        # Row WITHOUT source_cells (NULL array) — should export as empty string
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )
        # Row WITH source_cells — should export as comma-joined string
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands, source_cells)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2025_enacted',%s,%s)",
            (Decimal("300000"), ["J4", "J5"]),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    paths = export_facts(pg_dsn, parquet_dir=tmp_path)
    assert [p.name for p in paths] == [
        "budget_line_awards.parquet",
        "budget_lines.parquet",
        "detail_narratives.parquet",
        "details.parquet",
        "documents.parquet",
    ]
    n = duckdb.sql(
        f"select count(*) from read_parquet('{tmp_path}/jbooks/budget_lines.parquet')"
    ).fetchone()[0]
    assert n == 2
    # NULL source_cells exports as empty string (not NULL)
    no_cells_row = duckdb.sql(
        f"select source_cells from read_parquet('{tmp_path}/jbooks/budget_lines.parquet')"
        " where amount_type='fy_2024_actuals'"
    ).fetchone()[0]
    assert no_cells_row == "", f"Expected empty string for NULL source_cells, got {no_cells_row!r}"
    # Present source_cells exports as comma-joined string
    with_cells_row = duckdb.sql(
        f"select source_cells from read_parquet('{tmp_path}/jbooks/budget_lines.parquet')"
        " where amount_type='fy_2025_enacted'"
    ).fetchone()[0]
    assert with_cells_row == "J4,J5", f"Expected 'J4,J5', got {with_cells_row!r}"
    rec = duckdb.sql(
        f"select count(*) from read_parquet('{tmp_path}/jbooks/details.parquet')"
        " where reconciled"
    ).fetchone()[0]
    assert rec > 0


def test_export_facts_path_with_single_quote(pg_dsn, tmp_path):
    """COPY target path must be escaped so single quotes in tmp dir names don't break SQL."""
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)

    # Create a parquet_dir whose path contains a single quote
    quoted_dir = tmp_path / "o'brien"
    quoted_dir.mkdir()
    # Must not raise a DuckDB SQL syntax error
    paths = export_facts(pg_dsn, parquet_dir=quoted_dir)
    assert any(p.name == "budget_lines.parquet" for p in paths)
    bl_path = quoted_dir / "jbooks" / "budget_lines.parquet"
    escaped = str(bl_path).replace("'", "''")
    n = duckdb.sql(
        f"select count(*) from read_parquet('{escaped}')"
    ).fetchone()[0]
    assert n == 1


def test_export_facts_includes_provenance_columns(pg_dsn, tmp_path):
    _seed_full(pg_dsn, tmp_path)
    paths = export_facts(pg_dsn, parquet_dir=tmp_path)
    bl_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/budget_lines.parquet') limit 0"
    ).columns)
    assert {"source_document_id", "source_sheet", "source_cells"} <= bl_cols
    nr_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/detail_narratives.parquet') limit 0"
    ).columns)
    assert "document_id" in nr_cols
    dt_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/details.parquet') limit 0"
    ).columns)
    assert "document_sha256" in dt_cols
    doc_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/documents.parquet') limit 0"
    ).columns)
    assert {"id", "org", "fiscal_year", "title", "source_url", "sha256",
            "downloaded_at", "rel_path"} <= doc_cols
