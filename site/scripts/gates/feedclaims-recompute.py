#!/usr/bin/env python3
"""feedclaims-recompute.py — gate 24 leg h helper (PM-review Sprint 3 Task 1b).

Answers, on stdout as JSON, the ONE question the gate cannot answer in Node:
for every program element, what budget figures does the CORPUS actually hold
for FY2025 and FY2026 — and, decisively, does it hold one AT ALL?

Recomputed INDEPENDENTLY from data/site/data/budget_lines.parquet — the raw
workbook grain, upstream of both fct_feed_events (which generated the claims
under test) and feed.json (which rendered them). Reading either of those here
would make the gate tautological.

WHY the present/absent distinction is the whole point. The defect this leg
closes shipped 87 feed cards reading "<program> zeroed out in FY2026 (had $0
in FY25)". Every one was false. The mart filtered `coalesce(fy2026_total,0)=0`,
turning "this PE has no FY2026 row" into "Congress zeroed this program".

A missing row is not a zero. rollup_loader.py skips blank workbook cells and
stores literal 0s, so the corpus faithfully mirrors DoD's own distinction —
visible inside a single file, data/raw_docs/fy2026/dod/:
  0601101E "Defense Research Sciences" (R-1) FY 2026 Total ''  <- BLANK
  E00700   "E-7"                        (P-1) FY 2026 Total 0   <- LITERAL 0
Hence `present` is reported separately from `value`: a claim of zeroing needs
positive evidence (present and value == 0), never inferred from absence.

Output (amounts in USD thousands, matching the workbook grain):
{
  "0601101E": {
    "fy2026_total":   {"present": false, "value": null},
    "fy2026_any":     {"present": false, "value": null},
    "fy2025_total":   {"present": true,  "value": 293145.0},
    "fy2025_enacted": {"present": true,  "value": 293145.0},
    "by_org": {"DARPA": {"fy2026_total": {...}, ...}}
  },
  ...
}

`by_org` (added for gate 24 leg i, PM-review Sprint 3 Task 2) reports the SAME
measures at the (pe_bli, organization) grain that fct_budget_trajectory pivots
on — which is the grain a yoy_swing feed card's dollar pair is stated at. On
the current corpus every yoy_swing PE is single-org, so the PE-level and
per-org figures coincide exactly; emitting both means the check stays exact if
a program element ever carries money under two organizations, instead of
comparing a per-org claim against a whole-PE sum.
"""

import json
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
PARQUET = REPO / "data" / "site" / "data" / "budget_lines.parquet"

# Rollup rows (title IS NULL) are R-1 subtotal lines; summing them alongside
# detail rows double-counts. fct_budget_trajectory applies the same filter and
# documents the hazard — this recompute mirrors it so the two are comparable.
DETAIL_ONLY = "title is not null"

# The PB2026 edition. fiscal_year on budget_lines is the BOOK EDITION year,
# not the year of the money — a trap worth naming, since summing amount_types
# within an edition multi-counts the same dollars across fiscal years.
EDITION = 2026

MEASURES = {
    "fy2026_total": "amount_type = 'fy_2026_total'",
    "fy2026_any": "amount_type like 'fy_2026%'",
    "fy2025_total": "amount_type = 'fy_2025_total'",
    "fy2025_enacted": "amount_type = 'fy_2025_enacted'",
}


def main() -> int:
    if not PARQUET.is_file():
        print(json.dumps({"__error__": f"missing {PARQUET}"}))
        return 1

    src = f"read_parquet('{PARQUET.as_posix()}')"
    out: dict[str, dict[str, dict]] = {}

    for name, predicate in MEASURES.items():
        # sum() over an empty group never happens here — GROUP BY only emits
        # groups that have rows, so every row returned is genuinely `present`.
        rows = duckdb.sql(
            f"select pe_bli, sum(amount_thousands) as v, count(*) as n"
            f" from {src}"
            f" where fiscal_year = {EDITION} and {DETAIL_ONLY} and {predicate}"
            f"   and pe_bli is not null"
            f" group by pe_bli"
        ).fetchall()
        for pe_bli, v, _n in rows:
            out.setdefault(pe_bli, {})[name] = {
                "present": True,
                "value": float(v) if v is not None else None,
            }

    # ---- (pe_bli, organization) grain -------------------------------------
    # The grain fct_budget_trajectory pivots on, and the grain a yoy_swing
    # card's dollar pair is stated at. Same predicates, one more GROUP BY key.
    for name, predicate in MEASURES.items():
        rows = duckdb.sql(
            f"select pe_bli, organization, sum(amount_thousands) as v"
            f" from {src}"
            f" where fiscal_year = {EDITION} and {DETAIL_ONLY} and {predicate}"
            f"   and pe_bli is not null and organization is not null"
            f" group by pe_bli, organization"
        ).fetchall()
        for pe_bli, org, v in rows:
            by_org = out.setdefault(pe_bli, {}).setdefault("by_org", {})
            by_org.setdefault(org, {})[name] = {
                "present": True,
                "value": float(v) if v is not None else None,
            }

    # Normalize: every PE carries every measure key, absent ones explicit.
    for pe in out.values():
        for name in MEASURES:
            pe.setdefault(name, {"present": False, "value": None})
        for org_measures in pe.get("by_org", {}).values():
            for name in MEASURES:
                org_measures.setdefault(name, {"present": False, "value": None})

    if not out:
        print(json.dumps({"__error__": "recompute produced no rows"}))
        return 1

    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
