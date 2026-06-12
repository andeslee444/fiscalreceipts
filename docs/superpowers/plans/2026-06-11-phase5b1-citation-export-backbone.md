# Phase 5B-1: Citation + Export Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every site-served number gets a machine-verifiable citation: a `provenance_pages` table resolving J-book facts to PDF page + word bbox, cell-level provenance for R-1/P-1 workbook facts, a typed `export-site` artifact bundle (parquet + citations + sha-named PDFs/workbooks + manifest), and a `verify-phase5b1` gate that mechanically re-verifies sampled citations at 100%.

**Architecture:** Build-time only — no UI. New module `src/govbudget/jbooks/provenance_pages.py` (per-document hybrid pypdf-prefilter → pdfplumber-bbox finder), new `src/govbudget/export_site.py`, migration `003`, loader changes for cell provenance, gates in `src/govbudget/verify_phase5b1.py`. Citations carry per-tier shapes: PDF page+bbox (J-book), workbook+sheet+cells+amount (R-1/P-1), filing URL (LDA), with explicit `units` per tier ($M for details, $K for rollups).

**Tier deferral (binding):** USAspending (dataset + reproducible-query permalink), state checkbook (source/SoQL URL), and derived-metric (formula + input citations) tiers from spec §4.4 are NOT implemented in 5B-1 — they are owned by 5B-2 (USAspending/state, where query permalinks need the site's URL scheme) and 5B-3 (derived, where the anomaly/concentration features render them). Deferral is safe because 5B-1 ships no UI; to make it impossible to forget, `manifest.json` lists every exported dataset that lacks a citation tier under `"uncited_datasets"`, and 5B-2's render gate must refuse to render numbers from those datasets until their tiers exist. Spec §4.2's "static JSON per page" is likewise deferred: 5B-2 derives per-page JSON at SSG time from `citations.parquet`, which 5B-1 establishes as the canonical source.

**Tech Stack:** Python 3.12, pdfplumber>=0.11 (MIT — NEW dep; PyMuPDF rejected: AGPL), pypdf 6.x (installed), openpyxl, psycopg3, duckdb, pytest. Conventions: loud failures, no network in tests, DuckDB reads `read_only=True`. NO pandas/pyarrow — they are not installed; tests use plain duckdb `.fetchone()/.fetchall()`.

**Recon facts the implementer must NOT rediscover** (verified live 2026-06-11, incl. adversarial re-probe):
- `jbook_documents` columns: `id, org, exhibit_family, fiscal_year, title, source_url (official URL), file_path (ABSOLUTE local path — never export verbatim), sha256, bytes, downloaded_at (this is the "retrieved_at"; NULLABLE — handle None), has_embedded_xml, status`. Live: 37 downloaded docs = 34 PDFs + 3 xlsx display workbooks — a `status='downloaded'` filter alone ships workbooks mislabeled as PDFs; filter `file_path ilike '%.pdf'` for the pdfs copy.
- `extraction_runs` columns: `id, document_id, tier int NOT NULL, tool_versions jsonb NOT NULL, status (default 'running'), started_at, finished_at`. Test seeds MUST be `insert into extraction_runs (document_id, tier, tool_versions) values (%s, 1, '{}')`.
- `budget_line_details`: `document_id, pe_bli, project_number (nullable), project_title, scenario, amount_millions numeric, xml_path, reconciled, superseded`. Postgres ids are bigserial and RESET on re-extraction — never use them as fact ids. **Live data has 11 duplicate (document_sha, pe_bli, project_number, scenario) keys with DIFFERENT amounts** (e.g. 0208085JCY BudgetYearOne ×2) — fact identity MUST include the amount. **1,004 of 4,421 facts (23%) have amount_millions = 0** — '0.000' floods page text; zero-amount facts get NO page citation (policy below).
- `budget_lines`: unique grain `(exhibit, fiscal_year, account, organization, budget_activity, pe_bli, amount_type)`, `amount_thousands numeric`, `source_document_id`. `export_facts.EXPORTS["budget_lines"]` currently DROPS `source_document_id`.
- `export_facts(dsn, *, parquet_dir)` writes ALL-VARCHAR parquet to `parquet_dir/"jbooks"` — fine for dbt staging (it re-casts), FORBIDDEN for site artifacts. `tests/jbooks/test_export_facts.py::test_export_facts_writes_parquet` asserts the EXACT sorted file list — adding an export REQUIRES updating that assertion in the same commit.
- Loaders: `rollup_loader.load_rollup(dsn, xlsx_path, *, exhibit, fiscal_year, source_document_id=None)` is 1:1 cell→fact; `p1_loader.load_p1_rollup(...)` SUMS many "Add" sub-row cells into one fact (cell-LIST citations required). Both use `iter_rows(values_only=True)` with no enumerate — row numbers currently lost. `fy_cols`/`amount_cols` keys are 0-BASED column indices; `_find_header_row` returns a 1-BASED row. Existing test fixtures: `tests/jbooks/test_rollup_loader.py::make_xlsx(tmp_path, with_preamble_rows=True)` (header row 3, 'FY 2024 Actuals' at 0-based col 9 → expected cell `J4`); `tests/jbooks/test_p1_loader.py::make_p1_xlsx(tmp_path)` already contains exactly TWO 'Add' rows for BLI `7001SA1000` (amount cells `O3`, `O4`) plus one Non-Add row — reuse them, do not invent fixtures.
- pdfplumber probe: `page.extract_words()` → `{'text': '280.494', 'x0': 235.23, 'x1': 267.75, 'top': 158.47, 'bottom': 167.47}` on DARPA book page 24 (1-based; `pdf.pages` list 0-indexed). Same string also on p.25. Re-verified: a pypdf 2-page excerpt of pages 24-25 is ~104 KB, keeps its text layer, and pdfplumber returns the IDENTICAL bbox on it. ~54-67 ms/page pdfplumber; pypdf `extract_text()` ≈ 12 ms/page. Pages landscape letter 792×612. `#page=N` is 1-based.
- DARPA master book: `data/raw_docs/fy2026/darpa/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf` (387 pp). PE 0601101E FY24 actuals fact: `scenario='PriorYear'`, `amount_millions=280.494`.
- Migrations auto-applied in name order by `govbudget.jbooks.db.migrate()`; Postgres is 17.8 → `unique nulls not distinct` valid. `array_to_string(source_cells, ',')` returns text → the all-varchar writer handles it.
- dbt marts are VIEWS over `read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/...')` — RELATIVE paths when `GOVBUDGET_DATA` unset: **live runs must execute from repo root** (same constraint as existing gates). All 11 duckdb marts exported in Task 6 verified to exist.
- Tests: pg fixtures ONLY in `tests/jbooks/conftest.py` (session `pg_dsn`; autouse `_clean_tables` truncates a HARD-CODED table list — append new tables there). Flat `tests/test_verify_*.py` files have NO pg access — path-only gates live there. No network. Parquet fixtures built inline with duckdb in tmp_path (see `tests/test_verify_phase5a.py` helpers).
- CLI: handlers `cmd_*(args)` with lazy imports; gates print `gate N name: ... → PASS/FAIL` then `print("verify-…:", "PASS"|"FAIL"); sys.exit(0|1)`. `jbooks` positional `choices=[...]` at cli.py ~818; `cmd_jbooks` at ~113.
- `config.py`: `ROOT, DATA_DIR (env GOVBUDGET_DATA), PARQUET_DIR, DUCKDB_PATH, MANIFEST_PATH, PG_DSN (env GOVBUDGET_PG_DSN), RAW_DOCS_DIR, JBOOK_FY=2026`. No SITE_DIR or PDF base URL yet.
- R2 decided; hosted PDF URL `{base}/{sha256}.pdf#page=N`, base via env `GOVBUDGET_PDF_BASE_URL` (default `/pdfs`).

**Canonical identity (binding, used everywhere):**

```python
def canonical_amount(amount) -> str:
    """Canonical 3-decimal string for identity hashing: '280.494', '-1.200', '0.000'."""
    from decimal import Decimal
    return f"{Decimal(amount):.3f}"

def fact_id_jbook(document_sha256, pe_bli, project_number, scenario, amount) -> str:
    import hashlib
    key = f"{document_sha256}|{pe_bli}|{project_number or ''}|{scenario}|{canonical_amount(amount)}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]

def fact_id_workbook(document_sha256, exhibit, fiscal_year, account, organization,
                     budget_activity, pe_bli, amount_type) -> str:
    import hashlib
    key = (f"{document_sha256}|{exhibit}|{fiscal_year}|{account}|{organization}|"
           f"{budget_activity or ''}|{pe_bli}|{amount_type}")
    return hashlib.sha256(key.encode()).hexdigest()[:16]

def fact_id_lda(filing_uuid, pe_bli, matched_term) -> str:
    import hashlib
    return hashlib.sha256(f"{filing_uuid}|{pe_bli}|{matched_term}".encode()).hexdigest()[:16]
```

These live in `src/govbudget/export_site.py` and are imported by gates/tests. All inputs are sha-/content-stable — ids survive DB rebuilds.

---

### Task 1: Dependency, config, migration 003, conftest

**Files:**
- Modify: `pyproject.toml` (+ `uv.lock` via `uv add`)
- Create: `migrations/003_provenance_pages.sql`
- Modify: `src/govbudget/config.py`
- Modify: `tests/jbooks/conftest.py` (truncate list)
- Test: `tests/jbooks/test_migration_003.py`, `tests/test_config.py` (extend)

- [ ] **Step 1: Add pdfplumber**

Run: `uv add "pdfplumber>=0.11"`
Expected: pyproject gains `pdfplumber>=0.11`; uv.lock updated (pdfminer.six MIT, pypdfium2 BSD/Apache).

- [ ] **Step 2: Write failing config test**

Append to `tests/test_config.py`:

```python
def test_site_constants():
    from govbudget import config

    assert config.SITE_DIR == config.DATA_DIR / "site"
    assert config.PDF_BASE_URL  # non-empty; env-overridable
```

Run: `uv run pytest tests/test_config.py -q` → FAIL (AttributeError).

- [ ] **Step 3: Add config constants**

In `src/govbudget/config.py`, after `JBOOK_FY = 2026`:

```python
# Phase 5B site export
SITE_DIR = DATA_DIR / "site"
# Base URL where sha-named PDFs are hosted (R2). Relative default for local dev.
PDF_BASE_URL = os.environ.get("GOVBUDGET_PDF_BASE_URL", "/pdfs")
```

Run: `uv run pytest tests/test_config.py -q` → PASS.

- [ ] **Step 4: Write failing migration test**

Create `tests/jbooks/test_migration_003.py`:

```python
import psycopg


def test_provenance_pages_table_exists(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        cols = {
            r[0]
            for r in con.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'provenance_pages'"
            )
        }
    assert {
        "document_sha256", "pe_bli", "project_number", "scenario",
        "amount_millions", "amount_text", "page_number", "x0", "x1",
        "top_pt", "bottom_pt", "page_width", "page_height", "resolution",
        "candidate_pages",
    } <= cols


def test_provenance_pages_amount_in_unique_key(pg_dsn):
    """Two facts differing ONLY in amount must both be storable (live data has 11 such pairs)."""
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        for amt in ("1.000", "2.000"):
            con.execute(
                "insert into provenance_pages (document_sha256, pe_bli, scenario,"
                " amount_millions, amount_text, resolution) values"
                " ('abc','0601101E','BudgetYearOne',%s,%s,'unresolved')",
                (amt, amt),
            )
        n = con.execute("select count(*) from provenance_pages").fetchone()[0]
    assert n == 2


def test_budget_lines_cell_columns(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        cols = {
            r[0]
            for r in con.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'budget_lines'"
            )
        }
    assert {"source_sheet", "source_cells"} <= cols
```

Run: `uv run pytest tests/jbooks/test_migration_003.py -q` → FAIL.

- [ ] **Step 5: Write migration**

Create `migrations/003_provenance_pages.sql`:

```sql
-- Phase 5B-1: PDF page/bbox resolution per J-book fact, and workbook
-- cell provenance for R-1/P-1 rollup facts.
-- Identity INCLUDES the amount: live data has duplicate
-- (sha, pe_bli, project, scenario) keys with different amounts.

create table if not exists provenance_pages (
  id bigserial primary key,
  document_sha256 text not null,
  pe_bli text not null,
  project_number text,
  scenario text not null,
  amount_millions numeric not null,
  amount_text text not null,          -- formatted string searched, e.g. '280.494'
  page_number int,                    -- 1-based PDF page; null when unresolved
  x0 numeric, x1 numeric,             -- pdfplumber coords, points
  top_pt numeric, bottom_pt numeric,  -- y from PAGE TOP (pdfplumber convention)
  page_width numeric, page_height numeric,
  resolution text not null,           -- 'unique' | 'ambiguous_first' | 'zero_amount' | 'unresolved'
  candidate_pages int not null default 0,
  built_at timestamptz not null default now(),
  unique nulls not distinct
    (document_sha256, pe_bli, project_number, scenario, amount_millions)
);

-- R-1: one cell per fact; P-1/P-1R: list of contributing 'Add' sub-row cells.
alter table budget_lines add column if not exists source_sheet text;
alter table budget_lines add column if not exists source_cells text[];
```

- [ ] **Step 6: Append `provenance_pages` to the conftest truncate list**

In `tests/jbooks/conftest.py` `_clean_tables`:

```python
con.execute(
    "truncate jbook_documents, budget_lines, extraction_runs, budget_line_details, "
    "detail_narratives, reconciliation_checks, review_queue, extraction_gaps,"
    " budget_line_awards, provenance_pages restart identity cascade"
)
```

- [ ] **Step 7: Run tests**

`uv run pytest tests/jbooks/test_migration_003.py tests/test_config.py -q` → PASS. Full suite green.

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml uv.lock migrations/003_provenance_pages.sql src/govbudget/config.py tests/jbooks/conftest.py tests/jbooks/test_migration_003.py tests/test_config.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(5b1): pdfplumber dep, site config, provenance_pages migration (amount in identity)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: XLSX cell provenance in both loaders

**Files:**
- Modify: `src/govbudget/jbooks/rollup_loader.py`, `src/govbudget/jbooks/p1_loader.py`
- Test: extend `tests/jbooks/test_rollup_loader.py`, `tests/jbooks/test_p1_loader.py`

- [ ] **Step 1: Write failing R-1 test** (reuse `make_xlsx(tmp_path, with_preamble_rows=True)` — header row 3, FY 2024 Actuals at 0-based col 9):

```python
def test_load_rollup_records_cell_provenance(pg_dsn, tmp_path):
    xlsx = make_xlsx(tmp_path, with_preamble_rows=True)
    load_rollup(pg_dsn, xlsx, exhibit="R-1", fiscal_year=2026)
    with psycopg.connect(pg_dsn) as con:
        row = con.execute(
            "select source_sheet, source_cells from budget_lines"
            " where amount_type = 'fy_2024_actuals'"
        ).fetchone()
    assert row[0]                      # sheet name recorded
    assert row[1] == ["J4"]            # col J (0-based 9 → letter J), data row 4
```

Run → FAIL.

- [ ] **Step 2: Implement R-1 cell tracking**

In `rollup_loader.py`: `from openpyxl.utils import get_column_letter`; track rows and extend the upsert:

```python
for row_idx, row in enumerate(
    sheet.iter_rows(min_row=header_row + 1, values_only=True),
    start=header_row + 1,
):
    ids = {name: row[j] for j, name in id_cols.items() if j < len(row)}
    if not ids.get("pe_bli"):
        continue
    for j, amount_type in fy_cols.items():
        ...
        cell = f"{get_column_letter(j + 1)}{row_idx}"
        con.execute(
            """
            insert into budget_lines
              (exhibit, fiscal_year, account, account_title, organization,
               budget_activity, budget_activity_title, line_number, pe_bli,
               title, amount_type, amount_thousands, source_document_id,
               source_sheet, source_cells)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (exhibit, fiscal_year, account, organization, budget_activity, pe_bli, amount_type)
            do update set amount_thousands = excluded.amount_thousands,
                          title = excluded.title,
                          source_document_id = excluded.source_document_id,
                          source_sheet = excluded.source_sheet,
                          source_cells = excluded.source_cells
            """,
            (..., sheet.title, [cell]),
        )
```

(Conflict grain stays last-write-wins for colliding sheet rows — same as amounts today.)

- [ ] **Step 3: Write failing P-1 test** (reuse `make_p1_xlsx(tmp_path)` — it already has TWO 'Add' rows for BLI `7001SA1000`, amount cells `O3` and `O4`):

```python
def test_load_p1_records_contributing_cells(pg_dsn, tmp_path):
    xlsx = make_p1_xlsx(tmp_path)
    load_p1_rollup(pg_dsn, xlsx, exhibit="P-1", fiscal_year=2026)
    with psycopg.connect(pg_dsn) as con:
        row = con.execute(
            "select source_sheet, source_cells from budget_lines where pe_bli = %s"
            " and amount_type = 'fy_2024_actuals'",
            ("7001SA1000",),
        ).fetchone()
    assert row[1] == ["O3", "O4"]      # BOTH contributing cells — honesty for summed facts
```

Run → FAIL.

- [ ] **Step 4: Implement P-1 cell-list tracking** — parallel `cells` accumulator keyed exactly like `sums`:

```python
cells: dict[tuple, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

for row_idx, row in enumerate(
    sheet.iter_rows(min_row=header_row + 1, values_only=True),
    start=header_row + 1,
):
    ...
    for j, amount_type in amount_cols.items():
        ...
        sums[key][amount_type] += amount
        cells[key][amount_type].append(f"{get_column_letter(j + 1)}{row_idx}")
```

Insert passes `sheet.title` + `cells[key][amount_type]`, same upsert extension as R-1.

- [ ] **Step 5: Run loader tests + full suite** → green.

- [ ] **Step 6: Commit**

```bash
git add src/govbudget/jbooks/rollup_loader.py src/govbudget/jbooks/p1_loader.py tests/jbooks/test_rollup_loader.py tests/jbooks/test_p1_loader.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(5b1): cell-level provenance in R-1/P-1 loaders (cell lists for summed P-1 facts)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: export_facts gains documents + provenance columns

**Files:**
- Modify: `src/govbudget/jbooks/export_facts.py`
- Test: extend `tests/jbooks/test_export_facts.py` — **including the existing exact-list assertion**

- [ ] **Step 1: Update the existing exact-list test FIRST**

`tests/jbooks/test_export_facts.py::test_export_facts_writes_parquet` asserts the exact sorted list of export files. Update it to:

```python
    assert [p.name for p in paths] == [
        "budget_line_awards.parquet",
        "budget_lines.parquet",
        "detail_narratives.parquet",
        "details.parquet",
        "documents.parquet",
    ]
```

- [ ] **Step 2: Write failing new-columns test**

```python
def test_export_facts_includes_provenance_columns(pg_dsn, tmp_path):
    # seed one jbook_documents + extraction_runs(document_id, tier, tool_versions)
    #   values (%s, 1, '{}') + one budget_lines + one details row
    #   (copy the seeding already in this file)
    paths = export_facts(pg_dsn, parquet_dir=tmp_path)
    import duckdb

    bl_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/budget_lines.parquet') limit 0"
    ).columns)
    assert {"source_document_id", "source_sheet", "source_cells"} <= bl_cols
    nr_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/detail_narratives.parquet') limit 0"
    ).columns)
    assert "document_id" in nr_cols
    dt_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/details.parquet') limit 0"
    ).columns)
    assert "document_sha256" in dt_cols
    doc_cols = set(duckdb.sql(
        f"select * from read_parquet('{tmp_path}/jbooks/documents.parquet') limit 0"
    ).columns)
    assert {"id", "org", "fiscal_year", "title", "source_url", "sha256",
            "downloaded_at", "rel_path"} <= doc_cols
