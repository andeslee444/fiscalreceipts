from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import reconcile_document, scenario_map
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
    m = scenario_map(2026)
    assert m["PriorYear"][0] == "fy_2024_actuals"
    assert "fy_2025_total" in m["CurrentYear"]
    assert "fy_2026_disc_request" in m["BudgetYearOne"]


def test_scenario_map_2026_pins_pb2026_semantics():
    # Regression pin: the PB2026 slugs (the pre-5E module constant) stay the
    # FIRST candidates in their original order; the appended header-variant
    # slugs (Task 4 live-run evidence: PB2024 'Total Enacted'/'Request'
    # columns, PB2025 CR-adjusted columns) don't exist in PB2026 budget_lines,
    # so PB2026 reconciliation outcomes are unchanged.
    assert scenario_map(2026) == {
        "PriorYear": ["fy_2024_actuals"],
        "CurrentYear": [
            "fy_2025_total", "fy_2025_enacted", "fy_2025_total_enacted",
            "fy_2025_less_supplementals_enacted",
            "fy_2025_pb_request_with_cr_amounts",
            "fy_2025_pb_request_with_cr_adjustments",
        ],
        "BudgetYearOne": ["fy_2026_total", "fy_2026_disc_request", "fy_2026_request"],
        "BudgetYearOneBase": ["fy_2026_disc_request", "fy_2026_total", "fy_2026_request"],
    }


def test_scenario_map_2025_shifts_every_year_by_one():
    m = scenario_map(2025)
    assert m["PriorYear"] == ["fy_2023_actuals"]
    assert m["CurrentYear"][:2] == ["fy_2024_total", "fy_2024_enacted"]
    # PB2025 published while FY2024 ran under a continuing resolution: the
    # display workbooks label the FY2024 column 'FY 2024 PB Request with CR
    # Amounts*' (R-1) / '... CR Adjustments Amount*' (P-1).
    assert "fy_2024_pb_request_with_cr_amounts" in m["CurrentYear"]
    assert "fy_2024_pb_request_with_cr_adjustments" in m["CurrentYear"]
    # 'FY 2025 Request' is the PB2024/PB2025-era request column label.
    assert m["BudgetYearOne"] == ["fy_2025_total", "fy_2025_disc_request", "fy_2025_request"]
    assert m["BudgetYearOneBase"] == ["fy_2025_disc_request", "fy_2025_total", "fy_2025_request"]


def test_scenario_map_2024_covers_total_enacted_headers():
    # PB2024 display workbooks label the FY2023 columns 'FY 2023 Total
    # Enacted' / 'FY 2023 Less Supplementals Enacted' and the FY2024 column
    # 'FY 2024 Request' (live-run evidence, Task 4).
    m = scenario_map(2024)
    assert m["PriorYear"] == ["fy_2022_actuals"]
    assert "fy_2023_total_enacted" in m["CurrentYear"]
    assert "fy_2023_less_supplementals_enacted" in m["CurrentYear"]
    # the supplementals-only column is NOT a CurrentYear candidate
    assert "fy_2023_supplementals_enacted" not in m["CurrentYear"]
    assert "fy_2024_request" in m["BudgetYearOne"]
    assert "fy_2024_request" in m["BudgetYearOneBase"]


def test_scenario_map_2017_shifts_every_year_by_nine():
    m = scenario_map(2017)
    assert m["PriorYear"] == ["fy_2015_actuals"]
    assert m["CurrentYear"][:2] == ["fy_2016_total", "fy_2016_enacted"]
    assert m["BudgetYearOne"][:2] == ["fy_2017_total", "fy_2017_disc_request"]
    assert m["BudgetYearOneBase"][:2] == ["fy_2017_disc_request", "fy_2017_total"]


def test_reconcile_uses_edition_year_map(pg_dsn):
    # A PB2025 document: PriorYear must reconcile against fy_2023_actuals,
    # not the PB2026 fy_2024_actuals column.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2025,
        "title": "darpa25.pdf", "source_url": "https://example.test/darpa25.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values ('R-1',2025,'0400','DARPA','0601101E',"
            " 'fy_2023_actuals', %s)",
            (Decimal("280494"),),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed, detail from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
    assert check[0] is True
    assert "fy_2023_actuals" in check[1]


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


def test_gate_b_zero_absent_rule(pg_dsn):
    # No R-1 row at all for the PE: explicit XML zeros pass, nonzero amounts fail.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        zero_check = con.execute(
            "select passed, detail from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='BudgetYearOne'"
        ).fetchone()
        nonzero_check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
    assert zero_check[0] is True and "zero-absent" in zero_check[1]
    assert nonzero_check == (False,)  # 280.494M with no control row still fails


