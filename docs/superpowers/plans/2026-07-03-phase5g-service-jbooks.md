# Phase 5G — Service J-books Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> task-by-task. Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"` +
> trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only;
> never weaken gates/evals; TDD; new gate legs ship with recorded proof-can-fail
> (docs/superpowers/reviews/5c-gates-pre-failure.txt). Sequential execution (shared
> warehouse/git/site build). NEVER print or commit .env. The ANTHROPIC_API_KEY is
> capped until 2026-08-01 — nothing in this plan may invoke it (no live eval, no
> dossiers); eval expected-answer re-baselines use the mechanical grader-recompute
> path only.

**Goal:** FY2026 Navy + Army J-books ingested end-to-end; up to 543 service PEs
upgraded to full-tier pages; AF manual drop-dir ready; all gates green.

**Spec:** docs/superpowers/specs/2026-07-03-phase5g-service-jbooks-design.md

---

### Task 1: Playwright probe — inventories + sample books (evidence first)

**Files:** new `src/govbudget/jbooks/service_fetch.py` (probe functions only),
new `scripts/probe_service_jbooks.py`, evidence to
`docs/superpowers/reviews/5g-probe/` (inventories + sample-extraction proof).
Playwright for Python is NOT currently a repo dep — check pyproject; if absent add
`playwright` + `uv run playwright install chromium` (dev-time dep; document).

- [ ] Implement `fetch_index_inventory(service) -> list[(text, href)]` (headless
  Chromium, real UA, wait for network idle) for Navy
  (`https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx` — the FY2026 page
  may be a child link; follow to the actual book listing) and Army
  (`https://www.asafm.army.mil/Budget-Materials/` FY2026 section).
- [ ] Run live: write full inventories to the evidence dir. If a WAF blocks
  headless Chromium, record the exact failure and STOP (report; no stealth
  escalation without a human decision).
- [ ] Download ONE RDT&E sample per service to /tmp; run extract_jbook_xml +
  parse_jbook_xml; record `.zzz` presence, schema namespace, PE count,
  BudgetYear==2026 in the evidence file.
- [ ] TDD the pure functions (URL/inventory parsing) with recorded HTML fixtures;
  live probe is a script, not a test. Commit.

### Task 2: Classifier + org aliases from real inventories (TDD)

**Files:** `src/govbudget/jbooks/registry.py` (service naming), `orgs.py`,
tests/jbooks/test_registry.py (+fixtures embedding the real inventories).

- [ ] From the Task 1 inventories: extend classification for service filenames
  (token rule extensions / EVIDENCE_PATHS entries as needed); byte-identity
  regression for defense-wide FY2025/FY2026 + era fixtures must stay green.
- [ ] Org aliases: doc_org → `N` / `A` workbook codes; loud failure on unknowns.
- [ ] Exclusions (overview volumes, exhibit summaries) recorded per the 5E
  manifest exclusions mechanism. Commit.

### Task 3: Acquisition adapter + backfill wiring

**Files:** `service_fetch.py` (download path), `src/govbudget/cli.py`
(`jbooks backfill --fiscal-year 2026 --service navy|army` or equivalent —
follow the existing backfill command's shape), edition_manifest `service_2026`
section, tests.

- [ ] Playwright per-file download with sha256/size verification, 2–4s throttle,
  resume-safe (skip already-downloaded shas), acquisition='playwright' recorded.
- [ ] `ingest-local` command for the AF drop-dir (acquisition='manual', operator
  source URL required) — TDD; document in LAUNCH.md.
- [ ] Probe→acquire→extract→parse→load→reconcile sequencing reuses the existing
  pipeline actions. Commit before live runs.

### Task 4: Live ingestion — Navy, then Army (long pole)

- [ ] Run Navy end-to-end (tee logs; per-service manifest entry with doc/line/
  detail/recon counts). Sanity: every document with detail facts has recon checks
  (the 5E doc-level lesson — check ALL docs, not edition aggregates).
- [ ] Amounts + narrative provenance for the new books (large PDFs — expect a
  long pdfplumber pass; per-book progress logging).
- [ ] Same for Army. Per-service commits of tracked state.
- [ ] Lake refresh (export-facts). verify-phase1 PASS (silent_unreconciled=0),
  verify-phase5e 4/4+new leg, verify-phase5b1 PASS. Scan-only books (if any):
  extraction_gaps + manifest reasons, PEs stay rollup-tier.

### Task 5: Exporter + site ripple

- [ ] export-site re-run; verify tier flips (rollup→full counts), program-skeleton
  universe recount, years-matrix/decade-series 2026 growth, cite-shards regen,
  5F rollup wording now names ONLY the AF gap (+ any scan-only stragglers);
  /methodology/ coverage section updated (Navy/Army ingested; AF manual path).
- [ ] Eval count-pins that drifted: re-baseline expected answers via grader
  recompute ONLY (no live run — API capped; note deferral alongside backlog #22).
- [ ] Full site rebuild + 22-gate suite green; pytest/vitest/tsc green. Commit.

### Task 6: Judging, deploy, close

- [ ] Evidence pack: one upgraded Navy page + one Army page (desktop+mobile,
  citation panel open on a narrative + an amount) + RUBRIC.md; 3 opus judges
  (5F full-tier bar); median ≥4, ≤2 rounds.
- [ ] Deploy (known drill), live verification (upgraded page renders narratives
  with working PDF citations in production).
- [ ] ROADMAP 5G ledger row + findings + backlog updates; push origin + subtree
  sync to fiscalreceipts standalone.
