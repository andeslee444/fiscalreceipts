# PB2025 J-book Backfill — Feasibility Spike

**Date:** 2026-07-02  
**Status:** GO (low-risk, high-value)  
**Author:** feasibility spike (read-only probe, no production changes)

---

## Context

The warehouse currently holds only the FY2026 President's Budget (PB2026) defense-wide
J-book edition. The `fct_budget_trajectory` mart computes `fy2025_total` and `fy2526_change`
from PB2026's own `CurrentYear` XML scenario, which reflects FY2025 **enacted** figures as
reported by the requesting agency, not the PB2025 **requested** figures. A "what changed this
cycle" book-diff product requires the PB2025 edition loaded as a separate, parallel ingestion
so that the same `pe_bli` can be compared across budget editions.

---

## Question 1: Do PB2025 J-book PDFs exist at the same comptroller sources?

**Answer: YES — full parity with FY2026.**

The registry scraper (`src/govbudget/jbooks/registry.py`) discovers documents by crawling two
index URLs. The FY2025 equivalents exist at the same path pattern:

| FY2026 URL | FY2025 URL |
|---|---|
| `https://comptroller.war.gov/Budget-Materials/Budget2026/` | `https://comptroller.war.gov/Budget-Materials/Budget2025/` |
| `https://comptroller.war.gov/Budget-Materials/FY2026BudgetJustification/` | `https://comptroller.war.gov/Budget-Materials/FY2025BudgetJustification/` |

Both FY2025 URLs returned HTTP 200 and full HTML during this spike (2026-07-02).

**Book counts discovered by `discover_documents()` run live against FY2025:**

| `exhibit_family` | FY2025 count | FY2026 count (reference) |
|---|---|---|
| `rdte` | 18 | 18 |
| `procurement` | 16 | 16 |
| `rollup` | 3 | 3 |
| **Total (classifiable)** | **37** | **37** |

The existing `_classify_jbook()` regex classifies all standard-named files correctly.
Four non-standard FY2025 filenames are skipped (same behavior as FY2026):

- `DSCA_PB2025.pdf` — missing `PROC_` prefix
- `PB_2025_PDW_VOL_1.pdf` — non-standard volume naming
- `PB_2025_RDTE_VOL_5.pdf` — non-standard volume naming
- `PB_2025_DWWCF_Operating_and_Capital_Budget_Estimates.pdf` — DWCF, not an R/D or procurement J-book

These were also non-classifiable in FY2026 under the same convention. No action needed.

**File path structure on the server:**

```
/Portals/45/Documents/defbudget/FY2025/budget_justification/pdfs/03_RDT_and_E/
    RDTE_Vol1_DARPA_MasterJustificationBook_PB_2025.pdf
    RDTE_CBDP_PB_2025.pdf
    ...
/Portals/45/Documents/defbudget/FY2025/budget_justification/pdfs/02_Procurement/
    PROC_OSD_PB_2025.pdf
    PROC_CBDP_PB_2025.pdf
    ...
/Portals/45/Documents/defbudget/FY2025/
    r1_display.xlsx
    p1_display.xlsx
    p1r_display.xlsx
```

---

## Question 2: Does the .zzz attachment + jb-2009 schema hold for PB2025?

**Answer: YES — identical structure, zero parser changes needed.**

Three PDFs were downloaded to `/tmp/pb2025_scratch/` (not production paths) and tested:

| File | Size | Attachments | Extracted XMLs |
|---|---|---|---|
| `RDTE_Vol1_DARPA_MasterJustificationBook_PB_2025.pdf` | 4.0 MB | `U_RDTE_JB_*.zzz`, `U_RDTE_MJB_*.zzz`, `Exhibit_R-1D.xml` | 3 files |
| `RDTE_CBDP_PB_2025.pdf` | 5.5 MB | `U_RDTE_JB_*.zzz`, `U_RDTE_MJB_*.zzz`, `Exhibit_R-1D.xml`, `R3_overview.xml` | 4 files |
| `PROC_OSD_PB_2025.pdf` | 947 KB | `U_PROCUREMENT_JB_*.zzz`, `U_PROCUREMENT_MJB_*.zzz`, `Exhibit_P-1D.xml` | 3 files |

**Extraction result (using existing `extract_jbook_xml()` unmodified):**

- All three PDFs: `.zzz` attachments present, renamed-zip pattern identical to FY2026.
- Zip members are `.xml` files. Extraction succeeded without errors.
- XML namespace: `{http://www.dtic.mil/comptroller/xml/schema/022009/jb}` — same `jb-2009` schema as FY2026.

**Parse result (`parse_jbook_xml()` unmodified):**

