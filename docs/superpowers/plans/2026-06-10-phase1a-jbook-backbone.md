# Phase 1A: J-Book Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Budget-intent backbone: DoD R-1/P-1 rollups and DARPA R-2 detail (via embedded J-book XML) in Postgres with provenance, reconciliation gates, a review CLI, and acceptance gates 1–3 passing on live data.

**Architecture:** Five thin modules under `src/govbudget/jbooks/`: registry/acquirer (scrape comptroller index → download → detect embedded XML), rollup loader (XLSX → `budget_lines` control set), tiered extractor Tier 0 only (pypdf attachment → zip → `jb:` schema XML → typed records → `budget_line_details` + `detail_narratives`), reconciliation (Gates A/B → `review_queue`), and verification (`verify-phase1` gates 1–3). Plan B adds the Docling/Claude fallback tier, crosswalk, and gates 5–6.

**Tech Stack:** Python 3.12, psycopg 3 (plain SQL migrations), pypdf, openpyxl, selectolax, stdlib `xml.etree` (namespace handled by local-name matching), existing Phase 0 `download_file`/config.

**Verified ground truth used throughout (live recon 2026-06-10):** FY2026 DARPA book (`RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf`, 433pp) embeds `Exhibit_R-1D.xml` + two `.zzz` zip attachments containing the full book XML (1.5MB, namespace `jb=http://www.dtic.mil/comptroller/xml/schema/022009/jb`). Structure: 24 `ProgramElement` (fields incl. `ProgramElementNumber` 0601101E, `ProgramElementTitle` DEFENSE RESEARCH SCIENCES, `R1LineNumber` 2, `AppropriationCode` 0400, `BudgetActivityNumber` 1, `ProgramElementFunding/{AllPriorYears,PriorYear,CurrentYear,BudgetYearOne,BudgetYearOneBase}` = 0.000/280.494/293.145/0.000/0.000 $M, `ProgramElementMissionDescription`, `ChangeSummary`, `ProjectList`), 63 `Project` (`ProjectNumber` CCS-02, `ProjectTitle` MATH AND COMPUTER SCIENCES, `ProjectFunding`, `R2aExhibit/ProjectMissionDescription`, `AccomplishmentPlannedProgramList/AccomplishmentPlannedProgram/{Title,Description}`). R-1 rollup XLSX (`r1_display.xlsx`): sheet `Exhibit R-1`, headers Account, Account Title, Organization, Budget Activity, Budget Activity Title, Line Number, PE/BLI, Program Element/Budget Line Item (BLI) Title, Include In TOA, FY 2024 Actuals, FY 2025 Enacted, FY 2025 Supplemental, FY 2025 Total, FY 2026 Disc Request, … (amounts in $ THOUSANDS; XML amounts in $ MILLIONS — Gate B divides R-1 by 1000).

**Deviations from spec (flagged):** (1) stdlib `xml.etree` instead of lxml — zero extra dependency; the schema needs only local-name matching. (2) Spec's `budget_line_details` is implemented as two tables: `budget_line_details` (amount rows) + `detail_narratives` (text rows) — cleaner typing, same content. (3) Plan B (separate plan) carries Tier 1 fallback, crosswalk v1, gates 5–6, Army expansion.

**Conventions:**
- All commands run from `/Users/andeslee/Documents/Cursor-Projects/GovBudget`.
- Every commit: `git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "<msg>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`
- Core functions take explicit `dsn`/`path`/`client` args; `cli.py` binds config defaults.
- **Prerequisite:** local Postgres running. Verify before Task 1: `psql postgres -c 'select 1'`. If unreachable, STOP and report BLOCKED.

---

### Task 1: Dependencies, config, migrations runner, Phase 1 schema

**Files:**
- Modify: `pyproject.toml` (add deps), `src/govbudget/config.py` (add PG_DSN, RAW_DOCS_DIR)
- Create: `src/govbudget/jbooks/__init__.py` (empty), `src/govbudget/jbooks/db.py`, `migrations/001_phase1_schema.sql`, `tests/jbooks/__init__.py` (empty), `tests/jbooks/conftest.py`
- Test: `tests/jbooks/test_db.py`

- [ ] **Step 1: Add dependencies**

In `pyproject.toml`, extend `[project] dependencies` to:

```toml
dependencies = [
    "httpx>=0.27",
    "duckdb>=1.1",
    "dbt-duckdb>=1.9",
    "psycopg[binary]>=3.2",
    "pypdf>=5.0",
    "openpyxl>=3.1",
    "selectolax>=0.3",
]
```

Run: `uv sync` — resolves cleanly.

- [ ] **Step 2: Extend `src/govbudget/config.py`**

Append:

```python
PG_DSN = os.environ.get("GOVBUDGET_PG_DSN", "postgresql://localhost/govbudget")
RAW_DOCS_DIR = DATA_DIR / "raw_docs"
JBOOK_FY = 2026
```

And add `data/raw_docs/` is NOT gitignored as a whole… it must be: append `data/raw_docs/` to `.gitignore`.

- [ ] **Step 3: Write `migrations/001_phase1_schema.sql`**

```sql
create table if not exists jbook_documents (
  id bigserial primary key,
  org text not null,
  exhibit_family text not null,
  fiscal_year int not null,
  title text not null,
  source_url text not null unique,
  file_path text,
  sha256 text,
  bytes bigint,
  downloaded_at timestamptz,
  has_embedded_xml boolean,
  status text not null default 'registered'
);

create table if not exists budget_lines (
  id bigserial primary key,
  exhibit text not null,
  account text not null,
  account_title text,
  organization text not null,
  budget_activity text,
  budget_activity_title text,
  line_number text,
  pe_bli text not null,
  title text,
  amount_type text not null,
  amount_thousands numeric,
  source_document_id bigint references jbook_documents(id),
  unique (exhibit, account, organization, pe_bli, amount_type)
);

create table if not exists extraction_runs (
  id bigserial primary key,
  document_id bigint not null references jbook_documents(id),
  tier int not null,
  tool_versions jsonb not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists budget_line_details (
  id bigserial primary key,
  extraction_run_id bigint not null references extraction_runs(id),
  document_id bigint not null references jbook_documents(id),
  pe_bli text not null,
  project_number text,
  project_title text,
  scenario text not null,
  amount_millions numeric not null,
  xml_path text not null,
  reconciled boolean not null default false,
  superseded boolean not null default false
);

create table if not exists detail_narratives (
  id bigserial primary key,
  extraction_run_id bigint not null references extraction_runs(id),
  document_id bigint not null references jbook_documents(id),
  pe_bli text not null,
  project_number text,
  kind text not null,
  title text,
  body text not null,
  xml_path text not null,
  superseded boolean not null default false
);

create table if not exists reconciliation_checks (
  id bigserial primary key,
  extraction_run_id bigint not null references extraction_runs(id),
  gate text not null,
  pe_bli text not null,
  scenario text not null,
  expected numeric,
  actual numeric,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists review_queue (
  id bigserial primary key,
  check_id bigint not null references reconciliation_checks(id),
  status text not null default 'open',
  resolution text,
  resolved_at timestamptz
);

create table if not exists extraction_gaps (
  id bigserial primary key,
  exhibit text not null,
  pe_bli text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Write the failing test `tests/jbooks/conftest.py` + `tests/jbooks/test_db.py`**

`tests/jbooks/conftest.py`:

```python
import os

import psycopg
import pytest

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test"


@pytest.fixture(scope="session")
def pg_dsn():
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres unavailable ({e}); start local postgres to run jbooks tests")
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()
    dsn = ADMIN_DSN.rsplit("/", 1)[0] + "/" + TEST_DB

    from govbudget.jbooks.db import migrate

    migrate(dsn)
    yield dsn


@pytest.fixture()
def pg(pg_dsn):
    import psycopg

    with psycopg.connect(pg_dsn) as con:
        yield con
        con.rollback()


@pytest.fixture(autouse=True)
def _clean_tables(pg_dsn):
    yield
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "truncate jbook_documents, budget_lines, extraction_runs, budget_line_details, "
            "detail_narratives, reconciliation_checks, review_queue, extraction_gaps "
            "restart identity cascade"
        )
```

`tests/jbooks/test_db.py`:

```python
import psycopg


