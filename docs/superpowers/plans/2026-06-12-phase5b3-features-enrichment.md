# Phase 5B-3: Features + Enrichment Implementation Plan (rev 2 — post adversarial review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feature surface grows (anomaly feed, district lens, /filing pages, follow-the-dollar, GAO overlays, top-50 dossiers + category animations, OG share cards) while three citation tiers land (derived, USAspending, state), shrinking `uncited_datasets` with a MECHANICAL enforcement path. Gated by extended 5B-1/5B-2 suites + verify-phase5b3 + dossier cited-or-absent gate + visual r3.

**RECON ARTIFACTS (committed, binding):** `docs/superpowers/specs/2026-06-12-phase5b3-recon-artifacts.md` — every task below that says "recon §X" means that file. Implementers reuse its SQL/snippets verbatim.

**Plan-level decisions (recorded; Task 10 writes them to ROADMAP):**
1. District lens v1 = sortable table + state filter over the 106 linkable districts (DARPA-crosswalk scope, disclaimer banner). The spec's choropleth + full-district coverage are deferred to the crosswalk-extension backlog item — reversible decision, flagged for user visibility in the phase summary.
2. Genealogy timeline + program-page district footprint map: DEFERRED (timeline needs design work composing existing data — backlog with sketch; footprint blocked on crosswalk breadth). GAO/improper overlays ARE in scope (Task 6b — small and cited).
3. /filing OG cards: one shared static default image (4,258 satori renders not justified for noindex-heavy thin pages). public/og/ is gitignored, generated in prebuild.
4. Search alias table (spec §6) IS in scope: curated+cited rows authored with the category taxonomy (Task 7a), wired into quick search + eval.
5. dim_geography totals on district pages stay state C (flagged) until the geography mart backlog lands; district_gate requires citations only on program-linked dollars.
6. Batch cost: estimator per recon §G; proceed if estimate ≤$50, else orchestrator confirmation checkpoint. ANTHROPIC_API_KEY absent → Task 7b live run blocks loudly (mocked tests still pass); surface to user.

**Evaluator design (extends 5B-2; ROADMAP framework):**
- **Ledger enforcement (kills the vacuousness found in review):** `<Cite>` gains `data-dataset={dataset}` on ALL states; render-static.mjs reads `site_meta.uncited_datasets` and FAILS any state-C span whose dataset is NOT on the ledger (i.e. flipped datasets may no longer render ⁂) AND any state-A span whose dataset IS on the ledger. Lands in the SAME commit as Task 3's flips.
- verify-phase5b1 extends at its THREE per-kind sites (recon §I) for kinds `derived` (recompute formula over inputs, 0.001 tolerance), `usaspending` (endpoint allowlisted + query_body parses + recorded_value present; no network), `state_soql`/`state_file` (URL shape + captured value + retrieved_at).
- verify-phase5b3 gates: feed_gate (≥30 cards / ≥3 types, all figures cited, junk pe_bli absent, "why" links); district_gate (106 pages; program-linked dollars cited via usaspending-derived rows + disclaimer present; geography totals may be C); filing_gate (4,258 pages; zero-mention pages have noindex; canonical to human LDA URL; amounts state A via filing-level lda citations); dossier_gate (Python: all 50 pe_blis ∈ dim_programs pre-batch; zero unresolved claims; ≥80% warehouse-cited CORPUS-WIDE; recent_developments may be empty; category rows for all 50 whose source_url is a cached snapshot whose text supports the assignment); og_gate (PNG exists for program/company/agency/core; 10 sampled decode 1200×630 AND pass a non-background-pixel-ratio floor ≥5% — catches blank/tofu satori output); animation_gate (top-50 pages: hero present, CSS-only — chunk-set referenced by animated pages == chunk-set of non-animated program pages within the SAME build; emitted CSS contains prefers-reduced-motion; flow SVG present on all 17 crosswalked pages with node dollars matching flows sidecar); search_gate += alias cases ('drones'→a loitering-munitions PE page, 'JSF'→F-35-related if present in data — author achievable cases from the alias table).
- visual r3: states += {feed, district, dossier-hero program, follow-the-dollar program, filing} ×3 viewports + 3 OG PNGs included as judge inputs; 3 judges, medians ≥4, no Blockers.

---

