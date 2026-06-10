from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.export_facts import export_facts
from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import reconcile_document
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def test_export_facts_writes_parquet(pg_dsn, tmp_path):
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
    out = export_facts(pg_dsn, parquet_dir=tmp_path)
    assert sorted(p.name for p in out) == [
        "budget_line_awards.parquet", "budget_lines.parquet",
        "detail_narratives.parquet", "details.parquet",
    ]
    n = duckdb.sql(
        f"select count(*) from read_parquet('{tmp_path}/jbooks/budget_lines.parquet')"
    ).fetchone()[0]
    assert n == 1
    rec = duckdb.sql(
        f"select count(*) from read_parquet('{tmp_path}/jbooks/details.parquet')"
        " where reconciled"
    ).fetchone()[0]
    assert rec > 0