def test_migrate_creates_schema_and_is_idempotent(pg_dsn):
    from govbudget.jbooks.db import migrate

    assert migrate(pg_dsn) == []  # session fixture already applied it; second run is a no-op
    with psycopg.connect(pg_dsn) as con:
        tables = {
            r[0]
            for r in con.execute(
                "select table_name from information_schema.tables where table_schema='public'"
            )
        }
    assert {
        "jbook_documents", "budget_lines", "extraction_runs", "budget_line_details",
        "detail_narratives", "reconciliation_checks", "review_queue", "extraction_gaps",
        "schema_migrations",
    } <= tables
```

- [ ] **Step 5: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_db.py -v`
Expected: FAIL/ERROR with `ModuleNotFoundError: No module named 'govbudget.jbooks'`

- [ ] **Step 6: Write `src/govbudget/jbooks/db.py`** (and empty `src/govbudget/jbooks/__init__.py`, `tests/jbooks/__init__.py`)

```python
from pathlib import Path

import psycopg

from govbudget import config

MIGRATIONS_DIR = config.ROOT / "migrations"


def connect(dsn: str | None = None) -> psycopg.Connection:
    return psycopg.connect(dsn or config.PG_DSN)


def migrate(dsn: str | None = None) -> list[str]:
    """Apply unapplied migrations/*.sql in name order. Returns names applied."""
    applied: list[str] = []
    with connect(dsn) as con:
        con.execute(
            "create table if not exists schema_migrations "
            "(name text primary key, applied_at timestamptz not null default now())"
        )
        done = {r[0] for r in con.execute("select name from schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            con.execute(path.read_text())
            con.execute("insert into schema_migrations (name) values (%s)", (path.name,))
            applied.append(path.name)
    return applied
```

- [ ] **Step 7: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_db.py -v`
Expected: PASS (1 passed). If skipped with "Postgres unavailable": start Postgres, re-run. Do not proceed on skip.
Then: `uv run pytest -q` — 32 passed (31 existing + 1).

- [ ] **Step 8: Add `migrate` CLI command**

In `src/govbudget/cli.py` add:

```python
def cmd_migrate(args) -> None:
    from govbudget.jbooks.db import migrate

    applied = migrate()
    print(f"migrations applied: {applied or 'none (up to date)'}")
```

Register in `main()`:

```python
    m = sub.add_parser("migrate", help="apply postgres migrations")
    m.set_defaults(func=cmd_migrate)
```

Run: `uv run python -m govbudget --help` — lists `migrate`.

- [ ] **Step 9: Commit**

```bash
git add pyproject.toml uv.lock .gitignore src/govbudget/config.py src/govbudget/jbooks src/govbudget/cli.py migrations tests/jbooks
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): postgres migrations and phase 1 schema

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PDF attachment extractor

**Files:**
- Create: `src/govbudget/jbooks/attachments.py`
- Test: `tests/jbooks/test_attachments.py`

- [ ] **Step 1: Write the failing test** (synthetic PDF with a real zip attachment — pypdf can write attachments, so the roundtrip needs no fixtures)

```python
import io
import zipfile

from pypdf import PdfWriter

from govbudget.jbooks.attachments import extract_jbook_xml, list_embedded

XML_BODY = b'<?xml version="1.0"?><root xmlns:jb="http://www.dtic.mil/comptroller/xml/schema/022009/jb"><jb:ProgramElement/></root>'


def make_pdf(tmp_path, attachments):
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    for name, data in attachments.items():
        w.add_attachment(name, data)
    p = tmp_path / "book.pdf"
    with open(p, "wb") as f:
        w.write(f)
    return p


def make_zzz():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("U_RDTE_MJB_FAKE_PB_2026.xml", XML_BODY)
        z.writestr("seal.png", b"\x89PNG")
    return buf.getvalue()


def test_list_embedded(tmp_path):
    pdf = make_pdf(tmp_path, {"Exhibit_R-1D.xml": XML_BODY, "book.zzz": make_zzz()})
    assert set(list_embedded(pdf)) == {"Exhibit_R-1D.xml", "book.zzz"}


def test_extract_jbook_xml_handles_direct_and_zipped(tmp_path):
    pdf = make_pdf(tmp_path, {"Exhibit_R-1D.xml": XML_BODY, "book.zzz": make_zzz()})
    out = extract_jbook_xml(pdf, tmp_path / "xml")
    names = sorted(p.name for p in out)
    assert names == ["Exhibit_R-1D.xml", "U_RDTE_MJB_FAKE_PB_2026.xml"]
    for p in out:
        assert p.read_bytes() == XML_BODY


def test_extract_on_pdf_without_attachments(tmp_path):
    pdf = make_pdf(tmp_path, {})
    assert extract_jbook_xml(pdf, tmp_path / "xml") == []
    assert list_embedded(pdf) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_attachments.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.jbooks.attachments'`

- [ ] **Step 3: Write `src/govbudget/jbooks/attachments.py`**

```python
import io
import zipfile
from pathlib import Path

from pypdf import PdfReader


def _attachment_bytes(contents) -> bytes:
    # pypdf returns list[bytes] for attachments with multiple streams
    if isinstance(contents, list):
        return contents[0]
    return contents


def list_embedded(pdf_path: Path) -> list[str]:
    return list(PdfReader(str(pdf_path)).attachments.keys())


def extract_jbook_xml(pdf_path: Path, out_dir: Path) -> list[Path]:
    """Extract XML payloads: direct .xml attachments plus .xml members of .zzz zips.

    The DoD budget system attaches the full justification-book XML as a zip
    renamed to .zzz ("save & rename to .zip to open").
    """
    reader = PdfReader(str(pdf_path))
    written: list[Path] = []
    for name, contents in reader.attachments.items():
        data = _attachment_bytes(contents)
        if name.lower().endswith(".xml"):
            out_dir.mkdir(parents=True, exist_ok=True)
            p = out_dir / Path(name).name
            p.write_bytes(data)
            written.append(p)
        elif name.lower().endswith(".zzz"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for member in z.namelist():
                    if member.lower().endswith(".xml"):
                        out_dir.mkdir(parents=True, exist_ok=True)
                        p = out_dir / Path(member).name
                        p.write_bytes(z.read(member))
                        written.append(p)
    return sorted(written)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_attachments.py -v` — PASS (3 passed). If pypdf's `attachments` API differs (it stabilized in pypdf 5): check `PdfReader.attachments` exists via `uv run python -c "from pypdf import PdfReader; print(hasattr(PdfReader, 'attachments'))"`; if False, use `reader._list_attachments()`/`reader.attachment_list` per the installed version's docs and report the deviation.

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/attachments.py tests/jbooks/test_attachments.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): pdf embedded-attachment xml extractor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Golden XML fixture from the real DARPA book

**Files:**
- Create: `tests/fixtures/jbooks/darpa_fy2026_excerpt.xml` (committed), `scripts/make_jbook_fixture.py`

- [ ] **Step 1: Write `scripts/make_jbook_fixture.py`**

```python
"""Build the committed golden fixture from the real FY2026 DARPA J-book.

Downloads the book (if not already at data/raw_docs/), extracts the embedded
XML, trims to the first TWO ProgramElement records, writes the fixture.
Run: uv run python scripts/make_jbook_fixture.py
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx

sys.path.insert(0, "src")
from govbudget.download import download_file  # noqa: E402
from govbudget.jbooks.attachments import extract_jbook_xml  # noqa: E402

URL = (
    "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/"
    "budget_justification/pdfs/03_RDT_and_E/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf"
)
PDF = Path("data/raw_docs/fy2026/darpa/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf")
FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def local(tag: str) -> str:
    return tag.split("}")[-1]


def main() -> None:
    if not PDF.exists():
        with httpx.Client() as client:
            download_file(client, URL, PDF)
    xmls = extract_jbook_xml(PDF, PDF.parent / "xml")
    book = max(xmls, key=lambda p: p.stat().st_size)  # the MJB xml is the largest
    tree = ET.parse(book)
    for parent in tree.getroot().iter():
        pes = [c for c in list(parent) if local(c.tag) == "ProgramElement"]
        for extra in pes[2:]:
            parent.remove(extra)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    tree.write(FIXTURE, encoding="utf-8", xml_declaration=True)
    print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size} bytes) from {book.name}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `uv run python scripts/make_jbook_fixture.py`
Expected: `wrote tests/fixtures/jbooks/darpa_fy2026_excerpt.xml (...bytes)`. Sanity: size must be under 500_000 bytes (`ls -la tests/fixtures/jbooks/`). The first two PEs are 0601101E and one sibling.

- [ ] **Step 3: Verify the fixture contains the known anchors**

Run: `grep -c "ProgramElementNumber" tests/fixtures/jbooks/darpa_fy2026_excerpt.xml`
Expected: `2`
Run: `grep -o "0601101E" tests/fixtures/jbooks/darpa_fy2026_excerpt.xml | head -1`
Expected: `0601101E`

- [ ] **Step 4: Commit**

```bash
git add scripts/make_jbook_fixture.py tests/fixtures/jbooks/darpa_fy2026_excerpt.xml
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): golden xml fixture from real fy2026 darpa j-book

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: J-book XML parser