```

Run → FAIL.

- [ ] **Step 3: Extend EXPORTS** (all-varchar convention is FINE here — dbt staging re-casts; the typed site export is Task 6):

```python
EXPORTS: dict[str, str] = {
    "budget_lines": (
        "select exhibit, fiscal_year, account, account_title, organization,"
        " budget_activity, budget_activity_title, pe_bli, title, amount_type,"
        " amount_thousands, source_document_id, source_sheet,"
        " array_to_string(source_cells, ',') as source_cells from budget_lines"
    ),
    "details": (
        "select d.pe_bli, d.project_number, d.project_title, d.scenario,"
        " d.amount_millions, d.xml_path, d.reconciled, j.org, j.exhibit_family,"
        " j.fiscal_year, d.document_id, j.sha256 as document_sha256"
        " from budget_line_details d join jbook_documents j on j.id=d.document_id"
        " where not d.superseded"
    ),
    "detail_narratives": (
        "select n.pe_bli, n.project_number, n.kind, n.title, n.body, n.xml_path,"
        " j.org, j.fiscal_year, n.document_id"
        " from detail_narratives n join jbook_documents j on j.id=n.document_id"
        " where not n.superseded"
    ),
    "budget_line_awards": (  # unchanged
        "select pe_bli, exhibit, fiscal_year, organization, award_piid,"
        " recipient_name, recipient_uei, matched_obligation, method, confidence,"
        " score, rationale from budget_line_awards"
    ),
    "documents": (
        # rel_path relativizes the machine-specific absolute file_path
        "select id, org, exhibit_family, fiscal_year, title, source_url, sha256,"
        " bytes, downloaded_at,"
        " 'fy' || fiscal_year || '/' || lower(org) || '/' || title as rel_path"
        " from jbook_documents where status = 'downloaded' and sha256 is not null"
    ),
}
```

- [ ] **Step 4: Run tests** — `uv run pytest tests/jbooks/test_export_facts.py -q` → PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/export_facts.py tests/jbooks/test_export_facts.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(5b1): export documents.parquet + provenance columns in fact exports" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Real-PDF test fixture (DARPA 2-page excerpt, ~104 KB)

**Files:**
- Create: `scripts/make_pdf_fixture.py`, `tests/fixtures/jbooks/darpa_p24_25.pdf` (first binary fixture in the repo — intentional: bbox tests need a real text layer)
- Test: `tests/jbooks/test_pdf_fixture.py`

- [ ] **Step 1: Write the generator**

`scripts/make_pdf_fixture.py`:

```python
"""One-shot: extract pages 24-25 (1-based) from the DARPA master book into a
~104 KB committed test fixture. Re-run only if the source book changes.

Usage: uv run python scripts/make_pdf_fixture.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter

SRC = Path("data/raw_docs/fy2026/darpa/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf")
DST = Path("tests/fixtures/jbooks/darpa_p24_25.pdf")

reader = PdfReader(str(SRC))
writer = PdfWriter()
for i in (23, 24):  # 0-based indices for 1-based pages 24, 25
    writer.add_page(reader.pages[i])
DST.parent.mkdir(parents=True, exist_ok=True)
with DST.open("wb") as fh:
    writer.write(fh)
print(f"wrote {DST} ({DST.stat().st_size} bytes)")
```

- [ ] **Step 2: Generate + verify** — run it, then `tests/jbooks/test_pdf_fixture.py`:

```python
from pathlib import Path

import pdfplumber

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"


def test_fixture_contains_anchor_and_amount_on_both_pages():
    with pdfplumber.open(FIXTURE) as pdf:
        assert len(pdf.pages) == 2
        texts = [p.extract_text() or "" for p in pdf.pages]
    assert "0601101E" in texts[0] and "280.494" in texts[0]
    assert "0601101E" in texts[1] and "280.494" in texts[1]  # ambiguity case is real
```

(Both pages verified live to contain both strings.) Run → PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/make_pdf_fixture.py tests/fixtures/jbooks/darpa_p24_25.pdf tests/jbooks/test_pdf_fixture.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "test(5b1): committed 2-page DARPA excerpt fixture for page/bbox resolution" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: provenance_pages builder (per-document hybrid finder)

**Files:**
- Create: `src/govbudget/jbooks/provenance_pages.py`
- Test: `tests/jbooks/test_provenance_pages.py`
- Modify: `src/govbudget/cli.py` (jbooks action `provenance-pages`)

- [ ] **Step 1: Write failing tests**

`tests/jbooks/test_provenance_pages.py`:

```python
import hashlib
from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.provenance_pages import (
    amount_strings,
    build_provenance_pages,
    find_fact_page,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"


def test_amount_strings():
    assert amount_strings(Decimal("280.494")) == ["280.494"]
    assert amount_strings(Decimal("1234.5")) == ["1,234.500", "1234.500"]
    assert amount_strings(Decimal("-1.2")) == ["-1.200"]


def test_find_fact_page_resolves_with_anchor():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("280.494"))
    assert hit["page_number"] == 1                  # 1-based within the excerpt
    assert hit["resolution"] == "ambiguous_first"   # both pages carry anchor+amount
    assert hit["candidate_pages"] == 2
    assert 200 < hit["x0"] < 300 and 150 < hit["top_pt"] < 175


def test_find_fact_page_word_boundary():
    """'280.494' must NOT match inside '1,280.494'-style strings; the prefilter
    is regex word-boundary, not substring. Probe with an amount absent from the
    fixture but whose digits appear as a substring of present numbers."""
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("80.494"))
    assert hit["resolution"] == "unresolved"        # '80.494' only occurs inside '280.494'


def test_find_fact_page_zero_amount_policy():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("0"))
    assert hit["resolution"] == "zero_amount"
    assert hit["page_number"] is None


def test_find_fact_page_unresolved():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("999999.999"))
    assert hit["page_number"] is None
    assert hit["resolution"] == "unresolved"


def _seed_fact(pg_dsn, amount="280.494"):
    sha = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'excerpt.pdf','https://example.mil/x.pdf',%s,%s,"
            " now(),'downloaded') on conflict (source_url) do nothing",
            (str(FIXTURE), sha),
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','PriorYear',%s,'ProgramElement[0]')",
            (run_id, doc_id, amount),
        )


def test_build_provenance_pages_inserts_and_caches(pg_dsn):
    _seed_fact(pg_dsn)
    assert build_provenance_pages(pg_dsn) == 1
    assert build_provenance_pages(pg_dsn) == 0   # cached by identity incl. amount
    with psycopg.connect(pg_dsn) as con:
        row = con.execute(
            "select page_number, resolution, amount_text, amount_millions"
            " from provenance_pages"
        ).fetchone()
    assert row[0] == 1 and row[2] == "280.494"


def test_build_provenance_pages_distinct_amounts_both_stored(pg_dsn):
    """Live data has duplicate keys differing only in amount — both must store."""
    _seed_fact(pg_dsn, amount="280.494")
    _seed_fact(pg_dsn, amount="281.000")
    assert build_provenance_pages(pg_dsn) == 2
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement the module — the grouped implementation IS the code (no per-fact PDF reopening exists anywhere):**

```python
"""Resolve J-book facts to PDF page + word bbox.

