# Phase 4: State/Local Pilot Implementation Plan (California)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** California pilot — budget + checkbook + ACFR acquired with provenance, budget lines reconciled against published totals, and one genuine cross-jurisdiction cost-per-capita comparable (CA vs CT) — `verify-phase4` gates green.

**Recorded decisions (autonomous continuation):** (1) Pilot state = **California**: ebudget.ca.gov publishes budget data machine-readably; Open Fi$Cal (Socrata) is the checkbook; the ACFR PDF is acquired-with-sha (its extraction is NOT required for the gates — gate 2's reconciliation runs on the machine-readable budget data against its own published totals; ACFR extraction is the Phase-4.5/Tier-1 follow-on). (2) Cross-jurisdiction comparable = department/category spend per capita, CA vs **Connecticut** (CT OpenCheckbook on data.ct.gov Socrata), populations from the US Census state population estimates API (keyless at this volume). (3) No new Postgres tables: state artifacts live in `data/raw_docs/state/{ca,ct}/` + the existing manifest (sha provenance), facts in parquet + dbt marts; failures surface through `verify-phase4`, not a review queue (deterministic structured sources). (4) All ingestion deterministic — still no LLM required; recon-first pattern as in Phase 3.

**Conventions:** as prior phases. Baseline: `uv run pytest -q` → 152 passed. Branch `govbudget-phase4`.

---

### Task 1: California ingestion (budget + checkbook + ACFR provenance)

**Files:** Create `src/govbudget/states/__init__.py`, `src/govbudget/states/california.py`, fixture script + committed fixtures under `tests/fixtures/states/`, `tests/states/__init__.py`, `tests/states/test_california.py`; modify `src/govbudget/cli.py` (new `states` subparser: `acquire-ca`).

Contract (RECON FIRST, like Phase 3 — find the real download URLs/dataset IDs before coding):
- **Budget:** locate ebudget.ca.gov's machine-readable budget download (Excel/CSV of line items or program/department-level amounts for the current budget year; historical if cheap). Parse → `data/parquet/states/ca_budget.parquet` (all-varchar; columns at the natural grain found — department/program/fund/amount/fy + source_url). Record published control totals present in the same artifact (statewide/department totals) for gate 2.
- **Checkbook:** Open Fi$Cal Socrata API — find the expenditure dataset id; pull an AGGREGATE slice (per department/category/year totals via SoQL `$select=...sum(...)&$group=...`, NOT the raw 10M-row feed) → `ca_checkbook_agg.parquet` with source_url including the SoQL query (provenance = reproducible query).
- **ACFR:** locate California's latest ACFR PDF (sco.ca.gov), download via Phase-0 `download_file` to `data/raw_docs/state/ca/`, manifest-record (sha) — registered + acquired is the gate-1 requirement.
- Tests: fixture-driven parser tests with golden values hand-read from fixtures; no live calls in pytest.

### Task 2: Connecticut comparable slice + Census populations

**Files:** Create `src/govbudget/states/connecticut.py`, `src/govbudget/states/population.py`, tests + fixtures; modify CLI (`states acquire-ct`, `states population`).

Contract:
- **CT checkbook:** data.ct.gov Socrata — find the OpenCheckbook/expenditures dataset; aggregate per department/category/year via SoQL → `ct_checkbook_agg.parquet` (same column shape as CA agg: jurisdiction, department, category, fiscal_year, amount_usd, source_url).
- **Population:** Census Bureau population estimates API (keyless) → `state_population.parquet` (state, year, population, source_url). CA + CT minimum.

### Task 3: Marts + verify-phase4 + THE LOOP

**Files:** Create `dbt/models/marts/fct_state_budget.sql`, `fct_state_spend.sql`, `fct_state_per_capita.sql`, `src/govbudget/verify_phase4.py`, `tests/test_verify_phase4.py`; modify sources.yml, CLI, `tests/test_dbt_build.py` fixtures.

Mart contracts:
- `fct_state_budget`: typed CA budget lines (try_cast amounts) + a control-total reconciliation column set (line sums vs published totals per department where the artifact carries both).
- `fct_state_spend`: union CA+CT checkbook aggregates, jurisdiction-tagged.
- `fct_state_per_capita`: spend joined to population per (jurisdiction, category/department, year): amount_per_capita. ≥1 category present for BOTH CA and CT in the same year = the comparable.

Gates (`verify-phase4`):
1. `provenance_gate4`: CA budget parquet + checkbook aggs (CA, CT) + population parquet all exist with source_url on every row; ACFR present in manifest with sha + file on disk.
2. `reconcile_gate4`: CA budget line sums match the artifact's own published totals within 0.5% for ≥95% of departments that carry totals (loud list of failures).
3. `comparable_gate4`: ≥1 (category, year) where both CA and CT have per-capita figures; values positive; provenance resolvable on each input row.
THE LOOP: acquire-ca / acquire-ct / population / build / verify-phase4 until PASS; phase 1-3 verifies + pytest stay green. Final opus review; merge + push.

## Self-Review Notes
- Gates ↔ phase-gates doc items 1–3 (item 1's "registered/acquired with sha" satisfied via manifest; ACFR extraction explicitly deferred — recorded).
- Comparable is genuinely cross-jurisdiction (two states, same category/year, per-capita normalized, fully cited).
- Risk: dataset IDs/URLs unknown until recon — contract-style plan + loop handles, as proven in Phase 3.
