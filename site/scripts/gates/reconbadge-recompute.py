#!/usr/bin/env python3
"""reconbadge-recompute.py — gate 23 leg (k) helper (tri-persona review Wave 2).

Answers, on stdout as JSON, the one question the basis gate cannot answer in
Node: for each program element, WHICH reconciliation verdict does the
warehouse actually support?

The defect this exists to catch was not a wrong number. `dim_programs`
computed `fully_reconciled = bool_and(reconciled)` across every J-book detail
scenario, including `AllPriorYears` — a cumulative to-date element with no
R-1/P-1 display column, which `govbudget.jbooks.reconcile` therefore never
issues a Gate A/B check for. Its rows keep `reconciled=false` forever (0 of
3,267 in the shipped PB2026 corpus), so the site's "Partial Reconciliation"
badge landed on 1,310 programs with zero in-scope failures and on 87 with a
real one, in identical wording.

SCOPE IS TAKEN FROM THE PIPELINE, NEVER RETYPED HERE. `reconcile.py`'s Gate B
loop is `candidates = edition_map.get(scenario); if not candidates: continue`,
so `scenario_map(fy).keys()` IS the checked set by construction. This helper
imports that function. dim_programs' own SQL carries a literal list instead
(dbt cannot import Python), which is exactly why this gate must not read
dim_programs: comparing the mart against a copy of the mart's own rule is how
a wrong scope ships past three checks that all agree with each other.
`tests/test_dim_programs_inscope_scope.py` closes the other direction.

Reads `stg_budget_details` — the SAME staging table dim_programs reads, one
step upstream of the column under test. Deduplication is not needed:
`bool_and` is idempotent, so the mart's distinct-tuple dedup cannot change a
bool_and verdict.

Output:
{
  "edition": 2026,
  "in_scope_scenarios": ["BudgetYearOne", ...],
  "excluded_scenarios": ["AllPriorYears", "BudgetYearOneOOC"],
  "scenario_rows": {"AllPriorYears": {"rows": 3267, "reconciled": 0}, ...},
  "verdicts": {"<pe_bli>": "reconciled" | "partial"},   # in-scope rows exist
  "no_detail": ["<pe_bli>", ...],                       # rows, none in scope
  "counts": {"reconciled": N, "partial": N, "no_detail": N,
             "all_scenario_pass": N}                    # the OLD predicate
}
"""

import json
import sys

import duckdb

from govbudget.config import ROOT
from govbudget.jbooks.reconcile import DESIGN_EXCLUDED_SCENARIOS, scenario_map

# The PB2026 edition fence dim_programs itself applies (see its model-level
# comment: scenario names are edition-RELATIVE, so a PB2026-semantic column
# must filter fiscal_year = 2026).
EDITION = 2026

DUCKDB = ROOT / "data" / "duckdb" / "govbudget.duckdb"


def main() -> int:
    if not DUCKDB.exists():
        print(json.dumps({"__error__": f"warehouse missing at {DUCKDB}"}))
        return 0
    in_scope = sorted(scenario_map(EDITION))
    excluded = sorted(DESIGN_EXCLUDED_SCENARIOS)
    try:
        con = duckdb.connect(str(DUCKDB), read_only=True)
    except Exception as e:  # pragma: no cover - environment failure
        print(json.dumps({"__error__": f"cannot open warehouse: {e}"}))
        return 0

    try:
        scenario_rows = {
            s: {"rows": int(n), "reconciled": int(r)}
            for s, n, r in con.execute(
                "select scenario, count(*), sum(case when reconciled then 1 else 0 end)"
                " from stg_budget_details where fiscal_year = ? group by 1",
                [EDITION],
            ).fetchall()
        }
        rows = con.execute(
            """
            select pe_bli,
                   count(*) filter (where scenario = any(?)) as n_in_scope,
                   bool_and(reconciled) filter (where scenario = any(?)) as in_scope_ok,
                   bool_and(reconciled) as all_scenario_ok
            from stg_budget_details
            where fiscal_year = ?
            group by pe_bli
            """,
            [in_scope, in_scope, EDITION],
        ).fetchall()
    finally:
        con.close()

    verdicts: dict[str, str] = {}
    no_detail: list[str] = []
    all_pass = 0
    for pe_bli, n_in_scope, in_scope_ok, all_scenario_ok in rows:
        if all_scenario_ok:
            all_pass += 1
        if not n_in_scope:
            no_detail.append(pe_bli)
            continue
        verdicts[pe_bli] = "reconciled" if in_scope_ok else "partial"

    counts = {
        "reconciled": sum(1 for v in verdicts.values() if v == "reconciled"),
        "partial": sum(1 for v in verdicts.values() if v == "partial"),
        "no_detail": len(no_detail),
        "all_scenario_pass": all_pass,
    }
    json.dump(
        {
            "edition": EDITION,
            "in_scope_scenarios": in_scope,
            "excluded_scenarios": excluded,
            "scenario_rows": scenario_rows,
            "verdicts": verdicts,
            "no_detail": sorted(no_detail),
            "counts": counts,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
