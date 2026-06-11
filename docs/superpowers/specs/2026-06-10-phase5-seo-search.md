# Phase 5B Research: SEO + Instant Search Architecture

**Date:** 2026-06-10 · companion to the product-vision doc; web-researched.

## SEO (Google, 2026 reality) — applied to GovBudget

1. **AI Overviews are the visibility layer.** Ranking #1 no longer guarantees
   clicks; being CITED inside AI Overviews is the new currency, and pages with
   proper structured data get cited at 2–3× the rate. We are structurally
   advantaged: citation-rich government data with per-number provenance is exactly
   what AI systems prefer to cite. Action: full schema.org coverage per page type —
   `Dataset` (each source + the bulk-downloads page → also surfaces in Google
   Dataset Search, which drives academic discovery), `Article` (dossiers),
   `Organization`/`GovernmentOrganization` (companies/agencies), `FAQPage`
   (methodology), `BreadcrumbList` everywhere.
2. **E-E-A-T:** the methodology page, named primary sources, and visible citations
   are our expertise/trust signals — publish them, link them site-wide.
3. **Core Web Vitals / INP (<200ms)** is the animation constraint: hero animations
   must live on the compositor (CSS transforms/opacity only), DuckDB-WASM queries
   in a Web Worker (never the main thread), animation bundles lazy-loaded below
   the fold, `prefers-reduced-motion` respected. Budget: INP <200ms on program
   pages WITH animations running.
4. **Architecture:** flat structure (every program ≤3 clicks from home via
   agency→program and feed→program paths); SSG/ISR (already chosen); canonical
   stable URLs (`/program/0601101E`); XML sitemaps generated from dim_programs +
   dim_entities; internal linking woven by the anomaly feed and dossier
   cross-references; templated titles ("Loitering Munitions — FY2026 Budget,
   Contracts & Lobbying | <brand>").
5. **LLM crawlers:** publish `llms.txt`; OG/share images per program card
   (already planned); allow citation-friendly crawling.

## Instant search ("fills as the user types") — two-tier architecture

**Tier 1 — typeahead (<100ms, every keystroke):** a compact QUICK index (~326
programs + top entities + agencies + districts + high-risk areas + aliases; a few
hundred KB JSON) loaded once and queried IN-MEMORY per keystroke — no debounce
needed because no network round-trip; results group by type (Programs / Companies /
Places / Reports) with substring highlighting, keyboard navigation, ARIA combobox
accessibility, ⌘K command-palette invocation. Library: Orama or MiniSearch
(in-memory, fuzzy/typo-tolerant, prefix-fast) — small-corpus tier where in-memory
is the right trade-off.

**Tier 2 — deep full-text (narratives, dossiers, filings):** Pagefind over the SSG
output — chunked binary index that downloads only the chunks matching typed terms
(~50KB per query), scales to 100k+ pages with no server. Debounce 150–200ms for
tier-2 fetches only (research consensus: ≤200ms preferred, >300ms degrades UX);
tier-2 results stream in under the instant tier-1 rows.

**Domain alias table is the differentiator:** "drones" must hit loitering-munitions
PEs; "F-35" ↔ "Joint Strike Fighter" ↔ its PE/BLI numbers; "JASSM" ↔ its
procurement line. Aliases generated during dossier enrichment (LLM-assisted,
curated, cited), stored in the quick index. Rank: exact > alias > fuzzy, weighted
by program dollars + page popularity. Recent searches in localStorage; empty-state
shows top programs; search analytics (privacy-respecting) feeds the roadmap.

**Gate:** a search eval set (queries → expected top-3, incl. aliases and typos:
"lockeed" → Lockheed Martin) joins verify-phase5.

## Sources

Technical SEO 2026 guides (DebugBear, SEOsolved, Yotpo), AI Overviews impact
analyses (eSEOspace, EnFuse, almcorp), typeahead/instant-search UX (Meilisearch
typeahead guide, Algolia debounce docs, DesignRush search UX 2026, codesmith
typeahead system design), static-search comparisons (Static Signal Pagefind,
sarthakmishra.com 4-engine comparison: Pagefind chunked ~50KB/query vs Orama
full-index download — hence the two-tier split).
