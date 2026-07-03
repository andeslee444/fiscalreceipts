# Phase 5E — Decade Backfill: PB2017–PB2025 J-book Editions

**Date:** 2026-07-03
**Status:** Approved (user: "I thought all the budget books over the past decade
were pulled" → "yes please plan 5e if go, agree with your recommendation";
feasibility spike 2026-07-02-pb2025-backfill-feasibility.md returned GO)
**Sequenced:** after 5H. Defense-wide (4th-estate) editions only — service J-books
are Phase 5G, a separate GO/NO-GO.

## 1. What we're building

Ingest the **PB2017 through PB2025 President's Budget defense-wide J-book
editions** (9 editions × ~37 books each) alongside the existing PB2026 edition,
with full provenance, and surface them as:

- **/years/ matrix extension:** actuals columns FY2015–FY2024 (each from its
  authoritative edition — actuals for FY N are reported in the PB(N+2) book's
  `PriorYear` scenario), plus the existing FY2025 enacted and FY2026 request
  columns ≈ **12 default year columns**. Column picker gains an edition axis.
- **`fct_book_diff` mart (the new product):** same `pe_bli` compared across
  editions. Two diff kinds, both cited:
  - *request-vs-request* — PB(N) `BudgetYearOne` vs PB(N+1) `BudgetYearOne`
    (what changed between asks);
  - *request-vs-actuals* — PB(N) `BudgetYearOne` request for FY N vs PB(N+2)
    `PriorYear` actuals for FY N (what was asked vs what was eventually
    reported spent — the accountability diff).
- **Program-page trajectory extension:** sparklines/trajectory sections gain the
  decade series where the PE exists in older editions.
- **Eval refresh:** questions previously REFUSEd for "only PB2026 is loaded"
  (q041 class) become answerable; refreshed only through the sanctioned
  eval-refresh mechanism (freshness gate re-baseline — never hand-edit answers).

## 2. Non-negotiable honesty rules

1. **Never merge editions silently.** Every fact row, matrix cell, diff row, and
   citation carries its `edition_year`. A rendered cell's fact must resolve to a
   citation whose source document's `fiscal_year` equals the column's stated
   edition (gate-enforced).
2. **Editions are parallel worlds, not corrections.** PB2026's FY2024 actuals and
   PB2025's FY2024 enacted may disagree; both are kept, labeled by edition. The
   site never averages or "reconciles" across editions.
3. **Per-edition probe before load.** Older editions may deviate (URL layout,
   file naming, .zzz convention, XML schema drift pre-jb-2009-confirmation).
   Each edition passes a probe (discovery count sane, sample PDF extracts, XML
   parses, BudgetYear self-describes) before its loader runs. Editions that fail
   probe are recorded in an **edition coverage manifest** with the failure
   reason and surfaced on /methodology/ — an honest gap, never a silent skip.
4. **PE identity across editions is by `pe_bli` string only.** No fuzzy matching
   of renamed/renumbered programs (a wrong lineage is worse than a gap). PEs
   that appear/disappear across editions render as series gaps with a
   "not in the PB20XX edition" note.

## 3. Data & pipeline design

