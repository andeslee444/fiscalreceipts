from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def seed_doc(pg_dsn) -> int:
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        return con.execute("select id from jbook_documents").fetchone()[0]


def test_load_details_writes_rows_and_run(pg_dsn):
    doc_id = seed_doc(pg_dsn)
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        run = con.execute(
            "select tier, status from extraction_runs where id=%s", (run_id,)
        ).fetchone()
        assert run == (0, "finished")
        pe_rows = con.execute(
            "select count(*) from budget_line_details "
            "where pe_bli='0601101E' and project_number is null"
        ).fetchone()[0]
        assert pe_rows >= 2  # PriorYear + CurrentYear at minimum
        proj_rows = con.execute(
            "select count(*) from budget_line_details where project_number='CCS-02'"
        ).fetchone()[0]
        assert proj_rows >= 1
        narr = con.execute(
            "select count(*) from detail_narratives where pe_bli='0601101E'"
        ).fetchone()[0]
        assert narr >= 1


def test_reextract_supersedes_prior_run(pg_dsn):
    doc_id = seed_doc(pg_dsn)
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        live = con.execute(
            "select count(*) from budget_line_details where not superseded"
        ).fetchone()[0]
        dead = con.execute(
            "select count(*) from budget_line_details where superseded"
        ).fetchone()[0]
    assert live == dead  # second run superseded the first, equal row counts