Per DOCUMENT (not per fact): one pypdf text pass over all pages (~12 ms/page)
caches page texts; candidate pages are those whose text contains the pe_bli
anchor AND a word-boundary regex match of a formatted amount string; ONE
pdfplumber handle (opened lazily) extracts words only on candidate pages
(~60 ms/page) until one yields the exact word → bbox.

Resolution honesty: 'unique' (one candidate page), 'ambiguous_first' (several;
the first page with a word match wins, count recorded), 'zero_amount' (amount
== 0 — '0.000' floods pages, a page highlight would be arbitrary; NO page
citation, the xml_path citation remains), 'unresolved' (no page). Identity
includes the amount (live data has same-key facts with different amounts).
Cached: already-built (sha, pe_bli, project, scenario, amount) keys are skipped.
"""
from __future__ import annotations

import re
from decimal import Decimal
from itertools import groupby
from pathlib import Path

import psycopg


def amount_strings(amount: Decimal) -> list[str]:
    """Candidate page renderings, 3-decimal J-book style; comma form first."""
    grouped = f"{amount:,.3f}"
    bare = f"{amount:.3f}"
    return [grouped] if grouped == bare else [grouped, bare]


def _page_texts(pdf_path: Path) -> list[str]:
    from pypdf import PdfReader

    return [p.extract_text() or "" for p in PdfReader(str(pdf_path)).pages]


def _amount_pattern(target: str) -> re.Pattern:
    # word-boundary for numerics: '280.494' must not match inside '1,280.494'
    return re.compile(rf"(?<![\d,.]){re.escape(target)}(?![\d])")


_UNRESOLVED = {
    "page_number": None, "x0": None, "x1": None, "top_pt": None,
    "bottom_pt": None, "page_width": None, "page_height": None,
}


def _resolve_fact(page_texts: list[str], plumber, *, pe_bli: str,
                  amount: Decimal) -> dict:
    """Resolve one fact against pre-extracted texts + an open pdfplumber handle.

    `plumber` is a zero-arg callable returning the (lazily opened, cached)
    pdfplumber.PDF — so documents whose facts all miss never pay the open cost.
    """
    targets = amount_strings(amount)
    if amount == 0:
        return {**_UNRESOLVED, "resolution": "zero_amount",
                "candidate_pages": 0, "amount_text": targets[0]}
    patterns = [_amount_pattern(t) for t in targets]
    candidates = [
        i for i, text in enumerate(page_texts)
        if pe_bli in text and any(p.search(text) for p in patterns)
    ]
    if not candidates:
        return {**_UNRESOLVED, "resolution": "unresolved",
                "candidate_pages": 0, "amount_text": targets[0]}
    pdf = plumber()
    for idx in candidates:                      # try ALL candidates, not just first
        page = pdf.pages[idx]
        word = next((w for w in page.extract_words() if w["text"] in targets), None)
        if word is not None:
            return {
                "page_number": idx + 1,         # 1-based for #page=N anchors
                "x0": float(word["x0"]), "x1": float(word["x1"]),
                "top_pt": float(word["top"]), "bottom_pt": float(word["bottom"]),
                "page_width": float(page.width), "page_height": float(page.height),
                "resolution": "unique" if len(candidates) == 1 else "ambiguous_first",
                "candidate_pages": len(candidates),
                "amount_text": word["text"],
            }
    return {**_UNRESOLVED, "resolution": "unresolved",
            "candidate_pages": len(candidates), "amount_text": targets[0]}


def find_fact_page(pdf_path: Path, *, pe_bli: str, amount: Decimal) -> dict:
    """Single-fact public entry point (tests; ad-hoc use)."""
    import pdfplumber

    texts = _page_texts(pdf_path)
    pdf_handle = None

    def plumber():
        nonlocal pdf_handle
        if pdf_handle is None:
            pdf_handle = pdfplumber.open(pdf_path)
        return pdf_handle

    try:
        return _resolve_fact(texts, plumber, pe_bli=pe_bli, amount=amount)
    finally:
        if pdf_handle is not None:
            pdf_handle.close()


def build_provenance_pages(dsn: str) -> int:
    """Resolve every non-superseded detail fact lacking a provenance_pages row.

    Grouped by document: each PDF's text is extracted ONCE for all its facts.
    Returns rows actually inserted (cursor rowcount — ON CONFLICT suppressions
    don't count). Missing document files raise loudly.
    """
    import pdfplumber

    inserted = 0
    with psycopg.connect(dsn) as con:
        rows = con.execute(
            """
            select j.sha256, j.file_path, d.pe_bli, d.project_number, d.scenario,
                   d.amount_millions
            from budget_line_details d
            join jbook_documents j on j.id = d.document_id
            where not d.superseded and j.sha256 is not null
              and not exists (
                select 1 from provenance_pages p
                where p.document_sha256 = j.sha256 and p.pe_bli = d.pe_bli
                  and p.scenario = d.scenario
                  and p.project_number is not distinct from d.project_number
                  and p.amount_millions = d.amount_millions
              )
            order by j.sha256
            """
        ).fetchall()
        for sha, doc_group in groupby(rows, key=lambda r: r[0]):
            facts = list(doc_group)
            pdf_path = Path(facts[0][1])
            if not pdf_path.exists():
                raise FileNotFoundError(f"document {sha} missing on disk: {pdf_path}")
            texts = _page_texts(pdf_path)
            pdf_handle = None

            def plumber():
                nonlocal pdf_handle
                if pdf_handle is None:
                    pdf_handle = pdfplumber.open(pdf_path)
                return pdf_handle

            try:
                for _, _, pe_bli, project_number, scenario, amount in facts:
                    hit = _resolve_fact(texts, plumber, pe_bli=pe_bli,
                                        amount=Decimal(amount))
                    cur = con.execute(
                        """
                        insert into provenance_pages
                          (document_sha256, pe_bli, project_number, scenario,
                           amount_millions, amount_text, page_number, x0, x1,
                           top_pt, bottom_pt, page_width, page_height,
                           resolution, candidate_pages)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (document_sha256, pe_bli, project_number,
                                     scenario, amount_millions) do nothing
                        """,
                        (sha, pe_bli, project_number, scenario, amount,
                         hit["amount_text"], hit["page_number"], hit["x0"],
                         hit["x1"], hit["top_pt"], hit["bottom_pt"],
                         hit["page_width"], hit["page_height"],
                         hit["resolution"], hit["candidate_pages"]),
                    )
                    inserted += cur.rowcount
            finally:
                if pdf_handle is not None:
                    pdf_handle.close()
        con.commit()
    return inserted
```

- [ ] **Step 3: Run tests** → PASS. (`test_find_fact_page_word_boundary` validates the regex prefilter; if `80.494` happens to exist standalone on the fixture pages, pick a different substring probe — verify with pdfplumber first, don't weaken the test's intent.)

- [ ] **Step 4: CLI wiring** — extend choices to `[..., "crosswalk", "provenance-pages"]`, dispatch:

```python
    elif args.action == "provenance-pages":
        from govbudget.jbooks.provenance_pages import build_provenance_pages

        n = build_provenance_pages(config.PG_DSN)
        print(f"provenance-pages: {n} facts resolved")
```

- [ ] **Step 5: Full suite + commit**

```bash
git add src/govbudget/jbooks/provenance_pages.py tests/jbooks/test_provenance_pages.py src/govbudget/cli.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(5b1): provenance_pages builder — per-document hybrid page+bbox resolution" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: export-site (typed datasets + citations + sha-named PDFs/workbooks + manifest)

**Files:**
- Create: `src/govbudget/export_site.py`
- Test: `tests/jbooks/test_export_site_pg.py` (ALL export_site tests live here — they need Postgres; the pg fixtures exist only in tests/jbooks/)
- Modify: `src/govbudget/cli.py` (top-level `export-site`)

**Binding design:**

`export_site(dsn, duckdb_path, *, out_dir, pdf_base_url) -> dict` returning `{"datasets": int, "citations": int, "pdfs": int, "workbooks": int, "skipped_unresolved": int, "skipped_zero_amount": int}`.

1. **DuckDB mart exports** → `out_dir/data/{name}.parquet`, typed, via `COPY (select * from {name}) TO '{path}' (format parquet, compression zstd)` on a `read_only=True` connection: `dim_programs, fct_budget_to_awards, fct_budget_trajectory, dim_entities, fct_influence, fct_program_lobbying, dim_lobbyists, fct_program_concentration, fct_improper_exposure, dim_geography, fct_state_per_capita` (11 — `fct_budget_lines` is NOT exported from duckdb; the citable budget-lines dataset comes from Postgres, next). Missing mart → `ValueError` naming it.
2. **Postgres typed exports** — mechanism (pandas is NOT available): fetch rows via psycopg, compute fact_id per row in Python, then in an in-memory duckdb connection `create table _t (...)` with EXPLICIT typed columns, `executemany` with native Python values (no `str()`), `COPY _t TO ... (format parquet, compression zstd)`:
   - `out_dir/data/jbook_details.parquet` — columns: `fact_id varchar, pe_bli varchar, project_number varchar, project_title varchar, scenario varchar, amount_millions double, units varchar ('USD millions'), xml_path varchar, org varchar, exhibit_family varchar, fiscal_year integer, document_sha256 varchar, resolution varchar` — `resolution` from `left join provenance_pages` on the five-column identity (null → `'unresolved'`). fact_id = `fact_id_jbook(...)`.
   - `out_dir/data/jbook_narratives.parquet` — `pe_bli, project_number, kind, title, body, xml_path, org, fiscal_year (int), document_sha256` (narratives cite via xml_path; no fact_id needed in 5B-1).
   - `out_dir/data/budget_lines.parquet` — `fact_id varchar, exhibit varchar, fiscal_year integer, account varchar, account_title varchar, organization varchar, budget_activity varchar, budget_activity_title varchar, pe_bli varchar, title varchar, amount_type varchar, amount_thousands double, units varchar ('USD thousands'), document_sha256 varchar, source_sheet varchar, source_cells varchar (comma-joined)` — only rows with `source_document_id is not null`; rows lacking it are counted and printed (pre-backfill rows; Task 8's load-rollups rerun eliminates them). fact_id = `fact_id_workbook(...)`.
3. **Citations** → `out_dir/citations/citations.parquet`, one row per citable fact, typed; columns (nullable where tier-inapplicable): `fact_id, kind, units, amount_text, page_number, x0, x1, top_pt, bottom_pt, page_width, page_height, resolution, sheet, cells, amount_thousands, sha256, hosted_pdf_url, official_url, xml_path, retrieved_at`:
   - `kind='jbook_pdf'` (details ⋈ provenance_pages ⋈ jbook_documents): rows with `resolution in ('unique','ambiguous_first')` ONLY. `hosted_pdf_url = f"{pdf_base_url}/{sha}.pdf#page={page_number}"`; `official_url = f"{source_url}#page={page_number}"` (spec §4.2: the official link also opens at the page); `retrieved_at = downloaded_at.isoformat() if downloaded_at else None`. Facts with `resolution in ('unresolved','zero_amount')` are EXCLUDED and counted in `skipped_unresolved` / `skipped_zero_amount` (their xml_path citation remains available via jbook_details.parquet; the site must not render a page link for them).
   - `kind='workbook'` (budget_lines with source_document_id ⋈ jbook_documents): carries `sheet, cells (comma-joined), amount_thousands (double — the gate re-derives against the workbook), units='USD thousands', sha256, official_url=source_url, retrieved_at`. fact_id matches budget_lines.parquet by construction.
   - `kind='lda_filing'` (duckdb `fct_program_lobbying`): `fact_id = fact_id_lda(filing_uuid, pe_bli, matched_term)`, `official_url = filing_url`.
4. **Documents** → `out_dir/pdfs/{sha256}.pdf` copied from `file_path` WHERE `status='downloaded' and sha256 is not null and file_path ilike '%.pdf'` (34 live); `out_dir/workbooks/{sha256}.xlsx` for `file_path ilike '%.xlsx'` (3 live — the citation gate re-derives workbook cells from these). `shutil.copyfile`; skip when destination exists with equal size.
5. **Manifest** → `out_dir/manifest.json`, `json.dumps(..., indent=2, sort_keys=True)`: `{"built_at": <iso-utc>, "datasets": {name: rowcount}, "citations": {kind: count}, "skipped_unresolved": n, "skipped_zero_amount": n, "uncited_datasets": [<every data/*.parquet name with no citation kind — the §4.4 deferral ledger for 5B-2>], "pdf_base_url": ..., "schema_version": 1}`.
6. Module also exports `canonical_amount`, `fact_id_jbook`, `fact_id_workbook`, `fact_id_lda` (definitions in the plan header) for gates and tests.

- [ ] **Step 1: Write failing test** (`tests/jbooks/test_export_site_pg.py`) — seed via Task 5's `_seed_fact` pattern + `build_provenance_pages`, plus ONE budget_lines row with source provenance, plus a tiny duckdb at `tmp_path/"wh.duckdb"` containing 1-row versions of all 11 marts (follow `make_duckdb_with_influence` style from `tests/test_verify_phase5a.py`; `fct_program_lobbying` needs `filing_uuid, pe_bli, matched_term, filing_url` at minimum):

```python
    out = export_site(pg_dsn, db, out_dir=tmp_path / "site",
                      pdf_base_url="https://cdn.example/pdfs")
    site = tmp_path / "site"
    assert (site / "data" / "dim_programs.parquet").exists()
    assert (site / "manifest.json").exists()
    sha, hosted, official, res = duckdb.sql(
        f"select sha256, hosted_pdf_url, official_url, resolution"
        f" from read_parquet('{site}/citations/citations.parquet')"
        f" where kind = 'jbook_pdf'"
    ).fetchone()
    assert hosted.endswith(f"{sha}.pdf#page=1") and official.endswith("#page=1")
    assert (site / "pdfs" / f"{sha}.pdf").exists()
    # workbook tier joins to the served dataset by fact_id
    wb_fact, = duckdb.sql(
        f"select fact_id from read_parquet('{site}/citations/citations.parquet')"
        f" where kind = 'workbook'").fetchone()
    bl_fact, = duckdb.sql(
        f"select fact_id from read_parquet('{site}/data/budget_lines.parquet')").fetchone()
    assert wb_fact == bl_fact
    import json
    man = json.loads((site / "manifest.json").read_text())
    assert "fct_budget_trajectory" in man["uncited_datasets"]
```

Run → FAIL.

- [ ] **Step 2: Implement `export_site.py`** per the binding design. Lazy heavy imports; plain functions.

- [ ] **Step 3: Failing-loudly tests** (same file — they need pg): duckdb missing one mart → `ValueError` naming it; jbook document file missing on disk → `FileNotFoundError`. Plus pure-function tests for `canonical_amount`/fact_id stability (exact known hashes).

- [ ] **Step 4: CLI wiring** (top-level):

```python
def cmd_export_site(args) -> None:
    from govbudget.export_site import export_site

    out = export_site(
        config.PG_DSN, config.DUCKDB_PATH, out_dir=config.SITE_DIR,
        pdf_base_url=config.PDF_BASE_URL,
    )
    print(
        f"export-site: {out['datasets']} datasets, {out['citations']} citations,"
        f" {out['pdfs']} pdfs, {out['workbooks']} workbooks,"
        f" {out['skipped_unresolved']} unresolved, {out['skipped_zero_amount']} zero-amount"
        f" -> {config.SITE_DIR}"
    )
```

and in `main()`: `es = sub.add_parser("export-site", help="export typed site artifacts + citations + documents"); es.set_defaults(func=cmd_export_site)`.

- [ ] **Step 5: Full suite + commit**

```bash
git add src/govbudget/export_site.py tests/jbooks/test_export_site_pg.py src/govbudget/cli.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(5b1): export-site — typed datasets, per-tier citations, sha-named documents, manifest" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: verify-phase5b1 (citation_gate + integrity gates)

**Files:**
- Create: `src/govbudget/verify_phase5b1.py`
- Test: `tests/test_verify_phase5b1.py` (path-only — gates take explicit paths, never read config; fixture site dirs in tmp_path; the one real-PDF case uses the Task 4 fixture)
- Modify: `src/govbudget/cli.py`

**Gates (binding):**

1. `citation_gate5b1(site_dir: Path, *, sample_size: int = 50) -> dict` — sample up to `sample_size` citations stratified by kind (each kind present gets ≥5 or all its rows). Per kind, mechanically re-derive:
   - `jbook_pdf`: `site/pdfs/{sha}.pdf` exists; sha256 of bytes matches; pdfplumber-open AT `page_number`; `extract_words()` contains a word with text == `amount_text` whose x0/top_pt are within 2.0 pt of stored values.
   - `workbook`: `site/workbooks/{sha}.xlsx` exists; sha256 matches; `load_workbook(path, read_only=True, data_only=True)` (same flags as the loaders — reproduces cached values); sheet exists; the cells' Decimal values SUM to `amount_thousands` exactly (R-1 single cell == trivially; P-1 lists sum).
   - `lda_filing`: `official_url` matches `^https://lda\.senate\.gov/` and contains the filing uuid (shape-only by design — gates are no-network; the URL's uuid permanence is the LDA API's contract, verified live in 5A).
   Result `{"ok": sampled > 0 and passed == sampled, "sampled": n, "passed": m, "failures": [(fact_id, reason), ...]}` — **100% required**, empty citations FAIL.
2. `integrity_gate5b1(site_dir: Path) -> dict` — computable entirely from artifacts:
   - jbook: every `jbook_details.parquet` row with `resolution in ('unique','ambiguous_first')` has EXACTLY ONE `kind='jbook_pdf'` citation by fact_id; zero jbook_pdf citations are orphaned (fact_id ∉ jbook_details); count reconciliation `rows(resolution='unresolved') + rows('zero_amount') == manifest.skipped_unresolved + manifest.skipped_zero_amount`.
   - workbook: citation fact_ids == `budget_lines.parquet` fact_ids exactly (set equality both directions).
   - lda: every `kind='lda_filing'` fact_id re-derives from some `fct_program_lobbying.parquet` row via `fact_id_lda` (recompute over the dataset, set containment).
   - `manifest.json` parses; its dataset rowcounts match the actual parquet files.
3. `coverage_report5b1(site_dir: Path) -> dict` — NOT pass/fail: resolved/ambiguous/zero_amount/unresolved counts + fractions, and the `uncited_datasets` list echoed (the honesty ledger 5B-2's render gate consumes).

CLI `verify-phase5b1` runs 1→3, prints per-gate lines, `print("verify-phase5b1:", "PASS" if ok else "FAIL"); sys.exit(0|1)`. Missing site dir / empty citations → loud FAIL naming the path.

- [ ] **Step 1: Write failing tests** — fixture site dir built in tmp_path with duckdb helpers: happy path (one real jbook citation against the Task 4 fixture PDF copied to `site/pdfs/{sha}.pdf` — stored bbox obtained by calling `find_fact_page` live in the test; one workbook citation against a `make_xlsx`-style workbook copied to `site/workbooks/{sha}.xlsx`; one lda citation). Failure cases: tampered `amount_text` → gate 1 fails listing fact_id; tampered workbook `amount_thousands` → gate 1 fails; orphan jbook citation → gate 2 fails; resolved details row missing its citation → gate 2 fails; manifest rowcount mismatch → gate 2 fails; empty citations.parquet → gate 1 `ok` False; missing site dir → `ok` False with `reason`.
- [ ] **Step 2: Implement** `verify_phase5b1.py` (import `fact_id_lda`, `fact_id_workbook` from `export_site` — single source of truth; no config reads inside gates).
- [ ] **Step 3: CLI wiring** following `cmd_verify_phase5a` verbatim style.
- [ ] **Step 4: Full suite green; commit**

```bash
git add src/govbudget/verify_phase5b1.py tests/test_verify_phase5b1.py src/govbudget/cli.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(5b1): verify-phase5b1 — citation re-derivation, per-kind integrity, coverage report" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: THE LOOP — live build until PASS, regression sweep, final review

- [ ] **Step 1: Live pipeline** (from REPO ROOT — dbt views use relative read_parquet paths):

```bash
uv run python -m govbudget migrate
uv run python -m govbudget jbooks load-rollups          # backfill cell provenance (idempotent upserts)
uv run python -m govbudget jbooks export-facts
uv run python -m govbudget jbooks provenance-pages      # first full build: minutes (34 PDFs; OSD 1490pp dominates)
uv run python -m govbudget build                        # dbt over re-exported parquets
uv run python -m govbudget export-site
uv run python -m govbudget verify-phase5b1
```

- [ ] **Step 2: Iterate.** Gate failures here are DATA findings — expected first-run classes: amount formats `amount_strings` misses (P-40 procurement page styles, parenthesized negatives), text-layer mismatches between pypdf and pdfplumber, workbook rows pre-dating the cell backfill. Fix code via subagent, re-run only the failing stage, repeat until `verify-phase5b1: PASS`. Record final coverage numbers (unique/ambiguous/zero/unresolved) in the commit message.
- [ ] **Step 3: Regression sweep:** `verify-phase1` … `verify-phase5a` all PASS + `uv run pytest -q` green.
- [ ] **Step 4: Commit data deltas** (explicit paths under `data/` only — NEVER `git add -A`).
- [ ] **Step 5: Final whole-implementation review** (opus reviewer over the full 5B-1 commit range; fix findings via subagent; re-verify).
- [ ] **Step 6: Merge to main + push** (established per-phase pattern).

---

## Self-Review Notes

- Spec §4 coverage: builder (Task 5), resolver artifacts with hosted/official#page=N, bbox, sha, xml_path, retrieved_at (Task 6), click-through gate at 100% with per-tier re-derivation incl. workbook cell sums (Task 7). USAspending/state/derived tiers + per-page JSON: explicitly deferred with the `uncited_datasets` manifest ledger making the deferral enforceable by 5B-2's render gate — not silent.
- Identity includes amounts everywhere (migration key, builder cache predicate, fact_id) — the 11 live duplicate-key facts and the 23% zero-amount facts each have explicit, honest handling (`zero_amount` = no page citation rather than an arbitrary highlight).
- Workbook citations join the served dataset by construction (same fact_id function, both sides exported from the same Postgres rows); integrity gate checks set equality, preventing the unjoinable-citation hole.
- Performance contract is IN the code (groupby document, single text pass, lazy pdfplumber), not in a trailing note.
- No pandas anywhere; typed exports use duckdb create-table + executemany with native values.
- Known accepted limits: narratives cite via xml_path only (no page resolution for prose); R-1 conflict-grain last-write-wins keeps one cell ref on colliding sheet rows (same semantics as amounts today); LDA gate is shape-only (no network in gates — documented).
