# Phase 5D — Budget-Over-Time Matrix ("Years" view)

**Date:** 2026-07-02
**Status:** Approved (user directive: "the money needs to be easier to track year over
year… similar to how S&P Capital IQ has built their interface for public companies but
a table view for program lists (as rows) and years (as columns). categorized with
sub programs")
**Depends on:** backlog fleet completion (462 program pages, dim_pe_titles); Phase 5C
gates; citation infrastructure.

## 1. What we're building

A Capital-IQ-financials-style dense grid at **`/years/`** (nav label **Years**):

- **Rows:** every program element (all 462), grouped under collapsible **organization
  sections** (DARPA, MDA, Navy…), each program expandable to its **project-level
  sub-rows** (R-2 Projects / P-40 line detail — the J-book's own sub-program grain).
- **Columns:** fiscal years. From the FY2026 President's Budget book we have:
  FY2024 Actuals · FY2025 Enacted · FY2025 Total · FY2026 Request · FY2026 Total,
  plus computed **Δ FY25→26** and **%Δ** columns. Default visible set: FY24A, FY25T,
  FY26T, Δ, %Δ; a column picker exposes the full amount-type set.
- **Every dollar cell is a real `<Cite>`** — program-row amounts carry their existing
  workbook fact_ids, project sub-row amounts their jbook_pdf fact_ids, Δ cells their
  derived trajectory fact_ids. Clicking any cell opens the citation panel exactly like
  everywhere else (the receipt contract is the product).
- **CapIQ interface conventions:** sticky header row + sticky first column; indent
  hierarchy with expand carets; right-aligned mono numerals in a single stated unit
  (USD millions); red/green deltas; sort by any column; instant text filter
  (program/PE/org); zebra rows; compact density; client-side **CSV export** of the
  current view; units/coverage note always visible.

## 2. Data mapping (all existing — no new ingestion)

| Table concept | Source |
|---|---|
| Program rows + FY columns | `fct_budget_lines` detail rows (`title IS NOT NULL` — the rollup+detail dedup lesson), pivoted by `amount_type`; titles via `dim_pe_titles` |
| Project sub-rows | `jbook_details` project rows; scenario→year map: PriorYear=FY2024, CurrentYear=FY2025, BudgetYear=FY2026 |
| Δ / %Δ | `fct_budget_trajectory` (fy2526_change / fy2526_pct_change + their derived fact_ids) |
| Org sections | `organization`; top-50 category tags shown as chips (categories.json) |
| Cell citations | existing citations.parquet fact_ids (workbook / jbook_pdf / derived) |

**Honesty constraints:** one book edition means the year columns all come from the
FY2026 PB — a permanent coverage note states this ("Columns from the FY2026
President's Budget edition; prior-edition backfill is on the roadmap" — links
methodology; wording adapts if the PB2025 spike returns GO). Programs missing a value
render "–" (never 0). No CAGR/derived metrics beyond the already-cited trajectory
deltas (nothing uncited gets computed in the UI).

## 3. Architecture

- **Exporter:** new sidecar `data/site/json/years_matrix.json` — nested
  org → programs → projects with per-cell `{v, fid}` pairs (value + fact_id), built
  from the same queries as the marts (recompute-verified). Size budget ≤ 900 KB raw
  (fetched lazily by the client on /years/ load, like the search index).
- **Lazy citation resolution (new, reusable):** the page has ~20k potential fact_ids —
  far beyond the embedded-slice mechanism. Exporter emits **sharded citation slices**
  `data/site/json/cite-shards/{fact_id[:2]}.json` (256 shards, ~230 facts each). The
  citation panel context gains a fetch-on-miss path: fact not in the embedded slice →
  fetch its shard → cache. Existing pages keep embedded slices (zero regression);
  the panel behavior is identical after resolution, including degraded fallback.
- **Page:** `/years/` — server shell + client table island. 462 collapsed rows render
  directly (no virtualization needed until expansion; expanded projects render
  per-program on demand). Sticky via CSS `position: sticky` (header + first column).
  Motion tokens for expand/collapse; `prefers-reduced-motion` respected.
- **Nav:** header gains **Years** (linkgraph gate picks it up automatically).

## 4. Verification (evaluator-first, house rules)

- **G8 `yearsmatrix` gate (new, built FIRST, proof-can-fail):**
  (a) integrity — recompute ≥30 sampled cells (programs and projects, every column
  type) from the parquet lake and compare to the rendered payload byte-for-canonical;
  (b) citation contract — sampled cells carry resolvable fact_ids per the three-state
  Cite rules; Δ cells resolve to derived citations whose formula recomputes;
  (c) UX mechanics via Playwright — sticky header/column at 1440 & 390, sort
  correctness on two columns, expand shows project rows, filter narrows, CSV export
  produces parseable rows matching the view;
  (d) shard integrity — every fact_id in years_matrix.json resolves in its shard.
- **Existing suite:** all 19 gates green (linkgraph covers nav reachability; motion
  gate covers new animation; render-static covers the Cite contract on the new page).
- **Visual judging:** 3 opus judges, added scenario screenshots (collapsed, expanded,
  filtered, mobile) — dimension focus: data-density legibility (CapIQ bar), V1/V2
  inheritance. Median ≥ 4.
- **Live verification:** browser pass on production — click three cells across kinds
  (workbook/jbook_pdf/derived), confirm panel opens with correct source each time.

## 5. Non-goals

- Additional book editions (PB2025 backfill is its own decision post-spike).
- Award/outlay year columns mixed into the same grid (budget intent only; awards
  remain on program pages — mixing appropriation years with obligation years in one
  row invites false comparisons).
- Saved views/watchlists (paid-layer).
- Server-side anything (static + client island, as everywhere).
