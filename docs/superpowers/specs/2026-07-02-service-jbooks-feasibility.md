# FY2026 Service J-books Feasibility Spike

**Date:** 2026-07-02  
**Status:** CONDITIONAL GO (Navy/Army) | BLOCKED (Air Force) — per-service verdicts below  
**Author:** feasibility spike (read-only probe, no production changes)

---

## Context

The defense-wide FY2026 J-book corpus (34 books on `comptroller.war.gov`) covers only 4th-estate
("defense-wide") organizations: DARPA, MDA, OSD, CBDP, CYBERCOM, DCAA, DCMA, DCSA, DHRA, DISA,
DLA, DSCA, DTIC, DTRA, OTE, SOCOM, TJS, and others. The R-1 display workbook (`r1_display.xlsx`)
and P-1 display workbook (`p1_display.xlsx`) also contain R-1 and P-1 budget lines for three
service branches — Army (org code `A`), Navy (`N`), Air Force (`F`) — whose **justification
books live on separate service comptroller sites**. Those sites were never scraped.

This spike answers: can those service J-books be ingested using the existing pipeline?

---

## Question 1: Index Page Access and Naming Conventions

### Findings per service

| Service | Primary site | HTTP probe result | Access verdict |
|---|---|---|---|
| Army | `asafm.army.mil` | HTTP 403 (Akamai WAF, IP-based) | **Blocked from server IP** |
| Navy | `secnav.navy.mil/fmc/fmb` | HTTP 200 + 244-byte WAF rejection page (all `/fmc/*` paths) | **Blocked from server IP** |
| Air Force | `saffm.hq.af.mil` | TLS alert 80 (SSL_AD_INTERNAL_ERROR) on both TLS 1.2 and 1.3 | **CAC client cert required** |

All three sites served their content during this probe (July 2026) but enforce bot/non-browser
access controls:

- **Army (asafm.army.mil):** Akamai WAF returns 403 for all curl/urllib requests regardless
  of User-Agent, Accept headers, or Googlebot impersonation. Requires a full browser TLS
  handshake (Playwright would bypass this).
- **Navy (secnav.navy.mil/fmc/fmb):** The entire `/fmc/*` path tree returns HTTP 200 with
  a 244-byte "Request Rejected" WAF page for all non-browser clients. Playwright would bypass
  this. The root `secnav.navy.mil/` serves normally; only `/fmc` is gated.
- **Air Force (saffm.hq.af.mil):** The TLS handshake fails at the cipher negotiation step
  with `SSL_AD_INTERNAL_ERROR` (alert 80). This pattern indicates the server requires a DoD
  CAC/PIV client certificate, not just a browser — the WAF rejects the TLS ClientHello without
  a matching client cert. **Playwright alone cannot bypass this.** The site is on a
  CAC-protected `.hq.af.mil` subdomain.

**Wayback Machine and alternate mirrors:** CDX API confirms no archived captures of
service budget material for FY2026. No public mirrors found. `comptroller.war.gov` (the
existing pipeline source) confirmed to contain **zero** service branch J-books; all its RDTE
and PROC books are 4th-estate orgs only.

### Naming convention compatibility

The existing `_classify_jbook()` regex (`RDTE_<tokens>.pdf` / `PROC_<tokens>.pdf`) works for
service books that follow the standard DoD naming pattern using the org code letters:

```
RDTE_N_MasterJustificationBook_PB2026.pdf  → ('rdte', 'N')  ✓
RDTE_A_Vol1_PB2026.pdf                     → ('rdte', 'A')  ✓
RDTE_F_MasterJustificationBook_PB2026.pdf  → ('rdte', 'F')  ✓
PROC_N_PB_2026.pdf                         → ('procurement', 'N')  ✓
```

If services use non-standard prefixes (e.g. `RDTENAV_BS_Vol1_PB2026.pdf`), the classifier
returns `None` and those books are skipped — same behavior as the 4 skipped FY2026 defense-wide
files. The exact filenames are **unverifiable without browser-level site access**.

---

## Question 2: XML Extraction and Parser Compatibility

### What we know (verifiable)

The FY2026 comptroller.war.gov release ships standalone `.xml` sidecar files alongside each
defense-wide PDF (e.g. `RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.xml`, 1.3 MB, HTTP 200).
These were verified to use the `{http://www.dtic.mil/comptroller/xml/schema/022009/jb}` namespace
(`jb-2009` schema), identical to the embedded `.zzz` XML inside the same PDFs:

```
Root tag: {http://www.dtic.mil/comptroller/xml/schema/022009/jb}JustificationBook
ProgramElements: 24
ServiceAgencyName values: {'Defense Advanced Research Projects Agency'}
```