### Task 1: New dbt marts + staging permalink columns
**Files:** dbt/models/marts/{fct_feed_events,fct_district_programs,fct_family_obligations_by_year}.sql + schema.yml; dbt/models/staging/{stg_contracts,stg_assistance}.sql; tests/test_dbt_build.py.
Use recon §A/§B SQL verbatim (junk filter, coalesce-zeroed, shares-CTE HHI w/ $5M floor, $1M entrant floor; district mart = high-confidence dollar grain + optional breadth grain with mapped_via_account flag and NO dollar column). Staging: add `usaspending_permalink` + alias `contract_award_unique_key`/`assistance_award_unique_key` → `award_unique_key` at the SAME position in BOTH files (recon §D; update the column-order comments). `uv run python -m govbudget build` green; row counts ≈ recon (267 district / 365,457 family-year / feed ≥150). Commit.

### Task 2a: Derived citation tier (Python)
**Files:** src/govbudget/export_site.py, src/govbudget/verify_phase5b1.py, tests.
`fact_id_derived(surface, key, metric)` beside the canonical identity fns. citations.parquet schema += `formula varchar, inputs varchar (JSON array), query_body varchar, recorded_value varchar` (nullable). Emit derived rows for RENDERED surfaces only: trajectory figures (inputs = budget_lines fact_ids joined via (pe_bli, workbook_org(org), amount_type) — recon §I warns naive joins miss), program FY25/FY26 headlines, agency sums, HHI (formula states positive-only-shares rule), improper (formula = outlays×rate, inputs = paymentaccuracy source_url), per-capita (inputs = spend_source_url + pop_source_url), entity total_obligation + fct_influence dollars (inputs = constituent filing API URLs). Extend verify_phase5b1 at ALL THREE sites (recon §I) with `derived` (recompute from inputs where inputs are fact_ids; tolerance 0.001). TDD; live re-export deferred to 2c. Commit.

### Task 2b: USAspending tier + sidecars (Python)
**Files:** export_site.py, verify_phase5b1.py, tests; data/research/usaspending_recipient_ids.json (COMMITTED cache).
Kind `usaspending`: durable artifact = {endpoint, query_body} per recon §E; hash permalink minted at export when network available (cached too); recipient profile ids via POST api/v2/recipient/ — deterministic parent-UEI rule (recon §E), skip-if-cached, network-fail → emit citation WITHOUT the profile link (never fail export). family→parent-UEI sidecar from entity_xwalk. Filing-level amounts: `fact_id_lda(filing_uuid, '__filing__', 'income'|'expenses')` rows (kind lda_filing, official_url = filing API URL) so /filing pages render state A. flows sidecar: data/site/json/flows/{pe_bli}.json for the 17 crosswalked programs (top-N awards: piid, recipient family slug, district, dollars, confidence='high' only). verify branch + tests. Commit.

### Task 2c: State tiers + ledger flip + live re-export
**Files:** export_site.py, states/connecticut.py (build_soql_url select/where overrides), verify_phase5b1.py, tests.
CT per recon §F ($select=sum + $where with IN-list from state_category_map seed; pins captured value + retrieved_at). CA pointer tier (state_file kind). Update `_CITED_DATASETS` (+fct_budget_trajectory, dim_programs, fct_program_concentration, fct_improper_exposure, fct_state_per_capita, dim_entities, fct_influence, feed/district marts). Live: `export-site` → `verify-phase5b1` PASS with 7+ kinds sampled. Commit.