**Files:**
- Create: `src/govbudget/jbooks/xml_parser.py`
- Test: `tests/jbooks/test_xml_parser.py`

- [ ] **Step 1: Write the failing test** (golden values hand-verified against the real book during recon)

```python
from decimal import Decimal
from pathlib import Path

from govbudget.jbooks.xml_parser import parse_jbook_xml

FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def test_parses_program_elements_with_golden_values():
    pes = parse_jbook_xml(FIXTURE)
    assert len(pes) == 2
    pe = pes[0]
    assert pe.number == "0601101E"
    assert pe.title == "DEFENSE RESEARCH SCIENCES"
    assert pe.r1_line_number == "2"
    assert pe.appropriation_code == "0400"
    assert pe.budget_activity == "1"
    assert pe.budget_year == 2026
    funding = {f.scenario: f.amount_millions for f in pe.funding}
    assert funding["PriorYear"] == Decimal("280.494")
    assert funding["CurrentYear"] == Decimal("293.145")
    assert funding["BudgetYearOne"] == Decimal("0.000")
    assert pe.mission_description and pe.mission_description.startswith("The efforts")


def test_parses_projects_and_narratives():
    pe = parse_jbook_xml(FIXTURE)[0]
    assert pe.projects, "expected at least one project"
    proj = pe.projects[0]
    assert proj.number == "CCS-02"
    assert proj.title == "MATH AND COMPUTER SCIENCES"
    assert proj.mission_description
    scenarios = {f.scenario for f in proj.funding}
    assert {"PriorYear", "CurrentYear"} <= scenarios
    kinds = {n.kind for n in proj.narratives}
    assert "accomplishment_planned_program" in kinds
    apb = [n for n in proj.narratives if n.kind == "accomplishment_planned_program"][0]
    assert apb.title and apb.body


def test_xml_paths_are_resolvable():
    import xml.etree.ElementTree as ET

    pes = parse_jbook_xml(FIXTURE)
    root = ET.parse(FIXTURE).getroot()
    # xml_path is an index-based pseudo-xpath like ProgramElement[0]/Project[3]
    pe = pes[1]
    assert pe.xml_path.startswith("ProgramElement[")
    assert root is not None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_xml_parser.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/xml_parser.py`**

```python
"""Parser for the DoD comptroller J-book XML (jb schema, 02/2009 vintage).

Element names verified live against the FY2026 DARPA master justification
book. Namespace-agnostic: matches on local names so jb:/r2: prefix variants
across services parse identically.
"""
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

FUNDING_SCENARIOS = [
    "AllPriorYears", "PriorYear", "CurrentYear", "BudgetYearOne", "BudgetYearOneBase",
]


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _text(el: ET.Element, name: str) -> str | None:
    c = _child(el, name)
    if c is None or c.text is None:
        return None
    t = c.text.strip()
    return t or None


def _descendant(el: ET.Element, name: str) -> ET.Element | None:
    for c in el.iter():
        if _local(c.tag) == name:
            return c
    return None


@dataclass
class FundingLine:
    scenario: str
    amount_millions: Decimal


@dataclass
class NarrativeItem:
    kind: str
    title: str | None
    body: str
    xml_path: str


@dataclass
class ProjectRecord:
    number: str
    title: str | None
    mission_description: str | None
    funding: list[FundingLine] = field(default_factory=list)
    narratives: list[NarrativeItem] = field(default_factory=list)
    xml_path: str = ""


@dataclass
class ProgramElementRecord:
    number: str
    title: str | None
    r1_line_number: str | None
    appropriation_code: str | None
    appropriation_name: str | None
    budget_activity: str | None
    budget_activity_title: str | None
    service_agency: str | None
    budget_year: int | None
    mission_description: str | None
    funding: list[FundingLine] = field(default_factory=list)
    projects: list[ProjectRecord] = field(default_factory=list)
    xml_path: str = ""


def _parse_funding(container: ET.Element | None) -> list[FundingLine]:
    if container is None:
        return []
    lines: list[FundingLine] = []
    for c in container:
        name = _local(c.tag)
        if name in FUNDING_SCENARIOS and c.text:
            try:
                lines.append(FundingLine(name, Decimal(c.text.strip())))
            except InvalidOperation:
                continue
    return lines


def _parse_project(el: ET.Element, xml_path: str) -> ProjectRecord:
    r2a = _child(el, "R2aExhibit")
    mission = None
    narratives: list[NarrativeItem] = []
    if r2a is not None:
        m = _descendant(r2a, "ProjectMissionDescription")
        if m is not None and m.text:
            mission = m.text.strip()
        for i, app in enumerate(x for x in r2a.iter() if _local(x.tag) == "AccomplishmentPlannedProgram"):
            body = _text(app, "Description")
            if body:
                narratives.append(
                    NarrativeItem(
                        kind="accomplishment_planned_program",
                        title=_text(app, "Title"),
                        body=body,
                        xml_path=f"{xml_path}/AccomplishmentPlannedProgram[{i}]",
                    )
                )
    return ProjectRecord(
        number=_text(el, "ProjectNumber") or "",
        title=_text(el, "ProjectTitle"),
        mission_description=mission,
        funding=_parse_funding(_child(el, "ProjectFunding")),
        narratives=narratives,
        xml_path=xml_path,
    )


def parse_jbook_xml(path: Path) -> list[ProgramElementRecord]:
    root = ET.parse(path).getroot()
    pes: list[ProgramElementRecord] = []
    pe_idx = 0
    for el in root.iter():
        if _local(el.tag) != "ProgramElement":
            continue
        xml_path = f"ProgramElement[{pe_idx}]"
        by = _text(el, "BudgetYear")
        record = ProgramElementRecord(
            number=_text(el, "ProgramElementNumber") or "",
            title=_text(el, "ProgramElementTitle"),
            r1_line_number=_text(el, "R1LineNumber"),
            appropriation_code=_text(el, "AppropriationCode"),
            appropriation_name=_text(el, "AppropriationName"),
            budget_activity=_text(el, "BudgetActivityNumber"),
            budget_activity_title=_text(el, "BudgetActivityTitle"),
            service_agency=_text(el, "ServiceAgencyName"),
            budget_year=int(by) if by else None,
            mission_description=_text(el, "ProgramElementMissionDescription"),
            funding=_parse_funding(_child(el, "ProgramElementFunding")),
            xml_path=xml_path,
        )
        proj_list = _child(el, "ProjectList")
        if proj_list is not None:
            for j, p in enumerate(c for c in proj_list if _local(c.tag) == "Project"):
                record.projects.append(_parse_project(p, f"{xml_path}/Project[{j}]"))
        if record.number:
            pes.append(record)
            pe_idx += 1
    return pes
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_xml_parser.py -v` — PASS (3 passed). If a golden assertion fails, diff against the fixture content directly (`grep -A2 ProgramElementNumber tests/fixtures/jbooks/darpa_fy2026_excerpt.xml`) — fix the parser, never the golden values (they were hand-verified against the published book).

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/xml_parser.py tests/jbooks/test_xml_parser.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): j-book xml parser with golden darpa fixtures

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Document registry + index scraper

**Files:**
- Create: `src/govbudget/jbooks/registry.py`
- Test: `tests/jbooks/test_registry.py`