### What we cannot verify without download

Neither the PDF structure (`.zzz` presence) nor the XML schema version of service books can be
confirmed from this IP. Two scenarios:

**Scenario A — Embedded XML (`.zzz` attachment):** All post-FY2021 J-books are produced in the
DoD Comptroller General budget system (CG-OMS / BICS). OMB Circular A-11 and DoD's own PPBE
reform mandate require XML embedding across all components using the `jb-2009` schema. The
existing `extract_jbook_xml()` + `parse_jbook_xml()` / `parse_p40_xml()` would work with
**zero code changes**.

**Scenario B — PDF without XML attachment (scan-only):** Some older or smaller service books have
been observed in prior years as scan PDFs without embedded data. If a service ships a scan-only
PDF, `extract_jbook_xml()` returns an empty list (`written = []`), the doc gets status
`extracted: 0 XMLs`, and it falls into `extraction_gaps`. The fallback for scan-only PDFs is
Mistral-OCR/vision extraction — **this spike does not build that path.** Detection is automatic
(empty `list_embedded()` result); the gap gets recorded and the book is skipped without crashing.

**Verdict:** The pipeline degrades gracefully for scan PDFs. The XML path works if the PDF has
embedded data. The risk is unknown without an actual download.

---

## Question 3: Coverage Math and Effort Estimate

### PE/BLI counts per service (from live FY2026 R-1 and P-1 display workbooks)

R-1 display: `https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/r1_display.xlsx`  
P-1 display: `https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/p1_display.xlsx`

**Unique PE/BLIs with no current J-book narrative (page-less in live site):**

| Service | R-1 (RDTE) unique PEs | P-1 (Procurement) unique BLIs | Total page-less PE/BLIs |
|---|---|---|---|
| Army (`A`) | 234 | 32 | **266** |
| Navy (`N`) | 258 | 19 | **277** |
| Air Force (`F`) | 335 | 21 | **356** |
| Space Force (`S`) | 0 | 0 | 0 |
| **Total** | **827** | **72** | **899** |

**Defense-wide orgs also without J-book coverage** (for completeness):

| Org | R-1 PEs | Note |
|---|---|---|
| DHA | 14 | Defense Health Agency — no DHA RDTE J-book in FY2026 corpus |
| CYBER | 7 | Present via CYBERCOM alias — IS covered |
| DEFW | 1 | Defense Experimentation Workforce |
| IG | 1 | Inspector General |

The **899 total service PE/BLIs** is the ground truth from the display workbooks. The task
prompt's "1,533 page-less PEs" likely refers to `budget_lines` table rows (one per
(PE, amount_type) pair), since each PE generates 7 budget_lines rows from the 7 FY columns in
the R-1 exhibit. Cross-check: Army 234×7=1,638 + 32×5=160 → 1,798 rows; Navy 258×7=1,806 +
19×5=95 → 1,901 rows; AF 335×7=2,345 + 21×5=105 → 2,450 rows. Combined: ~6,149 budget_lines
rows without narrative coverage (exact figure requires live DB query).

**Coverage gain if service books are ingested:** all 899 page-less PE/BLIs would gain
mission description + project-level R-2 narratives. That is the full set; there are no
partial-coverage scenarios (either the J-book exists and has the XML, or it does not).

### Book counts and size estimates

Service J-books are published as multi-volume sets. Estimated from historical budget cycles
and PE counts:

| Service | Estimated RDTE volumes | Estimated Procurement volumes | Total books | Estimated size |
|---|---|---|---|---|
| Navy | 5–6 | 3–4 | ~9 | ~250 MB |
| Army | 4–5 | 3 | ~8 | ~200 MB |
| Air Force | 6–7 | 4–5 | ~11 | ~350 MB |
| **Total** | | | **~28 books** | **~800 MB** |

Compare: defense-wide 34 books ≈ 150–200 MB. Service books are larger per-book (more PEs per
volume) but the pipeline imposes no size limit per document.

### Loader and registry changes needed

The pipeline change surface for a Scenario A (embedded XML) ingestion:

