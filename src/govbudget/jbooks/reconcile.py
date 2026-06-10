from decimal import Decimal

import psycopg

TOLERANCE_M = Decimal("0.001")

# XML scenario -> candidate R-1 amount_type slugs, in preference order.
# PB books label FY relative to the budget year (BudgetYear=2026 =>
# PriorYear=FY2024 actuals, CurrentYear=FY2025, BudgetYearOne=FY2026).
SCENARIO_MAP: dict[str, list[str]] = {
    "PriorYear": ["fy_2024_actuals"],
    "CurrentYear": ["fy_2025_total", "fy_2025_enacted"],
    "BudgetYearOne": ["fy_2026_disc_request", "fy_2026_total"],
}


def reconcile_document(dsn: str, *, document_id: int, extraction_run_id: int) -> dict:
    """Run Gates A and B for one document's live details. Returns counters."""
    passed = failed = queued = 0
    with psycopg.connect(dsn) as con:
        org, family, fy = con.execute(
            "select org, exhibit_family, fiscal_year from jbook_documents where id=%s",
            (document_id,),
        ).fetchone()
        exhibit = {"rdte": "R-1", "procurement": "P-1"}.get(family)
        # ---------- Gate A: project rows sum to the PE-level amount ----------
        gate_a_rows = con.execute(
            """
            with pe as (
              select pe_bli, scenario, amount_millions from budget_line_details
              where document_id=%s and not superseded and project_number is null
            ), proj as (
              select pe_bli, scenario, sum(amount_millions) total, count(*) n
              from budget_line_details
              where document_id=%s and not superseded and project_number is not null
              group by pe_bli, scenario
            )
            select pe.pe_bli, pe.scenario, pe.amount_millions, proj.total
            from pe join proj using (pe_bli, scenario)
            """,
            (document_id, document_id),
        ).fetchall()
        for pe_bli, scenario, pe_amount, proj_total in gate_a_rows:
            ok = abs(pe_amount - proj_total) <= TOLERANCE_M
            check_id = _record(con, extraction_run_id, "A", pe_bli, scenario,
                               pe_amount, proj_total, ok,
                               f"sum(projects)={proj_total} vs PE={pe_amount}")
            passed, failed, queued = _tally(con, check_id, ok, passed, failed, queued)
            if not ok:
                _unreconcile(con, document_id, pe_bli, scenario)

        # ---------- Gate B: PE-level amount matches R-1 control rows ----------
        # Split-funded PEs have one R-1 row per budget activity: sum them.
        pe_rows = con.execute(
            "select pe_bli, scenario, amount_millions from budget_line_details "
            "where document_id=%s and not superseded and project_number is null",
            (document_id,),
        ).fetchall()
        for pe_bli, scenario, amount_m in pe_rows:
            candidates = SCENARIO_MAP.get(scenario)
            if not candidates:
                continue
            row = con.execute(
                "select amount_type, sum(amount_thousands) from budget_lines "
                "where pe_bli=%s and amount_type = any(%s) "
                "and exhibit=%s and organization=%s and fiscal_year=%s "
                "group by amount_type",
                (pe_bli, candidates, exhibit, org, fy),
            ).fetchall()
            by_type = {t: v for t, v in row}
            expected = None
            matched_type = None
            for t in candidates:
                if t in by_type and by_type[t] is not None:
                    expected = by_type[t] / Decimal(1000)  # R-1 $K -> $M
                    matched_type = t
                    break
            ok = expected is not None and abs(expected - amount_m) <= TOLERANCE_M
            detail = (
                f"R-1 {matched_type}={expected}M vs XML {scenario}={amount_m}M"
                if expected is not None
                else f"no R-1 row for {pe_bli} ({exhibit}/{org}/fy{fy}) in {candidates}"
            )
            check_id = _record(con, extraction_run_id, "B", pe_bli, scenario,
                               expected, amount_m, ok, detail)
            passed, failed, queued = _tally(con, check_id, ok, passed, failed, queued)
            if ok:
                con.execute(
                    "update budget_line_details set reconciled=true "
                    "where document_id=%s and pe_bli=%s and scenario=%s and not superseded "
                    "and not exists (select 1 from reconciliation_checks c "
                    "  where c.extraction_run_id=%s and c.pe_bli=%s and c.scenario=%s "
                    "  and not c.passed)",
                    (document_id, pe_bli, scenario, extraction_run_id, pe_bli, scenario),
                )
            else:
                _unreconcile(con, document_id, pe_bli, scenario)
    return {"passed": passed, "failed": failed, "queued": queued}


def _record(con, run_id, gate, pe_bli, scenario, expected, actual, ok, detail) -> int:
    return con.execute(
        "insert into reconciliation_checks (extraction_run_id, gate, pe_bli, scenario,"
        " expected, actual, passed, detail) values (%s,%s,%s,%s,%s,%s,%s,%s) returning id",
        (run_id, gate, pe_bli, scenario, expected, actual, ok, detail),
    ).fetchone()[0]


def _tally(con, check_id, ok, passed, failed, queued):
    if ok:
        return passed + 1, failed, queued
    con.execute("insert into review_queue (check_id) values (%s)", (check_id,))
    return passed, failed + 1, queued + 1


def _unreconcile(con, document_id, pe_bli, scenario):
    con.execute(
        "update budget_line_details set reconciled=false "
        "where document_id=%s and pe_bli=%s and scenario=%s and not superseded",
        (document_id, pe_bli, scenario),
    )
