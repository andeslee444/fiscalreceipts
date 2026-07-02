# GovBudget Roadmap — Source of Truth

**Updated:** 2026-07-02 · Living document: phase ledger, findings log, improvement
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
| 5B-4 | verify-phase5 assembly: NL eval ≥90%, citation resolution 100%, search eval, full regression | verify-phase5 | ✅ COMPLETE | Analyst agent (sandboxed text-to-SQL: enable_external_access=false, cached schema card, 8-turn tool loop); eval set drift-corrected (freshness gate); verify-phase5 exits 0; live eval 45/45 accuracy + 40/40 citation resolution (100%) — run artifact data/research/eval-runs/eval-20260702T085924Z.json (2026-07-02); verify-phase1..5b3 + phase5 assembly all PASS; site live at https://govbudget.vercel.app; launch tooling (R2 upload/CORS/config-rewrite + LAUNCH.md); 830 pytest/192 vitest |
| 5C | UX trust journey: linkgraph integrity, coverage notes, degraded-mode, receipt moment, 5 persona journeys, answer-fold, motion | 7 npm gates (G1–G7) | ✅ COMPLETE 2026-07-02 | 7 new gates all green; every gate has recorded proof-can-fail; 19/19 total npm gates; visual judges round-2 medians D1–D4:4 V1:5 V2:5 V3:4(after fix) V4:5 V5:4; final opus review SHIP; deployed https://govbudget.vercel.app; live computer-use verification of all 5 persona journeys PASS (PDF panel/downloads verified in degraded mode pending R2); data bug: 146/1,982 PEs had doubled trajectory rows — fixed (detail-only pivot + exporter derived-input join mirror); 4,446 trajectory citations re-verified; 136 dead-link feed events resolved from fct_budget_lines detail |
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
- **Sandbox broke the warehouse (5B-4, 2026-07-02):** `SET enable_external_access=false`
  (added to stop read_text exfiltration) silently broke every mart query because
  marts are views over read_parquet — mocked FakeClient tests couldn't see it
  (fixtures use in-DB tables). Live eval crashed to 5/45 REFUSEs. Fix: DuckDB
  `allowed_directories` (scoped to the parquet lake) + `enable_external_access=false`
  + `lock_configuration=true`, with a parquet-backed-view regression test. Lesson:
  security lockdowns need a live-path smoke test, not just mocked denial tests.
- **Answer contract invisible to mocked tests (5B-4, 2026-07-02):** first working
  live run scored 5/45 because the model submitted markdown prose in
  `submit_answer.answer` while the grader compares exact canonical values — the
  tool schema never stated the contract. Fixes: explicit canonical-value contract
  in the tool schema, separate `explanation` field for prose, and run_sql now
  returns the grader's own `canonical` string so compliance is copy-paste (imports
  the same `_canonicalize` the grader uses). Lesson: any exact-match grader must
  publish its canonicalization to the agent as a copyable artifact.
- **Answer-shape taxonomy — 22 failures classified (5B-4, 2026-07-02):** SHAPE
  (extra columns/rows vs the question's literal ask), SEMANTIC (wrong
  table/grain/definition — e.g. pe_bli repeats across organizations; improper_payments
  temp table is all-VARCHAR so ORDER BY sorts lexicographically), PRECISION
  (per-question rounding), NONDET (DuckDB parallel float SUM varies run-to-run at
  trillions scale, ~0.1 variance — disproved the 'ROUND(x,4) makes it reproducible'
  idea live). Fixes were generic schema-card rules (question-literal shape,
  deterministic final SELECT, honest data-trap docs) — with an anti-overfit test
  asserting the card mentions no eval question.
- **Underspecified-question repair pattern (5B-4, 2026-07-02):** 9 residual
  failures traced to eval questions not stating the precision/units/shape/
  metric-definition their own answer_sql embodies. Repair = amend question TEXT
  only (expected_answer/answer_sql/tolerance untouched), e.g. 'in millions, to
  three decimal places'. Two eval bugs found and fixed: q005 answer_sql returned
  ranks 2 AND 3 for a single-answer question (limit 2 offset 1 → limit 1 offset
  1); q012/q024 pre-emptively clarified. Live-eval trajectory across the loop:
  5 → 23 → 36 → 45/45.
- **Eval cost correction (5B-4, 2026-07-02):** a full 45-question live run costs
  ~$0.40 (sonnet, ~$0.009/question), not the ~$10 earlier estimated — cheap enough
  to iterate the loop freely.
