from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import SCENARIO_MAP, reconcile_document
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def seed(pg_dsn, r1_fy2024_thousands):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values ('R-1',2026,'0400','DARPA','0601101E',"
            " 'fy_2024_actuals', %s)",
            (r1_fy2024_thousands,),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    return doc_id, run_id


def test_gate_b_passes_when_r1_matches(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))  # $K == 280.494M
    result = reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
        assert check == (True,)
        rec = con.execute(
            "select bool_and(reconciled) from budget_line_details "
            "where pe_bli='0601101E' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
    assert rec is True
    assert result["queued"] == result["failed"]


def test_gate_b_split_ba_control_rows_are_summed(pg_dsn):
    # two R-1 rows for the same PE across budget activities summing to the XML total
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for ba, amt in (("01", Decimal("200000")), ("02", Decimal("80494"))):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " budget_activity, pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA',%s,'0601101E','fy_2024_actuals',%s)",
                (ba, amt),
            )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
    assert check == (True,)


def test_gate_b_failure_queues_review(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("999999"))
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        q = con.execute(
            "select count(*) from review_queue rq join reconciliation_checks c"
            " on c.id=rq.check_id where c.gate='B' and c.pe_bli='0601101E'"
            " and c.scenario='PriorYear' and rq.status='open'"
        ).fetchone()[0]
        rec = con.execute(
            "select bool_or(reconciled) from budget_line_details "
            "where pe_bli='0601101E' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
    assert q == 1
    assert rec is False


def test_gate_a_checks_project_sums(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        gate_a = con.execute(
            "select count(*) from reconciliation_checks where gate='A'"
        ).fetchone()[0]
    assert gate_a >= 1  # one per (PE, scenario) with project rows


def test_scenario_map_covers_core_scenarios():
    assert SCENARIO_MAP["PriorYear"][0] == "fy_2024_actuals"
    assert "fy_2025_total" in SCENARIO_MAP["CurrentYear"]
    assert "fy_2026_disc_request" in SCENARIO_MAP["BudgetYearOne"]


def test_gate_b_ignores_other_org_control_rows(pg_dsn):
    doc_id, run_id = None, None
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values ('R-1',2026,'0400','DARPA','0601101E',"
            " 'fy_2024_actuals', %s)",
            (Decimal("280494"),),
        )
        # alien rows that MUST NOT pollute the control sum
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values ('R-1',2026,'2040','ARMY','0601101E',"
            " 'fy_2024_actuals', 500000)",
        )
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values ('P-1',2026,'2035','NAVY','0601101E',"
            " 'fy_2024_actuals', 999999)",
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed, expected from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
    assert check[0] is True
    assert check[1] == Decimal("280.494")


def test_gate_a_failure_blocks_reconciled_even_when_gate_b_passes(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))
    # corrupt one project row so Gate A fails for (0601101E, PriorYear)
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "update budget_line_details set amount_millions = amount_millions + 50 "
            "where pe_bli='0601101E' and scenario='PriorYear' and project_number='CCS-02'"
            " and not superseded"
        )
    # wipe earlier checks from seed's implicit state (none yet) then reconcile
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        gate_a = con.execute(
            "select passed from reconciliation_checks where gate='A'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
        gate_b = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
        reconciled = con.execute(
            "select bool_or(reconciled) from budget_line_details"
            " where pe_bli='0601101E' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
    assert gate_a == (False,)
    assert gate_b == (True,)
    assert reconciled is False  # Gate A failure blocks serving despite Gate B pass
