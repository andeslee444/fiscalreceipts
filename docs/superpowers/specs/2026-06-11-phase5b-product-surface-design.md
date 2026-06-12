# Phase 5B: Product Surface — Design Spec

**Date:** 2026-06-11 · **Status:** Draft for user review
**Consolidates** (all previously user-approved): `2026-06-10-phase5-product-vision.md`
(features + influence + citation deep-links), `2026-06-10-phase5-considerations.md`
(serving architecture, refresh, IDs, personas), `2026-06-10-phase5-seo-search.md`
(SEO + two-tier search). Gates trace to `2026-06-10-phase-gates.md` §Phase 5.

## 1. Goal

A public, citation-first interactive site over the GovBudget warehouse: program
dossiers with category animations, receipts mode (every number click-through to its
source), anomaly feed, district lens, influence panels, vendor network, instant
search — statically generated, zero query servers, every rendered number citable or
absent.

## 2. Architecture (decided)

```
Mac Mini (build time)                     Edge (serve time)
─────────────────────                     ────────────────
Postgres + DuckDB + dbt ──export──▶ Parquet bundle ──▶ object storage (R2*)
data/raw_docs PDFs ──sha-named──▶ object storage (R2*)
provenance_pages builder ──▶ citations.parquet + bbox sidecars
dossier enrichment (Claude Batch) ──▶ dossiers/*.json (cited-or-absent)
Next.js SSG ──build──▶ Vercel (static + ISR)
                                          Browser: DuckDB-WASM in Web Worker
                                          over hosted Parquet (exploration views)
                                          PDF.js side-panel viewer (citations)
```

- **No runtime backend.** SSG pages for all program/company/agency/district routes;
  DuckDB-WASM (Web Worker only) hits hosted Parquet for exploration interactions.
  12.6M transactions never ship to a client — every view reads a pre-aggregated
  mart export (mart-per-view discipline).
- **Postgres/DuckDB remain internal.** The site consumes only exported Parquet +
  JSON artifacts produced by `govbudget export-site` (new CLI).
- *R2 default (free egress); S3 acceptable. **USER DECISION** with name/domain (§9).

## 3. Stable public IDs + routes (decided, painful to change later)

| Route | Source | Notes |
|---|---|---|
| `/program/{pe_bli}` | dim_programs | e.g. `/program/0601101E`; canonical |
| `/company/{family_slug}` | dim_entities | slug from family_key; redirects table for renames |
| `/agency/{org}` | budget orgs | DARPA, OSD, … |
| `/district/{state}-{cd}` | dim_geography | `/district/CA-52` |
| `/filing/{uuid}` | lda_filings | thin page; canonical link to lda.senate.gov |
| `/feed` | anomaly cards | the insight feed |
| `/methodology`, `/downloads`, `/about` | static | trust anchors |

Old permalinks must always resolve (superseded facts render with an "as of" banner).
Per-source "data as of" stamps site-wide.

## 4. Citation system (the load-bearing feature)

1. **provenance_pages builder** (build-time CLI): for every served J-book fact,
   locate (document sha, pe_bli, scenario, amount) → page number + word bbox via
   PyMuPDF text search (feasibility proven: PE 0601101E's 280.494 → DARPA book
   p.24). Cached table keyed by document sha; rebuilt only on sha change. Facts
   that fail to locate are flagged — **a number whose citation does not resolve
   does not render** (it renders as "unavailable + why" instead).
2. **Citation resolver** (build-time, emitted as static JSON per page): fact_id →
   `{hosted_pdf_url#page=N, official_url#page=N, bbox, sha256, xml_path,
   retrieved_at}`.
3. **Viewer UX:** click any number → side panel opens PDF.js AT the page, line
   highlighted from bbox; "open official source" beside it. We serve sha-verified
   copies; the official URL is always co-cited.
4. **Source-tier honesty** (each number gets its native best citation): J-book →
   PDF page + highlight · R-1/P-1 → workbook/sheet/cell with rendered preview ·
   USAspending → dataset + reproducible query permalink · LDA → filing UUID URL ·
   state checkbook → source/SoQL URL · derived → formula + every input's citation.
5. **Receipts mode:** site-wide toggle; every number flips to its citation chain
   on hover.

## 5. Pages + features (v1 scope)

- **Program dossier** `/program/{pe_bli}`: mission/accomplishments narratives
  (already extracted, cited to xml_path), budget trajectory chart, awards +
  recipients, competition health ("N offers received" — NEVER invented bidders),
  GAO/improper-payment overlays, influence panel (lobbying alongside outcomes,
  no causal language), genealogy timeline (budget lines + awards + findings),
  district footprint map. Top-50 programs additionally get the enrichment layer
  (§6) + category hero animation.
- **Company page** `/company/{slug}`: family tree (UEIs, JVs kept distinct),
  obligations by program/year, subaward flows, lobbying panel (filings, amounts,
  registered lobbyists w/ revolving-door badges — statutory disclosures only).