### Task 3: Site type ripple + flips + ledger gate (ONE commit)
**Files:** site/src/lib/{data,citations}.ts, citation-panel/{derived-card,usaspending-card,state-card}.tsx + dispatch, cite.tsx (`data-dataset` attr all states), render-static.mjs (ledger enforcement per evaluator design), flip call sites (trajectory/home movers//programs index/agency sums/company obligations+influence/HHI/per-capita), vitest. Derived card: formula + input chips that open their own citations (fact inputs) or link (url inputs). Commit.

### Task 4: /feed
Feed sidecar + /feed/ page (cards grouped by type: headline, cited figure, program link, "why am I seeing this" methodology anchor) + home teaser strip + search quick-index entry. Commit.

### Task 5: /district lens
District sidecars (index + 106 pages from the high grain; optional breadth list flagged mapped-via-account, no dollars) + /district/ index (sortable table, state filter, honest coverage line "17 of 326 programs currently linkable — DARPA crosswalk") + /district/[id] pages (programs, recipients, cited dollars via usaspending-derived rows, disclaimer banner; geography totals state C). Commit.

### Task 6a: /filing pages
Filing sidecars (lda_filings ⋈ activities ⋈ lobbyists, 4,258) + /filing/[uuid] SSG: client/registrant/year/period, income+expenses state A (2b's filing-level citations), activities w/ issue codes, lobbyists w/ covered-position + revolving-door badge, mentions → program links, noindex meta when zero mentions, canonical → human LDA URL, shared default OG. Build ≈4,800 pages. Commit.

### Task 6b: Follow-the-dollar + GAO overlays
Follow-the-dollar: compositor-only animated SVG flow (appropriation→PE→award→recipient family→district) on the 17 crosswalked program pages, built at SSG from flows/{pe_bli}.json, reduced-motion static fallback, node values = sidecar dollars. GAO overlays: /agency pages gain high-risk areas (data-seeds/gao_high_risk_agency_map.csv via a small sidecar) + improper-exposure figures (state A via derived tier); program pages gain a compact agency-risk badge linking to the agency overlay. Commit.

### Task 7a: Research fetcher + taxonomy + aliases (Python)
**Files:** src/govbudget/dossiers/{__init__,research}.py; data-seeds/program_categories.csv; data-seeds/search_aliases.csv; CLI `dossiers fetch`; pyproject +anthropic.
RSS pull (recon §I sources; honest UA, robots, ≤1 req/s/host) + keyword match (program titles + alias terms) → snapshots data/research/snapshots/ {url, retrieved_at, sha256, text}. AUTHOR program_categories.csv for the top-50 (recon §C selection): category ∈ {drones, hypersonics, space, shipbuilding, cyber, default} + rationale + source_url that MUST be a cached snapshot (or a J-book narrative xml_path) whose text supports the assignment; 'default' = static flow motif (no animation claim). AUTHOR search_aliases.csv (term, target_url, source_url, note) — achievable, cited aliases only. Wire aliases into search_quick emission (export_site) + 5 new search_eval cases. TDD (mock HTTP). Commit.

### Task 7b: Batch pipeline (Python)
**Files:** src/govbudget/dossiers/{batch,gate}.py; CLI `dossiers {submit|collect|gate}`.
Per recon §G verbatim: bundle trimming (narratives full, top-25 mentions/awards, trajectory, feed events; ≤40k tokens), count_tokens estimator + per-dossier log, ≤$50 proceed / else checkpoint; submit/poll/collect; raw results archived to data/research/dossiers-raw/ (COMMITTED — paid artifacts re-collectable without re-paying) + final JSON to data/site/json/dossiers/. gate per evaluator design. TDD mocked; ONE live smoke (2 programs) before the full 50. If ANTHROPIC_API_KEY missing: implement + mock-test, mark live run blocked, report. Commit.

### Task 8a: Dossier rendering + animations
Program pages: dossier sections (gated dossiers only; every claim renders its citation as chip — fact chips open panel, url chips link snapshot + live source); category hero animations per recon §H (CSS/SVG compositor-only, reduced-motion, `<desc>` rule); non-top-50 keep current layout. Commit.

### Task 8b: OG share cards
scripts/generate-og.mjs (satori+resvg, vendored Inter font; spike opengraph-image.tsx once first, fall back fast) for program/company/agency/core pages in prebuild; public/og/ gitignored; meta wiring; shared default for filings. Commit.

### Task 9: verify-phase5b3 assembly
gates/{feed,district,filing,og,animation}.mjs + verify.mjs ordering; Python verify-phase5b3 (runs dossier gate + shells npm verify); search_eval += feed/district/filing/alias cases; screenshots.mjs += 5 states + OG samples. Commit.

### Task 10: THE LOOP + merge + ROADMAP
export-site → build (~4,800 pages) → verify-phase5b1 (7+ kinds) → 5b2 → 5b3 → fix loops; live dossier batch (cost-logged, checkpoint if >$50); visual r3 (3 judges); regression (phases 1..5b2 + pytest + vitest); final opus review; merge+push; ROADMAP update (ledger, findings, backlog: choropleth+geography mart, crosswalk extension, CA file+sha, alias re-pull, genealogy timeline sketch, district footprint, per-dataset stamps, filing OG upgrade).

## Self-Review Notes (rev 2)
All 25 review findings incorporated: recon artifacts committed + referenced (B1), top-50 scoped to dim_programs w/ pre-batch assertion (B2), ledger enforcement mechanism specified and co-committed with flips (B3/vacuousness), fct_influence in tier scope (contradiction), CT SoQL fully specified, filing-amount citations resolved (sentinel fact_id_lda), OG scope reconciled + content check, flows sidecar owned by 2b, zero-snapshot dossiers valid (warehouse-only), district gate deadlock resolved (decision 5), task splits (2a/2b/2c, 6a/6b, 7a/7b, 8a/8b), real permalink columns, parent-UEI rule, three verify extension sites enumerated, cost estimator numbers + confirm-above semantics, dossiers persisted to tracked dir, animation gate mechanism (same-build chunk sets), category-assignment protocol, 80% corpus-wide, GAO overlays added, genealogy/footprint recorded deferrals, alias table owned (7a).
