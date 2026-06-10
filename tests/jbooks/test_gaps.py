from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.gaps import record_extraction_gaps
from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def test_gaps_recorded_for_unextracted_r1_lines(pg_dsn):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for pe in ("0601101E", "0699999E", "9999999999"):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA',%s,'fy_2024_actuals',%s)",
                (pe, Decimal("1000")),
            )
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    n = record_extraction_gaps(pg_dsn, document_id=doc_id)
    assert n == 1  # 0699999E missing; 0601101E extracted; sentinel excluded
    with psycopg.connect(pg_dsn) as con:
        rows = con.execute(
            "select pe_bli, reason from extraction_gaps"
        ).fetchall()
    assert rows[0][0] == "0699999E"
    assert "DARPA" in rows[0][1]

    # idempotent: re-run replaces, no duplicates
    assert record_extraction_gaps(pg_dsn, document_id=doc_id) == 1
    with psycopg.connect(pg_dsn) as con:
        total = con.execute("select count(*) from extraction_gaps").fetchone()[0]
    assert total == 1


def test_coverage_gate_translates_aliased_orgs(pg_dsn):
    from govbudget.jbooks.verify import coverage_gate

    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','CYBER','0208085JCY','fy_2024_actuals',1000)",
        )
    cov = coverage_gate(pg_dsn, organizations=["CYBERCOM"])
    assert cov["r1_lines"] == 1  # not a vacuous 0/0
    assert cov["missing"] == ["0208085JCY"]


def test_coverage_gap_lookup_is_org_scoped(pg_dsn):
    from govbudget.jbooks.verify import coverage_gate

    upsert_documents(pg_dsn, [
        {"org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
         "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf"},
        {"org": "OTHER", "exhibit_family": "rdte", "fiscal_year": 2026,
         "title": "other.pdf", "source_url": "https://example.test/other.pdf"},
    ])
    with psycopg.connect(pg_dsn) as con:
        other_id = con.execute(
            "select id from jbook_documents where org='OTHER'"
        ).fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DARPA','0601999E','fy_2024_actuals',1000)",
        )
        # a gap row belonging to ANOTHER org's document must not cover DARPA's PE
        con.execute(
            "insert into extraction_gaps (exhibit, pe_bli, reason, document_id)"
            " values ('R-1','0601999E','no extracted detail in OTHER fy2026 documents',%s)",
            (other_id,),
        )
    cov = coverage_gate(pg_dsn, organizations=["DARPA"])
    assert cov["covered"] == 0
    assert cov["missing"] == ["0601999E"]
