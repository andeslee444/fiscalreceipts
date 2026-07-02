# GovBudget Roadmap — Source of Truth

**Updated:** 2026-06-12 · Living document: phase ledger, findings log, improvement
backlog, and the evaluator framework. Every phase loop ends by updating this file.

## Phase ledger

| Phase | Goal (source of truth) | Gate | Status | Live numbers |
|---|---|---|---|---|
| 0 | Federal backbone (USAspending archives → parquet → dbt) | dbt build + smoke | ✅ merged | contracts/assistance/subawards FY2017–2026 complete; 6.0GB contracts lake |
| 1A/1B | J-book extraction (embedded XML, all defense-wide books) | verify-phase1 | ✅ merged | 34 books, 4,421 detail facts, 2,457 narratives, recon gates green |
| 1C | Budget→spend crosswalk + marts | verify-phase1 --trace | ✅ merged | Gate-6 trace 5/5; link-table high/medium only |
| 2 | Beneficiary entity graph | verify-phase2 | ✅ merged | 76,727 families; Boeing 89 UEIs; 99.8% district coverage |
| 3 | Oversight layer (GAO high-risk, improper payments) | verify-phase3 | ✅ merged | 67 programs/$185.6B derived improper; 38 GAO areas 84.2% mapped |
| 4 | State pilot (CA/CT comparables) | verify-phase4 | ✅ merged | CA $314.1B full capture; 3 honest comparables |
| 5A | Influence layer (Senate LDA) | verify-phase5a | ✅ merged | 4,258 filings; 32,780 program mentions/245 programs; match 80% |
| 5B-1 | Citation + export backbone | verify-phase5b1 | ✅ merged | 44,754 citations (3,417 pdf / 8,557 workbook / 32,780 lda); 0 unresolved; 50/50 re-derived |
| 5B-2 | Site skeleton: Next.js SSG + DuckDB-WASM + PDF.js citation panel + receipts mode + two-tier search + SEO | verify-phase5b2 | ✅ merged | 556 SSG pages (326 program/200 company/20 agency); 7 gates PASS; search 24/24 incl. typos; LHCI ≥90; a11y 0 serious; visual gate r2 medians 5/5/5/5 (r1 FAILED on doubled uncited-flag + mobile nav — agent-visual judging caught what no mechanical gate saw); 8,834 amount spans full-corpus verified cited/chipped/flagged |
| 5B-3 | Features + enrichment: anomaly feed, district lens, follow-the-dollar, share cards, top-50 dossiers + animations; USAspending/state/derived citation tiers | verify-phase5b3 + dossier_gate | ✅ merged (dossier batch pending API key) | 4,923 pages (feed 290 cards/4 types; 106 district; 4,258 filing w/ noindex policy; 554 OG cards); 7+ citation kinds, uncited_datasets 11→4 (dim_geography, dim_lobbyists, fct_budget_to_awards, jbook_narratives); 12 npm gates PASS; visual r3 5/5/5/5; 692 pytest/192 vitest. Dossier LLM batch BLOCKED on ANTHROPIC_API_KEY (cost-capped ≤$50; `govbudget dossiers submit` when exported) |
| 5B-4 | verify-phase5 assembly: NL eval ≥90%, citation resolution 100%, search eval, full regression | verify-phase5 | ✅ merged (live eval + dossiers await API key) | Analyst agent (sandboxed text-to-SQL: enable_external_access=false, cached schema card, 8-turn tool loop); eval set drift-corrected (freshness gate); verify-phase5 exit contract 0/2/1; launch tooling (R2 upload/CORS/config-rewrite + LAUNCH.md); 830 pytest/192 vitest; terminal state exit 2 — single unblock: export ANTHROPIC_API_KEY → `govbudget dossiers submit` + `govbudget verify-phase5`. Known softening (backlog): pdf_page eval-citation resolution matches pe_bli-only (accuracy backstops the value) — tighten on first live run |
| Post-launch | Refresh automation (cron), accounts/alerts tier, text-to-SQL analyst surface | per feature | backlog | — |

