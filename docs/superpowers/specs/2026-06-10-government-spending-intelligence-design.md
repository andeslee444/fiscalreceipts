# Government Spending Intelligence Platform — Design

**Date:** 2026-06-10
**Status:** Draft — pending user review
**Working name:** GovBudget

## 1. Problem & Opportunity

Understanding government efficiency requires connecting four things that today live in
disconnected silos:

1. **Budget intent** — what legislatures and agencies *said* money was for
   (DoD justification books, state/local budget documents)
2. **Actual spend** — what was *actually* obligated and to whom
   (USAspending, state checkbooks, local vendor payments)
3. **Beneficiaries** — who ultimately received the money
   (contractors and their parent companies, grantees, geographies, populations)
4. **Oversight findings** — what auditors said about it
   (GAO high-risk list, IG reports, improper-payment estimates: ~$186B in FY2025 alone)

No existing product connects all four with per-number provenance:

| Product | What it is | Gap |
|---|---|---|
| USAspending.gov | Official federal award database | Federal only; no budget intent, no analysis layer |
| OpenTheBooks | ~10B records, FOIA-driven, all levels | Search engine, not a connected graph; weak analytics |
| USAFacts | Curated civic data storytelling | Aggregates only; not granular or queryable |
| GovSpend / GovWin | B2G sales intelligence for vendors | Built for selling to government, not evaluating it |

**The product is the connected graph**: budget line → obligation → recipient entity →
parent company / geography / population → audit finding, with every number citing the
exact source document and page.

## 2. Key Research Findings (shape the whole design)

1. **Federal award data is already structured.** USAspending offers bulk downloads and a
   full API (awards, subawards, account data, since the DATA Act). Treasury FiscalData and
   SAM.gov (entity registry with UEI + parent hierarchies) are likewise machine-readable.
   *Scraping PDFs for federal award data would be wasted effort.*
2. **The PDF moat is specific:** (a) DoD budget justification books ("J-books" — R-1/R-2,
   P-1/P-40 exhibits, program-element granularity) are PDF-only on comptroller.war.gov and
   service sites; (b) GAO/IG reports are narrative PDFs; (c) ~30,000 state/local
   governments publish budgets and ACFRs as PDFs.
3. **Timing window:** The Financial Data Transparency Act (2022) forces machine-readable
   municipal financial filings to EMMA by ~2027 (XBRL ACFR taxonomy exists). Extraction is
   a 1–2 year moat for state/local data, after which the durable moats are *history*,
   *the entity graph*, and *the cross-source crosswalk* — not parsing.
4. **Extraction tooling is mature:** Docling (IBM, open source) hits ~98% on complex table
   extraction for digital PDFs; vision-LLM structured extraction (Claude + typed schemas)
   covers scanned/messy documents. Pure VLM extraction on dense numeric tables still
   hallucinates — a deterministic parser + LLM schema-mapping hybrid with reconciliation
   checks is the accurate path.

## 3. Product Approaches Considered

**A. Spending-intelligence platform for analysts (RECOMMENDED)** — "Bloomberg terminal
for public spending." Audience: journalists, think tanks, congressional staff, muni bond
research desks, academics, defense analysts. Subscription + API. Moat: connected graph +
provenance. Chosen because it matches the stated goal (granular, accurate efficiency
analysis), the audience pays for accuracy, and nobody serves it today.

**B. B2G market intelligence (GovWin/GovSpend competitor)** — proven willingness to pay,
but crowded incumbents and the efficiency mission becomes secondary. Rejected as the
wedge; viable later revenue layer on the same data.

**C. Free civic transparency site (USAFacts/OpenTheBooks style)** — large audience, weak
monetization (philanthropy model). Rejected as the core; viable as a marketing surface
(public scorecards) on top of A.

### Wedge: DoD first, then one state, then expand

Start with **DoD budget-to-spend crosswalk**: J-book program elements → USAspending
obligations → vendors → congressional districts, joined to GAO findings. Rationale:
- One publisher, standardized exhibit formats (concentrated extraction effort)
- ~$850B+/yr and intense public/press/Hill interest in defense efficiency
- The federal backbone (USAspending) is free and structured, so a working spine exists
  before any extraction is built

Phase in **one state pilot** (budgets + ACFRs + open checkbook for top cities/counties)
to prove the cross-jurisdiction "cost per outcome" comparison that no one offers.

## 4. Architecture

**Core principle: this is a data-engineering product with LLM components, not a RAG
product.** Vector retrieval over budget PDFs produces plausible paragraphs, not numbers
that add up. LLMs serve two narrow, evaluable roles:
1. **Ingest time:** schema-first structured extraction from PDFs (typed rows, validated)
2. **Query time:** text-to-SQL / agentic analytics over a governed warehouse, with
   hybrid retrieval only over narrative corpora (GAO findings, budget narratives)

### Layers

```
Sources          → Ingestion/Extraction      → Canonical store            → Products
USAspending bulk → dlt loaders (no LLM)      → DuckDB/Postgres + dbt      → Analyst agent (text-to-SQL, cited)
DoD J-books      → Docling + Claude extract  → facts w/ page provenance   → Efficiency metrics
GAO/IG PDFs      → reconciliation gate       → entity graph (Splink+SAM)  → Hybrid search (narratives)
State/local PDFs →   (sums must match)       → object store (raw + parquet)
```

### Stack decisions

