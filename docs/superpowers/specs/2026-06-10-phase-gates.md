# Phase Gates — Mechanical Goals Through Phase 5

**Date:** 2026-06-10 · **Status:** Approved (user directive: continue all phases to 5;
test suite per phase; loop until each phase's goals are satisfied)

**Loop protocol (every phase):** design decisions recorded → implementation plan →
subagent-driven execution with per-task review → live smoke on real data →
`verify-phaseN` (the phase's goal test) runs in a fix → re-verify loop until PASS →
final whole-implementation review → merge to main + push. pytest suite must stay green
throughout; every gate is a CLI command an operator can re-run.

## Phase 1C — Budget→Spend Connection (current)

`govbudget verify-phase1 --orgs <all> --trace` must report:
1. Gates 1–3 (coverage/accuracy/provenance) PASS across all defense-wide orgs (existing).
2. **Gate 6 trace:** for 5 top-funded DARPA PEs: budget_line → reconciled details →
   ≥1 crosswalk link (confidence-tagged) → ≥1 award transaction in DuckDB → recipient
   name; every hop non-empty, provenance resolvable. 5/5 required.
3. Marts: `dbt build` green with `fct_budget_lines`, `dim_programs`,
   `fct_budget_to_awards` views over exported Parquet.
4. Recon-request scenario: BudgetYearOne/Base reconcile against
   `fy_2026_total − fy_2026_reconciliation_request` derived candidates; the
   "public-book value differs" triage class shrinks accordingly on re-reconcile.
- Descoped from Phase 1 with evidence: Tier-1 LLM fallback eval (gate 5) — all 34
  FY2026 defense-wide books embed XML; the fallback has no target corpus. Revisit if
  any future book lacks attachments.

## Phase 2 — Beneficiary Graph

`govbudget verify-phase2`:
1. SAM entity registry loaded (UEI, legal name, parent UEI/name).
2. ≥95% of the top-1000 recipients by total obligation resolve to a canonical entity
   (UEI direct or Splink match ≥ threshold), each link confidence-scored.
3. Known multi-UEI families merge: Boeing and Huntington Ingalls UEIs share one
   canonical parent in `dim_entities` (golden assertions).
4. Geography: ≥99% of transactions with a place-of-performance state resolve to
   state+congressional-district dims.
5. pytest golden corpus for the resolver (hand-verified matches + non-matches).

## Phase 3 — Oversight Layer + Efficiency Metrics v1

`govbudget verify-phase3`:
1. GAO high-risk list + improper-payment estimates ingested with provenance
   (report id/page or API source).
2. ≥80% of high-risk areas linked to ≥1 program/agency in the warehouse;
   unlinked ones carry explicit gap rows.
3. Efficiency marts build green: budget-vs-actual variance per PE, vendor
   concentration (HHI) per program/agency, improper-payment exposure per agency.
4. Trace test: high-risk area → linked programs → spend → top recipients.

## Phase 4 — State/Local Pilot (one state)

`govbudget verify-phase4`:
1. Pilot state's budget + ACFR + checkbook documents registered/acquired with sha
   provenance (state TBD at phase brainstorm; default candidate: a state with an
   open-checkbook API).
2. Extracted budget lines reconcile against published totals (Gate A/B analogs);
   failures queue-visible; coverage gate ≥95% of fund-level lines.
3. ≥1 cross-jurisdiction cost-per-outcome comparable computed end-to-end with
   provenance (e.g., spend per student or per capita by city/county).

## Phase 5 — Product Surface

`govbudget verify-phase5` (E2E suite):
1. Next.js dashboard renders program/recipient/efficiency views from the marts.
2. Analyst agent answers a fixed eval set of NL questions via text-to-SQL over the
   semantic layer; every numeric answer carries citations that resolve (doc sha +
   page/xml-path or table+filter lineage). ≥90% of eval questions correct vs
   hand-computed answers; 100% of served numbers cited.
3. Public scorecard pages build statically from marts; no unreconciled/unscored
   number rendered without its flag.

## Standing constraints

- Accuracy ethos unchanged: nothing served silently; provenance per number; loud
  failure beats silent gap.
- LLM usage: extraction only where deterministic paths fail (Phase 4 PDFs are the
  first real Tier-1 target); text-to-SQL in Phase 5; Batch API; evals before trust.
- Each phase merges only when its verify gate and the full pytest suite are green.