```
DARPA (rdte):   17 ProgramElements, BudgetYear=2025, service_agency='Defense Advanced Research Projects Agency'
                funding scenarios: ['PriorYear', 'CurrentYear', 'BudgetYearOne', 'BudgetYearOneBase']
CBDP (rdte):     8 ProgramElements, BudgetYear=2025
                funding scenarios: ['AllPriorYears', 'PriorYear', 'CurrentYear', 'BudgetYearOne', 'BudgetYearOneBase']
OSD (procurement): 1 LineItem, BudgetYear=2025 (P-40 format, correctly parsed by p40_parser)
```

All scenarios parsed cleanly. `BudgetYear=2025` is populated exactly as `BudgetYear=2026` is
in the FY2026 books, confirming the fiscal-year field is self-describing in the XML.

**`pick_book_xml()` selection:** correctly chose the `_MJB_` (master justification book) file
over the `_JB_` file for all three cases.

---

## Question 3: Effort estimate

### Book count and size

- **37 classifiable documents** per edition (identical to FY2026).
- Observed sizes: 947 KB (small PROC) to 5.5 MB (large RDTE). FY2026 DARPA MJB is ~6 MB.
  Estimate: **~150–200 MB total compressed PDFs** for PB2025 (consistent with FY2026 run).
- Extracted XML per document: 1–4 files, 64 KB–2.4 MB each.

### Extraction compatibility: HIGH

The existing pipeline (`discover_documents` → `acquire_pending` → `extract_jbook_xml` →
`parse_jbook_xml` / `parse_p40_xml`) works on PB2025 with **zero code changes** in the
extraction layer.

### Loader changes needed

Three areas require targeted changes:

#### 1. `JBOOK_INDEX_URLS` + `JBOOK_FY` in `cli.py` / `config.py`

Currently hardcoded to FY2026. For multi-edition support the scrape step needs to accept
a `--fiscal-year` argument and derive index URLs dynamically:

```python
# today (cli.py line 108)
JBOOK_INDEX_URLS = [
    "https://comptroller.war.gov/Budget-Materials/Budget2026/",
    "https://comptroller.war.gov/Budget-Materials/FY2026BudgetJustification/",
]

# needed: parameterize by year
def jbook_index_urls(fy: int) -> list[str]:
    return [
        f"https://comptroller.war.gov/Budget-Materials/Budget{fy}/",
        f"https://comptroller.war.gov/Budget-Materials/FY{fy}BudgetJustification/",
    ]
```

Effort: **~30 min**.

#### 2. `reconcile.py` — `SCENARIO_MAP` is edition-specific

Currently maps `PriorYear → fy_2024_actuals`, `CurrentYear → fy_2025_total`,
`BudgetYearOne → fy_2026_total`. These are semantic interpretations that shift by one year for
PB2025:

| Scenario | PB2026 meaning | PB2025 meaning |
|---|---|---|
| `PriorYear` | FY2024 actuals | FY2023 actuals |
| `CurrentYear` | FY2025 (enacted) | FY2024 (enacted) |
| `BudgetYearOne` | FY2026 request | FY2025 request |

The map must become a function of `fiscal_year` rather than a module-level constant.
The `reconcile_document()` function already receives `document_id` which carries `fiscal_year`.
Effort: **~1–2 hours** (change + update tests).

#### 3. `fct_budget_trajectory.sql` and the book-diff mart

The trajectory mart currently hard-codes `fy_2024_actuals / fy_2025_total / fy_2026_total` and
references the implicit single PB2026 edition. A book-diff mart needs a new grain:
`(pe_bli, edition_year)` rather than collapsing across editions.

Proposed new mart: `fct_book_diff`:

```sql
-- grain: (pe_bli, from_edition, to_edition)
-- from_edition=2025, to_edition=2026 for the PB2025→PB2026 diff
select
    a.pe_bli,
    a.fiscal_year as from_edition,      -- 2025
    b.fiscal_year as to_edition,        -- 2026
    a.budget_year_request as from_request,   -- BudgetYearOne from PB2025 (what PB25 asked for FY25)
    b.prior_year_actuals as to_prior_year,   -- PriorYear from PB2026 (what PB26 reports for FY24)
    b.current_year_enacted as to_enacted,    -- CurrentYear from PB2026 (FY25 enacted)
    b.budget_year_request as to_request,     -- BudgetYearOne from PB2026 (FY26 request)
    (b.budget_year_request - a.budget_year_request) as request_delta_k
from stg_budget_details a
join stg_budget_details b on a.pe_bli = b.pe_bli
where a.fiscal_year = 2025 and b.fiscal_year = 2026
  and a.scenario = 'BudgetYearOne'
  and b.scenario = 'BudgetYearOne'
```

Effort: **~2–3 hours** (new mart + dbt model + export-site changes to surface it).

#### 4. `stg_budget_details` — add `edition_year` / `fiscal_year` passthrough