- **Visual judges catch data bugs evals can't (5C, 2026-07-02):** a judge spotted
  sparkline FY24 $561.0M vs card $280.5M on the same page → fct_budget_trajectory
  summed rollup+detail duplicate rows (the q008 trap at the mart layer); 146 of
  1,982 PEs inflated 1.09–2.0×; invisible to the eval because pct-change ratios
  cancel doubling and eval absolutes hit fct_budget_lines with title filters. Fix:
  detail-only pivot + exporter derived-input join mirror; 4,446 trajectory citations
  re-verified. Companion lesson: derived-citation recompute passes when formula and
  recorded value share the same wrong inputs — recompute checks internal consistency,
  not truth; independent cross-surface comparison (two renderings of the same
  quantity) is what caught it.
- **fullPage screenshots don't trigger IntersectionObserver (5C, 2026-07-02):**
  below-fold reveal content captures as blank; a judge flagged a phantom "blank band".
  Capture scripts must scroll-through before fullPage shots.
- **Dead-link feed events (5C, 2026-07-02):** 136 feed events linked to
  non-existent program pages (pe_blis in trajectory but not dim_programs); G1 gained
  a dead-link leg (proof-can-fail recorded); titles for all 136 resolved from
  fct_budget_lines detail rows at export.
- **svg `<desc>` a11y text is read by screen readers but was invisible to the
  currency gate (5C, 2026-07-02)** after a naive exemption — tightened to require
  an identical [data-amount] twin in the same svg's parent subtree.
- **Evaluator-first worked as designed (5C, 2026-07-02):** G1/G2/G3 built failing
  (orphan nav, no coverage notes, silent degradation), recorded, then turned green
  by implementation — same for the dead-link leg. Proof-can-fail is not a checklist
  item; it is the gate.

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
11. **Type oversight parquets properly:** improper_payments and related oversight
    tables are all-VARCHAR from CSV ingestion, forcing CAST everywhere and inviting
    lexicographic-sort bugs (root cause of several 5B-4 SEMANTIC failures). Migrate
    to typed columns at the staging layer.
12. **Build gate for stale/failed `site/out`:** verify gates should detect that
    the SSG output is absent or from a failed build before running npm verify gates
    — currently a broken build silently causes gate false-passes against stale HTML.
13. **Mistral OCR (Document AI) as fallback extractor** for scanned/legacy J-book
    PDFs — current pipeline is XML-first and doesn't need it; revisit if pre-2015
    books (scan-only) enter scope.
14. **Feed title enrichment in dim_programs/exporter proper (5C):** 136 trajectory-only
    PEs currently have titles resolved at feed-export only; they need program pages and
    dim_programs entries so they appear in search and the sitemap.
15. **District choropleth + entity-graph viz (5C deferred):** interactive map of
    district spend distribution and force-directed entity graph; deferred pending
    D3/Mapbox integration decision.
16. **"Why?" link phrasing consistency (5C):** several detail pages mix "How is this
    calculated?" / "Source" / "Why?" for the same action — standardize to one phrase.
17. **Program pages for trajectory-only PEs (5C):** 136 PEs have feed events but no
    program page; they produce dead links in the feed until pages are generated.

## Remaining launch items

- **GitHub repo push** — awaiting user decision; repo exists empty at
  github.com/andeslee444/govbudget.
- **R2 assets** ✅ DONE 2026-07-02 — 52 objects / 154 MiB at
  `assets.fiscalreceipts.com`; PDF panel, explorer, and downloads verified at
  full fidelity in production browser.  CORS live test 7/7 PASS.
- **Domain** — DECIDED: `fiscalreceipts.com`.  Assets subdomain (`assets.`)
  already live.  Remaining: add `fiscalreceipts.com` to Vercel project + DNS
  CNAME + rebuild with `NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com` +
  OG/sitemap refresh + CORS policy already covers the new origin (step 4b done).
- **`NEXT_PUBLIC_SITE_URL`** — must be updated to `https://fiscalreceipts.com`
  in Vercel env before canonical meta and OG card URLs resolve correctly on the
  custom domain.

## Standing constraints (unchanged, every phase)

Cited-or-absent; influence correlational never causal; no invented bidders;
derived figures labeled; supersede-not-delete; loud failures; polite scraping;
LLM only where deterministic paths fail; merge only on green gates + suite.