| Layer | Choice | Why / Why not LangChain |
|---|---|---|
| Orchestration | **Dagster** (asset-based) | Lineage-aware: "this table depends on that scrape." Prefect acceptable alternative. |
| API ingestion | **dlt** + plain Python | Declarative loaders for USAspending/FiscalData/SAM; incremental sync built in. |
| Scraping | **Playwright + httpx** | Only where no API/bulk exists (some state portals). User already runs Playwright daemons. |
| PDF parsing | **Docling** primary; **Claude vision** (structured outputs, Batch API) for scanned/messy pages | Deterministic parser first = cheap + non-hallucinating; LLM only where layout defeats parsers. |
| Extraction contract | **Pydantic schemas** per exhibit type; Claude structured outputs or Pydantic AI | Typed rows, validation at the boundary, retry-on-mismatch. |
| Storage | **Postgres** (app + canonical facts), **DuckDB/Parquet** on object storage (analytics), **dbt** transforms | Familiar to user; DuckDB handles billions of rows locally; ClickHouse/MotherDuck later if needed. |
| Entity resolution | **SAM.gov UEI registry** backbone + **Splink** probabilistic matching for state/local vendor names | First-class subsystem — this IS the beneficiary mapping. Persistent crosswalk table with confidence scores. |
| NL query | **Text-to-SQL agent over a semantic layer** (dbt metrics; Claude tool use) | Answers are SQL over reconciled facts → numbers add up, citations attach. |
| Narrative RAG | **pgvector hybrid (BM25 + embeddings)** over GAO/IG/budget narratives | RAG where text is the payload; results link back to structured facts. |
| Agent framework | **Direct Claude API / Pydantic AI / Claude Agent SDK — not LangChain** | LangChain adds abstraction without benefit here; extraction and text-to-SQL need thin, debuggable, eval-able code paths. |

### Data model (canonical tables)

- `government_units` — hierarchical: federal agency / state / county / city / district
- `documents` — source URL, hash, type, fiscal year, unit; raw file in object store
- `budget_lines` — unit, fund/function/object class, program element, proposed/enacted/
  actual amounts, **provenance (doc id, page, table bbox)**
- `awards` / `subawards` — from USAspending: recipient, amounts, NAICS/PSC, place of performance
- `entities` — canonical recipients, UEI, parent hierarchy, NAICS
- `entity_crosswalk` — raw name → canonical entity, method + confidence
- `beneficiary_links` — budget_line/award → entity | geography | population segment
- `findings` — GAO/IG findings + improper-payment estimates linked to programs/units
- `outcomes` — performance metrics for cost-per-outcome ratios
- `extraction_runs` / `reconciliation_checks` — QA bookkeeping

### Accuracy system (the "incredibly accurate" requirement)

1. **Reconciliation gates:** extracted line items must sum to printed totals (row, column,
   and cross-document: J-book PE totals vs R-1 rollups; ACFR statements vs fund totals).
   Failures route to a human-review queue; unreconciled numbers are never served unflagged.
2. **Provenance per number:** every fact stores document + page + table coordinates;
   every answer cites them.
3. **Golden datasets + CI evals:** hand-labeled pages per document family; extraction
   accuracy tracked per release; dual-extraction (Docling vs LLM) cross-checks on a sample.
4. **Versioned facts:** budget documents get amended; facts are append-only with
   supersedence, never overwritten.

## 5. Roadmap

- **Phase 0 — Federal backbone (2–3 wks):** dlt loaders for USAspending bulk + FiscalData
  + SAM entities → DuckDB/Postgres + dbt star schema. No scraping, no LLM. Queryable spine.
- **Phase 1 — DoD J-book extraction (4–6 wks):** R-1/R-2/P-1/P-40 exhibits → `budget_lines`
  with provenance + reconciliation gates. PE → contract crosswalk v1.
- **Phase 2 — Beneficiary graph:** entity resolution (UEI parents, Splink), geography
  mapping (place of performance → district/county/tract).
- **Phase 3 — Oversight layer:** GAO/IG findings extraction + linkage; efficiency metrics
  v1 (budget-vs-actual variance, vendor concentration, improper-payment exposure).
- **Phase 4 — State/local pilot (1 state):** budgets + ACFRs + checkbook for top
  jurisdictions; cross-city cost-per-outcome comparables.
- **Phase 5 — Product surface:** Next.js dashboard + analyst agent (text-to-SQL with
  citations) + public scorecard pages.

## 6. Risks

- **Extraction errors** → reconciliation gates + HITL queue + evals (core mitigation, designed in)
- **Entity-resolution mistakes** → confidence scores surfaced; never assert links silently
- **LLM cost at scale** → Docling-first (local, free); Claude Batch API (50% off) only for
  failed pages; cache by document hash
- **FDTA erodes state/local extraction moat by ~2027** → moat shifts to history + graph +
  crosswalks; FDTA actually lowers future ingestion cost
- **Source churn** (e.g., comptroller domain moved to `.war.gov` in 2025) → source registry
  with monitors, not hard-coded URLs
- **Scrape etiquette** → government data is public domain; respect robots.txt and rate limits

## 7. Open Questions for User

1. Audience/monetization priority: paid analyst tool first (A), or public-good site with
   philanthropy funding (C)? Design assumes A with C as marketing surface.
2. Wedge confirmation: DoD-first vs state-first?
3. Hosting: local-first (Mac Mini + DuckDB, near-zero cost) vs cloud-first from day one?
   Design assumes local-first dev, cloud when the product surface ships.
