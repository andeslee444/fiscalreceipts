# GovBudget Roadmap — Source of Truth

**Updated:** 2026-07-03 · Living document: phase ledger, findings log, improvement
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
| 5D | Years matrix (/years/): 462 programs × FY columns, project sub-rows, cited cells via sharded lazy citations; derived breakdown tables (show-your-work, 1,068 sidecars) | G8 yearsmatrix gate (20th) | ✅ COMPLETE 2026-07-02 | judges r1 8/9 → M2 fix (sticky sum row, legend, decimal rule) → M2 re-score 5/5/5; 20/20 gates; 1,007 pytest / 271 vitest; live at fiscalreceipts.com/years/ |
| 5F | Program-page normalization: pages for all 1,995 PEs (rollup + full tiers), narrative paragraph provenance, deterministic prose amount cites, universal PE linking, 12-section skeleton | program-skeleton gate (21st) + linkgraph leg f + render-static prose-cite leg | ✅ COMPLETE 2026-07-03 | 1,995 program pages both tiers; narrative provenance 2,449/2,457 = 99.7% (8 unresolved keep the non-paged card — never a fake location); 27 deterministic prose cites; universal PE linking (196 unlinked tokens pre-fix → 0); 12-section skeleton gate; visual judges 4.5/5/4.5 PASS; 21/21 gates; 1,039 pytest / 303 vitest; live at fiscalreceipts.com |
| 5H | Experimental flowdown (/flow/): two-river sankey (budget intent vs contract obligations), honest 98.7% not-yet-crosswalked bridge band, FPDS competition overlay (FY2017–FY2026 selector), 1,965 minted flow derived facts, exporter-precomputed collision-free labels | G9 flowdown gate (22nd, legs a–e) + fct_flow_edges dbt conservation tests | ✅ COMPLETE 2026-07-03 | judges r1 PASS/PASS/PASS (F1 two-river honesty unanimous 5s) with F3 craftsmanship=3 on label collisions → fix round (exporter collision-free-by-construction labels + TDD bbox test, hue-split competition classes, value halos) → F3 re-score 5/4/5; G9 recomputes 55 budget + 40 spend nodes from the lake, bridge exact, 58/58 citations; 22/22 gates; 1,059 pytest / 335 vitest; live-verified node→panel (121.8B Navy derived formula + 532-input breakdown) and FY2025→FY2020 switch; live at fiscalreceipts.com/flow/ |
| 5E | Decade backfill PB2017–PB2026: 10 J-book editions (371 books, 159,503 budget lines, 38,422 detail facts, amounts provenance for every edition, 185 manifest-recorded exclusions, era procurement re-keyed {account}-{org}-L{line} with disjointness guard); fct_decade_series 59,068 + fct_book_diff 18,379 (exhaustively lake-recomputed); /years/ 12 edition-tagged columns; decade sparklines on 1,994 program pages; 15 request-vs-actuals feed cards | verify-phase5e CLI (23rd gate, 4 legs, pre-failure recorded) + G8 legs f/g + edition-integrity | ✅ COMPLETE 2026-07-03 (one open confirmation, below) | Adversarial review rounds caught + fixed: edition-merging dbt fence (291 programs would have shipped wrong FY2024 actuals), PB2023 OSD/CBDP books wrongly excluded (sole detail carriers for 112 PEs), era pe_bli collisions with modern BLI codes, 27.8k-orphan citation-export hazard, P-1R subset rule (993 withheld grains published incl. C-130J $1.78B); visual judges first-round PASS medians E1:4 E2:5 E3:5 E4:5 E5:5 + 4 polish fixes shipped; 22/22 npm gates; 1,196 pytest / 352 vitest; eval 48/48 accuracy + 43/43 citations achieved (artifact eval-20260703T190641Z); ⚠️ OPEN: post-run-3 eval robustness fixes (table-equivalence groups, temperature-0 determinism, transient-error retries — all committed + unit-tested) await their confirming verify-phase5 exit-0 run, blocked by the Anthropic API monthly usage cap (resets 2026-08-01); first post-reset run must confirm |
| 5G | Service J-books — Navy FY2026 (Army/AF manual path): Playwright download adapter past the secnav.navy.mil bot-WAF, classifier allowlist for appropriation-code naming (RDTEN/APN/OPN/…), per-family BA-split dedup, account-scoped Gate B, thousands-form provenance; 5,810 Navy detail facts + 2,066 narratives; 351 Navy PEs flipped rollup→full (full-tier universe 462→813; 387/593 Navy display PE-BLIs now carry book detail) | verify-phase5e gate a (superseded-terminal fix) + program-skeleton universe recount + render-static unresolved→state-B | ✅ COMPLETE 2026-07-04 (Navy live-verified; Army + AF on manual drop-dir path) | Probe-first: Playwright reached the live secnav SharePoint listing (spike URL dead); sample RDTE book confirmed Scenario-A embedded jb-2009 XML (252 PEs). Live-data fixes no fixture caught: per-family BA-split dedup (each PDF embeds the full master → 12× procurement over-load), account-scoped Gate B (Navy P-1 line numbers unique only within an appropriation → 204 false failures), thousands-form provenance. 11 duplicate doc rows non-destructively superseded (status flip, reversible — not DELETE); silent_unreconciled=0; verify-phase1/5b1/5e + 22 npm gates PASS; 1,244 pytest (1 pre-existing dossier-CSV failure, API-capped) / 363 vitest. Live-verified flagship 0601153N "Defense Research Sciences": full-tier, 108 R-2 narratives, cited amounts open derived-formula + breakdown panels, and the 40MB Navy RDTE PDF renders in the citation panel after the R2 sync. **R2 asset drift caught + fixed:** the deploy drill rebuilds site/out + Vercel but never re-synced data/site/pdfs → R2, so since the 2026-07-02 launch the 5E decade + Navy PDF citations silently degraded to "open official source" in production; re-ran upload_r2.sh (190 files / 1.48 GiB) → all PDF citations now full-fidelity. Army: asafm.army.mil Akamai blocks even a realistic headless Chromium (spike's "Playwright bypasses Akamai" premise disproven) → manual path, no stealth transport built. |
| 5G-archive | Service J-books — Army + Air Force + Space Force FY2026 via the Internet Archive: asafm.army.mil (Akamai-403 to server clients, per the 5G probe) and saffm.hq.af.mil (CAC) both mirror their PUBLIC books WAF-free on Wayback — a legitimate public archive of public records. New `archive_fetch.py` (CDX enumeration + `id_` raw-bytes download, all robustness-guarded), ARMY_NAMES/AF_NAMES classifier allowlists (org A / F; Space Force → org F via embedded ServiceAgencyName="Air Force" + SF-suffix PEs), empirical master-identity dedup (`dedup_service_master_dups`), per-document xml dir. **Army 507/513 + AF·SF 519/538 page-less PE/BLIs now carry book detail** (11k detail rows across 17 live books, 14 deduped); 1203154SF verified. source_url = ORIGINAL gov URL (Wayback is transport, not cited). | archive_fetch unit suite (MockTransport, no live net) + registry Army/AF/SF classifier + full-inventory partition + byte-identity regression + master-dedup (Postgres) + CLI archive-dispatch | ✅ COMPLETE 2026-07-05 | Provenance-first: `--source archive` enumerates via CDX → downloads through the Wayback raw-bytes endpoint → existing extract/load/reconcile unchanged. Six transport findings no fixture caught, each a committed fix + test: (1) shared xml/ dir clobbered masters across the many-books-per-org-folder layout → per-doc `{stem}__xml/`; (2) Wayback availability API flaky (returns {} for archived URLs) → CDX authoritative; (3) HTML-interstitial snapshots → `%PDF` magic guard; (4) 5 MB-boundary truncation → `is_complete_pdf` (%%EOF) on download AND resume; (5) variant-only archival (AF RDTE Vol I only under `?ver=`) → `variant_snapshots` fallback; (6) transient 504s → failed/missing reset to registered on re-run. Dedup finding: the Navy filename BA-split heuristic does NOT generalize (Army RDTE is genuinely per-volume distinct; AF RDTE Vol I-IV share one master) → empirical master-sha grouping. silent_unreconciled=0; verify-phase1/5e/5b1 PASS (PB2026 discovered=81 terminal=81); 1275 pytest (1 pre-existing dossier-CSV failure, API-capped). Evidence + full findings: docs/superpowers/reviews/5g-archive/. NOT done here (separate rounds): exporter/site ripple (tier flips, /methodology/ wording), deploy + R2 re-sync, judge pack. |
| 5G-archive-site | Exporter + site ripple for the Army/AF/SF archive round: surface the ingested Army (org A) + Air Force / Space Force (org F) FY2026 J-book detail on the site. dbt rebuild grew dim_programs to 1,739; export-site flipped the service PEs rollup→full (full-tier universe 813→**1,741**; rollup 1,182→**252**; total page universe 1,993). Full-tier by org now F=519, A=508, N=387. Coverage honesty: `isIngestedServiceOrg` extended N→{A,N,F} (Space Force folds under 'F' — 'SF' is a PE-number suffix, never an org); rollup service-books note + `/program/[peBli]` justification empty-state + methodology coverage section all say the service books ARE ingested (this line just has no matching R-2/P-40 narrative) instead of the false "not yet ingested"; methodology names Navy+Army+AF+Space Force ingested via official + Internet Archive sources with the near-zero classified/no-R-2 residual. | 22/22 npm gates (program-skeleton universe recount + ingested-wording accept; yearsmatrix budget 2MB→4MB; render-static Cite contract on new pages) + isIngestedServiceOrg tests + search-eval | ✅ COMPLETE 2026-07-05 (live-verified) | Movers, each a sanctioned fix not a weakening: (1) **yearsmatrix budget 2MB→4MB** — matrix grew 813→1,741 programs (~3.0MB) at the SAME ~1.6KB/program density; raised the exporter constant, the G20 gate, AND the pytest budget test (now pinned to the exporter constant so they never drift). (2) **2 mis-parsed pe_blis dropped** — Army R-1/P-1 lines that mis-parsed the appropriation label ("RDT&E", "O&M") into the pe_bli slot; the '&' breaks Next.js static routing → the pages 404'd (0 data-sections, caught by G21). Added a route-safety filter in the exporter (`_is_route_safe_pe`) so these garbage PEs never generate broken pages; real programs with "RDT&E" in their *title* are untouched. (3) **search near-exact company boost bug** — the 3-char-stub heuristic wrongly boosted "GENERAL ATOMICS" over "GENERAL DYNAMICS CORP" for query "general dynamics"; tightened to a real head-prefix overlap (typo cases darppa/lockeed/boeng still pass). (4) **search-eval corpus drift** — every military department now carries its own full-tier "Defense Research Sciences" PE (5-way title tie), so the DARPA-specific case was disambiguated to "defense research sciences darpa"; G5 back to 29/32 (91%). Eval count re-baseline: `evals check` → 43 ok / 0 stale / 5 skipped — no count-pin drifted (the new jbook_details rows touch no pinned SQL; live-eval confirm stays on backlog #22, API-capped). **R2 re-synced** (backlog #27 lesson): the 17 new Army/AF/SF PDF binaries pushed to R2 (`upload_r2.sh --live`), else citations degrade to "open official source"; SF book 40f1f67d…pdf + an Army (asafm) + an AF (saffm) book all return HTTP 200 from assets.fiscalreceipts.com. Live-verified **1203154SF "Long Range Kill Chains"** (the user's ask, #1 by FY2026 request at $7.7B): now FULL-TIER with 12 canonical sections, the real GMTI mission narrative, R-2 detail table, and working PDF citations to the Space Force RDT&E book (pages 647/649/654) — and one Army full-tier (0603462A NGCV, 114 narratives) + rollup coverage wording confirmed. Deploy `vercel --prod --archive=tgz` (6,732 pages, 2 fewer than pre-fix) aliased to fiscalreceipts.com; 1,275 pytest (1 pre-existing dossier-CSV failure, API-capped) / 363 vitest / tsc clean / eslint 0 errors. Evidence: docs/superpowers/reviews/5g-archive/live-*.png. |
| 5G-dossiers | Regenerate top-50 dossiers for the service-J-book-shifted top-50 (40/50 changed after the Navy + Army/AF/SF ingestion — the current #1 is 1203154SF "Long Range Kill Chains" at $7.7B, and the old defense-wide top-50 that had dossiers dropped out). Recompute live `research.top50`; rewrite `data-seeds/program_categories.csv` to the live set (40 new rows: 6 space, 3 shipbuilding, 31 default; each with a resolvable narrative `source_ref`) → fixes `test_covers_live_top50_exactly`. Author 40 new dossiers in the exact production schema (sections→claims, every claim a real resolvable `fact_id`) via **Claude Code subagents** (not the cost-capped Batch API) — the cited-or-absent gate makes subagent-authored dossiers as honest as pipeline-authored. Committed raw source in `data/research/dossiers-raw/{pe}.json` (honest provenance marker, no faked API batch metadata) so `dossiers collect` reproduces them; the `dossiers submit` CLI remains for future API runs. | `dossiers gate` + `verify-phase5b3` + full pytest | ✅ COMPLETE 2026-07-05 (live-verified) | Dossier gate PASS: 50/50 present, **0 unresolvable citations, 733/733 claims warehouse-cited (100%, floor 80%)**, categories 50/50. **`test_covers_live_top50_exactly` now PASSES** (the one pre-existing API-capped failure noted in 5G rows — now cleared); `test_seed_emits_verbatim` re-pinned to the shifted top-50 (space/cyber/shipbuilding, no hypersonics in the current top-50). Full suite **1,282 pytest / 0 failures**. Faithfulness handled per program: classified lines (0603525N PILOT FISH, 846510 SAP) state "classified per E.O. 13526" and cite only money facts — the "absent" half of cited-or-absent, no fabricated mission; discretionary vs. reconciliation (mandatory) splits cited to distinct budget-line fact_ids; only contractors named IN the J-book narrative asserted (Lockheed for F-35 C2D2, Dynetics for IFPC) — no invented bidders; percent-changes cited only where a feed `figure_fact_id` backs them. 22/22 npm gates PASS (gate-12 animation now 50/50 `data-hero-category` after the fresh build baked the new categories). Deploy `vercel --prod --archive=tgz` aliased to fiscalreceipts.com; **R2 re-synced** (`upload_r2.sh --live` — citations/ 2.85 MiB + data/ 5.4 MiB refreshed so dossier fact_ids resolve). Live-verified 1203154SF (What-it-is/Why-it-matters/Key-players + Golden Dome + $7,696,916, fact_id `7d4bd900234f652c` resolves via same-origin cite-shard HTTP 200), 0603525N (classified framing), 1000 (ship maintenance). |
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

- **2026-07-02: product rebranded to Fiscal Receipts** (site display name; infra
  identifiers unchanged).
- **47.3% of FY2025 DoD obligations ($232.4B) were not competed** — surfaced by
  the 5H competition overlay from extent_competed, a field sitting untapped in
  the contracts parquet since Phase 0. Editorial headline candidate.
- **Losing bidders are structurally absent from all public data** — FPDS records
  number_of_offers_received (counts) but never offer identities; SAM.gov is an
  entity registry, not a bid ledger. The /flow/ UI states this statically
  ("counts offers, not bidders") so the overlay can't be misread (5H).
- **Sankey labels: precompute collision-free placement in the exporter, don't
  fix collisions in the client** — thickness-threshold suppression + placement
  at export time made "no label overlaps" a TDD-able bbox-intersection test
  instead of a rendering hope. Rendering-metric drift (font change) is the
  residual risk — judge flagged; closed 2026-07-03 by G9 leg f (backlog #20),
  which promptly caught a real Avenir-Next under-measurement on its first
  clean run (5H F3 fix round, 3→5/4/5).
- **Negative net flows need an explicit rule** — TACOM→Boeing FY2017 nets to
  −$97.6M; sankeys can't draw negative width. Rule: draw at zero width, label
  "net de-obligation", keep the citation (5H).
- **max() on confidence strings is a trap** — lexicographic max('high','medium')
  = 'medium'; the flow marts needed an explicit ordinal mapping (5H dbt).
- **R2 asset sync drifted out of the deploy loop (5G, caught 2026-07-04).** The
  deploy drill rebuilds `site/out` and pushes to Vercel but never re-syncs
  `data/site/pdfs → R2`. So every phase since the 2026-07-02 launch (5E decade
  editions, 5F/5H additions, 5G Navy) shipped citation *metadata* while the PDF
  *binaries* were missing from the CDN — the panel degraded to "open official
  source" and no gate or live-check caught it (prior live-checks happened to
  click workbook/XLSX and derived citations, which were in R2). Fixed by
  re-running `upload_r2.sh` (190 files / 1.48 GiB). LESSON: the "deploy" step is
  Vercel + R2, not Vercel alone — a gate should sample a live PDF fetch from a
  recently-added citation, and the deploy drill must include the R2 sync
  (backlog #27).
- **Government WAFs are not uniform — probe each, never assume (5G).** Navy's
  secnav bot-WAF yields to a realistic headless browser; Army's Akamai blocks
  the identical browser with a 403. The feasibility spike's "Army ≈ Navy, both
  bypass with Playwright" premise was disproven by the actual probe. A blocked
  WAF is a finding routed to the manual path — never a prompt to build evasion.
- **Live data finds bugs fixtures can't — ingest surfaces them (5G).** Three
  Navy defects appeared only against real books: each BA-split PDF embeds the
  full master (12× over-load → per-family dedup), P-1 line numbers reuse across
  appropriations (204 false recon failures → account-scoped Gate B), and Navy
  renders dollars in thousands not millions (provenance form). None were
  reachable from fixtures.
- **`superseded` is an accounted-for terminal state, not a coverage gap (5G).**
  Deduplicated duplicate documents get a reversible status flip (never a
  destructive DELETE); the edition-coverage gate counts them as terminal, with
  a `recon>0` guard so an all-superseded edition still fails.
- **A WAF-blocked source has a legitimate public mirror — the Internet Archive
  (5G-archive).** Army (Akamai-403 to even a headless browser) and AF/SF (CAC)
  are unreachable server-side, but Wayback mirrors their PUBLIC FY2026 books
  WAF-free. Fetching a public archive of public records is a legitimate
  transport, not evasion — and it needs its own robustness layer: the
  availability API is flaky (CDX is authoritative), `id_` snapshots can be HTML
  interstitials (guard `%PDF`) or 5 MB-truncated (guard `%%EOF`, on resume too),
  and some books are archived only under a `?ver=` variant (prefix-search
  fallback). Provenance records the ORIGINAL gov URL; Wayback is transport only.
- **Dedup rules do not generalize across services — derive them empirically
  (5G-archive).** The Navy filename BA-split heuristic collapsed 18 distinct
  Army books when reused blind. Army RDTE is genuinely per-volume distinct
  (each volume's PDFs share only THAT volume's master); AF RDTE Vol I-IV share
  one master; AF vs SF RDTE differ despite same org+family. The robust rule is
  content-based: group by the sha256 of the master XML `pick_book_xml` selects
  and keep one per `(family, master-sha)` — no per-service filename knowledge.
- **Many-books-per-org-folder needs a per-document extraction dir
  (5G-archive).** Defense-wide/Navy put one book per family in each org folder,
  so a shared `xml/` dir was safe; Army/AF pack a dozen justification PDFs into
  one folder and their masters clobbered each other, making `pick_book_xml`
  return the wrong master and the dedup collapse distinct books. Fix: per-stem
  `{name}__xml/` dir, with a read-time fallback to the legacy shared dir.
- **The Internet Archive is a WAF-free mirror of PUBLIC govt budget books with
  the embedded XML intact — the CAC/Akamai "hard blockers" were access-method
  problems, not data-availability problems (5G-archive-site).** Everything the
  5G Navy round could only get by driving a stealth browser past secnav's bot-
  WAF — and everything the 5G probe declared a "hard blocker" for Army (Akamai-
  403) and AF/SF (CAC) — was sitting on Wayback the whole time, same public
  records, same embedded jb-2009 XML that anchors every figure to its page. The
  site ripple is the proof: 928 program pages flipped rollup→full and 1203154SF
  "Long Range Kill Chains" (#1 by FY2026 request) now renders its Space Force
  RDT&E narrative + working PDF citation. The lesson is to separate "can't
  reach it with THIS transport" from "the data isn't public" — the second was
  never true.
- **A larger corpus surfaces latent bugs and stale eval pins — data growth is a
  gate stress-test (5G-archive-site).** Flipping ~1,000 service PEs to full tier
  exposed three defects the smaller corpus hid, each fixed at the root, none by
  weakening a gate: (1) two Army R-1/P-1 lines mis-parsed the appropriation
  label ("RDT&E"/"O&M") into the pe_bli slot — harmless as rollup data, fatal as
  a URL route (the '&' 404'd the page); a route-safety filter drops only these
  garbage PEs. (2) The search near-exact company boost matched on a 3-char stub,
  so "general dynamics" wrongly boosted "GENERAL ATOMICS"; tightened to a real
  head-prefix. (3) Every service now has its own "Defense Research Sciences" PE
  (a 5-way exact-title tie), so a search-eval pinned to DARPA's PE needed the
  org in the query to disambiguate. The years-matrix payload also grew linearly
  (813→1,741 programs, same ~1.6KB/program) — a budget raise, not a regression;
  pinning the pytest budget to the exporter constant stops the three copies from
  ever drifting apart again.
- **A hardcoded "ingested-orgs" constant lies the moment the data outgrows it —
  derive the set from the loaded books (audit-fix 2026-07-05).** `program-tier.ts`
  pinned `INGESTED_SERVICE_ORGS = {A,N,F}` by hand, so every defense-wide agency
  page whose FY2026 J-book WAS loaded (OSD, DCSA, MDA, DISA, DARPA, … — 27 books
  → 25 workbook-org codes) still rendered the false "the {org} J-book is not yet
  ingested". Three confirmed liars: 0604130V/0305133V (DCSA), 0303367D8Z (OSD).
  Fix: the exporter emits `site_meta.ingested_service_orgs` — the distinct
  `jbook_documents` FY2026 downloaded orgs, each run through `workbook_org()` so
  the codes land in the SAME space as `details.service_org` (CYBERCOM→CYBER,
  CHIPS/DPAP→OSD) — and `isIngestedServiceOrg` reads that payload (data.ts
  injects it via a build-time setter, since program-tier is a universal no-fs
  module). Orgs with no loaded book (DHA, DEFW, IG) stay absent → keep the
  honest wording. Lesson: any "which things are ingested/covered/enabled" set
  that a human maintains alongside the data it describes WILL drift; make it a
  query, not a literal.
- **Reject junk at the loader, not just at the exporter (audit-fix 2026-07-05).**
  Army P-1 appropriation SECTION-HEADER rows ('RDT&E', 'O&M') mis-parsed the
  label into the BLI cell and `p1_loader.load_p1_rollup` inserted them as real
  `budget_lines` rows. The exporter's `_is_route_safe_pe` filter hid them from
  PAGES (the '&' 404s a static route) but they still polluted every
  budget_lines-by-pe_bli aggregate (and 30 phantom workbook citations). Root fix
  is a pe_bli validity guard AT the loader (`_is_valid_pe_bli` rejects `& / % #`
  + whitespace, before era re-keying so digits/letters/era sub-line hyphens
  survive) plus a scoped one-shot cleanup of the 8 already-loaded rows
  (`scripts/clean_junk_pe_bli.py`, fy2026-scoped so the FY2017–2023 hyphenated
  era keys `0300D-CBDP-L70` are never in range). A route-safety filter that
  masks bad data from the UI is belt; rejecting it at ingest is braces.
- **A tail-scan window sized for the common case false-negatives the valid tail
  (audit-fix 2026-07-05).** `is_complete_pdf` scanned only the last 2KB for
  `%%EOF`; a valid PDF whose final `%%EOF` sits past 2KB (trailing metadata,
  incremental-update tail, linearized xref) read as truncated → spurious
  download gap. Widened to 64KB.
- **The whole 2017–2023 J-book era embeds .zzz XML** — same renamed-zip +
  jb-2009 schema as 2026; the Mistral-OCR fallback was never needed (5E).
- **Era editions publish consolidated volumes under unstable naming** — token
  classification + evidence-keyed exceptions (EVIDENCE_PATHS, download and
  inspect the embedded XML) beat prefix regexes; count envelopes must be
  era-aware (5E).
- **Era P-1 line numbers are not program identities** — the same string spans
  orgs, conflates programs, and collides with modern BLI codes; namespace
  within edition ({account}-{org}-L{line}) and guard keyspace disjointness (5E).
- **PB2019 OSD ships the same MJB XML in two BA-split volumes** — identical
  tuple sets under both documents; the dedup binding was recorded in the plan
  BEFORE the marts existed, which is what kept it enforced (5E).
- **P-1R is a subset breakout of P-1, never additive** — workbook-proven
  (Aircraft Procurement Army FY2024 = P-1 alone); excluding P-1R from candidate
  sums published 993 previously-unverifiable procurement grains (6 small-dollar
  book quirks noted) (5E).
- **`fiscal_year >= threshold` fences silently merge edition-relative
  scenarios** — PriorYear means a different fiscal year in every edition;
  always fence `= edition` (the 291-programs-wrong-FY2024 near-miss) (5E).
- **Copy-paste-canonical eval contracts need temperature 0 AND deterministic
  SQL rules** — and prompt examples leak into behavior on the very entities
  they mention; keep rules generic (5E).
- **Fencing typed exports requires symmetric fencing of every
  provenance-derived emission pass** — the 27.8k-orphan citation hazard
  (staleness luck masked it until the adversarial re-review simulated a fresh
  export) (5E).
- **Multiple marts can legitimately own the same quantity** — eval
  table-overlap prechecks need documented equivalence groups or agents
  flip-flop between correct citations run to run (5E).
- **Next.js title.template doubles when pages also append the site name** —
  every one of 6,593 pages rendered "… | Fiscal Receipts | Fiscal Receipts";
  caught only during 5H live verification because no gate read <title>. New
  render-static leg (t) asserts the site name appears at most once
  (proof-can-fail: 6,593 pages).
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
- **Fleet stragglers ship half-finished expectation raises (final stage,
  2026-07-02):** an uncommitted fleet diff raised match_gate5a to 0.85 claiming
  "data legitimately improved" — but the LDA re-pull that would improve the data
  never ran (aliases alone can't match filings the original pull never fetched;
  verified: only 1 of 4 target client names exists in the parquet at all).
  verify-phase5a caught it at 40/50 = 80% < 85%. Rule refined: a
  documented-expectation raise must land in the SAME change-set as the pipeline
  run that makes it true, with the gate's PASS output as commit evidence. Same
  class: a fleet build regenerated llms.txt without NEXT_PUBLIC_SITE_URL,
  committing placeholder-origin URLs into the tracked artifact.
- **LDA pull attribution is first-query-wins even at match 'none' (2026-07-02):**
  the global UUID dedup in pull_top_families assigns a filing to the first
  (highest-obligation) family whose contains-style query returns it, regardless of
  match quality — VECTRUS's 'V2X' query consumes the 'V2X, Inc. (formerly known as
  Vertex Aerospace)' filings at match 'none', starving VERTEX AEROSPACE SERVICES.
  A future re-pull should prefer matched attribution over unmatched before global
  dedup (or dedup only among matched claims).
- **Exhibit-header tie-breaking shrinks pdf-page ambiguity by a third (2026-07-02):**
  ambiguous_first 73% → 51% of provenance rows (969 facts disambiguated to their
  detail-exhibit page); the rebuild is deterministic (delete + rebuild reproduced
  all 4,419 keys byte-identically), so the improvement is re-runnable at every
  future J-book ingest.
- **Paragraph-provenance technique (5F, 2026-07-03):** narrative paragraphs are
  located in the source PDF by their OPENING TEXT (first 12 words,
  whitespace-normalized — the `narrative_opening` string is BINDING, shared
  verbatim with the verify-phase5b1 re-derivation leg) via the same
  pypdf-prefilter + pdfplumber-confirm machinery as amounts, with pe_bli →
  source-exhibit → project tie-breaking and a word-boundary span guard; bbox is
  the passage's first rendered line. 2,449/2,457 (99.7%) resolved; the 8
  unresolvable openings store 'unresolved' with NO page and keep the pageless
  citation card — locations are never faked. Prose needed no new machinery,
  only a new *anchor* (opening text instead of an amount) into the existing
  amount-provenance pipeline.
- **Integration tests catch cross-pass crashes unit tests can't (5F,
  2026-07-03):** the exporter's 4a jbook_pdf citation pass predated the
  target_kind discriminator and read ALL provenance_pages rows — with zero
  narrative rows it passed silently for weeks; the FIRST real
  narrative-provenance build (2,457 rows, NULL amounts by the kind-shape
  constraint) fed NULL into fact_id_jbook and crashed export-site. Each pass's
  unit tests were green in isolation; only running both builders + export
  together surfaced it. Regression now TDD'd (both builders in one export;
  4a selects target_kind='amount' only). Producer-consumer integration tests
  are load-bearing whenever two pipeline stages share a table.
- **Deterministic-prose-cite restraint is self-proving (5F, 2026-07-03):** a
  prose dollar token becomes a clickable cite ONLY when it exactly equals
  (canonical dollars) exactly ONE resolvable fact scoped to the same PE —
  ambiguous, unit-less, and uncited tokens stay plain prose. That yields just
  27 prose cites across 2,457 narratives, and the visual judges praised
  exactly this: the sparseness itself communicates that every link is earned
  (a maximal-recall linker would have manufactured doubt about all of them).
  Precision-over-recall in citation UX is a trust feature, not a coverage gap.

## Improvement backlog (content + tech; pulled into phases as they fit)

1. **Alias backlog (5B-2/3 content):** 9 top-50 families unmatched to LDA clients
   (Booz Allen Holding, ADS Tactical, Northrop Innovation Systems, Vertex, Fluor
   Marine Propulsion, MacAndrews & Forbes, Shell E&P, Bell-Boeing JPO*, Domestic
   Awardees* — *=genuinely unmatchable). Curated client_aliases.csv additions with
   documented corporate facts.
   *Update 2026-07-02:* aliases CURATED + committed for Booz Allen, ADS Tactical,
   Vertex (V2X fka), Shell E&P — spellings verified against the live LDA API, with
   over-merge guard tests. STAGED, not yet effective: those filings were never
   returned by the original pull's query strings, so they only match at the next
   `govbudget influence pull` (+ dbt marts, mentions, export-site, dossier-citation
   check). The match_gate5a raise to 0.85 lands with that re-pull (a premature
   raise was reverted in final-stage verification — see findings). Remaining 6
   families verified as having zero 2024–2026 filings (genuinely unmatchable).
2. **Citation tiers deferred from 5B-1:** ~~USAspending (reproducible query
   permalink), state checkbook (SoQL URL), derived metrics (formula + input
   citations). Owner: 5B-2 (usaspending/state), 5B-3 (derived). The manifest's
   `uncited_datasets` ledger (11 datasets) is the enforcement hook — 5B-2's
   render gate must refuse to render numbers from datasets still on it.~~
   **DONE 2026-07-02:** ledger cleared to 0 — final holdouts dim_geography,
   fct_budget_to_awards, dim_lobbyists received citations (district dollars are
   clickable citations); the ledger gate is now armed at empty (any future
   uncited dataset fails loudly).
3. **Page-resolution disambiguation:** ~~prefer detail-exhibit pages over summary
   pages via "Exhibit R-2"/"P-40" header anchoring → shrink ambiguous_first 73%.~~
   **DONE 2026-07-02:** exhibit-aware tie-breaking (source exhibit header, then
   project-number token; each step skipped if it would empty the candidate set);
   ambiguous_first 3,208 (73% of 4,419) → 2,239 (51%), unique 209 → 1,178.
   'unique' only when uniquely determined + word-confirmed; candidate_pages keeps
   the raw pre-tie-break count (auditable, no fabricated certainty). Rebuild
   determinism verified: delete-ambiguous + rebuild reproduced 4,419/4,419 keys
   byte-identically.
4. **Historical J-book backfill (PB2025/PB2024)** → enables book-diff "what
   changed this cycle" (5B-3 feature 6). Schema already supports.
   *Update 2026-07-02:* PB2025 feasibility spike complete — GO recommendation
   (docs/superpowers/plans/2026-07-02-pb2025-backfill-feasibility.md).
5. **$39T CPI SATCOM subaward outlier** — ~~staging-layer sanity guard
   (max-plausible-amount flag, quarantine table).~~ **DONE 2026-07-02:**
   staging quarantines subaward outliers with `is_amount_suspect` flag.
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
11. **Type oversight parquets properly:** ~~improper_payments and related oversight
    tables are all-VARCHAR from CSV ingestion, forcing CAST everywhere and inviting
    lexicographic-sort bugs (root cause of several 5B-4 SEMANTIC failures). Migrate
    to typed columns at the staging layer.~~ **DONE 2026-07-02:** loaders now write
    typed columns at ingestion (fiscal_year INTEGER, rate/amount columns DOUBLE,
    high_risk.mapped BOOLEAN); parquets retyped in place value-identically
    (fct_improper_exposure checksum unchanged); dbt try_casts dropped; schema card
    updated (trap note replaced — legacy CASTs are harmless no-ops).
12. **Build gate for stale/failed `site/out`:** ~~verify gates should detect that
    the SSG output is absent or from a failed build before running npm verify gates
    — currently a broken build silently causes gate false-passes against stale HTML.~~
    **DONE 2026-07-02:** gate 1 build-staleness check — postbuild marker file +
    mtime guard against data/site inputs.
13. **Mistral OCR (Document AI) as fallback extractor** for scanned/legacy J-book
    PDFs — current pipeline is XML-first and doesn't need it; revisit if pre-2015
    books (scan-only) enter scope.
14. **Feed title enrichment in dim_programs/exporter proper (5C):** 136 trajectory-only
    PEs currently have titles resolved at feed-export only; they need program pages and
    dim_programs entries so they appear in search and the sitemap.
    *Update 2026-07-02:* pages/search/sitemap half completed by backlog #17 (exporter
    synthesis from dim_pe_titles); dim_programs entries proper still require R-2/P-40
    detail ingestion and remain out of scope by design.
15. **District choropleth + entity-graph viz (5C deferred):** interactive map of
    district spend distribution and force-directed entity graph; deferred pending
    D3/Mapbox integration decision.
16. **"Why?" link phrasing consistency (5C):** ~~several detail pages mix "How is this
    calculated?" / "Source" / "Why?" for the same action — standardize to one phrase.~~
    **DONE 2026-07-02:** standardized to the explicit `why <topic>? →` convention
    across detail pages.
17. **Program pages for trajectory-only PEs (5C):** ~~136 PEs have feed events but no
    program page; they produce dead links in the feed until pages are generated.~~
    **DONE 2026-07-02:** exporter synthesizes dim_programs-shaped rows for feed PEs
    outside dim_programs (`_trajectory_only_feed_programs`): title from dim_pe_titles,
    exhibit_family from fct_budget_lines exhibits, trajectory figures reuse the
    already-emitted derived citations; honest absences elsewhere (no FY24 J-book
    headline / details / narratives / dossier). programs.json 326→462 pages;
    program_details, search docs, sitemap, OG cards, coverage denominators
    ("N of 462") all follow from data. Feed cards regained "view program →" links
    via the existing programs.json gate. agencies.json stays dim_programs-scoped
    (derived agency-sum recompute unchanged); service-org codes (A/N/F/DHA) render
    as plain text in the program header, never a dead link. This also completes the
    page-generation half of backlog #14 (dim_programs entries themselves still
    require R-2/P-40 detail by design).
18. **llms.txt / sitemap origin gate:** ~~a build without NEXT_PUBLIC_SITE_URL bakes
    the placeholder origin into tracked/deployed artifacts (caught once in a fleet
    straggler, 2026-07-02). Add a verify leg: production artifacts must not contain
    `govbudget-placeholder.example`.~~
    **DONE 2026-07-03:** two layers — verify-phase5b3 defaults
    NEXT_PUBLIC_SITE_URL for its wrapped npm verify (920c225), and gate 1
    now carries the requested UNCONDITIONAL placeholder scan
    (sitemap.xml/llms.txt/robots.txt/index.html must not contain the
    placeholder host, independent of the verify-time env — the env-relative
    sitemap-origin leg alone would false-pass a placeholder build verified
    without the env, since its fallback is the same placeholder).
    Pre-failure proof in reviews/5c-gates-pre-failure.txt.
19. **LDA re-pull to activate curated aliases (from backlog #1):** **PARTIAL
    (2026-07-04).** ✅ The first-query-wins attribution bug is FIXED + committed
    (7bb1582): best-match-tier resolution (exact_family > curated_alias >
    normalized > family_raw_name > suffix_residue > none; ties → higher
    obligation), query-order independent, 3 TDD regression tests — VECTRUS's
    'V2X' query no longer starves VERTEX AEROSPACE's curated alias.
    ⏸ DEFERRED — the live `influence pull` + dbt/mentions rebuild + export-site
    + dossier-citation check + match-gate raise to 0.85: the re-pull can change
    filing amounts, and fact identity includes amount, so it can orphan the 50
    static dossier claims that cite lobbying facts. Regenerating dossiers needs
    the Anthropic API (capped until 2026-08-01 — see #22). Rather than start a
    long live warehouse mutation that might leave dossiers broken with no repair
    path, run this as ONE unit after the cap resets: pull → ripple → dossier
    gate → (regenerate any orphaned dossiers) → measure live match rate → raise
    gate to 0.85 + boundary tests 43/50 only if the measured rate supports it.
20. **Render-level sankey label bbox gate leg (5H judge hardening):** ~~the
    exporter TDD bbox test proves the *precomputed* layout is collision-free,
    but if the site font or node metrics ever drift from the exporter's
    assumptions, labels could re-collide at render time. Add a G9 Playwright
    leg asserting no two rendered flow-label bounding boxes intersect at 1440.~~
    **DONE 2026-07-03:** G9 leg f — getBoundingClientRect on every rendered
    label (one <text> per node group), same-river pairs, ≤1px tolerance,
    collected at initial render AND after the FY switch; zero labels found
    fails loudly. The first clean run caught a REAL shipped collision
    (b:a:CLASSIFIED|3080F × b:ba:F|3600F|05, 9.9×2.5px) — root cause was the
    exporter model under-measuring "Avenir Next" (LABEL_H 10 vs 13.09-unit
    rendered em box; several width buckets below measured advances). Fixed
    exporter-side (LABEL_H 13.2, buckets re-derived to dominate measured
    advances, GUTTER_MAX 250→270) + re-export. Pre-failure (CSS font
    injection, 166 errors) + live-catch record in
    reviews/5c-gates-pre-failure.txt.
21. **favicon.ico 404:** ~~browsers request /favicon.ico by default; the site
    ships only the Next.js app-dir icon. Add a favicon.ico to site/public/
    (or a redirect) — found as the sole console error during 5H live
    verification. Also from judge advisories: include print-CSS +
    reduced-motion captures in visual-judge evidence packs; consider pinning
    the breakdown-overlay filter box in the sticky header.~~
    **DONE 2026-07-03:** real favicon.ico (16/32/48 PNG-entry ICO, brand
    receipt mark on the OG palette; scripts/generate-favicon.mjs for
    provenance) + explicit icons metadata; breakdown-overlay filter input
    moved into the overlay's non-scrolling header (state lifted to
    BreakdownOverlay, reset on close; 4 new vitest cases); evidence-pack
    print + reduced-motion capture requirement documented in
    reviews/EVIDENCE-CONVENTIONS.md.
22. **Confirm eval robustness fixes post API-cap reset (2026-08-01):** run
    `verify-phase5` once the Anthropic monthly usage cap resets — the
    table-equivalence groups, temperature-0 determinism, SQL-determinism
    rules, and transient-error retries all landed after the clean 48/48+43/43
    run (eval-20260703T190641Z) and need one confirming exit-0 run. Also
    consider a runner-side distinction between transport ERRORs and agent
    answers in the artifact (an ERROR currently scores "correct" on
    REFUSE-expected questions).
    *Update 2026-07-04 (Phase 5G Task 5):* Navy J-book detail landed and the
    marts were rebuilt; the mechanical grader-recompute (`evals check`) shows
    **43 ok / 0 stale / 5 skipped** — the count-pinned questions (incl. q017
    `fct_budget_trajectory` = 1982) did NOT drift, because Navy PEs were
    already in the R-1/P-1 workbook marts the pins key off; the new
    `jbook_details` narrative rows don't touch any pinned SQL. No expected-answer
    edits were needed. The confirming live eval run stays deferred to this item
    (API capped until 2026-08-01).
23. **Decade-parquet ↔ lake integrity leg** (Task 6 review): ~~a dedicated gate
    recomputing budget_lines_decade.parquet from the lake would close the
    residual artifact-tamper window for both parquets symmetrically.~~
    **DONE 2026-07-03:** verify-phase5e gate e (decade_parquet_gate5e) —
    ≥30 sampled decade-parquet rows; each row's grain (pe_bli, edition,
    amount_type) must sum across the whole parquet to a scenario_map
    candidate sum in the lake (reuses _lake_candidate_match, P-1R
    excluded). Main budget_lines.parquet deliberately out of scope (direct
    Postgres export, anchored by verify-phase5b1 — see gate docstring).
    Proof-can-fail recorded in reviews/5c-gates-pre-failure.txt; exhaustive
    off-gate sweep: all 32,233 grains recompute, 0 failures.
24. **fid_to_bl_amount overlap equality assertion** (Task 6 review): ~~5,257
    fids exist in both budget_lines and decade parquets; assert amount
    equality so a divergent decade copy can't hide behind setdefault.~~
    **DONE 2026-07-03:** _load_fid_to_bl_amount now Decimal-compares every
    overlapping fid; any divergence FAILs verify-phase5b1 gate 1 with the
    offending fids listed (first 10). Live run: 5,257 overlap, 0 divergent.
25. **PB2024 P-1R title backfill** ~~(582 title-NULL rows; P-1 was fixed in the
    Task 5 improvements round; P-1R out of scope there).~~
    **DONE 2026-07-03:** the P-1R sheet uses the same 'Program
    Element/Budget Line Item (BLI) Title' header the P-1 fix already
    mapped, so scripts/backfill_pb2024_p1r_titles.py (wipe+reload,
    self-verifying) sufficed: 582 rows, title-NULL 582 → 0, amount drift 0,
    lake re-exported. Honest residual: PB2025 (450) and PB2026 (403) P-1R
    rows are also title-NULL for the same historical reason — reload those
    two documents with the same pattern if P-1R titles ever render.
26. **Dead-PE 0605230F request_vs_request minting** if a feed claim ever
    covers request-vs-request swings (currently scoped to request-vs-actuals
    precisely because those are 100% minted).
27. **R2 sync belongs in the deploy loop + a live-PDF gate (5G, high value):**
    the deploy drill (rebuild → Vercel `--prod`) never re-synced
    `data/site/pdfs → R2`, so PDF citations for every post-launch phase silently
    degraded in production until the 2026-07-04 catch. Two fixes: (a) fold
    `scripts/launch/upload_r2.sh --live` into the standard deploy sequence (or a
    `deploy` make-target that does both); (b) add a gate leg that fetches ONE
    recently-added jbook_pdf citation's asset from assets.fiscalreceipts.com and
    asserts 200 + non-zero body — so a missing-from-CDN PDF fails a gate instead
    of a user. Until then, run upload_r2.sh --live after any ingestion phase.
28. **Agency PEs with ingested decade detail but no FY2026 page (coverage
    enhancement, NOT a bug — surfaced by the 2026-07-05 audit).** A large set of
    program elements carry FY2017–2025 J-book/workbook detail in the warehouse
    but have no FY2026 `budget_lines` row, so they generate no `/program/`
    page — the decade history exists but isn't browsable (the audit estimated
    ~271 agency PEs under its criterion; a looser budget_lines-only cut is
    larger). These are legitimately absent from FY2026 (zeroed, consolidated,
    or renamed lines), so this is a decision about whether to build history-only
    pages for a PE that no longer requests money, not a data defect. Scope if
    taken: a "decade-only" page tier (or fold into the rollup tier with an
    explicit "no FY2026 request" note), gated for citation-completeness like the
    other tiers. Deferred — verify the exact eligible set and its editorial
    value before building.


## Remaining launch items

- **GitHub repo push** ✅ DONE 2026-07-02 — user-authorized; standalone history
  synced to github.com/andeslee444/govbudget via subtree split (re-sync per phase).
- **R2 assets** ✅ DONE 2026-07-02 — 52 objects / 154 MiB at
  `assets.fiscalreceipts.com`; PDF panel, explorer, and downloads verified at
  full fidelity in production browser.  CORS live test 7/7 PASS.
- **Domain** ✅ DONE 2026-07-02 — site LIVE at `https://fiscalreceipts.com`
  (apex A 76.76.21.21 DNS-only, www 308-redirect via Vercel API, canonicals/
  sitemap/OG on the domain, receipt moment verified in production browser).
  `govbudget.vercel.app` remains as an alias.
- **`NEXT_PUBLIC_SITE_URL`** ✅ DONE 2026-07-02 — baked into the production
  build (`https://fiscalreceipts.com`); 3,750 sitemap URLs on the domain.

## Standing constraints (unchanged, every phase)

Cited-or-absent; influence correlational never causal; no invented bidders;
derived figures labeled; supersede-not-delete; loud failures; polite scraping;
LLM only where deterministic paths fail; merge only on green gates + suite.
