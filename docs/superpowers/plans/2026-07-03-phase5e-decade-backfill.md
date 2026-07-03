# Phase 5E — Decade Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only; never
> weaken gates/evals — fix data instead; TDD; every new gate leg ships with recorded
> proof-it-can-fail in docs/superpowers/reviews/5c-gates-pre-failure.txt. Sequential
> execution only (shared duckdb warehouse + git index + site build). pgrep-quiet before
> builds. `.env` is gitignored — never print or commit its values.

**Goal:** Ingest PB2017–PB2025 defense-wide J-book editions (9 editions × ~37 books)
with full provenance; ship `fct_book_diff` + `fct_decade_series` marts; extend /years/
to ~12 edition-honest columns; refresh evals via the sanctioned mechanism.

**Spec:** `docs/superpowers/specs/2026-07-03-phase5e-decade-backfill-design.md`
(read it first — its honesty rules §2 are the acceptance bar).

**Architecture:** probe-per-edition → parameterized existing pipeline (discovery →
acquire → extract → parse → load → reconcile) run per edition, oldest-first, committing
per edition → new dbt marts → exporter extensions → G8 legs + verify-phase5e → visual
judging → deploy.

---

### Task 1: Edition parameterization (discovery + CLI + rollups)

**Files:** `src/govbudget/cli.py` (JBOOK_INDEX_URLS at :107, scrape command),
`src/govbudget/config.py` (JBOOK_FY), `src/govbudget/jbooks/registry.py` (no change
expected — verify), rollup loader call sites in cli.py (r1/p1 display per FY);
tests `tests/test_jbook_registry.py` (extend).

- [ ] Failing tests: `jbook_index_urls(2025)` returns the two Budget2025 URLs;
  `jbook_index_urls(2026)` matches today's constants; scrape command accepts
  `--fiscal-year` and threads it to `discover_documents(fiscal_year=fy)` and the
  rollup loader (r1_display/p1_display fetched from `Budget{fy}/`).
- [ ] Implement: replace the module-level `JBOOK_INDEX_URLS` constant with
  `jbook_index_urls(fy: int)`; CLI `--fiscal-year` (default `config.JBOOK_FY` so all
  existing invocations behave identically); rollup loader takes fy.
- [ ] pytest green; commit.

### Task 2: Year-relative SCENARIO_MAP (TDD)

**Files:** `src/govbudget/jbooks/reconcile.py` (SCENARIO_MAP at :11 + usage at :88),
`tests/test_reconcile.py` (extend).

- [ ] Failing tests: `scenario_map(2026)` == today's constant exactly (regression
  pin); `scenario_map(2025)` maps PriorYear→fy_2023_actuals,
  CurrentYear→fy_2024_total, BudgetYearOne→fy_2025_total; `scenario_map(2017)`
  maps PriorYear→fy_2015_actuals; unknown scenarios keep current fallback behavior.
- [ ] Implement `scenario_map(fiscal_year: int)`; `reconcile_document()` derives fy
  from the document row it already receives. No callers pass constants anymore.
- [ ] pytest green; commit.

### Task 3: verify-phase5e gate skeleton (built FIRST, failing)

**Files:** new `src/govbudget/verify_phase5e.py` + CLI wiring (mirror
verify_phase5b1 structure), `tests/test_verify_phase5e.py`.

- [ ] Gates, all designed to FAIL before data lands (record pre-failure output in
  docs/superpowers/reviews/5c-gates-pre-failure.txt under "verify-phase5e"):
  (a) **edition coverage** — for each edition in the target list [2017..2026]:
  documents discovered == acquired == parsed == loaded == reconciled, OR the edition
  appears in `data/research/edition_manifest.json` with a failure reason (manifest
  entries make the gate WARN-pass with the count printed, never silently);
  (b) **no-cross-edition-leakage** — sampled budget_lines join citations join
  documents: `budget_lines.fiscal_year == jbook_documents.fiscal_year` for 100%;
  (c) **book-diff conservation** — sampled fct_book_diff rows: delta == to − from
  recomputed from budget_lines;
  (d) **decade-series integrity** — `(pe_bli, fy, edition_year)` unique; sampled
  values recompute from the lake.
- [ ] Run now → FAIL legs a,c,d (only PB2026 loaded, marts absent). Record. Commit.

### Task 4: Per-edition probe + backfill loop (the long pole)