## Evaluator framework (how each thing is judged)

Pick the cheapest modality that actually measures the goal; escalate only when the
property is not mechanically checkable. Every gate is re-runnable by an operator.

1. **Mechanical CLI gates** (deterministic, exit-code; the backbone) — data
   correctness, citation re-derivation, set/count integrity, schema locks.
   *Used by: all phases (verify-phase1..5b1). Always preferred when possible.*
2. **Tool-instrumented gates** (headless browser + audit tooling) — properties of
   the RENDERED site that are still objective: every on-screen number carries a
   resolvable citation attr (Playwright DOM walk); citation click-through opens
   PDF.js at the right page with highlight overlapping the stored bbox (Playwright
   + bbox math); search eval set (type queries, assert top-3); Lighthouse budgets
   (INP <200ms, LCP <2.5s); axe-core accessibility; schema.org validation
   (structured-data parse); sitemap/llms.txt presence.
   *Used by: 5B-2 render/clickthrough/search/perf/a11y/seo gates.*
3. **Agent-visual judgment** (screenshot → vision-model rubric, N-vote) — what
   only eyes catch: broken layout, overflow, unreadable contrast, empty-state
   quality, animation jank (screenshot series), "does this page look trustworthy".
   Rubric-scored 1–5 per dimension by 3 independent judges; median ≥4 passes; any
   judge flagging a Blocker fails the gate. Screenshots at 3 viewports
   (390/768/1440px). Non-deterministic → ADVISORY-BLOCKING: failures stop the
   loop, but the rubric + screenshots are committed for human override.
   *Used by: 5B-2 visual_gate, 5B-3 animation/dossier layout review.*
4. **Loop-until-dry evaluation** (adversarial agents against live artifacts) —
   unknown-unknowns: final whole-implementation reviews (opus, live-probing),
   plan reviews before execution, eval-set construction (45 NL Q&A pairs already
   authored in evals/phase5_questions.yaml with 5 REFUSE cases).
   *Used by: every phase's final review; 5B-4's NL eval (≥90% + REFUSE handling).*

## Findings log (what we learned; feeds future phases)

- **J-book PDFs embed full XML** (.zzz attachments) — extraction is deterministic;
  no LLM needed for federal budget facts. The single most load-bearing discovery.
- **Fact identity must include the amount** — 11 live duplicate
  (sha, pe_bli, project, scenario) keys differ only in amount (5B-1).
- **Gates must compare raw rowcounts vs distinct keys** — set-collapse in checks
  hides join fan-out (the 24×-overcount class; re-found at citation layer in 5B-1
  final review).
- **23% of J-book facts are $0** — page-highlighting "0.000" is meaningless;
  zero_amount facts carry xml-path citations only (honesty policy, 5B-1).