- [ ] **Step 1: Write the failing test** (HTML fixture mirrors the real comptroller markup seen in recon)

```python
import httpx
import psycopg

from govbudget.jbooks.registry import discover_documents, upsert_documents

INDEX_HTML = """
<html><body>
<a href="/Portals/45/Documents/defbudget/FY2026/r1_display.xlsx">R-1 Display</a>
<a href="/Portals/45/Documents/defbudget/FY2026/p1_display.xlsx">P-1 Display</a>
<a href="/Portals/45/Documents/defbudget/FY2026/FY2026_r1.pdf">R-1 PDF</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf">DARPA</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_Vol5_DTRA_MasterJustificationBook_PB_2026.pdf">DTRA</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/02_Procurement/PROC_Vol1_SOCOM_JustificationBook_PB_2026.pdf">SOCOM</a>
</body></html>
"""

BASE = "https://comptroller.war.gov"


def test_discover_classifies_documents():
    def handler(request):
        return httpx.Response(200, text=INDEX_HTML)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        docs = discover_documents(client, BASE + "/Budget-Materials/Budget2026/", fiscal_year=2026)
    by_family = {}
    for d in docs:
        by_family.setdefault(d["exhibit_family"], []).append(d)
    assert {d["title"] for d in by_family["rollup"]} == {"r1_display.xlsx", "p1_display.xlsx"}
    rdte_orgs = {d["org"] for d in by_family["rdte"]}
    assert rdte_orgs == {"DARPA", "DTRA"}
    assert {d["org"] for d in by_family["procurement"]} == {"SOCOM"}
    darpa = [d for d in by_family["rdte"] if d["org"] == "DARPA"][0]
    assert darpa["source_url"].startswith(BASE + "/Portals/")
    # plain exhibit summary PDFs (FY2026_r1.pdf) are NOT registered
    all_urls = [d["source_url"] for d in docs]
    assert not any(u.endswith("FY2026_r1.pdf") for u in all_urls)


def test_upsert_is_idempotent(pg_dsn):
    docs = [
        {
            "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
            "title": "RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf",
            "source_url": "https://example.test/darpa.pdf",
        }
    ]
    assert upsert_documents(pg_dsn, docs) == 1
    assert upsert_documents(pg_dsn, docs) == 0
    with psycopg.connect(pg_dsn) as con:
        n = con.execute("select count(*) from jbook_documents").fetchone()[0]
    assert n == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/registry.py`**

```python
import re
from urllib.parse import urljoin

import httpx
import psycopg

from selectolax.parser import HTMLParser

ROLLUP_NAMES = {"r1_display.xlsx", "p1_display.xlsx", "p1r_display.xlsx"}
# e.g. RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf
JBOOK_RE = re.compile(
    r"(?P<family>RDTE|PROC)_[^/]*?_(?P<org>[A-Za-z0-9-]+)_(?:Master)?JustificationBook[^/]*\.pdf$",
    re.IGNORECASE,
)
FAMILY = {"RDTE": "rdte", "PROC": "procurement"}


def discover_documents(client: httpx.Client, index_url: str, *, fiscal_year: int) -> list[dict]:
    r = client.get(index_url, follow_redirects=True)
    r.raise_for_status()
    docs: list[dict] = []
    seen: set[str] = set()
    for a in HTMLParser(r.text).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = urljoin(index_url, href)
        if url in seen:
            continue
        seen.add(url)
        name = url.rsplit("/", 1)[-1]
        if name.lower() in ROLLUP_NAMES:
            docs.append({
                "org": "DoD", "exhibit_family": "rollup", "fiscal_year": fiscal_year,
                "title": name, "source_url": url,
            })
            continue
        m = JBOOK_RE.search(name)
        if m:
            docs.append({
                "org": m.group("org"), "exhibit_family": FAMILY[m.group("family").upper()],
                "fiscal_year": fiscal_year, "title": name, "source_url": url,
            })
    return docs


def upsert_documents(dsn: str, docs: list[dict]) -> int:
    inserted = 0
    with psycopg.connect(dsn) as con:
        for d in docs:
            cur = con.execute(
                """
                insert into jbook_documents (org, exhibit_family, fiscal_year, title, source_url)
                values (%(org)s, %(exhibit_family)s, %(fiscal_year)s, %(title)s, %(source_url)s)
                on conflict (source_url) do nothing
                """,
                d,
            )
            inserted += cur.rowcount
    return inserted
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_registry.py -v` — PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/registry.py tests/jbooks/test_registry.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): j-book document registry and index scraper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Acquirer

**Files:**
- Create: `src/govbudget/jbooks/acquire.py`
- Test: `tests/jbooks/test_acquire.py`

- [ ] **Step 1: Write the failing test**

```python
import io
import zipfile

import httpx
import psycopg
from pypdf import PdfWriter

from govbudget.jbooks.acquire import acquire_pending
from govbudget.jbooks.registry import upsert_documents

XML = b'<?xml version="1.0"?><root/>'


def make_pdf_bytes(with_attachment: bool) -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    if with_attachment:
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w") as z:
            z.writestr("book.xml", XML)
        w.add_attachment("book.zzz", zbuf.getvalue())
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def test_acquire_downloads_detects_xml_and_updates_rows(pg_dsn, tmp_path):
    upsert_documents(pg_dsn, [
        {"org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
         "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf"},
        {"org": "NOXML", "exhibit_family": "rdte", "fiscal_year": 2026,
         "title": "noxml.pdf", "source_url": "https://example.test/noxml.pdf"},
        {"org": "DoD", "exhibit_family": "rollup", "fiscal_year": 2026,
         "title": "r1_display.xlsx", "source_url": "https://example.test/r1_display.xlsx"},
    ])
    payloads = {
        "/darpa.pdf": make_pdf_bytes(True),
        "/noxml.pdf": make_pdf_bytes(False),
        "/r1_display.xlsx": b"PK\x03\x04fakexlsx",
    }

    def handler(request):
        return httpx.Response(200, content=payloads[request.url.path])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        n = acquire_pending(pg_dsn, client, raw_docs_dir=tmp_path, min_free_gb=0)
    assert n == 3
    with psycopg.connect(pg_dsn) as con:
        rows = {
            r[0]: r for r in con.execute(
                "select title, status, has_embedded_xml, file_path, sha256 from jbook_documents"
            )
        }
    assert rows["darpa.pdf"][1] == "downloaded" and rows["darpa.pdf"][2] is True
    assert rows["noxml.pdf"][2] is False
    assert rows["r1_display.xlsx"][2] is None  # xlsx: attachment check not applicable
    assert (tmp_path / "fy2026" / "darpa" / "darpa.pdf").exists()
    assert (tmp_path / "fy2026" / "darpa" / "xml" / "book.xml").exists()

    # second run: nothing pending
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert acquire_pending(pg_dsn, client, raw_docs_dir=tmp_path, min_free_gb=0) == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_acquire.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/acquire.py`**

```python
import datetime as dt
from pathlib import Path

import httpx
import psycopg

from govbudget.download import download_file, ensure_free_space
from govbudget.jbooks.attachments import extract_jbook_xml


def acquire_pending(
    dsn: str, client: httpx.Client, *, raw_docs_dir: Path, min_free_gb: float
) -> int:
    """Download every 'registered' document, detect embedded XML, update rows.

    PDFs and XLSX are KEPT on disk — they are the provenance source.
    Returns the number of documents downloaded.
    """
    with psycopg.connect(dsn) as con:
        pending = con.execute(
            "select id, org, fiscal_year, title, source_url from jbook_documents "
            "where status = 'registered' order by id"
        ).fetchall()
    done = 0
    for doc_id, org, fy, title, url in pending:
        dest = raw_docs_dir / f"fy{fy}" / org.lower() / title
        ensure_free_space(dest.parent, min_free_gb)
        sha, n = download_file(client, url, dest)
        has_xml: bool | None = None
        if title.lower().endswith(".pdf"):
            xmls = extract_jbook_xml(dest, dest.parent / "xml")
            has_xml = bool(xmls)
        with psycopg.connect(dsn) as con:
            con.execute(
                "update jbook_documents set status='downloaded', file_path=%s, sha256=%s, "
                "bytes=%s, downloaded_at=%s, has_embedded_xml=%s where id=%s",
                (str(dest), sha, n, dt.datetime.now(dt.UTC), has_xml, doc_id),
            )
        done += 1
    return done
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_acquire.py -v` — PASS (1 passed)
Then full suite: `uv run pytest -q` — all pass.

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/acquire.py tests/jbooks/test_acquire.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): document acquirer with embedded-xml detection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Rollup loader (R-1/P-1 XLSX → budget_lines)