- **Anomaly feed** `/feed`: auto-surfaced cards (YoY swings, zeroed programs,
  concentration spikes, new entrants, deobligation storms) — each card backed by a
  warehouse query + citations. Cards are the internal-linking engine for SEO.
- **District lens** `/district/{id}`: choropleth + "what your district builds."
- **Follow-the-dollar:** animated appropriation→PE→contract→prime→sub→district
  journey on program pages (compositor-only animation).
- **Share cards:** OG images per program/company generated at build.
- **Search (⌘K):** two-tier — Tier 1 in-memory quick index (~few hundred KB:
  programs, entities, agencies, districts, aliases) per-keystroke no debounce;
  Tier 2 Pagefind chunked deep search over narratives/dossiers/filings, 150-200ms
  debounce, streams under tier-1 rows. Alias table ("drones"→loitering-munitions
  PEs, "F-35"↔JSF↔PE/BLIs) curated during enrichment. Rank: exact > alias > fuzzy,
  weighted by program dollars. ARIA combobox; recents in localStorage.
- **SEO:** schema.org per page type (Dataset/Article/GovernmentOrganization/
  FAQPage/BreadcrumbList), XML sitemaps from dims, llms.txt, templated titles,
  flat ≤3-click architecture, INP <200ms with animations running
  (compositor-only transforms; WASM in worker; lazy animation bundles;
  prefers-reduced-motion).
- **Downloads page:** documented Parquet bundle + data dictionary (academic
  distribution channel).

**Explicit v1 non-goals:** accounts/auth, saved searches/alerts (first paid tier,
post-launch), public text-to-SQL endpoint (analyst agent stays an internal CLI —
the paid-analyst surface comes after launch), book-diffs (needs PB2025/PB2024
backfill — backlog), SAM bidder lists (FPDS has no losing bidders; never invent).

## 6. Dossier enrichment pipeline (first sanctioned heavy LLM use)

For the top-50 programs by FY2026 request: web research (curated defense press,
agency pages, company releases) → cached snapshots (URL + retrieved_at + sha) →
Claude Batch synthesis into dossier sections (what it is, why it matters, players,
recent developments) where **every claim cites a warehouse fact id or a fetched
URL; uncited claims are dropped at build** (cited-or-absent gate). Category →
animation mapping (loitering munitions→swarm, hypersonics→trajectory,
space→constellation, shipbuilding→hull, cyber→network) drives the hero animations.
Alias table rows generated here are curated + cited before entering search.

## 7. verify-phase5 (the gate suite; CLI `verify-phase5`)

1. **citation_gate:** sample 50 rendered numbers per build across source tiers;
   mechanically resolve each citation; assert the cited page/cell/payload contains
   the amount. **100% required.**
2. **eval_gate:** analyst agent (text-to-SQL over the semantic layer, internal)
   answers `evals/phase5_questions.yaml` (45 Q incl. 5 REFUSE): ≥90% correct,
   100% of numeric answers cited, REFUSE cases refused.
3. **dossier_gate:** zero uncited claims across all built dossiers (parse + verify
   citation ids/URLs resolve).
4. **search_gate:** search eval set (queries→expected top-3, incl. aliases +
   typos "lockeed"→Lockheed Martin) passes.
5. **render_gate:** every page renders no unreconciled/unflagged number; build
   fails on any mart export whose row hashes drift from the warehouse (honesty
   continuity).
6. **perf_gate:** Lighthouse CI on 5 representative pages: INP <200ms, LCP <2.5s.

## 8. Build order (sub-plans, each its own loop)

- **5B-1 Citation + export backbone:** `export-site` CLI, provenance_pages
  builder, citation resolver artifacts, citation_gate. (No UI yet — gate runs
  against artifacts.)
- **5B-2 Site skeleton:** Next.js app, routes, mart-export wiring, DuckDB-WASM
  worker, PDF.js citation panel, receipts mode, search two-tier, SEO plumbing,
  render_gate + search_gate + perf_gate.
- **5B-3 Features + enrichment:** anomaly feed, district lens, follow-the-dollar,
  influence panels, share cards, dossier pipeline + animations, dossier_gate.
- **5B-4 verify-phase5 assembly + loop:** eval_gate (analyst agent), full gate
  suite, regression sweep 1–5A, final review, merge.

## 9. User decisions required before public launch (not blocking 5B-1/5B-2 dev)

1. Product name + domain (placeholder: "GovBudget" / vercel preview URL).
2. Object storage: **R2 recommended** (free egress) vs S3.
3. Vercel account: deploys must use the andes.lee444@gmail.com identity (existing
   free-account constraint).

## Self-Review Notes

- Every §5 feature traces to an approved vision bullet; nothing new invented.
- Honesty constraints restated where load-bearing (bidders, causality, cited-or-
  absent, non-additive columns).
- Scope: 5B is large but §8 decomposes into four independently-gated sub-plans,
  each producing testable artifacts; matches the per-phase loop protocol.
- v1 non-goals keep the zero-write surface (minimal ops/attack surface).
