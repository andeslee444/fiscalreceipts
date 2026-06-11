# Phase 5 Planning Considerations & User Pains

**Date:** 2026-06-10 · companion to the product-vision doc. Captured while the CA
full-capture download runs.

## Validated this session

LDA filing free-text names specific programs (Lockheed 2025: "C-130J", "JASSM
funding", "JADC2", "space based radar") + agencies lobbied — program-grain
lobbying↔budget-line linkage is real, not aspirational. 66 Lockheed filings in 2025.

## Missed considerations (now planned)

1. **Serving architecture (decide before 5B):** everything lives on the Mac Mini;
   the site can't query it. Recommended: **SSG-first** — top-N program/company pages
   statically generated (Next.js on Vercel, user's stack) from mart exports, PLUS
   **DuckDB-WASM in the browser over hosted Parquet** (R2/S3) for the exploration
   views — zero query servers, receipts-mode queries run client-side. PDFs hosted on
   object storage (sha-named) for citation deep links. Postgres stays an internal
   build-time store. Decision memo at 5B spec time; this is the default.
2. **Refresh automation + drift alarms:** monthly USAspending Full-file refresh,
   quarterly LDA, annual J-book drop (each spring — expect schema drift; our golden
   fixtures become the drift alarm), biennial GAO. Cron on the Mac Mini (the fitness-
   sniper daemon pattern) + a `govbudget refresh` orchestrator + failure
   notifications. The site shows per-source "data as of" stamps.
3. **Stable public IDs + SEO before launch:** URL scheme (e.g.
   `/program/0601101E`, `/company/boeing`, `/filing/{uuid}`) is painful to change
   later; program pages are the long-tail SEO asset ("MQ-9 budget") — SSG +
   schema.org structured data from day one. Sitemap from dim_programs.
4. **Fact versioning on the surface:** amendments/re-extractions supersede facts
   internally; the web must show "as of PB2026, retrieved <date>" and old permalinks
   must still resolve (point at superseded fact + banner). Corrections policy page.
5. **Methodology + limitations page:** public writeup of gates, confidence tiers,
   known gaps (FY attribution v1, low-tier link semantics, derived improper amounts).
   Drafts almost write themselves from the phase docs. This is the trust anchor —
   and a differentiator no competitor publishes.
6. **Legal/positioning hygiene:** all sources are public-domain US government works;
   FEC data has solicitation-use restrictions (display fine); influence framing
   stays correlational (already specified); add a disclaimer/about page; pick a
   product name + domain (user decision).
7. **Search is table stakes:** programs/companies/keywords across 2,457 narratives +
   entities. v1: prebuilt client-side index (FTS over names/titles) for SSG pages;
   upgrade path: Typesense/pg_fts.
8. **Accessibility + performance for animations:** prefers-reduced-motion fallbacks;
   animations lazy-load; 12.6M transactions never ship to the client — every view
   has a pre-aggregated budget (mart-per-view discipline).
9. **Zero-write surface for v1:** no auth, no user data, static + WASM = minimal
   attack surface and minimal ops. Alerts/saved-searches (which need accounts) come
   after launch as the first monetizable tier.

## User pains → features (by persona)

- **Defense journalists** (deadline pain: unsearchable PDFs, uncitable numbers):
  exportable charts with citation bundles; "what changed this cycle" diffs;
  every number's receipts = quotable. Feature: copy-as-footnote.
- **Hill staffers** (briefing prep pain): printable one-pager program dossiers;
  district lens; "what GAO said" panel; congressional-adds view (data already in
  the J-book XML).
- **Contractor BD/competitive intel** (the first paying segment): competition
  health, new-entrant alerts, PE-space watchlists, lobbying-vs-award context on
  competitors. Future: saved searches + email alerts (account tier).
- **Academics/think tanks:** documented bulk downloads (the parquet + data
  dictionary) — getting cited in papers is distribution.
- **Citizens/watchdogs:** plain-language program explainers (the LLM dossier),
  share cards, follow-the-dollar story mode.
- **Everyone:** stable permalinks, search, "data as of" honesty, alerts later.

## Queue while downloads run (no bandwidth contention)

1. Author the verify-phase5 NL eval set (~40 Q&A pairs with hand-computed answers
   + expected citations) — needed before 5B's gate can exist.
2. Draft the methodology page from phase docs.
3. Decide URL/ID scheme (above defaults stand unless user overrides).
4. After CA download completes: kick historical J-book backfill (PB2025/PB2024
   books) in background — feeds the book-diff feature.