**Files:** new `src/govbudget/jbooks/edition_probe.py` (+test), new CLI subcommand
`govbudget jbooks backfill --fiscal-year N`; `data/research/edition_manifest.json`.

- [ ] Probe (TDD with recorded fixtures): for fy — index URLs reachable, discovery
  count in [30, 45], download ONE sample RDTE PDF to a temp path, extract_jbook_xml
  succeeds, parse_jbook_xml yields ProgramElements with `BudgetYear == fy`. Probe
  result (pass/fail + reason + counts) appended to edition_manifest.json.
- [ ] Backfill command: probe → if pass, run scrape/acquire/extract/parse/load/
  reconcile for that edition (existing pipeline, parameterized by Tasks 1–2);
  per-edition provenance_pages build for **amount** targets only (spec §3 defers
  old-edition narrative provenance — pass `target_kind='amount'` scope);
  incremental commit of state per edition.
- [ ] Execute oldest-first: 2017, 2018, … 2025. After each edition: spot-check
  rowcounts vs the edition's R-1/P-1 rollup reconciliation; update manifest.
  Editions failing probe are manifest-recorded and skipped (spec honesty rule 3 —
  surface, never silently skip; the /methodology/ note lands in Task 7).
- [ ] After all editions: verify-phase5e legs a+b PASS. Commit (data state files +
  manifest; parquet lake refresh via existing export-facts).

### Task 5: dbt marts — fct_book_diff + fct_decade_series (TDD via dbt tests)

**Files:** new `dbt/models/marts/fct_book_diff.sql`, new
`dbt/models/marts/fct_decade_series.sql`, `dbt/models/marts/schema.yml`.

