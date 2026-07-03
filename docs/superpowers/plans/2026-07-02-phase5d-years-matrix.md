# Phase 5D — Years Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DO NOT START until the backlog fleet's ship stage has landed** (repo quiet, all 19
> gates green on main). Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"`
> + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only;
> never weaken gates; TDD; every gate ships with recorded proof-it-can-fail.

**Goal:** `/years/` — CapIQ-style budget matrix: 462 program rows × fiscal-year columns,
org sections, expandable project sub-rows, every cell a live citation.

**Architecture:** exporter emits `years_matrix.json` (nested org→program→project cells
`{v, fid}`) + sharded citation slices `cite-shards/{fact_id[:2]}.json`; client table
island with sticky header/column, sort/filter/expand/CSV; citation panel gains
fetch-on-miss shard resolution. New G8 gate built first, failing.

**Spec:** `docs/superpowers/specs/2026-07-02-phase5d-years-matrix-design.md`

---

### Task 1: Exporter — years_matrix.json + citation shards (TDD)

**Files:** `src/govbudget/export_site.py` (+`tests/test_export_years_matrix.py`)

- [ ] Failing tests first: (a) matrix sidecar exists with org→programs→projects nesting;
  (b) a known program's FY24 cell equals the fct_budget_lines detail-row value with its
  workbook fact_id; (c) a known project cell equals its jbook_details row + jbook_pdf
  fact_id; (d) Δ cells carry trajectory derived fact_ids; (e) missing values are null,
  never 0; (f) every fid in the matrix exists in exactly the right shard file;
  (g) shard union == set of fids referenced (no orphans, no misses); (h) payload
  < 900 KB raw.
- [ ] Implement `_emit_years_matrix()` + `_emit_cite_shards()` (shards cover ALL
  citations, keyed by fact_id[:2] — 256 files; reuse the citation-row serializer the
  embedded slices use so the panel schema is identical).
- [ ] `uv run python -m govbudget export-site` → verify outputs; pytest green; commit.

### Task 2: G8 yearsmatrix gate (failing before the page exists)

**Files:** `site/scripts/gates/yearsmatrix.mjs`, register in `site/scripts/verify.mjs`

- [ ] Implement per spec §4: cell-integrity recompute vs parquet (read via duckdb CLI or
  a small python helper invoked from the gate — match how other gates recompute; if none
  do, recompute against the JSON sidecars the exporter tests already verified and note
  the trust chain), citation-contract sampling, Playwright UX legs (sticky/sort/expand/
  filter/CSV), shard-resolution leg. Missing page ⇒ FAIL (that is the pre-implementation
  proof-can-fail — record output in docs/superpowers/reviews/5c-gates-pre-failure.txt
  under "G8 yearsmatrix").
- [ ] Commit.

### Task 3: Lazy citation shards in the panel

**Files:** `site/src/components/citation-panel/` context/provider, `site/src/lib/citations.ts`
(+vitest)

- [ ] Failing vitest: fact-id miss triggers exactly one shard fetch (`{assetBase}? no —
  shards are small JSON, serve from /json/cite-shards/ same-origin`), result cached,
  second lookup no fetch; fetch failure ⇒ panel degraded state (existing pattern).
- [ ] Implement fetch-on-miss in the panel resolution path; keep embedded-slice fast
  path untouched (zero behavior change on existing pages — assert via existing tests).
- [ ] vitest + tsc green; commit.

### Task 3b: Derived breakdown tables — exporter + panel (spec §3b)

**Files:** `src/govbudget/export_site.py` (+`tests/test_export_breakdowns.py`),
`site/src/components/citation-panel/derived-card` (find the actual derived card file),
new `site/src/components/citation-panel/breakdown-table.tsx` (+vitest)

- [ ] Failing exporter tests: breakdowns/{fact_id}.json exists for every derived fact
  with ≥2 inputs; rows carry {label, pe_bli, v, fid}; sum(v) equals recorded_value
  canonically; uncited inputs present with fid:null + uncited:true (100% of the sum
  accounted for); labels resolve via dim_pe_titles where pe_bli-keyed.
- [ ] Implement `_emit_breakdowns()`; re-run export-site; pytest green; commit.
- [ ] Failing vitest: derived card shows "View all N line items →" when a breakdown
  exists; small sets (≤5) render inline table; large sets open the overlay (reuse the
  PDF zoom overlay dialog pattern — focus trap, Esc); sum row equals the derived
  figure; row Cite click drills panel to that input with a Back affordance; CSV
  export button produces rows matching the table; uncited rows show the ⁂ state.
- [ ] Implement breakdown-table.tsx + derived-card wiring (lazy-fetch the breakdown
  JSON on demand; motion tokens; reduced-motion). vitest + tsc green; commit.

### Task 4: /years/ page + table island

**Files:** `site/src/app/years/page.tsx`, `site/src/components/years-matrix.tsx`,
`site/src/app/layout.tsx` (+ mobile-nav) nav link, coverage note entry
(`site/src/lib/coverage.ts` + methodology anchor `#coverage-years-matrix`)

- [ ] Server shell: title, unit statement ("All figures USD millions"), CoverageNote
  (single-edition honesty per spec §2), loads nothing heavy server-side.
- [ ] Client island: lazy-fetch years_matrix.json; render org sections (collapsible,
  section subtotal row cited via existing agency derived fact where available, else
  no subtotal — never mint uncited sums client-side); program rows with expand carets
  → project sub-rows (indented); columns per spec with column-picker; sort (stable,
  numeric, missing-last); text filter (program/PE/org, ≤50ms on 462 rows); Δ coloring
  (green/red, colorblind-safe pairing with sign glyphs); CSV export of current view
  (client blob, same pattern as explorer). Sticky header + first column (test at 390).
  Cells render through the EXISTING `<Cite>` (state A with factId; "–" plain-text for
  null — no data-amount on empty cells). Motion tokens only; reduced-motion collapses.
- [ ] Nav: header "Years" after Districts; mirror mobile-nav.
- [ ] Rebuild; run G8 → PASS all legs; linkgraph/coverage/motion/render-static/answerfold/
  a11y gates → PASS; vitest + tsc. Commit.

### Task 5: Judging, ship

- [ ] Screenshots: /years/ collapsed + expanded + filtered at 390/768/1440 → 3 opus
  judges (data-density legibility vs the CapIQ bar; honesty; citation affordance);
  median ≥4, ≤2 rounds then fix.
- [ ] Full suite: pytest, vitest, tsc, npm run verify (all 20 gates incl. G8).
- [ ] Deploy (known drill: fresh build with NEXT_PUBLIC_SITE_URL, out/.vercelignore +
  project.json, `vercel --prod --archive=tgz`); live browser pass: three cell-kinds'
  citations open correctly on production.
- [ ] ROADMAP ledger row + findings; push origin main + standalone subtree sync
  (github.com/andeslee444/fiscalreceipts).