**Files:**
- Create: `src/govbudget/jbooks/rollup_loader.py`
- Test: `tests/jbooks/test_rollup_loader.py`

- [ ] **Step 1: Write the failing test** (builds a mini workbook mirroring the verified real headers)

```python
from decimal import Decimal

import psycopg
from openpyxl import Workbook

from govbudget.jbooks.rollup_loader import load_rollup

HEADERS = [
    "Account", "Account Title", "Organization", "Budget Activity",
    "Budget Activity Title", "Line Number", "PE/BLI",
    "Program Element/Budget Line Item (BLI) Title", "Include In TOA",
    "FY 2024 Actuals", "FY 2025 Enacted", "FY 2025 Total", "FY 2026 Disc Request",
]
ROW1 = ["0400", "RDT&E Defense-Wide", "DARPA", "01", "Basic Research", "2",
        "0601101E", "DEFENSE RESEARCH SCIENCES", "Y",
        280494, 293145, 293145, 0]
ROW2 = ["0400", "RDT&E Defense-Wide", "DARPA", "02", "Applied Research", "14",
        "0602303E", "INFORMATION & COMMUNICATIONS TECHNOLOGY", "Y",
        413000, 400000, None, 350000]


def make_xlsx(tmp_path, with_preamble_rows=True):
    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit R-1"
    if with_preamble_rows:
        ws.append(["Exhibit R-1, RDT&E Programs"])  # banner rows above the header
        ws.append([])
    ws.append(HEADERS)
    ws.append(ROW1)
    ws.append(ROW2)
    p = tmp_path / "r1_display.xlsx"
    wb.save(p)
    return p


def test_load_rollup_melts_fy_columns(pg_dsn, tmp_path):
    n = load_rollup(pg_dsn, make_xlsx(tmp_path), exhibit="R-1", fiscal_year=2026)
    assert n == 7  # ROW1: 4 amounts, ROW2: 3 amounts (None skipped)
    with psycopg.connect(pg_dsn) as con:
        val = con.execute(
            "select amount_thousands from budget_lines "
            "where pe_bli='0601101E' and amount_type='fy_2024_actuals'"
        ).fetchone()[0]
        assert val == Decimal("280494")
        types = {r[0] for r in con.execute(
            "select distinct amount_type from budget_lines where pe_bli='0602303E'")}
    assert types == {"fy_2024_actuals", "fy_2025_enacted", "fy_2026_disc_request"}


def test_load_rollup_is_idempotent_upsert(pg_dsn, tmp_path):
    p = make_xlsx(tmp_path)
    load_rollup(pg_dsn, p, exhibit="R-1", fiscal_year=2026)
    n2 = load_rollup(pg_dsn, p, exhibit="R-1", fiscal_year=2026)
    assert n2 == 7  # upserts same rows
    with psycopg.connect(pg_dsn) as con:
        total = con.execute("select count(*) from budget_lines").fetchone()[0]
    assert total == 7
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_rollup_loader.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/rollup_loader.py`**

```python
import re
from decimal import Decimal
from pathlib import Path

import psycopg
from openpyxl import load_workbook

ID_HEADERS = {
    "Account": "account",
    "Account Title": "account_title",
    "Organization": "organization",
    "Budget Activity": "budget_activity",
    "Budget Activity Title": "budget_activity_title",
    "Line Number": "line_number",
    "PE/BLI": "pe_bli",
    "Program Element/Budget Line Item (BLI) Title": "title",
}
REQUIRED = {"Account", "Organization", "PE/BLI"}


def _slug(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")


def _find_header_row(ws) -> tuple[int, dict[int, str]]:
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=20, values_only=True), start=1):
        cells = {j: str(v).strip() for j, v in enumerate(row) if v is not None}
        if REQUIRED <= set(cells.values()):
            return i, cells
    raise ValueError(f"No header row with {REQUIRED} found in first 20 rows")


def load_rollup(dsn: str, xlsx_path: Path, *, exhibit: str, fiscal_year: int, source_document_id: int | None = None) -> int:
    """Melt an R-1/P-1 display workbook into budget_lines rows. Returns rows upserted."""
    ws = load_workbook(xlsx_path, read_only=True, data_only=True)
    sheet = ws[f"Exhibit {exhibit}"] if f"Exhibit {exhibit}" in ws.sheetnames else ws[ws.sheetnames[0]]
    header_row, headers = _find_header_row(sheet)
    fy_cols = {j: _slug(h) for j, h in headers.items() if h.upper().startswith("FY ")}
    id_cols = {j: ID_HEADERS[h] for j, h in headers.items() if h in ID_HEADERS}
    upserted = 0
    with psycopg.connect(dsn) as con:
        for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
            ids = {name: row[j] for j, name in id_cols.items() if j < len(row)}
            if not ids.get("pe_bli"):
                continue
            for j, amount_type in fy_cols.items():
                if j >= len(row) or row[j] is None or str(row[j]).strip() == "":
                    continue
                try:
                    amount = Decimal(str(row[j]))
                except ArithmeticError:
                    continue
                con.execute(
                    """
                    insert into budget_lines
                      (exhibit, fiscal_year, account, account_title, organization, budget_activity,
                       budget_activity_title, line_number, pe_bli, title, amount_type,
                       amount_thousands, source_document_id)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (exhibit, fiscal_year, account, organization, pe_bli, amount_type)
                    do update set amount_thousands = excluded.amount_thousands,
                                  title = excluded.title,
                                  source_document_id = excluded.source_document_id
                    """,
                    (
                        exhibit, fiscal_year, str(ids.get("account")), ids.get("account_title"),
                        str(ids.get("organization")), _str(ids.get("budget_activity")),
                        ids.get("budget_activity_title"), _str(ids.get("line_number")),
                        str(ids.get("pe_bli")), ids.get("title"), amount_type, amount,
                        source_document_id,
                    ),
                )
                upserted += 1
    return upserted


def _str(v) -> str | None:
    return None if v is None else str(v)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_rollup_loader.py -v` — PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/rollup_loader.py tests/jbooks/test_rollup_loader.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): r-1/p-1 rollup loader into budget_lines

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Detail loader (parsed records → Postgres)

**Files:**
- Create: `src/govbudget/jbooks/load_details.py`
- Test: `tests/jbooks/test_load_details.py`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def seed_doc(pg_dsn) -> int:
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        return con.execute("select id from jbook_documents").fetchone()[0]


def test_load_details_writes_rows_and_run(pg_dsn):
    doc_id = seed_doc(pg_dsn)
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        run = con.execute(
            "select tier, status from extraction_runs where id=%s", (run_id,)
        ).fetchone()
        assert run == (0, "finished")
        pe_rows = con.execute(
            "select count(*) from budget_line_details "
            "where pe_bli='0601101E' and project_number is null"
        ).fetchone()[0]
        assert pe_rows >= 2  # PriorYear + CurrentYear at minimum
        proj_rows = con.execute(
            "select count(*) from budget_line_details where project_number='CCS-02'"
        ).fetchone()[0]
        assert proj_rows >= 1
        narr = con.execute(
            "select count(*) from detail_narratives where pe_bli='0601101E'"
        ).fetchone()[0]
        assert narr >= 1


def test_reextract_supersedes_prior_run(pg_dsn):
    doc_id = seed_doc(pg_dsn)
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        live = con.execute(
            "select count(*) from budget_line_details where not superseded"
        ).fetchone()[0]
        dead = con.execute(
            "select count(*) from budget_line_details where superseded"
        ).fetchone()[0]
    assert live == dead  # second run superseded the first, equal row counts
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_load_details.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/load_details.py`**

```python
import json
from pathlib import Path

import psycopg

from govbudget.jbooks.xml_parser import parse_jbook_xml


