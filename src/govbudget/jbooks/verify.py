import hashlib
from pathlib import Path

import psycopg

from govbudget.jbooks.gaps import SENTINEL_PE


def coverage_gate(dsn: str, *, organizations: list[str]) -> dict:
    """Gate 1: every in-scope R-1 line has detail rows or an extraction_gaps row."""
    from govbudget.jbooks.orgs import doc_orgs_for, workbook_org

    workbook_orgs = sorted({workbook_org(o) for o in organizations})
    doc_orgs = sorted({d for w in workbook_orgs for d in doc_orgs_for(w)})

    with psycopg.connect(dsn) as con:
        r1 = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines "
                "where exhibit='R-1' and organization = any(%s) "
                "and pe_bli <> %s",
                (workbook_orgs, SENTINEL_PE),
            )
        }
        detailed = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_line_details where not superseded"
            )
        }
        gapped = {
            r[0]
            for r in con.execute(
                "select eg.pe_bli from extraction_gaps eg "
                "join jbook_documents j on j.id = eg.document_id "
                "where j.org = any(%s)",
                (doc_orgs,),
            )
        }
    covered = r1 & (detailed | gapped)
    missing = sorted(r1 - detailed - gapped)
    return {
        "r1_lines": len(r1),
        "covered": len(covered),
        "pct": round(100.0 * len(covered) / len(r1), 1) if r1 else 100.0,
        "missing": missing[:20],
    }


def accuracy_gate(dsn: str) -> dict:
    """Gate 2: no unreconciled live detail without an open/resolved queue trail.

    Only counts scenarios that reconciliation actually checks. The SQL below
    defines that by asking for a Gate B check row, which is the honest test:
    reconcile.py's Gate B loop skips any scenario `scenario_map()` has no
    candidate amount_type slugs for, so that function's KEYS are the checked
    set — PriorYear, CurrentYear, BudgetYearOne **and BudgetYearOneBase**.
    The complement is reconcile.DESIGN_EXCLUDED_SCENARIOS (AllPriorYears,
    BudgetYearOneOOC): no R-1 display analog, so never checked, so 100%
    unreconciled by construction rather than by failure.

    This docstring used to omit BudgetYearOneBase. It cost a real figure: a
    2026-08-27 review counted the site's genuine reconciliation failures from
    this sentence rather than from scenario_map() and reported 52 where the
    warehouse has 87 — 73 programs carry an unreconciled BudgetYearOneBase
    row, and Gate B does check them. Anything that needs the scope must read
    scenario_map(), never this paragraph.
    """
    with psycopg.connect(dsn) as con:
        silent = con.execute(
            """
            select count(*) from budget_line_details d
            where not d.superseded and not d.reconciled
              and not exists (
                select 1 from reconciliation_checks c
                join review_queue rq on rq.check_id = c.id
                where c.pe_bli = d.pe_bli and c.scenario = d.scenario
              )
              and exists (  -- only count scenarios we promise to reconcile (Gate B)
                select 1 from reconciliation_checks c2
                where c2.pe_bli = d.pe_bli and c2.scenario = d.scenario and c2.gate = 'B'
              )
            """
        ).fetchone()[0]
        open_items = con.execute(
            "select count(*) from review_queue where status='open'"
        ).fetchone()[0]
    return {"silent_unreconciled": silent, "open_review_items": open_items}


def provenance_gate(dsn: str, *, sample_size: int = 50) -> dict:
    """Gate 3: sampled live facts resolve to document file + sha + xml anchor."""
    resolved = 0
    with psycopg.connect(dsn) as con:
        samples = con.execute(
            """
            select d.pe_bli, d.xml_path, j.file_path, j.sha256
            from budget_line_details d
            join jbook_documents j on j.id = d.document_id
            where not d.superseded
            order by random() limit %s
            """,
            (sample_size,),
        ).fetchall()
    for pe_bli, xml_path, file_path, sha in samples:
        p = Path(file_path) if file_path else None
        if not p or not p.exists():
            continue
        if sha and hashlib.sha256(p.read_bytes()).hexdigest() != sha:
            continue
        if not xml_path or not xml_path.startswith(("ProgramElement[", "LineItem[")):
            continue
        resolved += 1
    return {"sampled": len(samples), "resolved": resolved}
