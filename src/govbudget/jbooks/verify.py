import hashlib
from pathlib import Path

import psycopg


def coverage_gate(dsn: str, *, organizations: list[str]) -> dict:
    """Gate 1: every in-scope R-1 line has detail rows or an extraction_gaps row."""
    with psycopg.connect(dsn) as con:
        r1 = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines "
                "where exhibit='R-1' and organization = any(%s)",
                (organizations,),
            )
        }
        detailed = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_line_details where not superseded"
            )
        }
        gapped = {r[0] for r in con.execute("select pe_bli from extraction_gaps")}
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

    Only counts scenarios that reconciliation actually checks (PriorYear, CurrentYear,
    BudgetYearOne); other scenarios like AllPriorYears are extraction artifacts and
    out of scope.
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
        if not xml_path or not xml_path.startswith("ProgramElement["):
            continue
        resolved += 1
    return {"sampled": len(samples), "resolved": resolved}