def test_gate_b_matches_any_candidate_not_first_present(pg_dsn):
    # fy_2025_total present but wrong; fy_2025_enacted present and right.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for amount_type, amt in (("fy_2025_total", Decimal("999999")),
                                 ("fy_2025_enacted", Decimal("293145"))):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA','0601101E',%s,%s)",
                (amount_type, amt),
            )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed, detail from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='CurrentYear'"
        ).fetchone()
    assert check[0] is True
    assert "fy_2025_enacted" in check[1]


def test_budget_year_one_base_is_reconciled(pg_dsn):
    from govbudget.jbooks.reconcile import DESIGN_EXCLUDED_SCENARIOS

    assert "AllPriorYears" in DESIGN_EXCLUDED_SCENARIOS
    assert "BudgetYearOneBase" in scenario_map(2026)
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        # fixture BudgetYearOneBase=0.000, no control row -> zero-absent PASS
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='BudgetYearOneBase'"
        ).fetchone()
        unrec = con.execute(
            "select count(*) from budget_line_details where scenario='BudgetYearOneBase'"
            " and not superseded and not reconciled and pe_bli='0601101E'"
        ).fetchone()[0]
    assert check == (True,)
    assert unrec == 0


def test_gate_b_translates_document_org_aliases(pg_dsn):
    upsert_documents(pg_dsn, [{
        "org": "CHIPS", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "chips.pdf", "source_url": "https://example.test/chips.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        # control row lives under OSD, not CHIPS
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','OSD','0601101E','fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
    assert check == (True,)


def test_gate_b_consolidated_volume_matches_per_organization(pg_dsn):
    """A consolidated Defense-Wide volume (PB2018–PB2023 era) spans many
    workbook orgs. Gate B must match each PE against its own organization's
    control rows, not require organization == document org."""
    upsert_documents(pg_dsn, [{
        "org": "Defense_Wide", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "dw.pdf", "source_url": "https://example.test/dw.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        # the PE's control row lives under DARPA — not under 'DW'
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )
        # another org's row for a DIFFERENT amount must not blend into the sum
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DISA','0601101E','fy_2024_actuals',999999)",
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


def test_gate_b_consolidated_volume_no_match_still_fails(pg_dsn):
    upsert_documents(pg_dsn, [{
        "org": "Defense_Wide", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "dw.pdf", "source_url": "https://example.test/dw.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals',111111)",
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
    assert check == (False,)


def test_budget_year_one_matches_total_minus_recon(pg_dsn):
    # R-1 total carries a reconciliation-request slice the PB book excludes.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for amount_type, amt in (
            ("fy_2026_total", Decimal("661219")),
            ("fy_2026_reconciliation_request", Decimal("661219")),
        ):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA','0601101E',%s,%s)",
                (amount_type, amt),
            )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed, detail from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='BudgetYearOne'"
        ).fetchone()
    # fixture BudgetYearOne=0.000 == total(661.219) - recon(661.219)
    assert check[0] is True
    assert "minus_recon" in check[1]


def test_rereconcile_prunes_stale_open_queue_items(pg_dsn):
    # Seed ALL control rows that the fixture PEs need so a clean reconcile passes.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        # First-run: intentionally wrong PriorYear for 0601101E -> queue.
        # Other control rows cover 0601117E and CurrentYear scenarios so a
        # clean re-reconcile (after fixing the one wrong row) produces 0 failures.
        for pe, amount_type, amt in (
            ("0601101E", "fy_2024_actuals",    Decimal("999999")),   # wrong -> open
            ("0601101E", "fy_2025_total",       Decimal("293145")),
            ("0601117E", "fy_2024_actuals",     Decimal("55913")),
            ("0601117E", "fy_2025_total",       Decimal("89143")),
        ):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA',%s,%s,%s)",
                (pe, amount_type, amt),
            )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        before = con.execute(
            "select count(*) from review_queue where status='open'"
        ).fetchone()[0]
    assert before > 0  # 0601101E/PriorYear mismatch is open
    # fix the control, re-reconcile same run: stale open items must vanish
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "update budget_lines set amount_thousands=%s"
            " where pe_bli='0601101E' and amount_type='fy_2024_actuals'",
            (Decimal("280494"),),
        )
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        open_now = con.execute(
            "select count(*) from review_queue where status='open'"
        ).fetchone()[0]
        accepted_kept = con.execute(
            "select count(*) from review_queue where status='accepted'"
        ).fetchone()[0]
    assert open_now == 0
    assert accepted_kept == 0  # nothing was accepted in this test


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