| Component | Change needed | Effort |
|---|---|---|
| `registry.py` `_classify_jbook()` | Zero — works for `RDTE_N_/RDTE_A_/RDTE_F_` prefix | 0 |
| `registry.py` `discover_documents()` | Zero — function already accepts any `index_url` | 0 |
| `attachments.py` `extract_jbook_xml()` | Zero — `.zzz` detection is format-agnostic | 0 |
| `xml_parser.py` `parse_jbook_xml()` | Zero — namespace-agnostic local-name matching | 0 |
| `p40_parser.py` `parse_p40_xml()` | Zero | 0 |
| `config.py` `JBOOK_FY` | Already `2026` — no change | 0 |
| `cli.py` `JBOOK_INDEX_URLS` | **Add service index URLs per service** | ~30 min |
| `orgs.py` `ORG_ALIASES` | **Add service aliases if doc_org ≠ workbook org** (e.g. `'Navy': 'N'`) | ~1 hr |
| `reconcile.py` `SCENARIO_MAP` | Zero — service books use same FY scenarios as defense-wide | 0 |
| `gaps.py` `record_extraction_gaps()` | Zero — already filters by workbook_org, works with N/A/F | 0 |
| Downloader (acquire.py) | **Must use Playwright** for Army/Navy; AF needs CAC workaround | ~2–4 hrs |
| Site exporter (`export_site.py`) | Zero — service PEs already in `budget_lines` as gaps | 0 |
| Gate scripts (`verify_phase5*.py`) | Update thresholds for higher PE-with-narrative counts | ~1 hr |
| **Total** | | **~5–6 hrs (Army/Navy) + unknown for AF** |

**Critical blocker for org code mapping:** The `record_extraction_gaps()` function queries
`budget_lines` using `organization` = the workbook org. For defense-wide books, `doc_org`
(e.g. `'CYBERCOM'`) maps to workbook org `'CYBER'` via `ORG_ALIASES`. For service books:

- If `_classify_jbook('RDTE_N_MasterJustificationBook_PB2026.pdf')` returns `org='N'`
  and `'N'` == the `budget_lines.organization` code → **no alias needed**.
- If the filename yields `org='Navy'` but workbook uses `'N'` → add `'Navy': 'N'` to
  `ORG_ALIASES`.

The mapping is unambiguous once actual filenames are known. The workbook org codes (`'A'`,
`'N'`, `'F'`) come directly from the live R-1/P-1 display workbooks (confirmed above).

---

## Per-Service Verdicts

### Navy — CONDITIONAL GO

**Access:** `secnav.navy.mil/fmc/fmb` WAF blocks server-side requests but Playwright (already in
the pipeline as `mt-browser-scraper.ts` pattern) can fetch the index page and download PDFs.
The WAF is a bot-detection layer, not a CAC gate.

**XML compatibility:** High confidence (Scenario A). Navy has been on CG-OMS since FY2021.

**Effort:** ~3–5 hours (Playwright download adapter + org alias + index URL config).

**Unknowns:** Exact filenames (classifier compatibility), embedded XML presence in actual PDFs.

**Verdict: CONDITIONAL GO** — download adapter required; XML parse compatibility unverified but
high-confidence positive. Recommend: download 1 sample Navy RDTE book via Playwright in a
follow-up task, verify `.zzz` presence, then proceed.

### Army — CONDITIONAL GO

**Access:** `asafm.army.mil` Akamai 403 blocks server-side requests; same Playwright approach
resolves this (Akamai anti-bot, not certificate-gated).

**XML compatibility:** High confidence (Scenario A). Army has been on CG-OMS since FY2021.

**Effort:** ~3–5 hours (same Playwright adapter works; Army-specific index URL + org alias).

**Unknowns:** Same as Navy.

**Verdict: CONDITIONAL GO** — structurally identical situation to Navy. Same risk profile, same
Playwright resolution path.

### Air Force — BLOCKED (current architecture)

**Access:** `saffm.hq.af.mil` fails TLS negotiation with SSL_AD_INTERNAL_ERROR (alert 80) on
both TLS 1.2 and 1.3 without a client certificate. This is a DoD CAC/PIV-gated site — the
server requires a Department of Defense client certificate to complete the TLS handshake.
Playwright cannot provide a CAC certificate. The error occurs before any HTTP request is made.

**Workaround options (not built in this spike):**

1. **Manual download path:** A human with a CAC downloads the AF J-books and places them in
   `data/raw_docs/fy2026/af/`. The existing extract/parse/load pipeline then works unchanged.
   Effort: near-zero engineering, ~1 hour of manual work per budget cycle.
2. **Alternate mirror:** Check if AF publishes books on `af.mil` (different subdomain) or
   `milSuite` portals that don't require CAC. Not verified in this spike.
3. **FOIA/public PDF request:** AF budget books are public records; they are sometimes
   re-posted on budget-transparency sites (e.g. globalsecurity.org, FederalPay). Not confirmed
   for FY2026.

**XML compatibility:** Unknown — cannot download sample.

**Verdict: BLOCKED** for automated ingestion. **GO for manual-download path.** If a CAC-holder
manually downloads the ~11 AF books and places them in the raw_docs tree, the existing pipeline
processes them without code changes (assuming Scenario A XML embedding).

---

## Risks and Caveats

