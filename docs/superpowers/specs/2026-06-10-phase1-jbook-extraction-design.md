# Phase 1: DoD J-Book Extraction — Design

**Date:** 2026-06-10
**Status:** Draft — pending user review
**Parent spec:** [2026-06-10-government-spending-intelligence-design.md](./2026-06-10-government-spending-intelligence-design.md) (approved)
**User decisions:** both exhibit families (R-2 + P-40); DARPA golden corpus → one service (Army); Postgres for facts + review queue.

## 1. Goal

Add the **budget intent** layer to the Phase 0 spend backbone: every DoD program element
(RDT&E) and budget line item (procurement) becomes a queryable record with FY2024–FY2026
amounts, project-level detail, narrative mission/accomplishments text, page/XML-level
provenance, and a confidence-scored crosswalk to the Phase 0 contract transactions.

## 2. Discoveries that shape the design (verified live, 2026-06-10)

1. **R-1/P-1/O-1/M-1 rollups are published as XLSX** on comptroller.war.gov
   (`r1_display.xlsx`: 1,143 PE/BLI rows; columns Account, Budget Activity, PE/BLI,
   Title, FY2024 Actuals → FY2026 Total). The budget_lines backbone and all
   reconciliation control totals require **zero extraction**.
2. **J-book PDFs embed their own structured XML.** The FY2026 DARPA book carries PDF
   attachments: `Exhibit_R-1D.xml` plus a "Justification Book Zip File" (`.zzz` → zip →
   1.5MB XML with namespaced `r2:` elements: `ProjectMissionDescription`,
   `AccomplishmentPlannedProgramList`, project cost structures). The complete R-2 content
   is machine-readable inside the PDF. Prior art: the `540co/dod-jbook-pdf-xml` and
   `540co/dod-president-budget-procurement-rdte-data` repos parsed this same XML
   (2013–2017 era), confirming the schema family covers R-2/R-2A and P-40/P-5/P-21
   exhibits and is stable across years.
3. **J-books have proper text layers** (digitally generated, not scanned) — the
   Docling-based fallback path is viable where attachments are absent.
4. **budget.dtic.mil** (DoD Congressional Budget Data) publishes PDF + Excel and DTIC's
   R&E Gateway interlinks R-2/P-40 data — useful as a cross-check source, not a primary
   (no bulk API; FY2026 coverage of the comptroller site is authoritative).

## 3. Architecture — five units

### Unit 1: Document registry + acquirer (`jbooks/registry.py`, `jbooks/acquire.py`)
- `jbook_documents` Postgres table: org, exhibit_family (rdte | procurement), fiscal_year,
  title, source_url, sha256, bytes, downloaded_at, has_embedded_xml, status.
- Seeded by scraping index pages: comptroller.war.gov FY2026 budget-justification page
  (defense-wide) + asafm.army.mil budget materials (Army), via httpx + selectolax/regex
  (static HTML; no Playwright needed).
- Downloads reuse Phase 0's `download_file` + manifest. **PDFs and XLSX are kept** in
  `data/raw_docs/{fy}/{org}/` (provenance source, ~5–15MB each; unlike archive zips).

### Unit 2: XLSX backbone loader (`jbooks/rollup_loader.py`)
- openpyxl (new dep) parses `r1_display.xlsx` / `p1_display.xlsx` (and `p1r`) —
  per-FY-scenario sheets with columns verified in recon.
- Loads Postgres `budget_lines`: one row per (PE/BLI, appropriation account, budget
  activity, amount_type ∈ {fy2024_actual, fy2025_enacted, fy2025_supplemental,
  fy2026_request, ...}). Zero LLM. These rows are the **control set** every extraction
  reconciles against.

### Unit 3: Tiered exhibit extractor (`jbooks/extract/`)
- **Tier 0 — embedded XML (primary):** `attachments.py` extracts PDF `/EmbeddedFiles`
  (pypdf, new dep), unzips `.zzz`, lands XML in `data/raw_docs/.../xml/`;
  `xml_parser.py` (lxml) maps the `r2:`/`p40:` schema to typed records: per-PE projects,
  cost-by-FY tables, mission description, accomplishments/plans (title + narrative +
  amounts), congressional adds. Deterministic, full fidelity.
- **Tier 1 — Docling + Claude (fallback):** for documents where `has_embedded_xml` is
  false. Deterministic segmentation by exhibit header markers → Docling table extraction
  → Claude (Pydantic schemas, Batch API) for narrative fields and failed tables.
- Both tiers write identical record shapes to `budget_line_details` with
  `extraction_tier` recorded; every run logged in `extraction_runs` (tool/model
  versions, document sha).
- **Provenance:** tier 0 stores XML element path + source document id; tier 1 stores
  page range + table index. Both resolve to a human-viewable citation
  (document + page; the R-1D/Table-of-contents XML maps PEs to book pages).

### Unit 4: Reconciliation gates + review queue (`jbooks/reconcile.py`, `cli: govbudget review`)
- Gate A: project amounts within an exhibit sum to the exhibit's PE/BLI total (±$0.001M).
- Gate B: exhibit PE/BLI totals match the R-1/P-1 `budget_lines` row for the same
  (PE, appropriation, FY scenario).
- Gate C (advisory, non-blocking): cross-document consistency (same PE appearing in JB
  and MJB volumes agrees).
