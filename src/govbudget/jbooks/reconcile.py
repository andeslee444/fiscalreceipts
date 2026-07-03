from decimal import Decimal

import psycopg

TOLERANCE_M = Decimal("0.001")

def scenario_map(fiscal_year: int) -> dict[str, list[str]]:
    """XML scenario -> candidate R-1/P-1 amount_type slugs for one PB edition.

    Gate B passes if ANY candidate matches within tolerance (PB books split
    base/OOC/total differently per org, and the display-workbook column
    headers vary by edition). Scenario names are edition-relative: for
    edition year N, PriorYear=FY(N-2) actuals, CurrentYear=FY(N-1),
    BudgetYearOne=FY(N) total request, BudgetYearOneBase=FY(N) base/disc.

    Header-variant candidates are empirical, from the editions on disk
    (Phase 5E Task 4 live-run evidence):
      - PB2026: 'FY 2025 Total'/'FY 2025 Enacted', 'FY 2026 Total'/'FY 2026
        Disc Request' — the original slugs, kept first in original order.
      - PB2024: 'FY 2023 Total Enacted', 'FY 2023 Less Supplementals
        Enacted', 'FY 2024 Request'. (The supplementals-only column is
        intentionally NOT a CurrentYear candidate.)
      - PB2025: 'FY 2024 PB Request with CR Amounts*' (R-1) / '... with CR
        Adjustments Amount*' (P-1) — FY2024 ran under a continuing
        resolution when PB2025 published — plus 'FY 2025 Request'.
    Candidate slugs that don't exist in an edition's budget_lines never
    match, so each edition only ever reconciles against its own headers.
    """
    py, cy, by = fiscal_year - 2, fiscal_year - 1, fiscal_year
    return {
        "PriorYear": [f"fy_{py}_actuals"],
        "CurrentYear": [
            f"fy_{cy}_total", f"fy_{cy}_enacted", f"fy_{cy}_total_enacted",
            f"fy_{cy}_less_supplementals_enacted",
            f"fy_{cy}_pb_request_with_cr_amounts",
            f"fy_{cy}_pb_request_with_cr_adjustments",
        ],
        "BudgetYearOne": [f"fy_{by}_total", f"fy_{by}_disc_request", f"fy_{by}_request"],
        "BudgetYearOneBase": [f"fy_{by}_disc_request", f"fy_{by}_total", f"fy_{by}_request"],
    }

# Extracted but intentionally not reconciled: no R-1 display analog.
# Marts and the accuracy gate treat these as not-served-by-design,
# distinct from pending-review.
DESIGN_EXCLUDED_SCENARIOS = frozenset({"AllPriorYears", "BudgetYearOneOOC"})


def reconcile_document(dsn: str, *, document_id: int, extraction_run_id: int) -> dict:
    """Run Gates A and B for one document's live details. Returns counters."""
    passed = failed = queued = 0
    with psycopg.connect(dsn) as con:
        org, family, fy = con.execute(
            "select org, exhibit_family, fiscal_year from jbook_documents where id=%s",
            (document_id,),
        ).fetchone()
        # Re-reconciling replaces this document's verdicts: drop prior checks
        # and their UNRESOLVED queue items (resolved items keep their audit trail).
        con.execute(
            """
            delete from review_queue rq using reconciliation_checks c, extraction_runs r
            where rq.check_id = c.id and c.extraction_run_id = r.id
              and r.document_id = %s and rq.status = 'open'
            """,
            (document_id,),
        )
        con.execute(
            """
            delete from reconciliation_checks c using extraction_runs r
            where c.extraction_run_id = r.id and r.document_id = %s
              and not exists (select 1 from review_queue rq where rq.check_id = c.id)
            """,
            (document_id,),
        )
        from govbudget.jbooks.orgs import CONSOLIDATED_ORGS, workbook_org

        org = workbook_org(org)
        # Consolidated Defense-Wide volumes (PB2018–PB2023) span many workbook
        # orgs: their Gate B candidates are computed per organization instead
        # of pinned to the document org.
        consolidated = org in CONSOLIDATED_ORGS
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
        edition_map = scenario_map(fy)
        total_type = f"fy_{fy}_total"
        recon_type = f"fy_{fy}_reconciliation_request"
        for pe_bli, scenario, amount_m in pe_rows:
            candidates = edition_map.get(scenario)
            if not candidates:
                continue
            fetch_types = list(candidates) + [total_type, recon_type]
            if consolidated:
                rows = con.execute(
                    "select amount_type, organization, sum(amount_thousands) "
                    "from budget_lines "
                    "where pe_bli=%s and amount_type = any(%s) "
                    "and exhibit=%s and fiscal_year=%s "
                    "group by amount_type, organization",
                    (pe_bli, fetch_types, exhibit, fy),
                ).fetchall()
            else:
                rows = [
                    (t, org, v) for t, v in con.execute(
                        "select amount_type, sum(amount_thousands) from budget_lines "
                        "where pe_bli=%s and amount_type = any(%s) "
                        "and exhibit=%s and organization=%s and fiscal_year=%s "
                        "group by amount_type",
                        (pe_bli, fetch_types, exhibit, org, fy),
                    ).fetchall()
                ]
            control_orgs = sorted({o for _, o, _ in rows})
            by_type_org = {(t, o): v for t, o, v in rows}
            present = [
                (t, by_type_org[(t, o)] / Decimal(1000))  # R-1 $K -> $M
                for t in candidates
                for o in control_orgs
                if by_type_org.get((t, o)) is not None
            ]
            if scenario in ("BudgetYearOne", "BudgetYearOneBase"):
                for o in control_orgs:
                    total = by_type_org.get((total_type, o))
                    recon = by_type_org.get((recon_type, o))
                    if total is not None and recon is not None:
                        present.append((
                            f"fy_{fy}_total_minus_recon",
                            (total - recon) / Decimal(1000),
                        ))
            match = next(
                ((t, v) for t, v in present if abs(v - amount_m) <= TOLERANCE_M), None
            )
            if match:
                matched_type, expected = match
                ok = True
                detail = f"{exhibit} {matched_type}={expected}M vs XML {scenario}={amount_m}M"
            elif present:
                matched_type, expected = present[0]
                ok = False
                detail = f"{exhibit} {matched_type}={expected}M vs XML {scenario}={amount_m}M"
            elif amount_m == 0:
                # The R-1 display omits empty cells; an absent control row is
                # semantically zero. Only an explicit zero may match it.
                expected = None
                ok = True
                detail = f"absent {exhibit} cell == XML {scenario}=0.000 (zero-absent rule)"
            else:
                expected = None
                ok = False
                detail = f"no R-1 row for {pe_bli} ({exhibit}/{org}/fy{fy}) in {candidates}"
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