- [ ] `fct_decade_series`: grain `(pe_bli, fy, edition_year)`; detail rows only
  (`title is not null` — the 5C rollup+detail double-count lesson applies to every
  edition); actuals from PriorYear, enacted from CurrentYear, request from
  BudgetYearOne, each with source fact_id. dbt tests: uniqueness, not_null,
  no-cross-edition-leakage (relationship test to documents), spot value pin
  (one known PE from PB2026 must equal today's trajectory value — regression).
- [ ] `fct_book_diff`: grain `(pe_bli, from_edition, to_edition, diff_kind)` with
  `diff_kind in ('request_vs_request','request_vs_actuals')` per spec §1; deltas
  computed in-model; dbt tests: accepted_values, conservation (delta == to − from),
  join completeness (every row's inputs exist in fct_decade_series).
- [ ] Mint derived facts + citations for diff rows through the existing derived-fact
  contract (`_verify_derived` recompute must pass); breakdowns emitted by the
  existing `_emit_breakdowns` once inputs carry fact_ids.
- [ ] dbt build + tests green; verify-phase5e legs c+d PASS. Commit.

**Binding requirements (adversarial review, 2026-07-03 — the Task 5 marts MUST
honor all three):**

1. **PB2019 OSD dual-volume dedup.** The PB2019 OSD RDT&E book ships as two
   BA-split volumes (Vol_3A BA1–3, Vol_3B BA4–7) that EACH embed the complete
   OSD MJB XML — the edition's jbook details carry identical (pe_bli, project,
   scenario, amount) tuple sets under BOTH documents (jbook_documents ids
   278/279 at time of review). Any Task 5 mart aggregating jbook details must
   dedupe by distinct tuple or prefer exactly one of the two documents —
   summing both silently doubles every PB2019 OSD figure.

2. **Era procurement is excluded from pe_bli-keyed cross-edition diff joins.**
   Era (PB2017–PB2023) procurement pe_bli are namespaced within-edition keys
   (`{account}-{org}-L{line}`, `jbooks/era_keys.py` — review Finding D): the
   underlying (account, org, line) identity is unstable across editions, and
   post-re-key the keys are disjoint from the modern BLI space and the R-1 PE
   space by construction (guarded by tests/jbooks/test_era_keys.py).
   `fct_book_diff` must therefore state RDT&E-only coverage for boundaries
   touching era editions, or use the namespaced keys strictly within one
   edition — never join era procurement rows across editions by pe_bli.

3. **The dim_programs/dim_pe_titles/export fences are superseded by
   edition-aware marts.** The `fiscal_year = 2026` fences (review Finding A:
   dim_programs.sql, dim_pe_titles.sql, and the export_site.py typed-export
   queries) exist because scenario names and the fy2024_*/PriorYear labels are
   edition-relative and those surfaces carry PB2026 semantics without an
   edition axis. Task 5's marts replace the fences with explicit
   `edition_year` grain — they must NOT widen the fences; the pinned
   regression is dbt/tests/assert_dim_programs_pb2026_pin.sql
   (0601101E fy2024_actual_millions = 280.494).

### Task 6: Exporter — years_matrix decade columns + decade sparklines

**Files:** `src/govbudget/export_site.py` (_emit_years_matrix + program sidecars),
`tests/test_export_years_matrix.py` (extend), `tests/test_export_site.py` (extend).

- [ ] Failing tests: matrix carries column set FY2015A…FY2024A + FY2025E + FY2026R
  with per-column `edition` field; a sampled FY2020A cell value+fid comes from the
  PB2022 edition; cells for PEs absent from an edition are null (never 0);
  payload < 2 MB raw; program sidecars gain `decade_series` (fy, v, fid, edition)
  arrays; cite-shards regenerate covering new fact_ids (shard-union test extends).
- [ ] Implement; run export-site; pytest green; commit.

### Task 7: Site — /years/ decade columns, edition legend, program trajectory, feed

**Files:** `site/src/components/years-matrix.tsx`, `site/src/app/years/page.tsx`
(coverage note), `site/src/lib/coverage.ts` + methodology anchor
`#coverage-editions` (edition rule + manifest-excused editions),
program-page trajectory component (find via `data-section="trajectory"`),
feed exporter surface for request-vs-actuals events (exporter side in
export_site.py), vitests alongside each.

- [ ] Failing vitests: column headers render edition tags; legend states the
  "actuals for FY N come from PB(N+2)" rule; null-edition cells render "–" with
  the not-in-edition tooltip; CSV export includes edition columns; sparkline
  renders gaps (not zeros) for missing editions.
- [ ] Implement; keep every cell through the existing `<Cite>`; motion tokens only.
- [ ] Update the /years/ CoverageNote wording (the 5D note promised "prior-edition
  backfill is on the roadmap" — now delivered; state the edition rule instead).
- [ ] vitest + tsc green; commit.

### Task 8: G8 edition legs + full gate loop

**Files:** `site/scripts/gates/yearsmatrix.mjs` (new legs), pre-failure record.

- [ ] New G8 legs (write first, run against pre-Task-7 build → FAIL, record):
  (a) recompute sampled cells for ≥3 new columns from the parquet lake;
  (b) edition-integrity — sampled cells' fids resolve to citations whose document
  fiscal_year equals the column's edition.
- [ ] Full suite: pytest, vitest, tsc, `npm run verify` (all 22 gates + new legs),
  verify-phase5b1 (its narrative sample must still pass), verify-phase5e all legs.
- [ ] Commit.

### Task 9: Eval refresh (sanctioned mechanism only)

**Files:** `evals/phase5_questions.yaml`, eval freshness machinery from 5B-4.

- [ ] Identify REFUSE-class questions now answerable (q041 class: cross-edition /
  historical requests). Re-baseline through the freshness gate mechanism — new
  expected answers must be produced by the grader-recompute path, never hand-typed.
  Add ≥3 new decade questions (a request-vs-actuals diff, an old-edition actual,
  an edition-gap honesty REFUSE that must STAY a REFUSE — e.g. service-book-only
  PE detail, proving the agent doesn't overreach).
- [ ] Run live eval; target: no regression on the 45, new questions pass; citation
  resolution 100%. Commit run artifact under data/research/eval-runs/.

### Task 10: Judging, deploy, close

- [ ] Screenshots: /years/ decade view (collapsed/expanded/filtered) at 390/768/1440
  + a program page decade sparkline with an edition gap → 3 opus judges (density
  vs CapIQ bar at 12 columns; edition-legend comprehension; honesty of gaps);
  median ≥4, ≤2 rounds.
- [ ] Deploy (known drill: fresh build with NEXT_PUBLIC_SITE_URL, out/.vercelignore
  `filing/`, out/.vercel/project.json, `vercel --prod --archive=tgz` from site/out).
- [ ] Live verification: an FY2018A cell citation opens the PB2020 book at the
  correct page in production; book-diff breakdown renders.
- [ ] ROADMAP 5E ledger row + findings; push origin main + subtree sync to
  github.com/andeslee444/fiscalreceipts.