- Results in `reconciliation_checks`; failures create `review_queue` rows.
  `govbudget review` CLI lists failures, shows extracted values vs control values plus
  the provenance citation, accepts a correction or an accept-as-is with reason.
  Unreconciled facts carry `reconciled = false` and are excluded from marts by default.

### Unit 5: PE → contracts crosswalk v1 (`jbooks/crosswalk.py`)
- Method 1 (deterministic): treasury/federal account fields on Phase 0 contract
  transactions ↔ appropriation account on budget_lines (narrows to account + sub-agency).
- Method 2 (assisted): PE/project title ↔ award description matching, Claude Batch,
  emitting match + confidence ∈ {high, medium, low} + rationale.
- Landed in `budget_line_awards` (budget_line_id, award key, method, confidence,
  rationale). Nothing merged silently; marts expose confidence. Bonus input discovered
  in recon: the DARPA book's embedded zip includes a "New PE Crosswalk" supplemental —
  parse when present.

### Storage & modeling
- New local Postgres database `govbudget` (same instance pattern as the existing
  Fitness Sniper Postgres). Tables: `jbook_documents`, `budget_lines`,
  `budget_line_details`, `extraction_runs`, `reconciliation_checks`, `review_queue`,
  `budget_line_awards`, `extraction_gaps`. Plain SQL migrations in `migrations/` applied by
  `govbudget migrate` (psycopg, new dep; no ORM).
- dbt: Postgres rows are exported to Parquet by `govbudget export-facts` (keeps the
  DuckDB-only analytics layer of Phase 0 intact; no cross-DB federation complexity).
  New marts: `fct_budget_lines`, `dim_programs`, `fct_budget_to_awards`.

## 4. Testability — acceptance gates for the holistic goal

The product promise is *granular, accurate, provenance-backed budget-intent-to-spend*.
Phase 1 is accepted only when these measurable gates pass (each is an automated check,
run by `govbudget verify-phase1` and in CI on the golden corpus):

1. **Coverage gate:** ≥99% of R-1 rows in scope (defense-wide RDT&E first, then Army)
   have either a `budget_line_details` record or an explicit `extraction_gaps` row with
   a reason. No silent holes.
2. **Accuracy gate:** 100% of served (reconciled) details pass Gates A+B. Failures are
   visible in the review queue — the gate asserts zero *silent* mismatches, not zero
   mismatches.
3. **Provenance gate:** a sampler test draws 50 random served facts and mechanically
   resolves each to its citation (document exists on disk, sha matches manifest, XML
   path/page resolves). 50/50 required.
4. **Golden corpus:** ~25 hand-verified PEs/BLIs (DARPA R-2s + Army P-40s) as pytest
   fixtures with exact expected values; CI fails on drift.
5. **Fallback-path eval (the XML dividend):** run Tier 1 (Docling+Claude) on documents
   that HAVE XML and score field-level agreement against the XML as ground truth.
   Phase 1 requires ≥98% numeric-field agreement on the golden corpus before Tier 1 is
   trusted on any XML-less document. This gives the LLM path unlimited labeled eval
   data at zero labeling cost.
6. **Holistic trace test (E2E):** for 5 sample PEs (incl. at least one DARPA and one
   Army), an automated test walks PE → budget_line → detail → crosswalk → contract
   transactions → recipient, asserting every hop is non-empty, confidence-tagged, and
   provenance-resolvable. This is the "does the whole chain exist" test, run on real
   data after sync.

## 5. Scope fence

- **In:** FY2026 books (carrying FY2024–26 figures); defense-wide RDT&E (DARPA first),
  one compact P-40 book (Army Missiles), then Army RDT&E + procurement volumes;
  Postgres + migrations; review CLI; crosswalk v1; the six acceptance gates.
- **Out:** O-1/M-1 detail books; historical FY books (schema supports them; loading is a
  later backfill); classified annexes; Navy/AF (post-acceptance expansion); any web UI;
  entity resolution (Phase 2); narrative summarization/enrichment (Phase 3+).

## 6. Open-source adoption decisions

| Need | Choice | Why |
|---|---|---|
| PDF attachments | **pypdf** | Pure-python `/EmbeddedFiles` access; no system deps |
| J-book XML | **lxml** | Namespaced schema, XPath; 540co repos document the schema family as prior art |
| XLSX | **openpyxl** | DuckDB's excel ext mis-detects these workbooks (verified) |
| Index scraping | **httpx + selectolax** | Static pages; no browser needed |
| PDF fallback | **Docling** (+ Claude Batch) | Per master spec; now demoted to fallback tier |
| Postgres | **psycopg 3, plain SQL migrations** | No ORM; mirrors project's thin-dependency pattern |
| Prior art | **540co repos** (Apache-style data extracts), **budget.dtic.mil** | Schema reference + independent cross-check source; neither is a runtime dependency |

## 7. Risks

- **P-40 embedded XML unverified** — recon confirmed RDT&E (DARPA); procurement books
  come from a different generator. First plan task verifies on a real P-1/P-40 book;
  if absent, Tier 1 carries procurement (eval gate 5 still applies via RDT&E ground truth).
- **Schema drift across services/years** — mitigated by golden corpus + per-document
  `extraction_runs` versioning; 540co history suggests stability.
- **Crosswalk precision** — v1 is explicitly confidence-scored and non-authoritative;
  acceptance only requires the trace chain to exist, not to be complete.
- **Postgres operational surface** — single local instance, plain SQL, no ORM;
  `govbudget migrate` is idempotent.