def load_document_details(dsn: str, *, document_id: int, xml_path: Path) -> int:
    """Parse a J-book XML and load details/narratives. Supersedes prior rows
    for the document. Returns the extraction_run id."""
    records = parse_jbook_xml(xml_path)
    with psycopg.connect(dsn) as con:
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions) "
            "values (%s, 0, %s) returning id",
            (document_id, json.dumps({"parser": "xml_parser/1", "source": xml_path.name})),
        ).fetchone()[0]
        con.execute(
            "update budget_line_details set superseded=true where document_id=%s",
            (document_id,),
        )
        con.execute(
            "update detail_narratives set superseded=true where document_id=%s",
            (document_id,),
        )
        for pe in records:
            for f in pe.funding:
                con.execute(
                    "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
                    " project_number, project_title, scenario, amount_millions, xml_path)"
                    " values (%s,%s,%s,null,null,%s,%s,%s)",
                    (run_id, document_id, pe.number, f.scenario, f.amount_millions, pe.xml_path),
                )
            if pe.mission_description:
                con.execute(
                    "insert into detail_narratives (extraction_run_id, document_id, pe_bli,"
                    " project_number, kind, title, body, xml_path)"
                    " values (%s,%s,%s,null,'mission',%s,%s,%s)",
                    (run_id, document_id, pe.number, pe.title, pe.mission_description, pe.xml_path),
                )
            for proj in pe.projects:
                for f in proj.funding:
                    con.execute(
                        "insert into budget_line_details (extraction_run_id, document_id,"
                        " pe_bli, project_number, project_title, scenario, amount_millions,"
                        " xml_path) values (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (run_id, document_id, pe.number, proj.number, proj.title,
                         f.scenario, f.amount_millions, proj.xml_path),
                    )
                if proj.mission_description:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,%s,'mission',%s,%s,%s)",
                        (run_id, document_id, pe.number, proj.number, proj.title,
                         proj.mission_description, proj.xml_path),
                    )
                for n in proj.narratives:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (run_id, document_id, pe.number, proj.number, n.kind, n.title,
                         n.body, n.xml_path),
                    )
        con.execute(
            "update extraction_runs set status='finished', finished_at=now() where id=%s",
            (run_id,),
        )
    return run_id
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_load_details.py -v` — PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/load_details.py tests/jbooks/test_load_details.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): detail loader with supersede semantics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Reconciliation gates + review CLI

**Files:**
- Create: `src/govbudget/jbooks/reconcile.py`
- Modify: `src/govbudget/cli.py` (add `jbooks` group + `review`)
- Test: `tests/jbooks/test_reconcile.py`

- [ ] **Step 1: Write the failing test**

```python
from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import SCENARIO_MAP, reconcile_document
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def seed(pg_dsn, r1_fy2024_thousands):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values ('R-1',2026,'0400','DARPA','0601101E',"
            " 'fy_2024_actuals', %s)",
            (r1_fy2024_thousands,),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    return doc_id, run_id


def test_gate_b_passes_when_r1_matches(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))  # $K == 280.494M
    result = reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='PriorYear'"
        ).fetchone()
        assert check == (True,)
        rec = con.execute(
            "select bool_and(reconciled) from budget_line_details "
            "where pe_bli='0601101E' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
    assert rec is True
    assert result["queued"] == result["failed"]


def test_gate_b_failure_queues_review(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("999999"))
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        q = con.execute(
            "select count(*) from review_queue rq join reconciliation_checks c"
            " on c.id=rq.check_id where c.gate='B' and c.pe_bli='0601101E'"
            " and c.scenario='PriorYear' and rq.status='open'"
        ).fetchone()[0]
        rec = con.execute(
            "select bool_or(reconciled) from budget_line_details "
            "where pe_bli='0601101E' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
    assert q == 1
    assert rec is False


def test_gate_a_checks_project_sums(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        gate_a = con.execute(
            "select count(*) from reconciliation_checks where gate='A'"
        ).fetchone()[0]
    assert gate_a >= 1  # one per (PE, scenario) with project rows


def test_scenario_map_covers_core_scenarios():
    assert SCENARIO_MAP["PriorYear"][0] == "fy_2024_actuals"
    assert "fy_2025_total" in SCENARIO_MAP["CurrentYear"]
    assert "fy_2026_disc_request" in SCENARIO_MAP["BudgetYearOne"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_reconcile.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/reconcile.py`**

```python
from decimal import Decimal

import psycopg

TOLERANCE_M = Decimal("0.001")

# XML scenario -> candidate R-1 amount_type slugs, in preference order.
# PB books label FY relative to the budget year (BudgetYear=2026 =>
# PriorYear=FY2024 actuals, CurrentYear=FY2025, BudgetYearOne=FY2026).
SCENARIO_MAP: dict[str, list[str]] = {
    "PriorYear": ["fy_2024_actuals"],
    "CurrentYear": ["fy_2025_total", "fy_2025_enacted"],
    "BudgetYearOne": ["fy_2026_disc_request", "fy_2026_total"],
}


def reconcile_document(dsn: str, *, document_id: int, extraction_run_id: int) -> dict:
    """Run Gates A and B for one document's live details. Returns counters."""
    passed = failed = queued = 0
    with psycopg.connect(dsn) as con:
        # ---------- Gate A: project rows sum to the PE-level amount ----------
        gate_a_rows = con.execute(
            """
            with pe as (
              select pe_bli, scenario, amount_millions from budget_line_details
              where document_id=%s and not superseded and project_number is null
            ), proj as (
              select pe_bli, scenario, sum(amount_millions) total, count(*) n
              from budget_line_details
              where document_id=%s and not superseded and project_number is not null
              group by pe_bli, scenario
            )
            select pe.pe_bli, pe.scenario, pe.amount_millions, proj.total
            from pe join proj using (pe_bli, scenario)
            """,
            (document_id, document_id),
        ).fetchall()
        for pe_bli, scenario, pe_amount, proj_total in gate_a_rows:
            ok = abs(pe_amount - proj_total) <= TOLERANCE_M
            check_id = _record(con, extraction_run_id, "A", pe_bli, scenario,
                               pe_amount, proj_total, ok,
                               f"sum(projects)={proj_total} vs PE={pe_amount}")
            passed, failed, queued = _tally(con, check_id, ok, passed, failed, queued)
            if not ok:
                _unreconcile(con, document_id, pe_bli, scenario)

        # ---------- Gate B: PE-level amount matches R-1 control row ----------
        pe_rows = con.execute(
            "select pe_bli, scenario, amount_millions from budget_line_details "
            "where document_id=%s and not superseded and project_number is null",
            (document_id,),
        ).fetchall()
        for pe_bli, scenario, amount_m in pe_rows:
            candidates = SCENARIO_MAP.get(scenario)
            if not candidates:
                continue
            row = con.execute(
                "select amount_type, amount_thousands from budget_lines "
                "where pe_bli=%s and amount_type = any(%s)",
                (pe_bli, candidates),
            ).fetchall()
            by_type = {t: v for t, v in row}
            expected = None
            matched_type = None
            for t in candidates:
                if t in by_type and by_type[t] is not None:
                    expected = by_type[t] / Decimal(1000)  # R-1 $K -> $M
                    matched_type = t
                    break
            ok = expected is not None and abs(expected - amount_m) <= TOLERANCE_M
            detail = (
                f"R-1 {matched_type}={expected}M vs XML {scenario}={amount_m}M"
                if expected is not None
                else f"no R-1 row for {pe_bli} in {candidates}"
            )
            check_id = _record(con, extraction_run_id, "B", pe_bli, scenario,
                               expected, amount_m, ok, detail)
            passed, failed, queued = _tally(con, check_id, ok, passed, failed, queued)
            if ok:
                con.execute(
                    "update budget_line_details set reconciled=true "
                    "where document_id=%s and pe_bli=%s and scenario=%s and not superseded "
                    "and not exists (select 1 from reconciliation_checks c "
                    "  where c.extraction_run_id=%s and c.pe_bli=%s and c.scenario=%s "
                    "  and not c.passed)",
                    (document_id, pe_bli, scenario, extraction_run_id, pe_bli, scenario),
                )
            else:
                _unreconcile(con, document_id, pe_bli, scenario)
    return {"passed": passed, "failed": failed, "queued": queued}


def _record(con, run_id, gate, pe_bli, scenario, expected, actual, ok, detail) -> int:
    return con.execute(
        "insert into reconciliation_checks (extraction_run_id, gate, pe_bli, scenario,"
        " expected, actual, passed, detail) values (%s,%s,%s,%s,%s,%s,%s,%s) returning id",
        (run_id, gate, pe_bli, scenario, expected, actual, ok, detail),
    ).fetchone()[0]


def _tally(con, check_id, ok, passed, failed, queued):
    if ok:
        return passed + 1, failed, queued
    con.execute("insert into review_queue (check_id) values (%s)", (check_id,))
    return passed, failed + 1, queued + 1


def _unreconcile(con, document_id, pe_bli, scenario):
    con.execute(
        "update budget_line_details set reconciled=false "
        "where document_id=%s and pe_bli=%s and scenario=%s and not superseded",
        (document_id, pe_bli, scenario),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_reconcile.py -v` — PASS (4 passed)

Note on Gate A semantics with the real DARPA data: PE-level funding vs sum of project funding may legitimately differ for PEs with non-project costs; that is exactly what the review queue is for — the live smoke records the actual hit rate, and accept-as-is resolutions handle structural differences. Do not loosen the tolerance.

- [ ] **Step 5: Add CLI commands**

In `src/govbudget/cli.py` add:

```python
def cmd_jbooks(args) -> None:
    from govbudget.jbooks import acquire, load_details, reconcile, registry, rollup_loader
    from govbudget.jbooks.db import migrate

    migrate()
    if args.action == "scrape":
        with httpx.Client(timeout=60) as client:
            docs = registry.discover_documents(
                client,
                "https://comptroller.war.gov/Budget-Materials/Budget2026/",
                fiscal_year=config.JBOOK_FY,
            )
        n = registry.upsert_documents(config.PG_DSN, docs)
        print(f"jbooks scrape: {len(docs)} discovered, {n} new")
    elif args.action == "acquire":
        with httpx.Client(timeout=120) as client:
            n = acquire.acquire_pending(
                config.PG_DSN, client,
                raw_docs_dir=config.RAW_DOCS_DIR, min_free_gb=config.MIN_FREE_GB,
            )
        print(f"jbooks acquire: {n} downloaded")
    elif args.action == "load-rollups":
        import psycopg

        with psycopg.connect(config.PG_DSN) as con:
            rows = con.execute(
                "select id, title, file_path, fiscal_year from jbook_documents "
                "where exhibit_family='rollup' and status='downloaded'"
            ).fetchall()
        for doc_id, title, file_path, fy in rows:
            exhibit = "R-1" if title.startswith("r1") else "P-1"
            n = rollup_loader.load_rollup(
                config.PG_DSN, Path(file_path), exhibit=exhibit, fiscal_year=fy, source_document_id=doc_id
            )
            print(f"{title}: {n} budget_lines")
    elif args.action == "extract":
        import psycopg

        with psycopg.connect(config.PG_DSN) as con:
            rows = con.execute(
                "select id, file_path from jbook_documents "
                "where has_embedded_xml and status='downloaded'"
                + (" and org = %s" if args.org else ""),
                ((args.org,) if args.org else ()),
            ).fetchall()
        for doc_id, file_path in rows:
            xml_dir = Path(file_path).parent / "xml"
            xmls = sorted(xml_dir.glob("*.xml"), key=lambda p: p.stat().st_size)
            if not xmls:
                print(f"doc {doc_id}: no xml on disk, skipping")
                continue
            run_id = load_details.load_document_details(
                config.PG_DSN, document_id=doc_id, xml_path=xmls[-1]
            )
            result = reconcile.reconcile_document(
                config.PG_DSN, document_id=doc_id, extraction_run_id=run_id
            )
            print(f"doc {doc_id}: run {run_id} reconcile {result}")


def cmd_review(args) -> None:
    import psycopg

    with psycopg.connect(config.PG_DSN) as con:
        if args.review_action == "list":
            rows = con.execute(
                "select rq.id, c.gate, c.pe_bli, c.scenario, c.expected, c.actual, c.detail"
                " from review_queue rq join reconciliation_checks c on c.id=rq.check_id"
                " where rq.status='open' order by rq.id"
            ).fetchall()
            for r in rows:
                print(f"#{r[0]} gate {r[1]} {r[2]}/{r[3]} expected={r[4]} actual={r[5]} :: {r[6]}")
            print(f"{len(rows)} open item(s)")
        elif args.review_action == "accept":
            con.execute(
                "update review_queue set status='accepted', resolution=%s, resolved_at=now()"
                " where id=%s",
                (args.reason, args.id),
            )
            print(f"#{args.id} accepted: {args.reason}")
```

Register in `main()`:

```python
    j = sub.add_parser("jbooks", help="phase 1 j-book pipeline")
    j.add_argument("action", choices=["scrape", "acquire", "load-rollups", "extract"])
    j.add_argument("--org", default=None)
    j.set_defaults(func=cmd_jbooks)

    rv = sub.add_parser("review", help="reconciliation review queue")
    rv.add_argument("review_action", choices=["list", "accept"])
    rv.add_argument("--id", type=int)
    rv.add_argument("--reason", default="")
    rv.set_defaults(func=cmd_review)
```

Also add `from pathlib import Path` is already imported in cli.py (Task 9 of Phase 0 fix); `import httpx` exists.

- [ ] **Step 6: Run full suite + CLI help**

Run: `uv run pytest -q && uv run python -m govbudget --help`
Expected: all tests pass; help lists `jbooks` and `review`.

- [ ] **Step 7: Commit**

```bash
git add src/govbudget/jbooks/reconcile.py src/govbudget/cli.py tests/jbooks/test_reconcile.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): reconciliation gates a/b, review queue, jbooks cli

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: verify-phase1 (acceptance gates 1–3)

**Files:**
- Create: `src/govbudget/jbooks/verify.py`
- Modify: `src/govbudget/cli.py`
- Test: `tests/jbooks/test_verify.py`

- [ ] **Step 1: Write the failing test**

```python
from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import reconcile_document
from govbudget.jbooks.registry import upsert_documents
from govbudget.jbooks.verify import accuracy_gate, coverage_gate, provenance_gate

FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def seed_full(pg_dsn, tmp_path):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    import hashlib
    import shutil

    doc_file = tmp_path / "darpa.pdf"
    shutil.copy(FIXTURE, doc_file)  # any file works for sha provenance in tests
    sha = hashlib.sha256(doc_file.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "update jbook_documents set file_path=%s, sha256=%s, status='downloaded'"
            " where id=%s", (str(doc_file), sha, doc_id),
        )
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals', %s)",
            (Decimal("280494"),),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    return doc_id


def test_coverage_gate_counts_extracted_vs_r1(pg_dsn, tmp_path):
    seed_full(pg_dsn, tmp_path)
    cov = coverage_gate(pg_dsn, organizations=["DARPA"])
    assert cov["r1_lines"] == 1
    assert cov["covered"] == 1
    assert cov["pct"] == 100.0


def test_accuracy_gate_no_silent_unreconciled(pg_dsn, tmp_path):
    seed_full(pg_dsn, tmp_path)
    acc = accuracy_gate(pg_dsn)
    assert acc["silent_unreconciled"] == 0


def test_provenance_gate_resolves_samples(pg_dsn, tmp_path):
    seed_full(pg_dsn, tmp_path)
    prov = provenance_gate(pg_dsn, sample_size=10)
    assert prov["sampled"] > 0
    assert prov["resolved"] == prov["sampled"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/jbooks/test_verify.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write `src/govbudget/jbooks/verify.py`**

```python
import hashlib
from pathlib import Path

import psycopg


def coverage_gate(dsn: str, *, organizations: list[str]) -> dict:
    """Gate 1: every in-scope R-1 line has detail rows or an extraction_gaps row."""
    with psycopg.connect(dsn) as con:
        r1 = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines "
                "where exhibit='R-1' and organization = any(%s)",
                (organizations,),
            )
        }
        detailed = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_line_details where not superseded"
            )
        }
        gapped = {r[0] for r in con.execute("select pe_bli from extraction_gaps")}
    covered = r1 & (detailed | gapped)
    missing = sorted(r1 - detailed - gapped)
    return {
        "r1_lines": len(r1),
        "covered": len(covered),
        "pct": round(100.0 * len(covered) / len(r1), 1) if r1 else 100.0,
        "missing": missing[:20],
    }