| Component | Change |
|---|---|
| Discovery | `jbook_index_urls(fy)` — parameterize the two comptroller index URLs by fiscal year (spike-confirmed pattern `Budget{fy}/` + `FY{fy}BudgetJustification/`); CLI gains `--fiscal-year` |
| Acquisition/extraction/parsers | Zero changes expected (spike: .zzz + jb-2009 schema identical for PB2025; probe validates per older edition) |
| Reconciliation | `SCENARIO_MAP` becomes year-relative: `PriorYear → fy_{fy-2}_actuals`, `CurrentYear → fy_{fy-1}_total`, `BudgetYearOne → fy_{fy}_total`; per-edition rollup reconciliation against that edition's `r1_display.xlsx`/`p1_display.xlsx` (present at each `Budget{fy}/` page) |
| Warehouse | No schema migration — `jbook_documents.fiscal_year` + `budget_lines.fiscal_year` already disambiguate editions; all marts gain explicit `edition_year` grain where they aggregate |
| New mart | `fct_book_diff` — grain `(pe_bli, from_edition, to_edition, diff_kind)`; dbt tests: join completeness, no cross-edition leakage, derived deltas recompute |
| Trajectory | `fct_budget_trajectory` stays PB2026-scoped (its semantics are "current edition"); a new `fct_decade_series` mart provides `(pe_bli, fy, amount, edition_year, fact_id)` for the matrix/sparklines |
| Provenance | provenance_pages + narrative provenance run per new book (~333 PDFs, ~1.5–2 GB, disk fine); amounts only for old editions in v1 — **old-edition narratives are parsed but narrative paragraph provenance is deferred** (cost control; the citation falls back to the xml-anchor card, same honest pattern as unresolved 5F paragraphs) |
| Facts/citations | Same minting contract; every new amount gets a fact_id + page-resolved citation; cite-shards regenerate (256 shard files absorb the new volume by design) |

## 4. Site surfaces

- **/years/**: default columns = FY2015A…FY2024A (edition-authoritative actuals),
  FY2025 enacted, FY2026 request. Legend states the edition rule in one line
  ("actuals for FY N come from the PB(N+2) book"). Column picker exposes
  per-edition alternates (e.g. FY2024 enacted per PB2025 vs FY2024 actuals per
  PB2026). Coverage note updated; CSV export carries edition columns.
- **Program pages**: trajectory section extends to the decade series with
  edition-gap honesty; book-diff highlights ("request cut $X between PB2024 and
  PB2025") join the answer strip only where cited.
- **/feed/**: new event kind — largest request-vs-actuals gaps (cited, linked to
  book-diff breakdowns).
- **Breakdowns**: diff facts get show-your-work tables (the two input rows +
  editions) via the existing 5D mechanism.

## 5. Verification (evaluator-first, house rules)

- **G8 yearsmatrix extensions (existing gate, new legs):** (a) recompute sampled
  cells for every new column from the parquet lake; (b) **edition-integrity
  leg** — sampled cells' citations resolve to documents whose `fiscal_year`
  equals the column's edition; proof-can-fail recorded.
- **New verify-phase5e CLI gates:** per-edition coverage (discovered == acquired
  == parsed == loaded == reconciled, or manifest-excused with reason);
  book-diff conservation (deltas recompute from inputs); decade-series
  no-cross-edition-leakage; eval freshness re-baseline passes.
- **dbt tests:** fct_book_diff join completeness; fct_decade_series unique
  `(pe_bli, fy, edition_year)`.
- **Visual judging:** /years/ at 12 columns (390/768/1440) — density vs the
  CapIQ bar at decade width; edition legend comprehension; a program page with
  a decade sparkline including an edition gap.
- **Live verification:** matrix cell from an old edition opens its citation to
  the correct old book page in production.

## 6. Risks

- **Pre-2019 comptroller pages may deviate** (site reorganizations). Probe
  handles: worst case an edition lands in the coverage manifest as blocked with
  a manual-download path noted (same pattern as the 5G AF CAC blocker).
- **Runtime:** ~333 books through extraction + provenance is the long pole
  (estimated hours of pdfplumber work). Loader batches per edition and commits
  incrementally so a crash resumes at edition granularity.
- **Matrix payload growth:** years_matrix.json grows with ~7 more columns ×
  existing rows; budget raised from 900 KB to 2 MB raw with the same lazy-fetch
  pattern; re-measure at export.
- **4 unclassifiable files per edition** (same classes as FY2026) stay skipped;
  noted in the manifest.

## 7. Non-goals

- Service (Army/Navy/AF) J-books — Phase 5G.
- Narrative paragraph provenance for pre-2026 editions (deferred; xml-anchor
  citations still present).
- Cross-edition PE lineage inference (renames/renumbers) — explicit non-goal in
  v1; a curated lineage table is a future backlog candidate.
- Outlay/execution data (SAG/O&M) — out of scope entirely.
