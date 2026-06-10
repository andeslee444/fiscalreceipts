# Phase 3: Oversight Layer + Efficiency Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GAO high-risk + improper-payment data in the warehouse with provenance, linked to agencies/programs; efficiency marts v1; `verify-phase3` gates green.

**Recorded decisions (autonomous continuation):** (1) Improper payments ingested by scraping paymentaccuracy.gov — server-rendered HTML, no API/key (verified live: `/agencies-and-programs` is 385KB static HTML listing every program with per-program page links; homepage carries agency aggregates inline). (2) GAO high-risk list ingested from gao.gov/high-risk-list (HTML index of areas) with per-area URL provenance + a curated `agency_code` mapping column (curation recorded in the seed file; areas without an unambiguous agency get an explicit gap row per the gates). (3) Efficiency marts are deterministic SQL over existing facts: budget trajectory variance per PE, vendor-concentration HHI per program (crosswalk links × award dollars) and per sub-agency, improper-payment exposure per agency. (4) `award_id_piid` joins stg_contracts (null-cast in assistance, same position both files — order is load-bearing).

**Verified ground truth:** paymentaccuracy program URLs look like `/program/hhs-...-acf-head-start`; homepage shows agency cards (TREASURY 26.5%, SBA 12.3%, DOL 12.2%); program pages are server-rendered. Baseline: `uv run pytest -q` → 100 passed. Branch `govbudget-phase3`.

---

### Task 1: paymentaccuracy.gov scraper → improper_payments parquet

**Files:** Create `src/govbudget/oversight/__init__.py`, `src/govbudget/oversight/payment_accuracy.py`, `scripts/make_pa_fixture.py`, `tests/fixtures/oversight/pa_program_page.html` (committed, trimmed real page), `tests/oversight/__init__.py`, `tests/oversight/test_payment_accuracy.py`; modify `src/govbudget/cli.py`.

Contract:
- `discover_program_urls(client, index_url) -> list[str]` — parse `/agencies-and-programs` for `/program/...` hrefs (selectolax; absolute URLs; deduped).
- `parse_program_page(html, url) -> dict` — extract: program name, agency (name + abbreviation if present), and per-FY rows of {fiscal_year, improper_payment_rate_pct, improper_payment_amount, outlays} where the page provides them (the implementer RECONS the real page structure first — fetch one live program page, e.g. a CMS Medicare one, save the trimmed fixture via the script, parse against the fixture; golden values hand-read from the fixture). Provenance: source_url on every row.
- `scrape_payment_accuracy(client, *, out_path) -> Path` — index → all program pages → one parquet (all-varchar convention) with columns: program, agency_name, agency_code, fiscal_year, rate_pct, amount_usd, outlays_usd, source_url. Polite: no concurrency, reuse one client.
- CLI: `govbudget oversight scrape-pa` writing to `config.PARQUET_DIR / "oversight" / "improper_payments.parquet"`.
- TDD with the committed fixture; live smoke in Task 4 hits all (~100s of) program pages.

### Task 2: GAO high-risk list ingest

**Files:** Create `src/govbudget/oversight/high_risk.py`, `tests/fixtures/oversight/gao_high_risk.html` (trimmed real page via a fixture script or inline curl), `tests/oversight/test_high_risk.py`, `data-seeds/gao_high_risk_agency_map.csv` (committed curation: area_title, agency_code or empty, notes); modify `src/govbudget/cli.py`.

Contract:
- `parse_high_risk_index(html, url) -> list[dict]` — area title + area URL from gao.gov/high-risk-list.
- `build_high_risk(client, *, agency_map_csv, out_path) -> Path` — scrape index, left-join curated agency map, write parquet (area_title, area_url, agency_code, mapped: bool, source_url). Unmapped areas remain rows with mapped=false (the explicit gap the gate counts).
- Curate the map for at least the DoD-relevant + top-spend areas (DOD Weapon Systems Acquisition→DOD/097, DOD Financial Management→DOD, Medicare/Medicaid→HHS, Enforcement of Tax Laws→TREASURY, VA Health Care→VA, Unemployment Insurance→DOL, Federal Disaster Assistance→DHS/FEMA, NASA Acquisition Management→NASA, DOE Contract Management→DOE, ...) — every mapping row carries a `notes` justification. Target ≥80% mapped (gate 2).
- CLI: `govbudget oversight high-risk`.

### Task 3: Efficiency marts

**Files:** Create `dbt/models/marts/fct_budget_trajectory.sql`, `dbt/models/marts/fct_program_concentration.sql`, `dbt/models/marts/fct_agency_concentration.sql`, `dbt/models/marts/fct_improper_exposure.sql`; modify `dbt/models/sources.yml` (oversight parquet sources), `dbt/models/staging/stg_contracts.sql` + `stg_assistance.sql` (add `award_id_piid` — null-cast in assistance, SAME position both), `tests/test_dbt_build.py` (fixtures).

Mart contracts (full SQL authored by implementer, semantics fixed here):
- `fct_budget_trajectory`: per (pe_bli, org): fy2024 actuals, fy2025 total, fy2026 request (from stg_budget_lines pivot), absolute + pct change columns. Null-safe.
- `fct_program_concentration`: for crosswalked programs: join fct_budget_to_awards (high+medium) → award dollars (sum fct_award_transactions.obligation grouped by award_id_piid) → entity_xwalk family → HHI = sum over families of (100*share)^2, plus top_family, family_count. ONLY award-grain dollars (no link double-count: dollars enter once per award, families share via award→family).
- `fct_agency_concentration`: per awarding_sub_agency_name: HHI over recipient families, total obligation.
- `fct_improper_exposure`: per agency_code from improper_payments parquet: latest-FY rate, amount; joined where possible to awarding agency spend (DoD rows join 'Department of Defense' sub-agencies; mapping minimal + explicit).
- dbt tests: not_null on each mart's key.

### Task 4: verify-phase3 + live loop + merge

**Files:** Create `src/govbudget/verify_phase3.py`, `tests/test_verify_phase3.py`; modify `src/govbudget/cli.py`.

Gates (CLI `verify-phase3`, mirrors phase-gates doc):
1. `ingest_gate`: improper_payments parquet ≥ 50 programs with ≥1 FY row each, all rows carry source_url; high_risk parquet ≥ 30 areas, all with area_url.
2. `linkage_gate`: ≥80% of high-risk areas mapped to an agency_code; unmapped count reported (explicit, not silent).
3. `marts_gate`: dbt build green AND the four efficiency marts non-empty with sane invariants (HHI between 0 and 10000; trajectory rows ≥ 300; exposure has ≥ 10 agencies).
4. `trace_gate3`: for 2 mapped DoD high-risk areas: area → agency_code 097/DOD → ≥1 program in dim_programs → spend via fct_program_concentration → top family non-null. Both must trace.
THE LOOP: scrape live → build → verify-phase3; iterate on parser/mapping/marts until PASS; verify-phase1 --trace and verify-phase2 must stay green; full pytest green. Final opus review; merge + push.

## Self-Review Notes
- Gates ↔ phase-gates doc items 1-4 directly. LLM use: none needed (all server-rendered/deterministic) — consistent with standing constraints.
- Risk: paymentaccuracy program-page structure varies by program type → fixture-driven parser + loop handles; scraping ~200 pages politely ≈ minutes.
- award_id_piid staging addition keeps union order (guard comments in both files).