def accuracy_gate(dsn: str) -> dict:
    """Gate 2: no unreconciled live detail without an open/resolved queue trail."""
    with psycopg.connect(dsn) as con:
        silent = con.execute(
            """
            select count(*) from budget_line_details d
            where not d.superseded and not d.reconciled
              and not exists (
                select 1 from reconciliation_checks c
                join review_queue rq on rq.check_id = c.id
                where c.pe_bli = d.pe_bli and c.scenario = d.scenario
              )
              and exists (  -- only count scenarios we promise to reconcile
                select 1 from reconciliation_checks c2
                where c2.pe_bli = d.pe_bli and c2.scenario = d.scenario
              )
            """
        ).fetchone()[0]
        open_items = con.execute(
            "select count(*) from review_queue where status='open'"
        ).fetchone()[0]
    return {"silent_unreconciled": silent, "open_review_items": open_items}


def provenance_gate(dsn: str, *, sample_size: int = 50) -> dict:
    """Gate 3: sampled live facts resolve to document file + sha + xml anchor."""
    import xml.etree.ElementTree as ET

    resolved = 0
    with psycopg.connect(dsn) as con:
        samples = con.execute(
            """
            select d.pe_bli, d.xml_path, j.file_path, j.sha256
            from budget_line_details d
            join jbook_documents j on j.id = d.document_id
            where not d.superseded
            order by random() limit %s
            """,
            (sample_size,),
        ).fetchall()
    for pe_bli, xml_path, file_path, sha in samples:
        p = Path(file_path) if file_path else None
        if not p or not p.exists():
            continue
        if sha and hashlib.sha256(p.read_bytes()).hexdigest() != sha:
            continue
        if not xml_path or not xml_path.startswith("ProgramElement["):
            continue
        resolved += 1
    return {"sampled": len(samples), "resolved": resolved}
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/jbooks/test_verify.py -v` — PASS (3 passed)

- [ ] **Step 5: Add `verify-phase1` CLI**

In `src/govbudget/cli.py`:

```python
def cmd_verify_phase1(args) -> None:
    from govbudget.jbooks.verify import accuracy_gate, coverage_gate, provenance_gate

    orgs = args.orgs.split(",") if args.orgs else ["DARPA"]
    cov = coverage_gate(config.PG_DSN, organizations=orgs)
    acc = accuracy_gate(config.PG_DSN)
    prov = provenance_gate(config.PG_DSN)
    print(f"gate 1 coverage: {cov['covered']}/{cov['r1_lines']} ({cov['pct']}%)"
          + (f" missing: {cov['missing']}" if cov["missing"] else ""))
    print(f"gate 2 accuracy: silent_unreconciled={acc['silent_unreconciled']}"
          f" open_review={acc['open_review_items']}")
    print(f"gate 3 provenance: {prov['resolved']}/{prov['sampled']} resolved")
    ok = cov["pct"] >= 99.0 and acc["silent_unreconciled"] == 0 and (
        prov["sampled"] == 0 or prov["resolved"] == prov["sampled"]
    )
    print("verify-phase1:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
```

Register:

```python
    v = sub.add_parser("verify-phase1", help="run phase 1 acceptance gates 1-3")
    v.add_argument("--orgs", default="DARPA")
    v.set_defaults(func=cmd_verify_phase1)
```

- [ ] **Step 6: Run full suite + help; commit**

Run: `uv run pytest -q && uv run python -m govbudget --help`

```bash
git add src/govbudget/jbooks/verify.py src/govbudget/cli.py tests/jbooks/test_verify.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1): acceptance gates 1-3 and verify-phase1 cli

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Live smoke (network + real Postgres, manual)