The staging model already has `fiscal_year` from `jbook_documents` — this propagates naturally.
No schema migration needed; `budget_line_details` is keyed by `document_id`, and documents
carry `fiscal_year`. The `budget_lines` table also has `fiscal_year int not null`.

No schema migration needed for the core tables.

#### 5. `export_facts.py` and site exports

The `export_facts` export writes a single unified `jbook_budget_lines` parquet today.
With two editions, either:
- (a) Write both editions to the same parquet (filtered by `fiscal_year`) — simplest, works today.
- (b) Write per-edition parquets — more explicit, minimal change.

Option (a) requires zero code change to `export_facts.py` since it already includes `fiscal_year`
in the SELECT. The dbt `stg_budget_lines` source and all downstream models already handle
`fiscal_year` as a passthrough column.

Effort: **0–1 hour** depending on approach.

### Summary effort table

| Component | Change needed | Effort |
|---|---|---|
| PDF discovery (`registry.py`) | None — regex and classify work as-is | 0 |
| PDF download (`acquire.py`) | None | 0 |
| XML extraction (`attachments.py`) | None — .zzz + schema identical | 0 |
| RDTE parser (`xml_parser.py`) | None | 0 |
| Procurement parser (`p40_parser.py`) | None | 0 |
| CLI `--fiscal-year` param | Add `jbook_index_urls(fy)` function | ~30 min |
| Reconciliation `SCENARIO_MAP` | Make year-parametric | ~1–2 hrs |
| New `fct_book_diff` dbt mart | New model + export-site surface | ~2–3 hrs |
| `export_facts.py` | Likely zero if option (a) | 0–1 hr |
| Rollup loader (r1/p1 display) | Parameterize by FY (minor) | ~30 min |
| Gate + test updates | Update fixture + reconcile tests | ~1–2 hrs |
| **Total** | | **~5–9 hours** |

---

## Risks and caveats

1. **Missing non-defense-wide books.** The scraper covers only defense-wide (4th-estate) orgs
   on the OSD comptroller site. Army/Navy/Air Force/Space Force have separate J-book pages not
   scraped for FY2026 either — this is pre-existing scope, not a backfill-specific risk.

2. **4 unclassifiable FY2025 PDFs.** Same 4 files the FY2026 scraper would miss. Could be
   addressed with a small allowlist extension to `_classify_jbook()` if those orgs matter.

3. **Reconciliation baseline shift.** The PB2025 `CurrentYear` maps to FY2024 enacted (not
   FY2025), so reconciliation against the P-1 display rollup requires the FY2025 `r1_display.xlsx`
   and `p1_display.xlsx` files. These are present at
   `https://comptroller.war.gov/Budget-Materials/Budget2025/` (confirmed in this probe).

4. **Disk impact.** ~150–200 MB additional PDFs. At the project's 25 GB minimum-free threshold
   this is negligible.

5. **No architectural blocker.** The `jbook_documents.fiscal_year` column already disambiguates
   editions. The `budget_lines` unique constraint includes `fiscal_year` — no conflict.

---

## Recommendation: GO

**The PB2025 backfill is low-risk and mechanically straightforward.**

- Source availability: confirmed (same URLs, same HTML structure, HTTP 200).
- Extraction: zero-change (`.zzz` + `jb-2009` schema identical, all three sample PDFs parsed
  successfully with existing code, 0 errors).
- Loader impact: minimal — only 2 targeted code changes (URL parameterization, scenario-map
  year shift) plus one new dbt mart.
- Total estimated effort: 5–9 engineering hours for a complete, gate-guarded PB2025 ingestion.

The book-diff product (`fct_book_diff` mart) is the sole new deliverable beyond raw data
ingestion, and its grain is well-defined: `same pe_bli, from_edition=2025, to_edition=2026`.

**Proposed implementation phase:** Phase 5D Task 1 (Backfill), targeting the
`docs/2026-07-02-phase5d-years-matrix-design.md` feature roadmap.

---

## Appendix: evidence files

Scratch downloads (not committed, safe to discard):

```
/tmp/pb2025_scratch/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2025.pdf  (4.0 MB)
/tmp/pb2025_scratch/RDTE_CBDP_PB_2025.pdf                                (5.5 MB)
/tmp/pb2025_scratch/PROC_OSD_PB_2025.pdf                                 (947 KB)
/tmp/pb2025_scratch/xml/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2025/ (3 XMLs)
/tmp/pb2025_scratch/xml/RDTE_CBDP_PB_2025/                              (4 XMLs)
/tmp/pb2025_scratch/xml/PROC_OSD_PB_2025/                               (3 XMLs)
```

Comptroller URLs confirmed live:
- `https://comptroller.war.gov/Budget-Materials/Budget2025/` — HTTP 200
- `https://comptroller.war.gov/Budget-Materials/FY2025BudgetJustification/` — HTTP 200