- **73% of page resolutions are ambiguous_first** (amount appears on 2+ pages —
  summary + detail exhibits). Improvement candidate: scenario-column/exhibit-header
  anchoring to prefer the R-2/P-40 detail page (→ Backlog #3).
- **LDA client_name filter is contains-style** — query family_key + raw parent
  names + curated aliases; longer query strings return nothing (5A).
- **Entity-graph raw names are the honest alias authority** (UEI-grounded matching
  beats string fuzz; 'UNITED' single-token over-merge is the cautionary class).
- **pdfplumber (MIT) over PyMuPDF (AGPL)** for anything near a hosted product;
  hybrid pypdf-prefilter keeps full-corpus page resolution in minutes.
- **Decimal("NaN") inserts silently** — numeric pipelines need is_nan()/is_finite()
  guards at every parse boundary.
- **USAspending throttles multi-GB pulls** — patient 20–25min cooldown retry loops
  succeed where hammering fails.
- **Agent-visual judging catches what mechanical gates can't** (5B-2): all 7
  tool gates passed while the uncited-flag rendered doubled/overlapping and the
  mobile nav didn't collapse — 3-judge screenshot rubric failed it; after fixes,
  5/5/5/5. Visual gates are load-bearing for UI phases, not decoration.
- **Gate checks must be audited for vacuousness**: two clickthrough assertions
  passed while testing nothing (a misspelled field name; a missing chip check) —
  found only by the final whole-implementation review asking "would this gate
  catch a regression?". Negative-scan allowlists need exact-match semantics.
- **The vacuous-check class recurred TWICE more in 5B-3** — (1)
  `getAttribute(x) !== null` is always true under node-html-parser (returns
  undefined): the entire negative currency scan had never flagged anything;
  fixing it unmasked 1,916 strings needing a three-way taxonomy (quoted source
  prose = structurally exempt WITH block citation required; program names =
  labels; real violations = fix the site). (2) The derived-tier recompute read
  `recorded_value` from inputs that carry their value in `amount_thousands` —
  silently skipping verification of every headline figure; the fixed gate
  immediately caught a real 2× over-sum in the metric→amount_type mapping.
  Standing rule: every new gate ships with a test that proves it CAN fail.
- **Gate-weakening-by-eval-deletion**: an agent deleted failing search eval
  cases instead of indexing district pages — caught in orchestrator review.
  Eval cases are contracts; deletion requires a recorded decision.
- **Tech-stack lessons (5B-2):** SVG `<title>` inside server components gets
  hoisted by Next → hydration mismatch (use `<desc>`); .wasm needs
  `application/wasm` content-type for streaming compile; RSC→client props must
  be JSON-serializable (no Set); runtime asset config (public/config.json) beats
  env-baked bases — one artifact is both gated and shippable; Turbopack honors
  webpack magic comments (turbopackIgnore) for externals like Pagefind.

## Improvement backlog (content + tech; pulled into phases as they fit)

1. **Alias backlog (5B-2/3 content):** 9 top-50 families unmatched to LDA clients
   (Booz Allen Holding, ADS Tactical, Northrop Innovation Systems, Vertex, Fluor
   Marine Propulsion, MacAndrews & Forbes, Shell E&P, Bell-Boeing JPO*, Domestic
   Awardees* — *=genuinely unmatchable). Curated client_aliases.csv additions with
   documented corporate facts.
2. **Citation tiers deferred from 5B-1:** USAspending (reproducible query
   permalink), state checkbook (SoQL URL), derived metrics (formula + input
   citations). Owner: 5B-2 (usaspending/state), 5B-3 (derived). The manifest's
   `uncited_datasets` ledger (11 datasets) is the enforcement hook — 5B-2's
   render gate must refuse to render numbers from datasets still on it.
3. **Page-resolution disambiguation:** prefer detail-exhibit pages over summary
   pages via "Exhibit R-2"/"P-40" header anchoring → shrink ambiguous_first 73%.
4. **Historical J-book backfill (PB2025/PB2024)** → enables book-diff "what
   changed this cycle" (5B-3 feature 6). Schema already supports.
5. **$39T CPI SATCOM subaward outlier** — staging-layer sanity guard
   (max-plausible-amount flag, quarantine table).
6. **Site-mart gaps found in 5B-1 recon:** no per-family obligations-by-year mart
   (company page time series), no feed/event mart, dim_geography lacks
   fiscal_year/pe_bli breakdown (district drill-down) — build in 5B-2/5B-3 as
   their pages need them (YAGNI until then).
7. **FEC → CongressionalAddDetail chain** (money in → marks → money out) —
   post-5B; the J-book XML already carries the add elements.
8. **Refresh automation:** monthly USAspending, quarterly LDA, annual J-book,
   biennial GAO; cron on Mac Mini + `govbudget refresh` orchestrator + drift
   alarms (golden fixtures break = schema drift detected). Post-launch.
9. **Resolution-memory for review queue** (re-flagged items remember triage).
10. **SAM entity extract / Splink** entity-resolution upgrade (deferred with
    evidence since Phase 2).

## Standing constraints (unchanged, every phase)

Cited-or-absent; influence correlational never causal; no invented bidders;
derived figures labeled; supersede-not-delete; loud failures; polite scraping;
LLM only where deterministic paths fail; merge only on green gates + suite.