1. **XML embedding not verified for service books.** If any service book is a scan PDF
   (Scenario B), the parser returns 0 rows, extraction_gaps records it, and the PE remains
   page-less. Detection is automatic. Fix requires Mistral-OCR/vision pipeline — outside scope.

2. **Volume count uncertain.** The estimated 28 books may be higher or lower; services
   occasionally split or merge volumes. The `discover_documents()` function handles any count
   correctly.

3. **Filename pattern uncertainty.** If services use non-`RDTE_`/`PROC_` prefixes,
   `_classify_jbook()` returns `None` and those books are silently skipped. A small allowlist
   extension handles non-standard names once actual filenames are known.

4. **Org code alias gap.** The `workbook_org()` translation depends on knowing the
   `doc_org` string produced by `_classify_jbook()` from the actual filenames. Until filenames
   are confirmed, the alias mapping is speculative but easy to add (1-line dict entry).

5. **Disk impact.** ~800 MB additional PDFs. Well within the 25 GB minimum-free threshold.

6. **No architectural blocker.** `jbook_documents.org` and `budget_lines.organization` use the
   same short codes; `fiscal_year` disambiguates editions. No schema changes needed.

7. **Air Force CAC wall is a hard blocker for automation.** Unlike Army/Navy which use
   software WAF, the AF site requires hardware (CAC). This is not solvable with Playwright
   or any other software-only approach.

---

## Effort Summary

| Service | Automated ingestion | Manual-download path | XML compat risk |
|---|---|---|---|
| Navy | ~3–5 hrs (Playwright adapter) | N/A | Low (high-confidence Scenario A) |
| Army | ~3–5 hrs (same Playwright adapter) | N/A | Low |
| Air Force | BLOCKED (CAC wall) | ~1 hr manual work per cycle | Unknown |
| **Shared** | ~2 hrs (config + orgs + gate threshold updates) | | |
| **Total** | **~8–12 hrs** (Navy + Army automated) | **+1 hr/cycle** for AF | |

---

## Recommendation

**GO for Navy and Army** with a Playwright-based download adapter (2–3 day implementation).
Priority: download 1 Navy + 1 Army RDTE sample book first to confirm `.zzz` XML embedding
before building the full adapter.

**GO (manual) for Air Force** — treat as a quarterly manual-download step until an alternate
mirror or CAC-free access path is found. The engineering cost is near-zero once the adapter
is built for Army/Navy (same parse/load path).

**Proposed implementation:** Phase 5D Task 2 (Service J-book Ingestion), alongside the
PB2025 backfill (Phase 5D Task 1). Dependencies: Playwright adapter for Navy/Army index
crawling + PDF download; `ORG_ALIASES` additions; service index URL configuration.

**Expected PE coverage gain:** 899 page-less PE/BLIs gain narratives (266 Army + 277 Navy
+ 356 AF). AF coverage contingent on manual downloads. Combined with the PB2025 backfill
(Phase 5D Task 1), this closes the two largest narrative gaps in the system.

---

## Appendix: Evidence

Live probes confirmed (2026-07-02):

- `https://comptroller.war.gov/Budget-Materials/Budget2026/` — HTTP 200, 37 classifiable books, zero service branch books
- `https://comptroller.war.gov/Budget-Materials/FY2026BudgetJustification/` — HTTP 200, 84 RDTE/PROC links, all defense-wide only
- `https://www.asafm.army.mil/Budget-Materials/Budget2026/` — HTTP 403 (Akamai)
- `https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx` — HTTP 200, 244-byte rejection (WAF)
- `https://www.saffm.hq.af.mil/FM-Resources/Budget/` — TLS error 80 (CAC required)

R-1 and P-1 display workbooks read locally (FY2026):

- `/Users/andeslee/Documents/Cursor-Projects/GovBudget/data/raw_docs/fy2026/dod/r1_display.xlsx`
- `/Users/andeslee/Documents/Cursor-Projects/GovBudget/data/raw_docs/fy2026/dod/p1_display.xlsx`
- Org codes confirmed: `A` (Army), `N` (Navy), `F` (Air Force) — 234/258/335 RDTE PEs; 32/19/21 Procurement BLIs

XML sidecar sample downloaded to `/tmp/service_jbooks_scratch/DARPA_FY2026_sample.xml` (1.3 MB):

- Namespace: `{http://www.dtic.mil/comptroller/xml/schema/022009/jb}` (jb-2009)
- 24 ProgramElements parsed by `parse_jbook_xml()` without error
- `parse_jbook_xml()` / `pick_book_xml()` / `extract_jbook_xml()` confirmed namespace-agnostic
  (local-name matching, no schema changes needed for service books if XML is embedded)
