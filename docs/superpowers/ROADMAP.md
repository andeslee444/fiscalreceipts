# GovBudget Roadmap — Source of Truth

**Updated:** 2026-08-07 · Living document: phase ledger, findings log, improvement
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
| 5E | Decade backfill PB2017–PB2026: 10 J-book editions (371 books, 159,503 budget lines, 38,422 detail facts, amounts provenance for every edition, 185 manifest-recorded exclusions, era procurement re-keyed {account}-{org}-L{line} with disjointness guard); fct_decade_series 59,068 + fct_book_diff 18,379 (exhaustively lake-recomputed); /years/ 12 edition-tagged columns; decade sparklines on 1,994 program pages; 15 request-vs-actuals feed cards | verify-phase5e CLI (23rd gate, 4 legs, pre-failure recorded) + G8 legs f/g + edition-integrity | ✅ COMPLETE 2026-07-03 (one open confirmation, below) | Adversarial review rounds caught + fixed: edition-merging dbt fence (291 programs would have shipped wrong FY2024 actuals), PB2023 OSD/CBDP books wrongly excluded (sole detail carriers for 112 PEs), era pe_bli collisions with modern BLI codes, 27.8k-orphan citation-export hazard, P-1R subset rule (993 withheld grains published incl. C-130J $1.78B); visual judges first-round PASS medians E1:4 E2:5 E3:5 E4:5 E5:5 + 4 polish fixes shipped; 22/22 npm gates; 1,196 pytest / 352 vitest; eval 48/48 accuracy + 43/43 citations achieved (artifact eval-20260703T190641Z); ✅ CONFIRMED 2026-07-05 (cap raised): verify-phase5 exits 0 — eval 48/48 + 43/43 citations, freshness PASS, assembly PASS (artifact eval-20260706T014127Z); robustness fixes held on a fresh live run (see backlog #22) |
| 5G | Service J-books — Navy FY2026 (Army/AF manual path): Playwright download adapter past the secnav.navy.mil bot-WAF, classifier allowlist for appropriation-code naming (RDTEN/APN/OPN/…), per-family BA-split dedup, account-scoped Gate B, thousands-form provenance; 5,810 Navy detail facts + 2,066 narratives; 351 Navy PEs flipped rollup→full (full-tier universe 462→813; 387/593 Navy display PE-BLIs now carry book detail) | verify-phase5e gate a (superseded-terminal fix) + program-skeleton universe recount + render-static unresolved→state-B | ✅ COMPLETE 2026-07-04 (Navy live-verified; Army + AF on manual drop-dir path) | Probe-first: Playwright reached the live secnav SharePoint listing (spike URL dead); sample RDTE book confirmed Scenario-A embedded jb-2009 XML (252 PEs). Live-data fixes no fixture caught: per-family BA-split dedup (each PDF embeds the full master → 12× procurement over-load), account-scoped Gate B (Navy P-1 line numbers unique only within an appropriation → 204 false failures), thousands-form provenance. 11 duplicate doc rows non-destructively superseded (status flip, reversible — not DELETE); silent_unreconciled=0; verify-phase1/5b1/5e + 22 npm gates PASS; 1,244 pytest (1 pre-existing dossier-CSV failure, API-capped) / 363 vitest. Live-verified flagship 0601153N "Defense Research Sciences": full-tier, 108 R-2 narratives, cited amounts open derived-formula + breakdown panels, and the 40MB Navy RDTE PDF renders in the citation panel after the R2 sync. **R2 asset drift caught + fixed:** the deploy drill rebuilds site/out + Vercel but never re-synced data/site/pdfs → R2, so since the 2026-07-02 launch the 5E decade + Navy PDF citations silently degraded to "open official source" in production; re-ran upload_r2.sh (190 files / 1.48 GiB) → all PDF citations now full-fidelity. Army: asafm.army.mil Akamai blocks even a realistic headless Chromium (spike's "Playwright bypasses Akamai" premise disproven) → manual path, no stealth transport built. |
| 5G-archive | Service J-books — Army + Air Force + Space Force FY2026 via the Internet Archive: asafm.army.mil (Akamai-403 to server clients, per the 5G probe) and saffm.hq.af.mil (CAC) both mirror their PUBLIC books WAF-free on Wayback — a legitimate public archive of public records. New `archive_fetch.py` (CDX enumeration + `id_` raw-bytes download, all robustness-guarded), ARMY_NAMES/AF_NAMES classifier allowlists (org A / F; Space Force → org F via embedded ServiceAgencyName="Air Force" + SF-suffix PEs), empirical master-identity dedup (`dedup_service_master_dups`), per-document xml dir. **Army 507/513 + AF·SF 519/538 page-less PE/BLIs now carry book detail** (11k detail rows across 17 live books, 14 deduped); 1203154SF verified. source_url = ORIGINAL gov URL (Wayback is transport, not cited). | archive_fetch unit suite (MockTransport, no live net) + registry Army/AF/SF classifier + full-inventory partition + byte-identity regression + master-dedup (Postgres) + CLI archive-dispatch | ✅ COMPLETE 2026-07-05 | Provenance-first: `--source archive` enumerates via CDX → downloads through the Wayback raw-bytes endpoint → existing extract/load/reconcile unchanged. Six transport findings no fixture caught, each a committed fix + test: (1) shared xml/ dir clobbered masters across the many-books-per-org-folder layout → per-doc `{stem}__xml/`; (2) Wayback availability API flaky (returns {} for archived URLs) → CDX authoritative; (3) HTML-interstitial snapshots → `%PDF` magic guard; (4) 5 MB-boundary truncation → `is_complete_pdf` (%%EOF) on download AND resume; (5) variant-only archival (AF RDTE Vol I only under `?ver=`) → `variant_snapshots` fallback; (6) transient 504s → failed/missing reset to registered on re-run. Dedup finding: the Navy filename BA-split heuristic does NOT generalize (Army RDTE is genuinely per-volume distinct; AF RDTE Vol I-IV share one master) → empirical master-sha grouping. silent_unreconciled=0; verify-phase1/5e/5b1 PASS (PB2026 discovered=81 terminal=81); 1275 pytest (1 pre-existing dossier-CSV failure, API-capped). Evidence + full findings: docs/superpowers/reviews/5g-archive/. NOT done here (separate rounds): exporter/site ripple (tier flips, /methodology/ wording), deploy + R2 re-sync, judge pack. |
| 5G-archive-site | Exporter + site ripple for the Army/AF/SF archive round: surface the ingested Army (org A) + Air Force / Space Force (org F) FY2026 J-book detail on the site. dbt rebuild grew dim_programs to 1,739; export-site flipped the service PEs rollup→full (full-tier universe 813→**1,741**; rollup 1,182→**252**; total page universe 1,993). Full-tier by org now F=519, A=508, N=387. Coverage honesty: `isIngestedServiceOrg` extended N→{A,N,F} (Space Force folds under 'F' — 'SF' is a PE-number suffix, never an org); rollup service-books note + `/program/[peBli]` justification empty-state + methodology coverage section all say the service books ARE ingested (this line just has no matching R-2/P-40 narrative) instead of the false "not yet ingested"; methodology names Navy+Army+AF+Space Force ingested via official + Internet Archive sources with the near-zero classified/no-R-2 residual. | 22/22 npm gates (program-skeleton universe recount + ingested-wording accept; yearsmatrix budget 2MB→4MB; render-static Cite contract on new pages) + isIngestedServiceOrg tests + search-eval | ✅ COMPLETE 2026-07-05 (live-verified) | Movers, each a sanctioned fix not a weakening: (1) **yearsmatrix budget 2MB→4MB** — matrix grew 813→1,741 programs (~3.0MB) at the SAME ~1.6KB/program density; raised the exporter constant, the G20 gate, AND the pytest budget test (now pinned to the exporter constant so they never drift). (2) **2 mis-parsed pe_blis dropped** — Army R-1/P-1 lines that mis-parsed the appropriation label ("RDT&E", "O&M") into the pe_bli slot; the '&' breaks Next.js static routing → the pages 404'd (0 data-sections, caught by G21). Added a route-safety filter in the exporter (`_is_route_safe_pe`) so these garbage PEs never generate broken pages; real programs with "RDT&E" in their *title* are untouched. (3) **search near-exact company boost bug** — the 3-char-stub heuristic wrongly boosted "GENERAL ATOMICS" over "GENERAL DYNAMICS CORP" for query "general dynamics"; tightened to a real head-prefix overlap (typo cases darppa/lockeed/boeng still pass). (4) **search-eval corpus drift** — every military department now carries its own full-tier "Defense Research Sciences" PE (5-way title tie), so the DARPA-specific case was disambiguated to "defense research sciences darpa"; G5 back to 29/32 (91%). Eval count re-baseline: `evals check` → 43 ok / 0 stale / 5 skipped — no count-pin drifted (the new jbook_details rows touch no pinned SQL; live-eval confirm stays on backlog #22, API-capped). **R2 re-synced** (backlog #27 lesson): the 17 new Army/AF/SF PDF binaries pushed to R2 (`upload_r2.sh --live`), else citations degrade to "open official source"; SF book 40f1f67d…pdf + an Army (asafm) + an AF (saffm) book all return HTTP 200 from assets.fiscalreceipts.com. Live-verified **1203154SF "Long Range Kill Chains"** (the user's ask, #1 by FY2026 request at $7.7B): now FULL-TIER with 12 canonical sections, the real GMTI mission narrative, R-2 detail table, and working PDF citations to the Space Force RDT&E book (pages 647/649/654) — and one Army full-tier (0603462A NGCV, 114 narratives) + rollup coverage wording confirmed. Deploy `vercel --prod --archive=tgz` (6,732 pages, 2 fewer than pre-fix) aliased to fiscalreceipts.com; 1,275 pytest (1 pre-existing dossier-CSV failure, API-capped) / 363 vitest / tsc clean / eslint 0 errors. Evidence: docs/superpowers/reviews/5g-archive/live-*.png. |
| 5G-dossiers | Regenerate top-50 dossiers for the service-J-book-shifted top-50 (40/50 changed after the Navy + Army/AF/SF ingestion — the current #1 is 1203154SF "Long Range Kill Chains" at $7.7B, and the old defense-wide top-50 that had dossiers dropped out). Recompute live `research.top50`; rewrite `data-seeds/program_categories.csv` to the live set (40 new rows: 6 space, 3 shipbuilding, 31 default; each with a resolvable narrative `source_ref`) → fixes `test_covers_live_top50_exactly`. Author 40 new dossiers in the exact production schema (sections→claims, every claim a real resolvable `fact_id`) via **Claude Code subagents** (not the cost-capped Batch API) — the cited-or-absent gate makes subagent-authored dossiers as honest as pipeline-authored. Committed raw source in `data/research/dossiers-raw/{pe}.json` (honest provenance marker, no faked API batch metadata) so `dossiers collect` reproduces them; the `dossiers submit` CLI remains for future API runs. | `dossiers gate` + `verify-phase5b3` + full pytest | ✅ COMPLETE 2026-07-05 (live-verified) | Dossier gate PASS: 50/50 present, **0 unresolvable citations, 733/733 claims warehouse-cited (100%, floor 80%)**, categories 50/50. **`test_covers_live_top50_exactly` now PASSES** (the one pre-existing API-capped failure noted in 5G rows — now cleared); `test_seed_emits_verbatim` re-pinned to the shifted top-50 (space/cyber/shipbuilding, no hypersonics in the current top-50). Full suite **1,282 pytest / 0 failures**. Faithfulness handled per program: classified lines (0603525N PILOT FISH, 846510 SAP) state "classified per E.O. 13526" and cite only money facts — the "absent" half of cited-or-absent, no fabricated mission; discretionary vs. reconciliation (mandatory) splits cited to distinct budget-line fact_ids; only contractors named IN the J-book narrative asserted (Lockheed for F-35 C2D2, Dynetics for IFPC) — no invented bidders; percent-changes cited only where a feed `figure_fact_id` backs them. 22/22 npm gates PASS (gate-12 animation now 50/50 `data-hero-category` after the fresh build baked the new categories). Deploy `vercel --prod --archive=tgz` aliased to fiscalreceipts.com; **R2 re-synced** (`upload_r2.sh --live` — citations/ 2.85 MiB + data/ 5.4 MiB refreshed so dossier fact_ids resolve). Live-verified 1203154SF (What-it-is/Why-it-matters/Key-players + Golden Dome + $7,696,916, fact_id `7d4bd900234f652c` resolves via same-origin cite-shard HTTP 200), 0603525N (classified framing), 1000 (ship maintenance). |
| 5I-lineage | Program lineage — evidence-tiered YoY money-flow tracking across PE/BLI identity changes (transfer / split / merge / BA-maturation / rename), so a user can follow one funded activity across all the identities it wore over time. Two honesty tiers: **Stated** (regex over FY2026 R-2/P-40 `detail_narratives`, each edge cited to its source sentence + page + `fact_id_narrative`) and **Inferred** (deterministic RDT&E same-agency BA-maturation with a funding taper — never cited, dashed amber "candidate (unverified)", opt-in, never summed). New Postgres `program_lineage` (008) + `program_family` (009) tables + parquet exports; stated-only union-find families with a 1:1-chain helper (stops at split/merge/cycle/partial). Site: per-program lineage rail + reconstructed **family funding line** (sums ONLY the clean 1:1 chain; honest branch note on splits; "(unresolved)" for a cited page-less successor) at `data-section="lineage"`; threaded `/years/` family-thread badge. | **verify-lineage** CLI (24th gate; legs: stated-cite re-derive, id-agnostic family-integrity recompute, one-to-one-sum honesty — proof-can-fail recorded, later hardened) + **render-static inferred-honesty leg** (every `[data-inferred]` must carry a "candidate/unverified" label) | ✅ COMPLETE 2026-07-07 (live-verified) | **Extraction-probe reality (the honest headline): the tiers are small-but-bulletproof, not the "bulk coverage" the spec optimistically framed.** Regex-over-narratives is high-precision/low-recall: **25 stated** (FY2026-fenced) + **3 inferred** = 28 edges, 19 families, 44 PEs, 48 lineage sidecars. Coverage expansion (LLM extraction over the ~1,950 prose transfers, lineage Sankey, multi-edition citations) is deliberately Phase 2. Adversarial rounds caught + fixed live-data defects no fixture saw: (1) **inferred=0 was a plan bug** — the series query filtered a single edition (`edition_year=2026`), collapsing the request trajectory to one FY so no taper could compute; fixed to the cross-edition request series, then `_ba_digit` tightened to RDT&E-only (`06\d(\d)`) + a same-agency-suffix guard — **14 noisy cross-appropriation/cross-service edges → 3 textbook maturations** (0601384BP→0602384BP, 0603654N→0604654N, 0604294D8Z→0605294D8Z, each same serial+agency, one BA rung, a real taper). (2) **Citation resolvability** — 28 of 53 stated edges cited pre-2026 narratives NOT in the site's binding PB2026 cite-shard fence → their `<Cite>` would not resolve; **fenced stated extraction to FY2026 narratives** so all 25 resolve (FY2026 books still narrate historical predecessors, e.g. "previously funded in PE 0206625M in FY2023"). (3) **verify-lineage leg-c dangling-terminal carve-out** — an adversarial reviewer cloned the warehouse and laundered an *uncited* garbage terminal (`deadbeefdeadbeef`) through; hardened so the carve-out is **locally citation-gated** (the dangling terminal's incoming edge must itself pass leg-a) and the NOTE neutralized (no "not-yet-ingested" claim — spec §5.4). (4) Graph helper hardened: **cycle guard** (reciprocal cross-FY stated edges would hang the exporter) + **partial-transfer exclusion** (a `portion_amount` edge must not extend the 1:1 line — spec §5.3). Honesty invariants verified on the live export: 48/48 stated rail entries cite a resolving fact_id (0 dead-cites vs the 134,215-fact universe), 6/6 inferred entries `evidence:null`, 2 dangling refs `resolved:false`, all 19 families' funding lines equal a chain-only recompute exactly. Visual judges median **4/4/4** ("stated-vs-inferred separation exemplary; a casual user cannot mistake a candidate for a fact") → 1 fix round: **directional-honesty bug** (successor cards wrongly read "realigned from" → made direction-aware "realigned to"), `/years/` family-glyph legend, clickable "cited" affordance, funding-chain head title. **22/22 npm gates + verify-lineage (25/25 · 44/44 · 19/19, exit 0) + 1,326 pytest / 391 vitest / tsc clean.** Deploy `vercel --prod --archive=tgz` (359.7MB tarball, 88,526 files) aliased to fiscalreceipts.com; R2 re-synced (11 objects, 0 new PDFs). Live-verified in prod: `/program/0604818A/` renders the rail + a stated cite (`b3123c07e825d2d8` resolves via cite-shard to the Army RDT&E PDF), `/program/0605294D8Z/` shows the dashed `data-inferred` "candidate (unverified)", `/program/0604270F/` shows the "realigned to" direction fix, `/years/` carries `family_id`. Spec `docs/superpowers/specs/2026-07-06-program-lineage-design.md`; plan `docs/superpowers/plans/2026-07-06-program-lineage.md`; pre-failure evidence in `5c-gates-pre-failure.txt`. |
| 5I-review | Final whole-implementation review + live browser test of 5I (user-requested): 35-agent multi-dimension review (find → adversarial verify; 30 findings → 19 confirmed / 11 refuted) + hands-on prod walkthrough of every core journey. **Two CRITICALs the per-task reviews could not see, both live: (1) funding line displayed a multi-member SUM citing a single member's fact — 74/148 shipped points contradicted their citation (worst: $349M cited to a $0 fact); (2) extractor fabricated an endpoint when a sentence named both — 3/25 stated edges asserted a wrong predecessor (rollup-line narratives 837300/834190 aggregate statements about OTHER PEs).** Fix rounds: both-named-endpoint extraction (cross-pairs named PEs, never `this`; subject-position rule, lookahead/lookbehind-guarded) + per-member cited funding points (one entry per (fy, member), v == its fact, NO uncited sums; coexistence FYs render each member labeled). Gate teeth added, each proof-can-fail on the REAL pre-fix warehouse: leg (a) endpoint-contradiction (the 3 bad edges failed verbatim), leg (d) funding-point value==fact vs the built artifact (148 shipped mismatches failed), leg (e) lake↔DB binding (missing parquet = FAIL), FY2026 fence constant shared producer↔gate, cite-degrade print→hard error, render-static stated-side leg (bare stated card = FAIL) + inferred zero-count honesty; verify-lineage wired into the verify-phase5 assembly (8/8 incl. a fresh live eval 48/48 + 43/43). | verify-lineage (5 legs) + assembly + 22 npm gates | ✅ COMPLETE 2026-07-28 (live-verified) | **Re-extraction under the corrected rule GREW the gold tier: 25 → 31 stated (the old self-ref drop was silently discarding 6 real edges, incl. a 5-source fan-in into 0303005F), 22 families; merge fan-ins now flag the branch note (in-degree>1); dangling ORIGIN carve-out mirrors the terminal one (citation-gated).** UX fixes from live testing: evidence sentence now rendered (collapsed "show sentence" blockquote, `data-source-text="lineage-evidence"` — closes the "cited click never shows the sentence" gap), FY chip reads "per FY2026 J-book" (edition, not transfer year), search "Companys"→proper plurals, deep-content hits titled by program name (was raw URL path) + "Chainssource" join spacing, answer strip "run by A."→"run by Army" via serviceOrgName. 1,357 pytest / 410 vitest / tsc clean / 22/22 gates / verify-lineage a 31/31 · b 53/53 · c 22 · d 528 pts 0 fail · e 34/34. Deployed (`vercel --prod --archive=tgz`, aliased fiscalreceipts.com) + R2 re-synced (13 objects); live-verified 7/7: repaired 0207436F→0303004F sentence in prod, per-member FY blocks with per-fact cites, sentence blockquotes, branch note, copy fixes, shard resolution. Findings that remain by design: 4 dangling origins + 1 dangling terminal (cited, `resolved:false`); meta descriptions still use raw org codes (cosmetic, non-prose). Commits b81d4b7/59b417b (criticals+legs), 91a473b/d96a4a8/cadba85 (importants+UX). |
| PM-S1 | PM-review Sprint 1 — trust (spec `2026-07-30-pm-review.md` P0-1..P0-5, P1-1, §Systemic Fix): kill the basis-collision defect class. **Gate 23 "basis" built failing-first** (proof-can-fail: 76,106 attribute-less figures, the F-35 $5.25B/$5.57B collision, 26 summary/detail contradictions + 1,497 false absences, missing footnote fields) — then made green: (1) **dim_programs dual-volume dedup** (47 Army PEs summed at 2× across BA-volume PDF pairs — a defect class the PM review itself missed, caught by the new gate; 0601102A 644.682→322.341, dbt pin + fixture teeth); (2) **basis threading** on all 80,253 program-page figures (`basis/fy/measure/entity/edition` + always-visible ≥12px chips: `P-1 TOA · PB2026` / `P-40 detail · PB2026`), 730 latent same-label collisions resolved honestly in payload attribution; (3) **summary cards from the toa-preferred union** (F-35 FY24 card now $5.57B TOA; FY25 false absence → $4.97B enacted; absence-reason enum `not-published`/`no-comparison`/`no-rollup`, zero bare dashes) + **reconciliation strips** (one mechanism sentence + per-year arithmetic `$5.57B − $5.25B = $318.6M`, delta unlabeled — the bridge row isn't a parsed fact); (4) **unified footnote formatter** (program, FY, row name, value+unit, document title, locator, SHA-256, retrieved, fact permalink; Chicago/AP/BibTeX/JSON; goldens = gate 23 leg c); (5) **fact addressability**: `/fact/{id}` via out/vercel.json edge rewrite → client resolver over the permanent cite-shards (semantic header from the program sidecar, canonical-origin permalinks, 2 real fid8 collision pairs disambiguated), `#fact-{id}` scroll+highlight+open-drawer anchors, ONE public id (the chip/drawer mismatch was two truncations of one 16-hex id — now both `fid[:8]`), `pe_bli` added to shard payloads; (6) **P1-1**: citation underline 1.26:1 → **4.95:1** (hover 7.78:1, gate 6 teeth reproduce the PM's exact 1.26/1.23 measurements in the pre-failure record), 24 provenance elements 10px→12px, **Receipts default ON** (relabeled "Fact IDs", persisted, no-flash hydration); (7) hero/OG/feed on canonical TOA + scope qualifier. | gate 23 (3 legs) + gate 6 contrast/size legs + gate 1 fact-route leg + footnote goldens | ✅ COMPLETE 2026-07-31 (live-verified) | Visual judges **4/4/4** (definitional clarity unanimous) → 1 fix round (strip boilerplate→arithmetic table, resolver semantic labels, canonical permalink origin, 5 minors). Full loop: 1,375 pytest / 563 vitest / tsc clean / **23/23 gates** / verify-lineage exit 0 / verify-phase5 assembly PASS incl. live eval 48/48. Deployed (`vercel --prod --archive=tgz`, READY, aliased) + R2 re-synced (12 objects). **Live PM-appendix repros 7/7 PASS**: ATA000 card=$5.57B + strip + no false absence; `/fact/bb54b165` → 200 via edge rewrite; hero qualifier live; `#2b6dd3` decoration + "Fact IDs" toggle shipped; 0601102A halved to $322.3M. Commits ac7b7e9→02b8bd2 (9). Sprint 2 (P1-2..11) + Sprint 3 (RSS, P2s, coverage page) queued per the PM's sequencing; deferred judge nits (footnote preview, chart color semantics) + raw-org badge sweep + stale /data/ Explorer parquets (P1-5) folded into Sprint 2. |
| PM-S2 | PM-review Sprint 2 — usability & credibility (spec `2026-07-30-pm-review.md` §P1-2..§P1-11). **P1-4 search:** alphanumeric normalization (F35→F-35, B21, KC46), magnitude-blended ranking (Sentinel→GBSD above Sentinel Mods), a corpus-verified alias table with "also known as" chips, readable filing titles ("LOCKHEED MARTIN — PENN AVENUE PARTNERS, 2024 Q1") — **search-eval 29/32 (91%) → 36/37 (97%)**. **P1-5 data truth:** `/data/`'s row counts were hardcoded literals frozen at 5B-2 values (8 of 15 wrong — dim_programs claimed 326 against a 1,739-row parquet, jbook_details 4,421 against 21,028) while the parquets themselves were always correct — the page lied about its own data, not the data about itself; now every count + row-grain scope comes from an exporter-emitted manifest, plus one canonical corpus statement on the four pages that disagreed. **Found in passing: `budget_lines_decade` (32,642 rows) was not merely undocumented but UNQUERYABLE** — missing from the Explorer's registry, a whole shipped dataset invisible. Same defect class then closed on `/methodology/` §3 (197 test functions/42 modules/21 dbt assertions/45 eval pairs/≥41 — every literal rotted; real: 87 dbt, 24 gates, 48, 44 — now derived from dbt's compiled manifest, the verify.mjs registry, the eval set and the gate's own threshold constant; pytest/vitest totals deliberately REMOVED rather than re-hardcoded, since neither derives honestly at export). **P1-6/P1-7:** currency ladder through T (`$3657.4B` → `$3.66T`), data-derived FY ranges replacing three inconsistent statements, deterministic sorts on every table (filings 2024/2026/2025 → 2026/2025/2024). **P1-9 workbook drawer** (the weakest citation tier): `5,565,655 USD thousands (= $5.57B)`, a per-cell arithmetic line, and a build-time cell preview with context rows — cell data measured at +25.7% on cite-shards if inlined, so routed to lazy per-fact sidecars (22.1 MB, fetched on open). **P1-2/P1-3/P1-10/P1-11:** dossier-hoisted WHAT-IT-IS cards with their fact chips (field-generated fallback for non-dossier programs), the Raytheon/RTX split merged into **one RTX family at #3, $68.9B** (was #4 + #6) behind a hand-curated, source-audited events table on its own page, GAO department-level qualifier, `/programs/` filter + Org sort + CSV. | gate 24 "datatruth" legs a–g (dataset cards, rendered row counts, Explorer picker, corpus statement, /methodology/ build-checks, declared table sorts, curated-family merge) + gate 4 test 3 rebuilt (workbook drawer contract, 35,940 citations) + gate 21 leg f (dossier cards) | ✅ COMPLETE 2026-08-04 (live-verified) | **Visual judging FAILED first at 3/3/3, passed on re-judge at 4/4/4** — the fix round is the substance of this row. Round-1 majors, all real: mobile clipped the payload of three separate fixes (`/companies/` money column, `/data/` scope prose, the search alias chip truncating "Ground Bas…"), the alias table shipped to ⌘K **only** so `/programs/` returned the exact wrong "Sentinel" answer the sprint set out to kill, the deepest citation tier dropped the basis label Sprint 1 added everywhere else, and a merged $68.9B total showed no addends in the same sprint that added "how the cells combine" arithmetic. **Worst: two factual errors in our own curated data** — Exelis labeled "acquired 2019" (Harris acquired it May 2015; 2019 was the L3Harris merger) and Rockwell Collins "renamed 2023" (it entered by acquisition, UTC 2018). The source audit that followed re-opened all 17 rows against their filings and found the Exelis row's **source URL never supported the date it was cited for** (a pre-close shareholder-approval 8-K, replaced with the Item 2.01 completion filing), reclassified 3 events to the wrong `kind`, dropped 3 dollar figures the sources never stated, and caught a curator hazard where `normalize_name("United Technologies Corporation")` would have merged an unrelated $1.5M family into RTX. Schema gained `evidence`/`source_form`/`source_date`/`source_verified`; 2 rows are labelled name-inferred **on the row**; events are now annotated **per former name** (EXELIS acquired 2015 · ROCKWELL COLLINS acquired by UTC 2018 · RAYTHEON COMPANY merged 2020), each deep-linking to its `/families/` row. A re-judge independently spot-checked six curated dates and found **every one correct**. Final polish also fixed a regression the fix round itself introduced (arithmetic line and preview table disagreed on sign convention — now `+ O840 (−246,702)` substitutable straight from the row) and `/families/` at 390px (98px overflow with the **Source column entirely off-screen**, on the page whose whole argument is sourcing). 1,477 pytest / 748 vitest / tsc clean / **24/24 gates**. | 
| PM-S3 | PM-review Sprint 3 — reach & self-description (spec `2026-07-30-pm-review.md` §P1-8, §P2-1..§P2-8, §Coverage). Eight tasks: a **390×844 mobile gate leg** built first (backlog #31 — Sprint 2 passed 24/24 and then failed judging on mobile clipping no gate exercised); **withdrawal of 87 false "zeroed out in FY2026" feed claims** (absence in an edition is not a zero — and the investigation surfaced backlog #32, a PB2026 taxonomy renumber the corpus cannot express); **RSS/Atom + 123 program and 55 company watch feeds** with a dollar magnitude on every card and a per-item linkage basis; **§P2-1 page weight** — `/programs/` 5,875,345 → 2,733,056 bytes (−53.5%; the spec blamed `/years/`, which measured as a 28 KB shell) — plus **§P2-2 `/years/` opens on money** and a mobile column-chip disclosure; **§P2-3/§P2-6 chart a11y** — accessible names, computed descriptions, "View as table" on 5 charts, a Sankey paint-order fix (gate 22 leg f), and a scope-vs-caution note vocabulary; **§P2-4/5/7/8 display** — company title-casing, distinct `0`/`<0.05`/`—` cell states, reproducible derivation strips, count notation; a **rebuilt `entity_xwalk`** correcting a ~73% understatement on 201 pages; and a new **build-derived `/coverage/`** page (12 rows, every figure recomputed at build time, 8 dated targets and 4 reasoned refusals) plus a **`/flow/` two-rivers reframe**. | gate 3 mobile leg (m1/m2, then **m3** added in the fix round) + gate 6 chart legs + gate 22 leg f + gate 24 leg h | ⚠️ **GATES COMPLETE, VISUAL BAR NOT MET** 2026-08-05 — **NOT deployed** (deploy explicitly out of scope for this task, pending a controller decision) | **Visual judging FAILED twice: round 1 unanimous 2/2/2 at 390 and 3/3/3 at 1440; round 2, after the fix round, unanimous 3/3/3 at BOTH widths. Median never reached the ≥4 bar, and this row says so rather than rounding up.** Round 1's majors were all invisible to a 24/24 suite: **the home page painted the program title straight over its dollar delta** ("Test & Evaluation Science & Te**+$1.34B**ogy" — two of five figures on the front door unreadable); `/feed/` kept its desktop two-column row at 390, leaving ~110px for the headline (one or two words per line, ~1.4 cards per screen); **`/flow/`'s "View as table" — the sprint's own accessibility affordance — pushed the AMOUNT column out of its scroll box, so the fallback the chart's caption sends readers to carried no dollars at all**; and §P2-2 sorted the ROWS but not the viewport, so `/years/` still opened on FY2015A, empty for exactly the newest programs the new sort promotes, with the sorted column off-screen at both widths. **The gate work is the durable part.** (m3) — a label must not be painted over its value — was written, run against a deliberately-broken artifact, and **PASSED**, because it measured `getBoundingClientRect()` on a flex item that shrinks while its inline text overflows: the boxes never intersected, only the glyphs did. Rebuilt on painted extent (element + descendants + text line-boxes) it reproduces the shipped defect verbatim ("4/5 mover title vs change figure pair(s) collide — '0605238FGround Based Strategic Deterrent EMD' overprints '+$2.14B' by 59x20px"). The `/years/` leg was **strengthened, not relaxed**: it had pinned the LEFTMOST cell — a proxy that was passing on a column of em-dashes — and now reads the sorted key from the table's own `data-sorted-col` and measures that column (proof-can-fail: "300/300 sorted-column amount cell(s) are outside the 390px viewport — row 0: '7,696.9' left=993"). `/`, `/feed/` and `/flow/` joined the value-bearing sample; `/` had been in it but overflow-only, so the front page's sole assertion was one the defect could not trip. Round 2's majors were surfaces holding the answer in their own payload and not rendering it: **four different filings naming one PE in one quarter rendered as four identical rows** (registrant now on the row; the filing × program × matched-word grain also collapsed, Lockheed 1,296 → 1,219); **"Budget-Linked Awards" named no budget line** while `pe_bli` sat untyped in the sidecar; the chart table showed "RDT&E, Air Force" at $36.1B *and* $26.2B with no parent (now "from Air Force / Space Force" vs "from Classified Programs", 93/95 rows); the decade card claimed **"Ten fiscal years" on a five-year grid**; and `/companies/` said "total federal obligations" against a DoD-only lake. **Gate 1 then caught the fix's own cost** — naming the program on 318 award rows blew the page-weight ceiling by 172KB; the table was capped at 50 with its total stated (717,690 → 289,878 bytes) and **the ceiling was not touched**. Loop at final HEAD: 1,497 pytest / 853 vitest / tsc clean / eslint 0 errors / **24/24 gates** / verify-lineage PASS (31·53·22·528·34) / verify-phase5 assembly 8/8. **Live eval: FAILED first at citation 42/43 (q011 answered correctly through literal/echo SQL — `touched_tables` empty), PASSED on an immediate re-run at accuracy 47/48 and citation 43/43**; q011 has flaked twice before, so this is agent nondeterminism against a 100% bar, filed as backlog #36. The one persistent miss is q022 = backlog #34 (eval wording, not a regression; the gate passes on it). Findings left unfixed and why: the 390 Sankey still clips node values at the scroll edge (inherent to an 840px chart in a 356px scroller — mitigated by a swipe cue and the table view, not removed); 1440 Sankey value labels still sit on node bars and are crossed by de-obligation hairlines (chart-geometry work, not a copy fix); **`/data/` reports `dim_programs` at 1,739 against a site-wide claim of 1,741 — the parquet is right and the corpus number is two lines generous (backlog #35), which means the site currently overstates its own detail-grade coverage on the number `/coverage/` leads with**; `/flow/` "10 of 24 crosswalked PEs" vs `/district/` "17 of 1,741" unreconciled; filing pages keep their source ALL-CAPS registrant names; minus glyphs differ across pages. Commits a323b15→7734004 (7). |
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
6. **Site-mart gaps found in 5B-1 recon:** ~~no per-family obligations-by-year
   mart (company page time series), no feed/event mart~~, dim_geography lacks
   fiscal_year/pe_bli breakdown (district drill-down) — build in 5B-2/5B-3 as
   their pages need them (YAGNI until then).
   *Correction 2026-08-07 (verified against the codebase for the backlog-drawdown
   plan; do NOT close this entry):* the two mart sub-items are **DONE** —
   `dbt/models/marts/fct_family_obligations_by_year.sql` and
   `dbt/models/marts/fct_feed_events.sql` both exist. The third clause is
   **STILL TRUE and remains OPEN**: `dim_geography` is exactly
   `[pop_state, pop_district, transaction_count, total_obligation]` — no
   `fiscal_year`, no `pe_bli`. The district fiscal_year/pe_bli breakdown this
   entry asked for has not been built.
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
    *Correction 2026-08-07 (for whoever closes this entry):* the backlog-drawdown
    plan's verification grep, `grep -rniE "ocr|mistral|document.?ai"
    src/govbudget/`, is a false-positive generator — the unanchored `ocr` matches
    So**cr**ata, producing 14 spurious hits (`src/govbudget/states/`,
    `verify_phase4.py`). Use the anchored form instead:
    `grep -rniE "\bocr\b|mistral|document.?ai" src/govbudget/ | grep -v test` —
    verified genuinely clean (0 hits) on 2026-08-07.
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
22. ~~**Confirm eval robustness fixes post API-cap reset:** run `verify-phase5`
    once the Anthropic cap resets — the table-equivalence groups, temperature-0
    determinism, SQL-determinism rules, and transient-error retries need one
    confirming exit-0 run.~~ **DONE 2026-07-05:** the user raised the monthly
    cap; `verify-phase5` exits 0 — gate freshness PASS, **gate eval 48/48
    accuracy + 43/43 citations PASS**, gate assembly PASS (artifact
    eval-20260706T014127Z). All robustness fixes held on a fresh live run: no
    flakes, no mid-run transport ERRORs, 100% citation resolution. The freshness
    gate additionally caught a legitimate 1-answer drift — q017
    `fct_budget_trajectory` 1982→1980, from the p1_loader junk-pe_bli cleanup
    (commit 481bba0 removed 2 bogus PEs); the analyst answered 1980 correctly and
    the stale expected was re-baselined (sanctioned mechanical fix). Still open
    as a nicety: the runner scores a transport ERROR as "correct" on
    REFUSE-expected questions — worth a distinct ERROR outcome someday (backlog).
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
27. ✅ **DONE 2026-08-06 — R2 sync folded into the deploy loop + a live-asset
    check that runs itself.** The deploy drill (rebuild → Vercel `--prod`)
    never re-synced `data/site/pdfs → R2`, so PDF citations for every
    post-launch phase silently degraded in production until the 2026-07-04
    catch. (a) `scripts/launch/deploy.sh` is now the only deploy path and the
    source of truth for the sequence: preflight (out/ complete, `vercel.json`
    present, rclone + PDF source present) → `upload_r2.sh --live` →
    `vercel --prod --yes --archive=tgz` from `site/out/` → live verification.
    Assets go up BEFORE pages, so no live page ever cites a binary that is not
    there yet (`upload_r2.sh` never deletes, so an early sync is always safe).
    LAUNCH.md §7d now points at the script and keeps only the *why* — the two
    load-bearing constraints (cwd `site/out/`, `--archive=tgz`) and the
    backlog-#27 history. (b) `scripts/launch/verify_live_assets.mjs` fetches the
    N most recently added **cited** `jbook_pdf` assets (newest binaries under
    `data/site/pdfs/` that a `hosted_pdf_url` actually points at — citations.json
    is ~90 MB so it is streamed, not parsed) and asserts 200/206 + non-zero body
    + `%PDF-` magic, plus `citations/citations.parquet` and the site's `/fact/`
    rewrite. **Deliberately NOT a gate in `npm run verify`**: that suite is
    hermetic and offline by design, and production CDN state cannot be true
    before the upload that creates it — a pre-deploy gate asserting it would be
    vacuous at best and green-on-last-deploy's-assets at worst. It is step 4 of
    `deploy.sh`, exits non-zero, and is runnable standalone to audit what is
    live. Proof-can-fail recorded (a real 404 for an absent sha).
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
29. **Program-lineage Phase 2 (coverage + depth, from 5I).** The Phase-1 lineage
    layer is small-but-bulletproof (25 stated + 3 inferred edges) because regex
    over narratives is high-precision/low-recall and stated edges are FY2026-fenced
    to the cite-shard edition. Phase 2 expands it, each piece with its own honesty
    gate: (a) **LLM extraction** over the ~1,950 prose transfers that name a move
    but no adjacent PE code → many more *stated* edges, each verified to resolve,
    gated on an extraction-precision check (uses the API); (b) **multi-edition
    citations** so the 28 pre-2026 stated edges (dropped in 5I for cite-shard
    resolvability under the binding PB2026 fence) can ship with resolving cites;
    (c) a **lineage Sankey** (reuse the `/flow/` renderer) — identities as nodes
    over time, dollar ribbons for transfers/splits/merges; (d) cross-appropriation
    (RDT&E↔Procurement) money-color lineage beyond what a stated narrative asserts.
    Two dormant 5I code notes to fold in when they become live: when `portion_amount`
    extraction lands, `has_split` (exporter `_emit_lineage`) must also flag a
    partial-transfer chain truncation so the funding line is always explainable;
    and `_load_lineage_for_export`'s `fiscal_year or 0` coercion should skip/log an
    unparseable fy rather than emit a fy:0 edge (both unreachable in Phase 1).
30. **Program-level GAO ingestion (from PM Sprint 2 §P1-10).** The Oversight
    section on a program page currently shows only the DEPARTMENT-level GAO
    designation (`DOD — 5 high-risk areas`), now correctly labelled
    "Department-level designation (not specific to this program)" and visually
    de-emphasized so it cannot be mistaken for a program finding. What is
    missing is the program-specific tier: GAO issues real program-level work
    (the annual Weapon Systems Annual Assessment GAO-25-107569 and its
    predecessors; program-specific reports and recommendations), and on the
    F-35 in particular the absence is conspicuous. Phase: ingest GAO reports
    keyed to weapon programs, crosswalk report→pe_bli (title/PE match, gated
    like every other crosswalk on a precision check), render program-specific
    findings ABOVE the department note with the emphasis the department note
    gave up, and cite each to its report page. Until that lands, the honest
    statement on the page is exactly what it now says: no program-specific GAO
    finding for this line is in the ingested data.

31. ✅ **DONE 2026-08-04 (PM Sprint 3 Task 1) — a gate now exercises a mobile
    viewport.** The defect class: three mobile blockers — `/companies/` rendering its
    money column off-screen, `/data/` pushing its scope prose off-canvas behind
    250–400px near-empty rows, and `/families/` hiding the Source column that is the
    page's entire credibility claim — walked past a 24-gate suite untouched and were
    caught only by human-style visual judging, because every gate that drives a
    browser did so at desktop width. **Gate 3 (render-live) gained a 390×844 leg**
    (`site/scripts/gates/mobile.mjs`; standalone runner `run-mobile-leg.mjs`; sample
    pinned by 9 vitest cases) rather than a 25th gate — gate 3 already owns "does
    every page class render in a real browser" and its harness, so this is the same
    question at a second width. Two assertions: (m1) no page-level horizontal
    overflow over a 13-page sample covering every page class carrying a table or a
    wide chart, and (m2) the primary value element's box fully inside the viewport on
    the five value-bearing pages, identified by `data-*` hooks and never by text.
    (m2) is the load-bearing one: all three blockers sat inside an `overflow-x-auto`
    wrapper, so the container scrolled and (m1) alone passes on two of the three.
    Proof-can-fail reverts the three real Sprint-2 treatments in a scratch copy of
    the built stylesheet — all three reproduce, `/families/` at exactly the recorded
    +98px. **The first run against the live build found a fourth, shipping instance:
    `/district/`'s Linkable-dollars column sat 38px off the right edge at 390** (the
    Sprint 1 fact-id chip re-widened it past the Sprint 2 State-column fix); fixed by
    hiding the Programs column below `sm` with the count moved under the district
    code. Evidence: `docs/superpowers/reviews/5c-gates-pre-failure.txt`.

32. **Program-element lineage across a taxonomy renumber (from PM Sprint 3 Task 1b).**
    Task 1b withdrew 87 false "zeroed out in FY2026" feed cards, but the investigation
    surfaced a real and unmodelled phenomenon underneath them: **PB2026 renumbered
    program elements at scale, and the corpus has no way to say so.** Counting PEs in
    the PB2026 edition that carry FY2024/FY2025 money but no FY2026 figure ("retired")
    against PEs that carry FY2026 money and nothing earlier ("new"): Army 115 retired /
    33 new, Air Force 77/36, Navy 69/14, OSD 18/9, **DARPA 14/8**. DARPA is the clean
    case because it is small enough to read end to end: PB2026 retired *Defense Research
    Sciences*, *Tactical Technology*, *Sensor Technology*, *Electronics Technology* and
    10 more thematic lines, and introduced *Emerging Opportunities*, *Access and
    Awareness*, *Warfighting Performance*, *Effects*, *DARPA Advanced Technology
    Development* and 3 others — while DARPA's FY2026 total **rose to $4.92B from
    $4.15B**. Only 2 of 16 PEs carried through unchanged. **This is NOT an ingestion
    gap** — verified against the primary source, `data/raw_docs/fy2026/dod/r1_display.xlsx`
    shows the FY2026 cells for the retired lines are genuinely BLANK and the new lines
    genuinely have no FY2024/FY2025 history; the parser is reading the workbook
    correctly (an earlier "DARPA coverage artifact / parser problem" hypothesis was
    investigated and refuted). The gap is in the MODEL, not the data: nothing links a
    retired PE to its successors, so a reader who followed *Defense Research Sciences*
    for a decade hits a page that simply stops at FY2025 with no forward pointer, and
    any YoY analysis keyed on pe_bli silently drops ~$7B of continuing work. This is
    the natural next edge type for the 5I lineage layer (backlog #29): a
    `pe_remap` / `restructured_into` edge, evidence-tiered like the existing Stated and
    Inferred classes — Stated where a PB2026 R-2 narrative names the predecessor PE,
    Inferred where budget-activity + account + money conservation make a mapping likely.
    Until it exists, program pages for retired PEs should at minimum say "this program
    element does not appear in the FY2026 request" rather than ending silently — the
    honest version of the claim the withdrawn cards were trying to make. Sizing: the
    edge extraction is Phase-2 lineage work; the "does not appear in FY2026" page note
    is small and independently shippable.

    *Correction 2026-08-07 (for the planned #32a interim-note task, backlog-drawdown
    Task B2 — not yet filed as its own entry):* the task's proposed non-vacuity floor
    of 190 is wrong. 190 PEs carry FY2025 money and no FY2026 row, but only **165 of
    them have a `/program/` page** to render the note on — the other 25 have no page
    at all (that gap is backlog #28/D5 territory, not this task's). A floor of 190 can
    never pass against a 165-page eligible set. **The verified floor is 165.**

33. ✅ **DONE 2026-08-05 (PM Sprint 3 Task 5b) — a derived parquet older than its
    inputs understated the headline figure on 201 pages by 73%.**
    `data/parquet/entities/entity_xwalk.parquet` was built 2026-06-10 20:19; the
    FY2020–FY2026 contract partitions landed between 21:00 that night and 07:50 the
    next morning. Nobody rebuilt it. Every `/company/{slug}/` and `/companies/` row
    therefore published a `total_obligation` **labelled FY2017–FY2026 that summed only
    FY2017–FY2019** — Lockheed Martin $135.36B against a true $502.12B. The figure was
    never internally inconsistent; it was consistent with a stale input and wrong about
    the period it named, which is why 24 green gates and a 48/48 eval walked past it.
    **The rebuild alone would have been worse than the bug.** `build_entity_xwalk`
    aggregated `recipient_parent_uei` and `recipient_parent_name` with INDEPENDENT
    `max()`, so over a decade — where a recipient's registered parent legitimately
    changes — it took the uei from one transaction and the name from another and emitted
    **6,342 parent pairs that occur on no transaction anywhere**: $210B of Lockheed
    Martin into a family named `SIKORSKY SUPPORT SERVICES`, $88B of Electric Boat into
    one named `WICO`. Both defects are latent in a narrow window and only fire on a wide
    one. The parent is now chosen as a WHOLE PAIR by the obligation dollars behind it,
    under a total order (dollars, count, strings) so the build is reproducible. The
    crosswalk also now spans **contracts ∪ assistance** — the same union
    `fct_award_transactions` is, and the union every minted entity `query_body` sums —
    so `dim_entities.total_obligation` is reproducible from the query printed beside it
    (coverage 94.2% → 100.0%; 87,579 → 129,375 UEIs). **Gate 23 gained leg (d)**
    (`entitytotals-recompute.py`): d1 runs all 1,877 published `query_body` statements
    verbatim and requires each to return its own `recorded_value`; d2 finds the leading
    FY window over which the crosswalk reproduces the lake and requires it to END at the
    declared `fy_max` — the half that catches a figure wrong only about its period; d3
    fails when the parquet is older than a partition it reads. All three reproduce the
    shipped defect. d1 then caught a **second, independent** defect it was not aimed at:
    the `/feed/` new-entrant citations omitted the `obligation > 0` predicate their own
    mart carries, so 394 of 1,667 published queries returned a different number than the
    figure beside them — invisible until the rebuild populated that surface. Ranking
    moved as it should: RTX #6→#4, Raytheon #4→#10 (its UEIs resolve to RTX), Pfizer and
    Centene new to the top 200 on FY2020–21 awards the stale window could not see.
    Evidence: `docs/superpowers/reviews/5c-gates-pre-failure.txt`.

34. **Eval q022's instruction contradicts its own ground truth (found by PM Sprint 3
    Task 5b; NOT fixed there, deliberately).** q022 asks for the MDA HHI and vendor-family
    count and instructs: *"Report both values as integers, exactly as the SQL returns them
    (e.g. 2068, not 2068.0)."* That wording was written when `round(hhi, 1)` happened to
    return the integral 2068. The Task 5b crosswalk rebuild moved MDA's HHI to **2118.5**,
    so the instruction now tells the analyst to truncate a genuinely fractional value: it
    answered `2118, 3319` against an expected `2118.5, 3319` and was scored wrong. This
    is the only miss in the 47/48 run — the gate passes on it — and it is an eval-wording
    defect, not an analyst failure. It was left alone in Task 5b on purpose: rewording an
    eval question inside the same change that moves the data the question measures is the
    pattern that makes an eval untrustworthy, even when the motive is innocent. Fix
    separately: the intent is "do not add or drop decimal places", so say that rather than
    "as integers", keep the `e.g. 2068, not 2068.0` example, and re-run the live eval to
    record the corrected score.

35. ✅ **FIXED 2026-08-05 (Sprint 3 round 3).** The detail-grade tier is now
    defined by the J-book DETAIL ROWS: `getDetailGradeCount()` counts the
    `program_details` sidecars that hold at least one detail row (1,739),
    cross-checked against `dim_programs.parquet`'s published row count with a
    THROW on disagreement. The corpus statement, `/coverage/`'s lead row, the
    years-matrix note and the service-books note all read it. Two sentences
    were reworded rather than re-numbered because their count was right and
    their label was wrong (`/programs/` "the 1,741 detail-grade program
    elements" and `/methodology/` "the grid's rows ARE the N programs with
    detail-grade data" — the grid renders the whole index). datatruth leg (d)
    recomputes it the same way and now also fails when the sidecars and the
    parquet disagree. Original entry:

    **The corpus says 1,741 detail-grade programs; the detail table has 1,739
    (found by PM Sprint 3 round-1 visual judging; NOT fixed there).** `/data/`
    reports `dim_programs` at 1,739 rows while the corpus statement on the same
    page — and the `/coverage/` row, and gates 1, 20 and 21 — say 1,741 carry
    detail-grade R-2/P-40 J-book data. The page explicitly invites that
    comparison ("a row count can be compared against the right denominator"), so
    the unexplained 2-row gap undercuts its own premise. Checked: the two extra
    program elements are `0603115DHA` (Medical Development, DHA) and `0708083D`
    (Assembled Chemical Weapons Alternatives, Army). Both are in `programs.json`
    — so both get pages and both are counted in the 1,741 — and both carry
    `project_count: 0` and `narrative_count: 0`, i.e. no R-2/P-40 detail at all.
    **`dim_programs` is right and the 1,741 label is two lines generous**, which
    means the site is currently overstating its own detail-grade coverage, on the
    number the new `/coverage/` page leads with. Not fixed in the fix round for
    two reasons: re-baselining the corpus number touches gates 1, 20 and 21 plus
    the `/coverage/`, `/years/`, `/programs/` and `/data/` corpus statements, and
    the alternative (stating the difference on `/data/`) requires re-running
    `export-site` to regenerate `datasets.json`, which is not something to
    trigger under a pending deploy decision. Fix separately: decide whether the
    detail-grade tier is defined by "has a program page" or "has R-2/P-40
    detail", make every surface use that one definition, and add a gate leg that
    fails when `dim_programs` and the corpus statement disagree — the current
    suite checks rendered counts against the parquet but never the parquet
    against the corpus claim.

36. **The eval gate's 100% citation-resolution bar is flaky against a
    nondeterministic agent (found by PM Sprint 3 verification).** `verify-phase5`
    FAILED on its first run of the sprint — accuracy 47/48 (threshold 44, fine),
    but citation resolution 42/43 because q011 returned the right answer through
    literal/echo SQL, leaving `touched_tables` empty. An immediate re-run of the
    same gate, same build, same data scored 47/48 accuracy and **43/43
    citation**. The historical record shows the same question flaking twice
    before (2026-07-03, two different reasons), so this is analyst-agent
    nondeterminism, not a data or site regression. The bar is right — a citation
    that does not resolve is not a citation — but a single sampled run of an LLM
    agent gated at exactly 100% will fail intermittently for reasons unrelated to
    the build, and a release process that treats that as a blocker will either
    stall or teach operators to re-run until green, which is worse. Fix
    separately: either retry the citation-recompute step for a question whose
    answer scored correct but whose SQL was a literal echo (bounded, e.g. 2
    attempts, and record that it was retried), or make the gate report
    best-of-N with the per-attempt detail persisted. Do NOT lower the threshold.

37. ✅ **FIXED 2026-08-07 AT SOURCE — the grain is the PE, and the warehouse
    now owns the rollup.** `programs.json` held one row per PE with one `org`,
    and its `trajectory` carried that org's SHARE. For 1,738 of 1,741 programs
    the declared org is the only org, so the slice IS the program and nothing
    showed; three shared BLI codes published a part as the whole (FY24→FY26,
    USD thousands): BLI 30 "Other Major Equipment" 408,006→**435,163** /
    212,900→**232,181** (OSD + DMACT 13,012 + DTRA 12,787 + DoDEA 1,358); BLI
    20 "Vehicles" 356→**2,491** / 911→**3,141**; BLI 500 "Personnel
    Administration" 105,943→**110,388** / 79,251→**83,048**. Found by gate 23
    leg e in Sprint 3 round 3; the FY26 one had been shipping since the column
    existed.

    THE GRAIN DECISION, recorded: a row is a **PE**. pe_bli is the row
    identity, the `/program/{pe_bli}/` URL, the generateStaticParams key, the
    dead-link page set and the corpus count — one page per PE, always. The
    (PE, org) alternative multiplies the index against that URL space and
    leaves the `/programs/` row and the page it links to disagreeing by
    construction. The org grain is real and STAYS, in `fct_budget_trajectory`,
    where an agency's share is an agency-grain question.

    `fct_program_trajectory` (new dbt model, grain pe_bli) is the rollup, and
    `assert_program_trajectory_component_sum` pins every metric to the sum of
    its component rows — both directions, NULL-aware, change columns included.
    Proof-can-fail: redefine the model as the primary-org pick and it FAILs 3,
    naming BLI 30/500/20 with got/want. NOT a shipped parquet: a second public
    "trajectory" table differing on 3 of 1,741 rows would be a fresh footgun.
    The exporter reads it for `programs.json`, both sidecar tiers, search
    ranking, and the summary block's slot-2 fallback — which resolved to the
    PE's PRIMARY ORG, i.e. a component card on a program page whenever the
    decade grain was absent. Citation identity collapses to the parent at one
    component (1,738 programs keep their fact ids; no number gained a second
    receipt); the three shared BLIs mint a program-scoped derived sum whose
    inputs are every component's workbook rows, so rule 4c recomputes it.

    The site KEEPS reading years_matrix's decade cells on `/programs/` and
    `/agency/{org}/` — no longer as a workaround (the fixed trajectory agrees
    to the cent on all 1,799 FY24 and 1,671 FY26 programs where both publish)
    but because the decade cell is the same FACT the linked page cites. Same
    number from two facts still gives a reader two receipts for one figure.

    Enumerated and deliberately unchanged: the agency FY2026 sum stays the
    component grain (summing program totals there would credit OSD with
    DMACT's, DTRA's and DoDEA's money). See #45 for its coverage gap.

38. ✅ **DONE 2026-08-06 — the escape hatch WAS conflating two exemptions, and
    the split is the fix.** `/methodology/` wrapped its entire
    `<div class="container">` in `data-source-text="methodology"`, so the
    render-static negative-currency scan and datatruth leg j both skipped the
    single page arguing for the site's rigour. Round 3 declined the obvious fix
    (wrap ~8 paragraphs, each needing its own citation anchor for the (a0)
    constraint). **What the gate code actually said:** the marker was doing
    THREE jobs — (a0) "block-cited, so no per-figure anchor, and no
    `[data-amount]` may hide inside", (b) "these dollar strings are the
    *source's*, so do not demand `<Cite>`", and leg j "this *notation* is the
    source's, not ours". Jobs (b) and leg j are FORMATTING exemptions and are
    only earned by prose that genuinely comes from somewhere else — measured:
    dropping the skip wholesale would fail ~3,650 currency tokens under
    `narrative`/`dossier-claim`/`lineage-evidence` (real J-book prose, correctly
    exempt) and 226 leg-j hits, all under `narrative`. So a blanket "sweeps stop
    honouring it" does not hold; the narrower expression is **per-VALUE
    classification**. `scripts/gates/source-text-kinds.mjs` is now the one table
    both gates read: `narrative`/`dossier-claim`/`lineage-evidence`/
    `footnote-preview` earn both formatting exemptions (verbatim source prose);
    `headline` earns the currency one only (exporter-composed sentence — its
    *notation* is ours, so leg j sweeps it, 0 new failures); an **unclassified
    value fails render-static**, so a new marker can no longer buy silence by
    existing. `methodology` is gone as a kind: the page quoted nothing, and its
    sentinel `data-xml-path="site:methodology/prose"` was a fake anchor invented
    to satisfy (a0) — one container edit removed both, no paragraph re-wrapping,
    and `[data-amount]` is now legal on the page for the first time. Its 9
    non-figure dollar tokens (thresholds, a tolerance, GAO's $186 B, the
    $7.07B/$4.92B/$4.15B worked examples) are enumerated with reasons in
    `prose-allowlist.json`, whose `pages` field — present in the JSON since day
    one and **ignored by the gate**, matching every pattern site-wide — is now
    honoured, with dead patterns and stale (matched-nothing) entries failing the
    gate. That used-entry rule doubles as the render-static non-vacuity proof
    for `/methodology/`; leg j adds a COVERAGE guard (≥90% of the page's numeric
    leaves must be reached — a bare "≥1" would have been satisfied by the site
    chrome alone, i.e. would have passed the very defect it guards). Result:
    `/methodology/` = 47 numeric leaves swept, 9 currency tokens scanned, no
    real defect surfaced once visible (round 3 had already fixed by hand the
    three these sweeps would have caught). Proof-can-fail recorded for all four
    arms.

39. ✅ **FIXED 2026-08-13 — a published, enumerated titles-override table,
    applied at every point the exporter emits a program title.**
    `Joint Hypersonic Technology Development &Transition` (PE 0603183D8Z) was
    missing the space after its ampersand, verbatim from the source workbook.
    `data-seeds/title_overrides.csv` (`pe_bli, source_title, display_title,
    reason, verified_on`) is keyed on the SOURCE title as well as the PE, so
    an upstream workbook correction silently disarms the row instead of
    rewriting a title it no longer describes. `apply_title_override()` /
    `load_title_overrides()` route through it — the fan-out was larger than
    the plan's five named surfaces: correcting `all_prog_rows`,
    `titles_by_pe` and `bl_titles` once each (rather than patching every
    dict-literal call site) covers `programs.json`, `program_details`'
    `budget_lines` rows, `search_quick.json`, `feed.json`, `years_matrix.json`,
    the /companies/ `linked_programs` list, district/filing/flows sidecars,
    and the `breakdowns/` show-your-work labels — 8 call sites across 2
    genuinely independent raw-title reads inside `_emit_breakdowns` that the
    first pass missed and a manual post-build grep caught. `workbook-cells/`
    is deliberately EXCLUDED — it quotes the cited .xlsx cell verbatim, typo
    and all, because a citation drawer has to show what the source actually
    says. A missing seed raises `FileNotFoundError` at export time (the #55
    silent-`{}` failure mode is exactly what this refuses to repeat); an
    export-time gate re-reads the built JSON surfaces and raises if any
    listed `source_title` survived uncorrected; a row that never matched
    anything in the corpus prints (not raises — a PE can legitimately drop
    out of a future budget). The override list itself is published
    (`title_overrides.json` → `/methodology/`), so the correction is visible,
    not silent. `RDT&E`, `HM&E`, `S&T`, `D&UP` and `R&D` are unaffected
    site-wide (confirmed on the built HTML) — this was never a display-time
    regex.

40. **The mobile navigation drawer shipped as a 32px sliver on every page —
    and no gate could see it (found by round-3 visual judging, FIXED
    2026-08-05).** The panel is `absolute left-0 top-14 w-full`, written to
    position against the sticky `<header>`; the span wrapping the trigger in
    `layout.tsx` carried `relative`, so that 32px span became the containing
    block and `w-full` resolved to 32px. All nine nav links rendered 24px wide
    at x=358 in a 390 viewport, clipped to three characters, and opening the
    menu widened the document 390 → 457px. All three judges found it
    independently; two called it the single largest defect at 390. Fixed by
    dropping one word, plus a dismiss-on-click backdrop scrim. The LESSON is
    the gate gap, not the CSS: gate 3's mobile legs (m1-m3) all measure the
    page AT REST, so a defect that only exists after a click was structurally
    invisible to the suite. Leg (m4) now opens the menu and checks it — panel
    present, ≥5 links, every link inside the viewport and ≥64px wide, no label
    clipped by its own box, no document widening — with proof-can-fail
    recorded. Any future affordance that only exists in an interaction state
    needs its own leg; "the page looks fine on load" is not coverage.

41. **The decade trajectory chart drew a cited figure as visually zero on all
    1,741 program pages (found by round-3 visual judging, FIXED 2026-08-05).**
    The chart was min-max autoscaled with no y-axis, so the series MINIMUM
    landed exactly on the baseline rule. On `/program/ATA000/` that is the
    FY2026 request: a cited $4.09B drawn as nothing, directly above a table
    stating $4.09B and 73% of the FY24 actual. On a site whose argument is
    that its figures are exact, a figure rendered as zero while its own table
    says otherwise is the cardinal defect. Fixed by padding the plotted domain
    below the minimum and stating the scale in words beneath the chart (no
    figures in that sentence — gate 2 requires every rendered dollar amount to
    sit inside a `<Cite>`, and the extremes are already in the cited grid
    below). ✅ **Remnant CLOSED 2026-08-07:** the x-axis labelled only the
    first and last fiscal year, at 8 viewBox units, so every dot between them
    sat at an unlabelled position — on a chart whose own caption says to read
    it for direction. It is labelled at a regular step now, with a tick under
    each label, the step derived from span × plot width against a collision
    pitch (a decade gets FY15/18/20/22/24/26; a five-year program gets every
    year; a one-year program gets one and does not divide by zero). Type 8→9
    units, `#9ca3af`→`#6b7280`. `axisLabelYears` is exported and unit-tested,
    including "no two labels closer than the pitch" across every span 4–16
    years.

## PM-review Sprint 3 — round-3 visual judging

First panel (3 independent opus judges, both widths, ~120 screenshots each):
**390 → 2 / 2 / 3, median 2. 1440 → 4 / 3 / 4, median 4.** The desktop bar was
met; the phone bar was not, and all three judges gated the phone score on the
same defect — the nav drawer above (#40). The five commissioned fixes
(undated coverage targets, the `/programs/` basis collision, the corpus
overstatement, `/flow/` parentage, `/company/` precedence) drew no criticism
from any judge; every 390 finding was a defect the round had not been pointed
at, which is the panel doing its job.

Second panel (3 fresh independent opus judges, after those fixes):
**390 → 3 / 4 / 3, median 3. 1440 → 4 / 3 / 3, median 3.** The phone median
moved 2 → 3; the desktop median moved 4 → 3 against a different panel. The
≥4 bar was NOT met at either width by this panel — see the third panel below,
which was run after the next round of fixes and cleared it. The nav drawer, the filing truncation and
the `/companies/` fold were all confirmed fixed — no judge on the second panel
raised any of them. What the second panel raised instead is largely SYSTEMIC
rather than defect-shaped: no layout spine (#42), no reading measure, no
desktop type scale, Fact-ID chips louder than their figures (#43), and the
budget-river Sankey unencoded beside a fully colour-encoded sibling. Those are
a design pass, not a fix round, and saying otherwise would be overstating what
this round can deliver.

Third panel (3 fresh independent opus judges, after the second round of
fixes, run against the final HEAD): **390 → 4 / 4 / 4, median 4. 1440 → 4 / 4 /
4, median 4. The ≥4 bar is MET at both widths**, unanimously and without a
split. All three cited the same load-bearing strengths — the citation drawer,
the reconciliation strips, the edition-stamped `/years/` headers, the
contractor-bridge honesty — and none raised the nav drawer, the filing
truncation, the `/methodology/` text defects, the clipped mobile tables or the
`Total` contradiction, all of which had been fixed by then.

What all three still want, and what stays open (#42, #43, plus the Sankey
labelling and the caveat-before-content ordering): one content spine and one
reading measure, the Fact-ID chip made subordinate to the figure it annotates,
budget-river label collisions resolved, and the explanatory prose demoted below
the data it qualifies on five index pages. Those are a design pass and an owner
decision, not fix-round work, and the panel scored 4 with them outstanding.

Fixed after the SECOND panel: `/company/`'s "Total" column, which summed income
and expense while `/data/` documents them as "non-additive, never summed" and
the payload flags every row `nonAdditive` — the site contradicting its own data
dictionary, and the most serious finding of either panel; three run-together
words and an outdented bullet list on `/methodology/`; the two tables that
scrolled sideways at 390 with no cue while `/flow/` and `/years/` had one; the
translucent nav panel; the program-page hero decoration overflowing a 390
viewport; and the program `h1`, which was 24px at both widths.

Fixed after the FIRST panel, from the judges' convergent list: the nav drawer and
its scrim (#40); the exporter's 120-character mid-word snippet cut on
`/filing/` and the blind ellipsis on program pages (all three judges); the
`/companies/` phone fold, which put ~24 lines of caveat prose ahead of the
first company (all three); the `/company/` awards table, the one table on the
site with no mobile treatment; three home-page feed cards that truncated to
the same string; a right-edge fade on the `/flow/` Sankeys; and the decade
chart baseline (#41).

42. **No layout spine: the content column starts at five different left edges
    (found by round-3 visual judging, panel 2 — NOT fixed).** Measured `h1`
    left offsets at 1440: 96 (`/flow/`, `/years/`), 160 (`/programs/`,
    `/companies/`), 224 (nine pages), 288 (`/`, `/filing/`), 352
    (`/methodology/`) — six distinct `max-w-*` values across nineteen route
    files, against a header whose wordmark is pinned at 96. All three judges on
    the second panel named it, two put it first on their "what would move 1440
    up" list: navigating Programs → Feed → Flow slides the page sideways each
    time, and on 12 of 14 pages the title does not align with the brand.
    Deliberately NOT fixed in the fix round, because the obvious change makes
    a second reported defect worse: the same panel measured explanatory prose
    at 136-165 characters per line on `/coverage/`, `/companies/families/`,
    `/program/` and `/`, so widening those containers to align them would
    push an already-over-long measure further. The two have to be solved
    together — pick at most two container widths (wide-for-matrix aligned to
    the header at max-w-7xl, narrow-for-prose) AND cap the reading measure at
    ~70-75 characters inside the wide one. That is a design pass across every
    route, not a fix-round edit, and it wants a gate leg that measures rendered
    characters-per-line so it cannot drift back.

43. **Fact-ID chips are ON by default and outweigh the figures they annotate
    (found by round-3 visual judging, panel 2 — NOT fixed, needs an owner
    decision).** All three judges on the second panel reported the same thing:
    the blue monospace hash is visually louder than the dollar value beside it,
    it wraps to a second line on wider figures (giving `/programs/` an
    alternating 63/90px row rhythm), and toggling it off "proves the underlying
    table design is much better". This is NOT a defect to fix unilaterally: the
    default was set deliberately in PM Sprint 1 §P1-1 — "the site is named
    Fiscal Receipts; its receipts are not opt-in" — and flipping it reverses a
    recorded product decision. Options for the owner: keep ON but make the chip
    quieter than its figure (smaller, lower contrast, no fill); reveal on
    hover/focus; or default OFF with the dotted underline carrying the signal.
    Whichever, the figure should be the loudest thing in its own cell.

44. ✅ **FIXED 2026-08-07 — every feed headline figure now clicks through to
    its source.** `data-source-text="headline"` earned the currency-scan
    exemption, and its own `why` said so as a KNOWN GAP: the sentence was
    composed by the export pipeline as one string (`"… first award FY2025,
    $3.1M total"`), so its dollar tokens could not carry per-token anchors and
    were the only site-computed currency figures reaching a reader with no
    citation affordance — on the syndication surface, the most-forwarded,
    least-context view the site has. Before #38 it was invisible; #38 named it.

    **40 tokens** on the live corpus (25 `new_entrant`, 15
    `request_vs_actuals_gap`; `yoy_swing` and `concentration_shift` headlines
    print a percentage and an index, not money). **Every receipt already
    existed** — all 40 matched a fact id already on the card, so nothing was
    minted. The exporter emits `headline_segments` (text runs + `{amount,
    fact_id}`) and `<FeedHeadline>` renders the amount runs through
    `<ProseCite>`. Two invariants: the segments re-join to the flat `headline`
    exactly (it still ships in RSS/Atom/JSON and to search), and a dollar
    figure enters a headline ONLY with a receipt — where the fact does not
    resolve the money clause is dropped rather than printed uncitable.

    Gate flip: `headline` → `quotedFigures: false` (it now earns NEITHER
    formatting exemption; it stays classified because (a0) — no nested
    `[data-amount]` — is exactly what forces per-token anchors). One enabling
    change, and it is a strengthening: leg (b) accepts `[data-prose-cite]` as
    an anchor, which (a1) forces to RESOLVE, where a bare `[data-amount]` need
    carry no fact at all. New leg **(a2)** binds render to exporter both ways —
    segments re-join, every flat-headline currency token is covered by an
    amount segment (the non-vacuity arm), every amount segment resolves, and
    `/feed/` renders exactly as many headline prose cites as the sidecar
    declares. Suite stays 24 gates.

45. **The agency FY2026 sum's coverage gap (enumerated by #37, deliberately
    not closed there).** `agencies.json`'s `fy2026_total_thousands` is the
    COMPONENT grain by design — an agency total is an agency-grain question,
    and summing program totals would credit OSD with DMACT's, DTRA's and
    DoDEA's money. But it iterates `dim_programs`, which carries ONE org per
    PE, so a shared BLI's components under a different org are absent from
    that org's page entirely: DCSA is missing BLI 20's 2,230, DMACT BLI 30's
    7,258, DTRA BLI 30's 12,023, DHRA BLI 500's 3,797 — $25.3M across four
    agencies. It is not a wrong number (those pages do not list the PE either,
    so the total is consistent with what they show) but it is an
    under-statement with no note. Closing it means giving `dim_programs` a
    per-org grain — a dimension change, not an aggregate fix — and would move
    which agency page lists a shared BLI. Written down at the call site in
    `export_site.py` in the meantime.

**#47–#53 (filed 2026-08-07, an independent multi-persona review): a true,
correctly-cited figure wearing a false label.** Every one of the six passes
every existing gate, because those gates check number↔citation and nothing
checks claim↔citation. Sprint A′ (`docs/superpowers/plans/
2026-08-07-sprint-a-prime-claim-citation.md`) closes all six and adds the
gate family that makes the class visible.

> **✅ ALL SIX CLOSED 2026-08-08** on branch `sprint-a-prime-claim-citation`
> (20 commits, HEAD `b41ddaa`). Verified at final HEAD: **24/24 gates PASS**,
> 1,551 pytest, 949 vitest, `tsc` clean, 0 eslint errors, `verify-lineage` PASS
> (6 legs), `verify-phase5b3` PASS (50/50 dossiers), eval 47/48 · citations
> 43/43 (the one miss is q022, a pre-existing eval-wording defect owned by the
> backlog-drawdown plan's Task A4, not by this sprint). Citation parity
> json↔parquet 110,875 == 110,875. **Not deployed** — deploy is the
> controller's call.
>
> **New gate legs, all attached to existing gates so the suite stays 24:**
> gate 2 leg (t) request-vs-enacted vocabulary · gate 2 leg (cc) dollar
> denominators · gate 23 leg (f) exhibit agreement · gate 23 leg (g)
> reconciliation split · gate 9 leg (e) district no-double-count ·
> `verify-lineage` leg (f) no-retraction · dbt `assert_district_totals_no_double_count`,
> `assert_district_totals_grain_unique`, `assert_program_mentions_evidence` ·
> regression tests `test_citation_parity.py`, `test_export_site_dossier_filter.py`.
>
> **What each fix cost in published numbers** — see the corrections table on
> `/methodology/`: district linkable $8.01B → $5.58B; lobbying mentions
> 34,538 → 10,447; `/programs/` counter → $228.5B of $385.3B (59.3%); stated
> lineage edges 31 → 29; FY2026 figures gained a discretionary/reconciliation
> split; the R-1 basis chip corrected on 1,077 of 1,741 programs.
>
> **Not closed by this sprint, filed as #54 and #55:** #50's label reaches
> `/program/*` only, and Lockheed still lacks the F-35 pending alias curation.
>
> **Process note for the next sprint.** Every one of the seven tasks found a
> defect in the plan's *prescribed code* — a regex matching its own prescribed
> fix, a gate letter colliding with a live leg, units off 1000×, a
> grain-mismatched fail-proof, a prescribed file needing no change, a
> misattributed page-weight regression, and a negation window that would have
> deleted a legitimate edge. The plan's *measured figures* held up every time,
> because they were reproduced against the warehouse. The code was never
> executed before being written down. Write plans accordingly.

> **Owner decision, 2026-08-07 (#49, #51, #52):** where a published figure is currently
> large and false, publish the smaller true one. District linkable dollars fall
> $8.01B → $5.58B; the lobbying mention count falls by whatever the evidence rule
> removes. These are corrections, and they ship labelled as corrections.

47. **Homepage calls the FY2026 request "enacted".** `site/src/app/page.tsx:291-292`
    reads "between FY2025 and FY2026 enacted"; `/methodology/`, `/years/` (FY26R)
    and every program page say request. The source workbook has no FY2026
    enacted column.

48. **The basis chip says "P-1 TOA" on R-1 lines.** `site/src/lib/basis.ts:12`
    hardcodes one label; `programs.json.exhibit_family` is rdte=1077 /
    procurement=664, so 1,077 of 1,741 (62%) are mislabelled. The correct
    value already ships.

49. **`/programs/` publishes a row counter over a 59.3%-complete dollar
    universe.** Columns sum to $228.46B against the site's own $385.3B
    FY2026 universe. Largest omissions: 9999999999 Classified $73.90B, 2013
    Virginia Class $11.08B, 1045 COLUMBIA $10.92B. The stated exclusion
    ("not covered by the R-1/P-1 rollups") is false — COLUMBIA is a P-1 line
    and its own page says so.

50. **One-time reconciliation money is folded into every FY2026 "Request"
    figure.** `fy_2026_total` $385.27B = disc $296.26B + reconciliation
    $89.01B. Against `fy_2025_enacted` $321.88B the headline basis reads
    +19.7% and the discretionary basis reads −8.0%. Long Range Kill Chains
    headlines +3052.9% on $1,916k of discretionary.

51. **District totals add one award once per matched program element.**
    `fct_district_programs` joins on `award_id_piid` only, never `pe_bli`,
    and the exporter sums those rows. Published $8.0111B vs $5.5787B
    award-distinct = 43.6% inflation ($2.432B). AK-00 publishes $1.05B from
    one $209.3M award (5.0×).

52. **"Program elements named in lobbying filings" are single-common-word
    matches.** `mentions.py` emits a row on ONE title token ≥5 chars; the
    `GENERIC_WORDS` stoplist misses BASED, SERVICES (it lists singular
    SERVICE), ACQUISITION, ACTIVITIES, CHEMICAL. Aggregates (34,538
    sitewide) carry no caveat.

53. **A "Stated · cited" lineage edge is built from a sentence that
    retracts it.** `/program/1203154SF/` asserts realigned → 1203609SF from
    "was erroneously transferred"; both edges share one page-level
    `fact_id` `10a4acbaa3270c74`.

54. **#50's reconciliation label stops at the program page.** Sprint A′ split
    discretionary from one-time reconciliation money and labelled it on
    `/program/*` (gate 23 leg (g) enforces it there). The **combined** FY25→FY26
    percentage still renders unlabelled on `/years/`, `/feed/`, and
    `explorer.tsx`'s canned SQL — so the same +3052.9% that is now explained on
    Long Range Kill Chains' own page is still bare on three other surfaces.
    Deliberately scoped out of A′4 rather than expanded mid-task; filed so #50
    is not read as fully closed. The fix is to widen leg (g) past `/program/*`
    once those surfaces carry the split.

55. **`/company/lockheed-martin/` is honest but still incomplete.** #52 cut
    Lockheed's mention rows 1,296 → 366 by removing single-common-word matches,
    but the F-35 was absent before the fix and remains absent after: the
    matcher never had evidence for it, and removing false positives cannot
    manufacture a true one. The gap is alias curation —
    `dbt/seeds/program_aliases.csv` needs entries (F-35, JSF → ATA000, and the
    equivalents for RTX's and Boeing's flagship lines) so `evidence_kind='alias'`
    can carry programs whose titles share no two distinctive tokens with how
    lobbyists actually write them.

    *Correction 2026-08-08 (found by the post-merge code review; the first
    version of this entry had the cause wrong).* I originally wrote that
    `alias` matching zero rows was "a data-curation gap, not a code gap". It
    was a **code gap**: `mentions.py`'s `_SEED_PATH` used `parents[4]`, which
    resolves one level above the project, so `_load_aliases` hit its
    `exists()` guard and silently returned `{}` on every call — all 11
    curated aliases were dead. Harmless while `alias` was one signal among
    several; load-bearing the moment #52 made it a tier that qualifies a
    mention on its own. Fixed to `parents[3]`; `alias` now matches **53**
    rows (THAAD, Aegis, JASSM, GBI, C2BMC, SBX, MQ-9, CV-22, JADC2, C-130J,
    Iron Dome), taking the corpus from 10,447 to **10,500**.

    ✅ **CLOSED 2026-08-08.** F-35 → ATA000 and JSF → ATA000 added to the
    seed. ATA000 went **0 → 60** mention rows, Lockheed 366 → 425, the alias
    tier 53 → 113, and the corpus 10,500 → **10,560**. Lockheed's flagship
    program now appears on its own page, which was this entry's whole point.
    Equivalent aliases for RTX's and Boeing's flagship lines are the same
    shape of work and are NOT done — re-file if they matter.

> **✅ #56–#59 CLOSED 2026-08-08** on branch `sprint-b-prime-remaining-review`.
> **#56** six fused pages de-fused (3010 $2.62B → $20.9M and five more), dbt
> `assert_program_key_unique` at `(pe_bli, amount_type)` grain — 1045 COLUMBIA
> correctly excluded as a cross-edition migration, 9999999999 excluded by name —
> plus gate 23 legs (h1–h4). **#57** DOJ/FTC bands replace "near-monopoly" from a
> single shared `hhi-band.mjs`; gate 8 leg (l) checks all 84 cards against the
> band their destination page renders — 70 diverge legitimately and now disclose
> it, 0 silent contradictions. **#58** masthead: publisher, unfunded status,
> contact and CC0 visible on `/about/` and in the footer. **#59** gate 23 leg (i):
> the reconciliation disclosure program pages already carried now renders on the
> four agency rollups that need it.
>
> **Two review claims were falsified during this sprint and are recorded rather
> than inherited.** Agency headers *do* equal the sum of their rows exactly
> (FY2024 and FY2026, every agency) — the live gap was only that program-page
> reconciliation disclosure never reached the rollups. And `1045` is COLUMBIA
> Class Submarine migrating accounts between editions, not a collision; splitting
> it would have torn one real program in two.
>
> **Two of my own figures were also wrong and were corrected by measurement.** The
> FY24 reconciliation gap is **139 programs / $7.99B**, not 142 / $11.06B — the
> larger figure came from treating two synthesized trajectory-only programs'
> `None` as `$0`. And `#56`'s first fix reported "corpus count unchanged" as a
> success when it was the symptom: keeping one program per key silently dropped
> **$5.74B**, including Tomahawk, LPD Flight II and Medium Landing Ship. Those 17
> lines totalling $5.82B are now named on `/programs/` with their own
> `key_collision` reason, and gate 23 leg (h4) makes a silent drop impossible.
>
> **Filed, not closed:** actually *splitting* the collided keys into their own
> pages is estimated at 5–9 days, dominated by `fct_decade_series` (the collision
> spans PB2024/PB2025 too, and there is no pre-PB2026 anchor to pick a primary
> account consistently). A 2–3 day middle path — split the money/title/URL layer
> and ship the new pages with an honest "no decade history yet" gap — is the
> cheaper option if Tomahawk on the site is worth more than a complete sparkline.

> **✅ #4, #13, #26 CLOSED 2026-08-08 (drawdown Sprint A, Task A1).** Verified,
> not asserted:
> **#4** superseded by Phase 5E — `fct_budget_lines` carries all ten editions
> PB2017–PB2026, where #4 asked only for PB2025/PB2024.
> **#13** moot — every ingested era embeds structured `.zzz` XML, so extraction
> is deterministic and no OCR path was needed. The **anchored** grep
> (`grep -rniE "\bocr\b|mistral|document.?ai" src/govbudget/ | grep -v test`)
> returns **0**; the drawdown plan's unanchored version returns 14 false
> positives because `ocr` matches So**cr**ata. If a future source lacks XML this
> returns as a new entry naming that source.
> **#26** contingent-not-applicable — the feed's event types are exactly
> `concentration_shift`, `new_entrant`, `request_vs_actuals_gap`, `yoy_swing`;
> no request-vs-request type exists, so the dead-PE `request_vs_request` fact
> has nothing to serve. Re-open with the event type that needs it.
>
> **#6 stays OPEN** — its two mart sub-items are done, but `dim_geography` is
> still `[pop_state, pop_district, transaction_count, total_obligation]` with no
> `fiscal_year`/`pe_bli` breakdown. Closing it would be the false-completion
> this ledger keeps catching elsewhere.

> **✅ #60–#66 CLOSED 2026-08-14 (Sprint C — usability).** None of these was a
> correctness defect; the site said nothing untrue going in. They were
> reachability and comprehension gaps.
> **#60** `/glossary/` ships — 14 terms, one shared `GLOSSARY` map, and TOA is
> finally expanded ("total obligational authority" went from **0** occurrences
> sitewide to defined-and-linked) after being stamped on ~80,000 figures.
> **#61** `/fact/{id}/` no longer 404s — the rewrite was `/fact/:id` only, and
> Vercel's edge matched it more strictly than `path-to-regexp` does locally, so
> the trailing-slash form the rest of the site trains never fired. Gate 1 leg
> (f1) pins the second rule. Config-shape only — it can only be *proved* on
> deploy, and that is stated in the leg.
> **#62** `/agency/` index — 23 agencies, every figure cited, footer-linked.
> **#63** CSV exports carry `fy2024_fact_id`, `fy2026_fact_id` and both
> permalinks; the provenance chain survives entry into a spreadsheet.
> **#64** `/years/` has a chart. It plots a **balanced panel** — the 524 of 1,741
> programs reporting in all 12 years — because a naive full-corpus sum shows
> spending sextupling FY2015→FY2026, which is corpus-ingestion coverage (35% →
> 90%), not budget movement. The chart says so in its own accessible name and
> description. A chart is a claim; that one would have been dramatic and false.
> **#65** the 768–1023px horizontal overflow is gone — `container` clamped to
> 768 at exactly the breakpoint the nav switched on. Measured +167/+101/+51px
> before, 0 after, at six widths on two pages. Gate 3 leg (m5) covers the band.
> **#66** dark mode via `prefers-color-scheme`, one token vocabulary. Gate 6 leg
> (d) re-runs axe in a real dark Playwright context — and caught a genuine
> 2.48:1 contrast failure on its first run, which was fixed rather than waived.
>
> **Also fixed, unplanned:** every `measured` string in `PAGE_WEIGHT_BUDGET` had
> gone stale — `/programs/` recorded 261,871 while shipping 277,357, telling a
> reader there was 6% headroom where there was 0.2%. All 14 refreshed, and gate 1
> now emits a near-ceiling note at 90% so the record cannot rot unnoticed again.
> Eleven pages are at or above 90% today. `/coverage/` was re-baselined
> (16,500 → 17,700 gzip) for the sitewide glossary link after drifting to **nine
> bytes** of headroom.
>
> **Two prescriptions in this sprint did not survive inspection**, continuing the
> pattern: the plan said #61 needed a resolver fix (the resolver was already
> correct — its regex ended `\/?$`), and said the review's overflow numbers
> needed confirming (they were exactly right, the first prescribed table this
> whole effort that needed no correction).

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
