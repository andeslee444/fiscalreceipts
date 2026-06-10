from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.trace import trace_gate


def test_trace_gate_walks_all_hops(pg_dsn, tmp_path):
    # budget line + reconciled detail + crosswalk link + award row in the lake
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, status) values ('DARPA','rdte',2026,'d.pdf','u1','downloaded')"
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','DEFENSE RESEARCH SCIENCES',"
            "  'fy_2024_actuals',280494)"
        )
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions, status)"
            " values (%s,0,'{}','finished') ", (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path, reconciled)"
            " values (%s,%s,'0601101E','PriorYear',280.494,'ProgramElement[0]',true)",
            (run_id, doc_id),
        )
        con.execute(
            "insert into budget_line_awards (pe_bli, exhibit, fiscal_year, organization,"
            " award_piid, recipient_name, recipient_uei, matched_obligation, method,"
            " confidence, score, rationale) values"
            " ('0601101E','R-1',2026,'DARPA','HR001124C0001','ACME','UEI1',5000000,"
            "  'account+tokens','high',4,'test')"
        )
    lake = tmp_path / "contracts" / "fy=2024"
    lake.mkdir(parents=True)
    duckdb.sql(
        "copy (select * from (values ('HR001124C0001','ACME RESEARCH LLC','UEI1','5000000'))"
        " t(award_id_piid, recipient_name, recipient_uei, federal_action_obligation))"
        f" to '{lake}/part.parquet' (format parquet)"
    )
    result = trace_gate(
        pg_dsn, pe_blis=["0601101E"],
        award_glob=str(tmp_path / "contracts" / "*" / "*.parquet"),
    )
    assert result["traced"] == 1
    assert result["failed"] == []


def test_trace_gate_reports_missing_hops(pg_dsn, tmp_path):
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0699999E','fy_2024_actuals',1)"
        )
    result = trace_gate(
        pg_dsn, pe_blis=["0699999E"],
        award_glob=str(tmp_path / "nope" / "*.parquet"),
    )
    assert result["traced"] == 0
    assert result["failed"][0][0] == "0699999E"
    assert "detail" in result["failed"][0][1]  # first missing hop named
