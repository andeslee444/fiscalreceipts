# Phase 5G — Service J-books: Navy + Army Ingestion (AF Manual Path)

**Date:** 2026-07-03
**Status:** Approved (user queue; feasibility spike
2026-07-02-service-jbooks-feasibility.md: CONDITIONAL GO Navy/Army via Playwright,
BLOCKED AF on CAC hardware cert)
**Sequenced:** after 5E. PB2026 edition only (service decade backfill is a future
decision after this lands).

## 1. What we're building

Ingest the **FY2026 Navy and Army justification books** from their service
comptroller sites (secnav.navy.mil/fmc/fmb behind a bot-WAF; asafm.army.mil behind
Akamai — both bypassable with a real browser), through the existing
extract → parse → load → reconcile → provenance pipeline, so that up to **543
page-less service PEs (277 Navy + 266 Army)** gain full-tier program pages with
mission descriptions and R-2/P-40 project narratives. Air Force (356 PEs) stays an
honest, surfaced gap with a ready **manual drop-dir path** for when a CAC-holder
provides the ~11 books.

## 2. Honesty rules (constant)

1. **Probe before build** (5E lesson): Playwright-fetch each service index, inventory
   every PDF filename into the evidence file, download ONE sample RDT&E book per
   service, verify embedded `.zzz` XML and `BudgetYear == 2026` BEFORE building the
   full adapter run. Failures land in `edition_manifest.json` under a
   `service_2026` section with precise reasons — never silently skipped.
2. **Scan-only books are recorded gaps**, not crashes: `extract_jbook_xml()`
   returning zero XMLs → extraction_gaps + manifest note (the Mistral-OCR backlog
   candidate), and the PE keeps its rollup-tier page.
3. **Downloads carry provenance**: each document records its true source URL,
   retrieval date, sha256 — the citation contract is identical to defense-wide
   books. The Playwright adapter is an acquisition transport, not a scraper of
   rendered content: it downloads the same public PDFs a human browser gets.
4. **AF absence is stated where users look**: the 5F rollup-tier page wording and
   the /methodology/ coverage section name the AF gap and its reason (CAC-gated
   site; manual path documented). When AF books arrive via the drop-dir, the same
   pipeline processes them with `acquisition: manual` recorded.
5. **Tier flips must be earned**: a PE's page upgrades rollup→full ONLY when its
   details load AND reconcile; partially-extracted books never mint half-pages.

## 3. Design

| Component | Change |
|---|---|
| Discovery | New `src/govbudget/jbooks/service_registry.py`: per-service index URL lists (Navy FMB Pres-Budget page; Army asafm Budget-Materials) + Playwright page-fetch that returns the same `(filename, href)` inventory `discover_documents` consumes; classification via the existing 5E token classifier + `EVIDENCE_PATHS`/allowlist extensions for service naming once the real filenames are inventoried |
| Acquisition | New Playwright download adapter (`service_fetch.py`): headless Chromium, real UA, per-file download with sha256 + size checks, resumable, throttled (2–4s between files — WAF politeness); falls back to nothing (no stealth arms race — if the WAF blocks headless, record and stop) |
| Org mapping | `orgs.py` aliases for whatever doc_org the filenames yield → workbook codes `N` / `A` (exact mapping decided from the inventory) |
| Extract/parse/load/reconcile | Zero expected changes (jb-2009 embedded XML, same scenarios; reconcile joins per-org against the FY2026 r1/p1 displays already loaded) |
| Provenance | Amounts + narrative paragraph provenance (these are PB2026 books — same scope as defense-wide 2026); runtime note: service books are large (~450 MB combined), pdfplumber pass is the long pole |
| AF manual path | `data/raw_docs/fy2026/af/` drop-dir + `jbooks ingest-local --org F --fiscal-year 2026 <dir>` command registering local PDFs with `acquisition='manual'` + operator-supplied source URL; documented in LAUNCH.md |
| Exporter/site | Mostly automatic (5F tier logic reads details presence). Verify: tier flip wording, program-skeleton universe counts, years-matrix + decade-series growth for 2026 service detail rows, cite-shards regen |
| Eval | Count-pinned questions (e.g. q017 trajectory PE count) will drift — re-baseline expected answers via the sanctioned grader-recompute path (mechanical, no API); the confirming live eval run is deferred with backlog #22 until the API cap resets 2026-08-01 (recorded in ROADMAP) |

## 4. Verification

- **Probe evidence**: full per-service PDF inventories + sample-book extraction
  proof committed under docs/superpowers/reviews/ before the bulk run.
- **verify-phase1**: silent-unreconciled stays 0 with the new documents (the 5E
  doc-level lesson); per-org recon checks exist for N and A books.
- **verify-phase5b1**: narrative provenance sample includes service books; orphan
  and equality checks green with the grown corpus.
- **verify-phase5e**: leg a edition coverage unchanged (2026 gains docs, still one
  edition); legs b–d green with grown 2026 grain counts.
- **Site gates**: program-skeleton universe recount (full tier grows toward ~1,000);
  G8 recompute legs; full 22-gate suite.
- **Visual judging**: 3 judges on one newly-full-tier Navy page + one Army page
  (does the upgraded page meet the 5F bar? narrative citations land on the right
  PDF pages?) — median ≥4.
- **Live verification**: a Navy PE that was rollup-tier yesterday shows mission +
  project narratives with working PDF citations in production.

## 5. Non-goals

- AF automated ingestion (CAC hardware wall — manual path only).
- Service decade backfill (PB2017–2025 service books) — separate GO/NO-GO after
  this phase proves the adapter.
- Dossier generation for new PEs (cost decision, unchanged).
- OCR for scan-only volumes (recorded gaps; Mistral-OCR stays backlog).