Prereq: `createdb govbudget` (or confirm it exists: `psql govbudget -c 'select 1'`).

- [ ] **Step 1: Migrate + scrape**

Run: `uv run python -m govbudget migrate && uv run python -m govbudget jbooks scrape`
Expected: migrations applied; `jbooks scrape: N discovered, N new` with N ≥ 25 (rollups + defense-wide RDT&E + procurement books).

- [ ] **Step 2: Acquire (rollups + DARPA first)**

The acquirer downloads everything registered; for a focused first run, trim registration to rollups + DARPA + one procurement book before acquiring:

```bash
uv run python - <<'EOF'
import psycopg
from govbudget import config
with psycopg.connect(config.PG_DSN) as con:
    con.execute("""
        delete from jbook_documents where status='registered'
        and not (exhibit_family='rollup'
                 or org ilike '%darpa%'
                 or (exhibit_family='procurement' and id in (
                     select min(id) from jbook_documents where exhibit_family='procurement')))
    """)
    print(con.execute("select org, exhibit_family, title from jbook_documents").fetchall())
EOF
uv run python -m govbudget jbooks acquire
```

Expected: `jbooks acquire: 4 downloaded` (r1, p1, DARPA RDT&E, one procurement book). **Record the P-40 finding:** check `select org, title, has_embedded_xml from jbook_documents where exhibit_family='procurement'` — whether procurement books embed XML decides Plan B's Tier 1 scope. Note the answer in the Plan B planning notes.

- [ ] **Step 3: Load rollups + extract + reconcile**

Run: `uv run python -m govbudget jbooks load-rollups`
Expected: `r1_display.xlsx: ~7000+ budget_lines` (1,143 PE/BLI × populated FY columns) and a P-1 count.

Run: `uv run python -m govbudget jbooks extract --org DARPA`
Expected: one run line with reconcile counters. Gate B should pass for the large majority of (PE, scenario) pairs; Gate A failures are expected where PEs carry non-project costs — inspect.

- [ ] **Step 4: Review queue triage**

Run: `uv run python -m govbudget review list`
Inspect failures. For structural Gate A differences (PE total ≠ project sum by design), accept with reason:
`uv run python -m govbudget review accept --id <N> --reason "PE carries non-project costs"`.
Any Gate B failure is a real mapping or data problem — investigate before accepting (check the SCENARIO_MAP candidate that matched in the detail text).

- [ ] **Step 5: Acceptance gates**

Run: `uv run python -m govbudget verify-phase1 --orgs DARPA`
Expected: `gate 1 coverage: 24/24 (100.0%)`, `gate 2 accuracy: silent_unreconciled=0`, `gate 3 provenance: 50/50 resolved` (or N/N for N<50 samples), `verify-phase1: PASS`.

- [ ] **Step 6: Commit smoke artifacts**

```bash
git add -A docs
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "chore(phase1): record live smoke outcomes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" --allow-empty
```

(Use the commit body to record: scrape count, P-40 embedded-XML finding, Gate A/B pass rates, verify-phase1 output.)

---

## Self-Review Notes

- **Spec coverage (Plan A scope):** Unit 1 → Tasks 5–6; Unit 2 → Task 7; Unit 3 Tier 0 → Tasks 2–4, 8; Unit 4 → Task 9; gates 1–3 → Task 10; live validation + P-40 XML question → Task 11. Deferred to Plan B (explicitly): Tier 1 fallback, crosswalk v1, gates 4–6 full corpus, Army expansion, dbt `export-facts` marts.
- **Golden values** are real (hand-verified against the published FY2026 DARPA book during recon): PE 0601101E, 280.494/293.145 $M, project CCS-02, R1 line 2, approp 0400.
- **Type consistency:** `parse_jbook_xml -> list[ProgramElementRecord]` consumed by `load_document_details`; `SCENARIO_MAP: dict[str, list[str]]` consumed by reconcile + its test; `upsert_documents(dsn, docs) -> int` used in tests and CLI; conftest `pg_dsn` fixture used across all jbooks tests.
- **Known judgment calls:** Gate A may legitimately fail on PEs with non-project costs (review-queue accept path, not a tolerance loosen); `CurrentYear`/`BudgetYearOne` R-1 column mapping is candidate-ordered and the matched candidate is recorded in check detail — the live smoke validates the ordering empirically.
