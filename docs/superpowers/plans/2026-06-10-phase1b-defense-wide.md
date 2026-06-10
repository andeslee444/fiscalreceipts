# Phase 1B: Defense-Wide Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Plan B prerequisites from the Phase 1A final review and extend the deterministic extraction pipeline to procurement (P-40) and all defense-wide organizations, with gates 1–3 passing across the full defense-wide scope.

**Architecture:** Five increments on the existing `jbooks` package: (1) scenario lifecycle — any-candidate matching + `BudgetYearOneBase` in SCENARIO_MAP + explicit design-excluded set; (2) `extraction_gaps` producer wired into extract; (3) P-40 XML parser (verified `jb` schema: `LineItem/ResourceSummary/NetProcurementP1`) + procurement detail loader; (4) P-1 rollup loader aggregating cost-type rows to BLI grain into the existing `budget_lines` shape; (5) full defense-wide live smoke (~34 books, both families). Crosswalk v1, marts/export-facts, Tier 1 eval, and Army are Plan 1C.

**Tech Stack:** unchanged (Python 3.12, psycopg 3, pypdf, openpyxl, stdlib xml.etree, pytest).

**Verified ground truth (live recon 2026-06-10, CBDP procurement MJB on disk at `data/raw_docs/fy2026/cbdp/xml/U_PROCUREMENT_MJB_2506240848XAYF_CBDP_PB_2026.xml`):** root `MasterJustificationBook`; 2 `LineItem` records with `LineItemNumber` 7001SA1000 ("Chemical Biological Situational Awareness"), `P1LineNumber` 120, `AppropriationNumber` 0300D, `BudgetActivityNumber` 3, `BudgetSubActivityNumber` 1, `Description`, `Justification`, `ResourceSummary/{TotalCost, NetProcurementP1, TotalObligationAuthority}` each with `{AllPriorYears, PriorYear, CurrentYear, BudgetYearOneBase, BudgetYearOneOOC, BudgetYearOne}` in $M (NetProcurementP1 PriorYear=148.64, CurrentYear=186.841, BudgetYearOne=208.051), plus `ItemExhibitList` (P-5/P-21 detail — NOT parsed in 1B). P-1 display workbook headers (row 2 after one banner row): Account, Account Title, Organization, Budget Activity, Budget Activity Title, Line Number, BSA, Budget SubActivity (BSA) Title, Budget Line Item, Budget Line Item (BLI) Title, Cost Type, Cost Type Title, Add/Non-Add, then per-FY "… Quantity"/"… Amount" column pairs (amounts $K), Classification; multiple cost-type rows per BLI; "FY 2026 Reconciliation Request" appears as an UNLABELED duplicate pair (no Quantity/Amount suffix) — skipped in 1B.

**Conventions (same as 1A):** all commands from `/Users/andeslee/Documents/Cursor-Projects/GovBudget`; commits use `--author="Andes Lee <andes.lee444@gmail.com>"` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer; Postgres must be running. Baseline: `uv run pytest -q` → 64 passed.

---

### Task 1: Scenario lifecycle — any-candidate matching + BudgetYearOneBase

Two changes to Gate B in `src/govbudget/jbooks/reconcile.py`: (a) a candidate must MATCH, not merely be present — currently the first present column is compared and the rest ignored, which breaks for OOC-split orgs where `BudgetYearOne = Base + OOC` equals `fy_2026_total` but not `fy_2026_disc_request`; (b) `BudgetYearOneBase` joins SCENARIO_MAP (maps to the disc/base column), and the intentionally-unreconciled scenarios get an exported constant.

**Files:**
- Modify: `src/govbudget/jbooks/reconcile.py`
- Test: `tests/jbooks/test_reconcile.py`

- [ ] **Step 1: Write the failing tests** (append to `tests/jbooks/test_reconcile.py`):

```python
def test_gate_b_matches_any_candidate_not_first_present(pg_dsn):
    # fy_2025_total present but wrong; fy_2025_enacted present and right.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for amount_type, amt in (("fy_2025_total", Decimal("999999")),
                                 ("fy_2025_enacted", Decimal("293145"))):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA','0601101E',%s,%s)",
                (amount_type, amt),
            )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        check = con.execute(
            "select passed, detail from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='CurrentYear'"
        ).fetchone()
    assert check[0] is True
    assert "fy_2025_enacted" in check[1]


def test_budget_year_one_base_is_reconciled(pg_dsn):
    from govbudget.jbooks.reconcile import DESIGN_EXCLUDED_SCENARIOS

    assert "AllPriorYears" in DESIGN_EXCLUDED_SCENARIOS
    assert "BudgetYearOneBase" in SCENARIO_MAP
    doc_id, run_id = seed(pg_dsn, Decimal("280494"))
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        # fixture BudgetYearOneBase=0.000, no control row -> zero-absent PASS
        check = con.execute(
            "select passed from reconciliation_checks where gate='B'"
            " and pe_bli='0601101E' and scenario='BudgetYearOneBase'"
        ).fetchone()
        unrec = con.execute(
            "select count(*) from budget_line_details where scenario='BudgetYearOneBase'"
            " and not superseded and not reconciled and pe_bli='0601101E'"
        ).fetchone()[0]
    assert check == (True,)
    assert unrec == 0
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/jbooks/test_reconcile.py -v`: the any-candidate test FAILS (first-present fy_2025_total=999.999M compared, mismatch) and the base test FAILS (ImportError on DESIGN_EXCLUDED_SCENARIOS).

- [ ] **Step 3: Implement.** In `src/govbudget/jbooks/reconcile.py`, replace the SCENARIO_MAP block with:

```python
# XML scenario -> candidate R-1 amount_type slugs. Gate B passes if ANY
# candidate matches within tolerance (PB books split base/OOC/total
# differently per org). PB2026: PriorYear=FY2024 actuals, CurrentYear=FY2025,
# BudgetYearOne=FY2026 total request, BudgetYearOneBase=FY2026 base/disc.
SCENARIO_MAP: dict[str, list[str]] = {
    "PriorYear": ["fy_2024_actuals"],
    "CurrentYear": ["fy_2025_total", "fy_2025_enacted"],
    "BudgetYearOne": ["fy_2026_total", "fy_2026_disc_request"],
    "BudgetYearOneBase": ["fy_2026_disc_request", "fy_2026_total"],
}

# Extracted but intentionally not reconciled: no R-1 display analog.
# Marts and the accuracy gate treat these as not-served-by-design,
# distinct from pending-review.
DESIGN_EXCLUDED_SCENARIOS = frozenset({"AllPriorYears", "BudgetYearOneOOC"})
```

and replace the Gate B expected/ok computation (the `expected = None ... for t in candidates ... break` block plus the three-branch if/elif/else) with:

```python
            present = [
                (t, by_type[t] / Decimal(1000))  # R-1 $K -> $M
                for t in candidates
                if by_type.get(t) is not None
            ]
            match = next(
                ((t, v) for t, v in present if abs(v - amount_m) <= TOLERANCE_M), None
            )
            if match:
                matched_type, expected = match
                ok = True
                detail = f"R-1 {matched_type}={expected}M vs XML {scenario}={amount_m}M"
            elif present:
                matched_type, expected = present[0]
                ok = False
                detail = f"R-1 {matched_type}={expected}M vs XML {scenario}={amount_m}M"
            elif amount_m == 0:
                # The R-1 display omits empty cells; an absent control row is
                # semantically zero. Only an explicit zero may match it.
                expected = None
                ok = True
                detail = f"absent R-1 cell == XML {scenario}=0.000 (zero-absent rule)"
            else:
                expected = None
                ok = False
                detail = f"no R-1 row for {pe_bli} ({exhibit}/{org}/fy{fy}) in {candidates}"
```

- [ ] **Step 4: Run** — `uv run pytest tests/jbooks/test_reconcile.py -v` (10 passed), then `uv run pytest -q` (66 passed). NOTE: the existing `test_gate_b_zero_absent_rule` asserts PriorYear FAILS with no control row — unchanged behavior, must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/reconcile.py tests/jbooks/test_reconcile.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1b): any-candidate gate b matching, reconcile budget year base

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: extraction_gaps producer + sentinel exclusion

**Files:**
- Create: `src/govbudget/jbooks/gaps.py`
- Modify: `src/govbudget/jbooks/verify.py` (sentinel filter), `src/govbudget/cli.py` (extract calls producer)
- Test: `tests/jbooks/test_gaps.py`

- [ ] **Step 1: Write the failing test** (`tests/jbooks/test_gaps.py`):

```python
from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.gaps import record_extraction_gaps
from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def test_gaps_recorded_for_unextracted_r1_lines(pg_dsn):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for pe in ("0601101E", "0699999E", "9999999999"):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account, organization,"
                " pe_bli, amount_type, amount_thousands)"
                " values ('R-1',2026,'0400','DARPA',%s,'fy_2024_actuals',%s)",
                (pe, Decimal("1000")),
            )
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    n = record_extraction_gaps(pg_dsn, document_id=doc_id)
    assert n == 1  # 0699999E missing; 0601101E extracted; sentinel excluded
    with psycopg.connect(pg_dsn) as con:
        rows = con.execute(
            "select pe_bli, reason from extraction_gaps"
        ).fetchall()
    assert rows[0][0] == "0699999E"
    assert "DARPA" in rows[0][1]

    # idempotent: re-run replaces, no duplicates
    assert record_extraction_gaps(pg_dsn, document_id=doc_id) == 1
    with psycopg.connect(pg_dsn) as con:
        total = con.execute("select count(*) from extraction_gaps").fetchone()[0]
    assert total == 1
```

- [ ] **Step 2: Run** — FAIL with ModuleNotFoundError.

- [ ] **Step 3: Write `src/govbudget/jbooks/gaps.py`:**

```python
import psycopg

SENTINEL_PE = "9999999999"  # R-1 display subtotal rows, not real programs


def record_extraction_gaps(dsn: str, *, document_id: int) -> int:
    """Record in-scope rollup lines with no extracted detail from ANY of the
    org's documents. Replaces this document's prior gap rows (idempotent).
    Returns the number of gaps recorded."""
    with psycopg.connect(dsn) as con:
        org, family, fy = con.execute(
            "select org, exhibit_family, fiscal_year from jbook_documents where id=%s",
            (document_id,),
        ).fetchone()
        exhibit = {"rdte": "R-1", "procurement": "P-1"}.get(family)
        con.execute("delete from extraction_gaps where document_id=%s", (document_id,))
        missing = con.execute(
            """
            select distinct b.pe_bli from budget_lines b
            where b.exhibit=%s and b.organization=%s and b.fiscal_year=%s
              and b.pe_bli <> %s
              and not exists (
                select 1 from budget_line_details d
                join jbook_documents j on j.id = d.document_id
                where d.pe_bli = b.pe_bli and not d.superseded and j.org = %s
              )
            """,
            (exhibit, org, fy, SENTINEL_PE, org),
        ).fetchall()
        for (pe,) in missing:
            con.execute(
                "insert into extraction_gaps (exhibit, pe_bli, reason, document_id)"
                " values (%s,%s,%s,%s)",
                (exhibit, pe, f"absent from {org} fy{fy} book xml", document_id),
            )
        return len(missing)
```

- [ ] **Step 4: Sentinel filter in coverage.** In `src/govbudget/jbooks/verify.py`, `coverage_gate`, change the r1 query to exclude sentinels:

```python
        r1 = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines "
                "where exhibit='R-1' and organization = any(%s) "
                "and pe_bli <> '9999999999'",
                (organizations,),
            )
        }
```

- [ ] **Step 5: Wire into CLI.** In `src/govbudget/cli.py`, `cmd_jbooks` extract branch, after the `reconcile.reconcile_document(...)` call add:

```python
            from govbudget.jbooks.gaps import record_extraction_gaps

            gaps = record_extraction_gaps(config.PG_DSN, document_id=doc_id)
            print(f"doc {doc_id}: run {run_id} reconcile {result} gaps {gaps}")
```

(replacing the existing print line; keep the import at the top of the branch or with the function-local imports).

- [ ] **Step 6: Run** — `uv run pytest -q` → 67 passed.

- [ ] **Step 7: Commit**

```bash
git add src/govbudget/jbooks/gaps.py src/govbudget/jbooks/verify.py src/govbudget/cli.py tests/jbooks/test_gaps.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1b): extraction gaps producer, sentinel exclusion

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: P-40 fixture + procurement XML parser

**Files:**
- Create: `scripts/make_p40_fixture.py`, `tests/fixtures/jbooks/cbdp_fy2026_excerpt.xml` (committed), `src/govbudget/jbooks/p40_parser.py`
- Test: `tests/jbooks/test_p40_parser.py`

- [ ] **Step 1: Write `scripts/make_p40_fixture.py`:**

```python
"""Build the committed P-40 golden fixture from the real FY2026 CBDP book.

The CBDP procurement MJB XML is already on disk (extracted during the
Phase 1A live smoke). Trims each LineItem's ItemExhibitList (P-5/P-21
detail, not parsed in Phase 1B) to keep the fixture small.
Run: uv run python scripts/make_p40_fixture.py
"""
import xml.etree.ElementTree as ET
from pathlib import Path

SRC = Path(
    "data/raw_docs/fy2026/cbdp/xml/U_PROCUREMENT_MJB_2506240848XAYF_CBDP_PB_2026.xml"
)
FIXTURE = Path("tests/fixtures/jbooks/cbdp_fy2026_excerpt.xml")


def local(tag: str) -> str:
    return tag.split("}")[-1]


def main() -> None:
    tree = ET.parse(SRC)
    for li in (e for e in tree.getroot().iter() if local(e.tag) == "LineItem"):
        for child in [c for c in list(li) if local(c.tag) == "ItemExhibitList"]:
            li.remove(child)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    tree.write(FIXTURE, encoding="utf-8", xml_declaration=True)
    print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it** — `uv run python scripts/make_p40_fixture.py`. Sanity: fixture < 500_000 bytes; `grep -c LineItemNumber tests/fixtures/jbooks/cbdp_fy2026_excerpt.xml` → `2`; `grep -c 7001SA1000 ...` ≥ 1; `grep -c "148.64" ...` ≥ 1. If SRC is missing, re-extract first: `uv run python -c "from pathlib import Path; from govbudget.jbooks.attachments import extract_jbook_xml; print(extract_jbook_xml(Path('data/raw_docs/fy2026/cbdp/PROC_CBDP_PB_2026.pdf'), Path('data/raw_docs/fy2026/cbdp/xml')))"`.

- [ ] **Step 3: Write the failing test** (`tests/jbooks/test_p40_parser.py`):

```python
from decimal import Decimal
from pathlib import Path

from govbudget.jbooks.p40_parser import parse_p40_xml

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "cbdp_fy2026_excerpt.xml"


def test_parses_line_items_with_golden_values():
    items = parse_p40_xml(FIXTURE)
    assert len(items) == 2
    li = [x for x in items if x.number == "7001SA1000"][0]
    assert li.title == "Chemical Biological Situational Awareness"
    assert li.p1_line_number == "120"
    assert li.appropriation_number == "0300D"
    assert li.budget_activity == "3"
    assert li.budget_subactivity == "1"
    assert li.budget_year == 2026
    funding = {f.scenario: f.amount_millions for f in li.funding}
    assert funding["PriorYear"] == Decimal("148.64")
    assert funding["CurrentYear"] == Decimal("186.841")
    assert funding["BudgetYearOne"] == Decimal("208.051")
    assert li.description and li.justification
    assert li.xml_path.startswith("LineItem[")


def test_parse_is_deterministic():
    a = [(x.xml_path, x.number) for x in parse_p40_xml(FIXTURE)]
    b = [(x.xml_path, x.number) for x in parse_p40_xml(FIXTURE)]
    assert a == b
```

- [ ] **Step 4: Run** — FAIL with ModuleNotFoundError.

- [ ] **Step 5: Write `src/govbudget/jbooks/p40_parser.py`:**

```python
"""Parser for procurement (P-40) records in the DoD comptroller jb schema.

Element names verified live against the FY2026 CBDP procurement MJB.
Funding uses ResourceSummary/NetProcurementP1 — the measure that
reconciles against the P-1 display. Namespace-agnostic local-name matching,
same convention as xml_parser.py.
"""
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from govbudget.jbooks.xml_parser import FundingLine, _child, _local, _parse_funding, _text


@dataclass
class ProcurementLineRecord:
    number: str
    title: str | None
    p1_line_number: str | None
    appropriation_number: str | None
    appropriation_title: str | None
    budget_activity: str | None
    budget_subactivity: str | None
    service_agency: str | None
    budget_year: int | None
    description: str | None
    justification: str | None
    funding: list[FundingLine] = field(default_factory=list)
    xml_path: str = ""


def parse_p40_xml(path: Path) -> list[ProcurementLineRecord]:
    root = ET.parse(path).getroot()
    items: list[ProcurementLineRecord] = []
    idx = 0
    for el in root.iter():
        if _local(el.tag) != "LineItem":
            continue
        number = _text(el, "LineItemNumber")
        if not number:
            continue
        by = _text(el, "BudgetYear")
        try:
            budget_year = int(by) if by else None
        except ValueError:
            budget_year = None
        rs = _child(el, "ResourceSummary")
        net = _child(rs, "NetProcurementP1") if rs is not None else None
        items.append(
            ProcurementLineRecord(
                number=number,
                title=_text(el, "LineItemTitle"),
                p1_line_number=_text(el, "P1LineNumber"),
                appropriation_number=_text(el, "AppropriationNumber"),
                appropriation_title=_text(el, "AppropriationTitle"),
                budget_activity=_text(el, "BudgetActivityNumber"),
                budget_subactivity=_text(el, "BudgetSubActivityNumber"),
                service_agency=_text(el, "ServiceAgencyName"),
                budget_year=budget_year,
                description=_text(el, "Description"),
                justification=_text(el, "Justification"),
                funding=_parse_funding(net),
                xml_path=f"LineItem[{idx}]",
            )
        )
        idx += 1
    return items
```

Note: `_parse_funding` already accepts the scenario children present in NetProcurementP1; `BudgetYearOneOOC` is not in `FUNDING_SCENARIOS` so it is (intentionally) skipped — if Plan 1C wants OOC, extend FUNDING_SCENARIOS there.

- [ ] **Step 6: Run** — `uv run pytest tests/jbooks/test_p40_parser.py -v` → PASS (2 passed); full suite 69 passed. If a golden assertion fails, inspect the fixture (`grep -A3 LineItemNumber tests/fixtures/jbooks/cbdp_fy2026_excerpt.xml`) — fix the parser, never the goldens.

- [ ] **Step 7: Commit**

```bash
git add scripts/make_p40_fixture.py tests/fixtures/jbooks/cbdp_fy2026_excerpt.xml src/govbudget/jbooks/p40_parser.py tests/jbooks/test_p40_parser.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1b): p-40 parser with cbdp golden fixture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Procurement detail loader + extract wiring

**Files:**
- Modify: `src/govbudget/jbooks/load_details.py` (add `load_procurement_details`), `src/govbudget/jbooks/verify.py` (provenance anchor accepts LineItem paths), `src/govbudget/cli.py` (extract dispatches by family)
- Test: `tests/jbooks/test_load_details.py`

- [ ] **Step 1: Write the failing test** (append to `tests/jbooks/test_load_details.py`):

```python
P40_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "cbdp_fy2026_excerpt.xml"


def seed_proc_doc(pg_dsn) -> int:
    from govbudget.jbooks.registry import upsert_documents

    upsert_documents(pg_dsn, [{
        "org": "CBDP", "exhibit_family": "procurement", "fiscal_year": 2026,
        "title": "cbdp.pdf", "source_url": "https://example.test/cbdp.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        return con.execute("select id from jbook_documents").fetchone()[0]


def test_load_procurement_details(pg_dsn):
    from govbudget.jbooks.load_details import load_procurement_details

    doc_id = seed_proc_doc(pg_dsn)
    run_id = load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        run = con.execute(
            "select tier, status from extraction_runs where id=%s", (run_id,)
        ).fetchone()
        assert run == (0, "finished")
        from decimal import Decimal

        amt = con.execute(
            "select amount_millions from budget_line_details"
            " where pe_bli='7001SA1000' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
        assert amt == Decimal("148.64")
        kinds = {r[0] for r in con.execute(
            "select distinct kind from detail_narratives where pe_bli='7001SA1000'")}
        assert {"description", "justification"} <= kinds
        path = con.execute(
            "select xml_path from budget_line_details where pe_bli='7001SA1000' limit 1"
        ).fetchone()[0]
        assert path.startswith("LineItem[")


def test_reload_procurement_supersedes(pg_dsn):
    from govbudget.jbooks.load_details import load_procurement_details

    doc_id = seed_proc_doc(pg_dsn)
    load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        live = con.execute(
            "select count(*) from budget_line_details where not superseded"
        ).fetchone()[0]
        dead = con.execute(
            "select count(*) from budget_line_details where superseded"
        ).fetchone()[0]
    assert dead > 0
    assert live == dead
```

- [ ] **Step 2: Run** — FAIL (ImportError: load_procurement_details).

- [ ] **Step 3: Implement.** Append to `src/govbudget/jbooks/load_details.py`:

```python
def load_procurement_details(dsn: str, *, document_id: int, xml_path: Path) -> int:
    """Parse a P-40 procurement XML and load details/narratives. Supersedes
    prior rows for the document. Returns the extraction_run id."""
    from govbudget.jbooks.p40_parser import parse_p40_xml

    records = parse_p40_xml(xml_path)
    with psycopg.connect(dsn) as con:
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions) "
            "values (%s, 0, %s) returning id",
            (document_id, json.dumps({"parser": "p40_parser/1", "source": str(xml_path)})),
        ).fetchone()[0]
        con.execute(
            "update budget_line_details set superseded=true where document_id=%s",
            (document_id,),
        )
        con.execute(
            "update detail_narratives set superseded=true where document_id=%s",
            (document_id,),
        )
        for li in records:
            for f in li.funding:
                con.execute(
                    "insert into budget_line_details (extraction_run_id, document_id,"
                    " pe_bli, project_number, project_title, scenario, amount_millions,"
                    " xml_path) values (%s,%s,%s,null,null,%s,%s,%s)",
                    (run_id, document_id, li.number, f.scenario, f.amount_millions,
                     li.xml_path),
                )
            for kind, body in (("description", li.description),
                               ("justification", li.justification)):
                if body:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,null,%s,%s,%s,%s)",
                        (run_id, document_id, li.number, kind, li.title, body,
                         li.xml_path),
                    )
        con.execute(
            "update extraction_runs set status='finished', finished_at=now() where id=%s",
            (run_id,),
        )
    return run_id
```

- [ ] **Step 4: Provenance anchor.** In `src/govbudget/jbooks/verify.py`, `provenance_gate`, change:

```python
        if not xml_path or not xml_path.startswith("ProgramElement["):
```

to:

```python
        if not xml_path or not xml_path.startswith(("ProgramElement[", "LineItem[")):
```

- [ ] **Step 5: Extract dispatch.** In `src/govbudget/cli.py`, `cmd_jbooks` extract branch: select `exhibit_family` too and dispatch:

```python
        with psycopg.connect(config.PG_DSN) as con:
            rows = con.execute(
                "select id, file_path, exhibit_family from jbook_documents "
                "where has_embedded_xml and status='downloaded'"
                + (" and org = %s" if args.org else ""),
                ((args.org,) if args.org else ()),
            ).fetchall()
        for doc_id, file_path, family in rows:
            xml_dir = Path(file_path).parent / "xml"
            xmls = sorted(xml_dir.glob("*.xml"), key=lambda p: p.stat().st_size)
            if not xmls:
                print(f"doc {doc_id}: no xml on disk, skipping")
                continue
            if family == "procurement":
                run_id = load_details.load_procurement_details(
                    config.PG_DSN, document_id=doc_id, xml_path=xmls[-1]
                )
            else:
                run_id = load_details.load_document_details(
                    config.PG_DSN, document_id=doc_id, xml_path=xmls[-1]
                )
            result = reconcile.reconcile_document(
                config.PG_DSN, document_id=doc_id, extraction_run_id=run_id
            )
            from govbudget.jbooks.gaps import record_extraction_gaps

            gaps = record_extraction_gaps(config.PG_DSN, document_id=doc_id)
            print(f"doc {doc_id}: run {run_id} reconcile {result} gaps {gaps}")
```

- [ ] **Step 6: Run** — `uv run pytest -q` → 71 passed; `uv run python -m govbudget --help` exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/govbudget/jbooks/load_details.py src/govbudget/jbooks/verify.py src/govbudget/cli.py tests/jbooks/test_load_details.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1b): procurement detail loader, extract dispatch by family

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: P-1 rollup loader (aggregate to BLI grain)

P-1 display rows are (BLI × cost type × BSA) grain with Quantity/Amount column pairs; the Gate B control needs BLI grain. The loader filters `Add/Non-Add == 'Add'`, melts only "… Amount" FY columns (slug strips the suffix so amount_types align with the XML scenario map), and SUMS across cost-type/BSA rows per (account, org, BA, BLI). The unlabeled "FY 2026 Reconciliation Request" duplicate pair is skipped (header lacks the Amount suffix).

**Files:**
- Create: `src/govbudget/jbooks/p1_loader.py`
- Modify: `src/govbudget/cli.py` (load-rollups dispatch)
- Test: `tests/jbooks/test_p1_loader.py`

- [ ] **Step 1: Write the failing test** (`tests/jbooks/test_p1_loader.py`):

```python
from decimal import Decimal

import psycopg
from openpyxl import Workbook

from govbudget.jbooks.p1_loader import load_p1_rollup

P1_HEADERS = [
    "Account", "Account Title", "Organization", "Budget Activity",
    "Budget Activity Title", "Line Number", "BSA", "Budget SubActivity (BSA) Title",
    "Budget Line Item", "Budget Line Item (BLI) Title", "Cost Type",
    "Cost Type Title", "Add/Non-Add",
    "FY 2024 Actuals Quantity", "FY 2024 Actuals Amount",
    "FY 2025 Enacted Quantity", "FY 2025 Enacted Amount",
    "FY 2026 Disc Request Quantity", "FY 2026 Disc Request Amount",
    "Classification",
]


def make_p1_xlsx(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit P-1"
    ws.append(["Total of Displayed Rows"])  # banner
    ws.append(P1_HEADERS)
    # same BLI, two Add cost-type rows + one Non-Add row (must be excluded)
    ws.append(["0300D", "Procurement, Defense-Wide", "CBDP", "03", "Chem/Bio Defense",
               "120", "1", "CBDP", "7001SA1000", "CB Situational Awareness",
               "A", "Weapon System Cost", "Add", 2, 100000, 1, 150000, "", 200051])
    ws.append(["0300D", "Procurement, Defense-Wide", "CBDP", "03", "Chem/Bio Defense",
               "120", "1", "CBDP", "7001SA1000", "CB Situational Awareness",
               "B", "Advance Procurement", "Add", "", 48640, "", 36841, "", 8000])
    ws.append(["0300D", "Procurement, Defense-Wide", "CBDP", "03", "Chem/Bio Defense",
               "120", "1", "CBDP", "7001SA1000", "CB Situational Awareness",
               "Z", "Non-add memo", "Non-Add", "", 999999, "", 999999, "", 999999])
    p = tmp_path / "p1_display.xlsx"
    wb.save(p)
    return p


def test_p1_loader_aggregates_to_bli(pg_dsn, tmp_path):
    n = load_p1_rollup(pg_dsn, make_p1_xlsx(tmp_path), exhibit="P-1", fiscal_year=2026)
    assert n == 3  # one BLI x three FY amount columns
    with psycopg.connect(pg_dsn) as con:
        rows = dict(con.execute(
            "select amount_type, amount_thousands from budget_lines"
            " where exhibit='P-1' and pe_bli='7001SA1000'"
        ).fetchall())
    assert rows["fy_2024_actuals"] == Decimal("148640")  # 100000 + 48640, Non-Add excluded
    assert rows["fy_2025_enacted"] == Decimal("186841")
    assert rows["fy_2026_disc_request"] == Decimal("208051")


def test_p1_loader_is_idempotent(pg_dsn, tmp_path):
    p = make_p1_xlsx(tmp_path)
    load_p1_rollup(pg_dsn, p, exhibit="P-1", fiscal_year=2026)
    load_p1_rollup(pg_dsn, p, exhibit="P-1", fiscal_year=2026)
    with psycopg.connect(pg_dsn) as con:
        total = con.execute(
            "select count(*) from budget_lines where exhibit='P-1'"
        ).fetchone()[0]
    assert total == 3
```

(The synthetic amounts are chosen so the BLI sums equal the verified CBDP XML values × 1000: 148640/186841/208051 $K ↔ 148.64/186.841/208.051 $M — Gate B alignment is baked into the test.)

- [ ] **Step 2: Run** — FAIL with ModuleNotFoundError.

- [ ] **Step 3: Write `src/govbudget/jbooks/p1_loader.py`:**

```python
import re
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import psycopg
from openpyxl import load_workbook

P1_ID_HEADERS = {
    "Account": "account",
    "Account Title": "account_title",
    "Organization": "organization",
    "Budget Activity": "budget_activity",
    "Budget Activity Title": "budget_activity_title",
    "Line Number": "line_number",
    "Budget Line Item": "pe_bli",
    "Budget Line Item (BLI) Title": "title",
}
P1_REQUIRED = {"Account", "Organization", "Budget Line Item", "Add/Non-Add"}


def _slug(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")


def _find_header_row(ws) -> tuple[int, dict[int, str]]:
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=20, values_only=True), start=1):
        cells = {j: str(v).strip() for j, v in enumerate(row) if v is not None}
        if P1_REQUIRED <= set(cells.values()):
            return i, cells
    raise ValueError(f"No header row with {P1_REQUIRED} found in first 20 rows")


def load_p1_rollup(
    dsn: str, xlsx_path: Path, *, exhibit: str, fiscal_year: int,
    source_document_id: int | None = None,
) -> int:
    """Melt a P-1/P-1R display workbook into BLI-grain budget_lines rows.

    P-1 rows are (BLI x cost type x BSA) grain with Add/Non-Add memo rows;
    this loader keeps 'Add' rows only, melts the per-FY '... Amount' columns
    (slug drops the suffix so amount_types align with SCENARIO_MAP), and sums
    to (account, organization, budget activity, BLI) grain. Returns upserts.
    """
    wb = load_workbook(xlsx_path, read_only=True, data_only=True)
    sheet = wb[f"Exhibit {exhibit}"] if f"Exhibit {exhibit}" in wb.sheetnames else wb[wb.sheetnames[0]]
    header_row, headers = _find_header_row(sheet)
    amount_cols = {
        j: _slug(h[: -len(" Amount")])
        for j, h in headers.items()
        if h.upper().startswith("FY ") and h.endswith(" Amount")
    }
    id_cols = {j: P1_ID_HEADERS[h] for j, h in headers.items() if h in P1_ID_HEADERS}
    add_col = next(j for j, h in headers.items() if h == "Add/Non-Add")

    # key: (account, account_title, organization, ba, ba_title, line_number, bli, title)
    sums: dict[tuple, dict[str, Decimal]] = defaultdict(dict)
    for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
        ids = {name: row[j] for j, name in id_cols.items() if j < len(row)}
        if not ids.get("pe_bli"):
            continue
        if add_col >= len(row) or str(row[add_col]).strip().lower() != "add":
            continue
        key = (
            str(ids.get("account")), ids.get("account_title"),
            str(ids.get("organization")), _str(ids.get("budget_activity")),
            ids.get("budget_activity_title"), _str(ids.get("line_number")),
            str(ids.get("pe_bli")), ids.get("title"),
        )
        for j, amount_type in amount_cols.items():
            if j >= len(row) or row[j] is None or str(row[j]).strip() == "":
                continue
            try:
                amount = Decimal(str(row[j]))
            except ArithmeticError:
                continue
            bucket = sums[key]
            bucket[amount_type] = bucket.get(amount_type, Decimal(0)) + amount

    upserted = 0
    with psycopg.connect(dsn) as con:
        for key, amounts in sums.items():
            (account, account_title, organization, ba, ba_title,
             line_number, pe_bli, title) = key
            for amount_type, amount in amounts.items():
                con.execute(
                    """
                    insert into budget_lines
                      (exhibit, fiscal_year, account, account_title, organization,
                       budget_activity, budget_activity_title, line_number, pe_bli,
                       title, amount_type, amount_thousands, source_document_id)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (exhibit, fiscal_year, account, organization, budget_activity, pe_bli, amount_type)
                    do update set amount_thousands = excluded.amount_thousands,
                                  title = excluded.title,
                                  source_document_id = excluded.source_document_id
                    """,
                    (exhibit, fiscal_year, account, account_title, organization,
                     ba, ba_title, line_number, pe_bli, title, amount_type, amount,
                     source_document_id),
                )
                upserted += 1
    return upserted


def _str(v) -> str | None:
    return None if v is None else str(v)
```

- [ ] **Step 4: CLI dispatch.** In `cmd_jbooks` load-rollups branch, replace the exhibit/loader selection:

```python
        from govbudget.jbooks.p1_loader import load_p1_rollup

        failures = []
        for doc_id, title, file_path, fy in rows:
            try:
                if title.startswith("r1"):
                    n = rollup_loader.load_rollup(
                        config.PG_DSN, Path(file_path), exhibit="R-1", fiscal_year=fy,
                        source_document_id=doc_id,
                    )
                else:
                    exhibit = "P-1R" if title.startswith("p1r") else "P-1"
                    n = load_p1_rollup(
                        config.PG_DSN, Path(file_path), exhibit=exhibit, fiscal_year=fy,
                        source_document_id=doc_id,
                    )
            except Exception as e:
                failures.append(title)
                print(f"{title}: FAILED ({type(e).__name__}: {e})")
                continue
            print(f"{title}: {n} budget_lines")
        if failures:
            print(f"load-rollups finished with {len(failures)} failure(s): {', '.join(failures)}")
            sys.exit(1)
```

- [ ] **Step 5: Run** — `uv run pytest -q` → 73 passed.

- [ ] **Step 6: Commit**

```bash
git add src/govbudget/jbooks/p1_loader.py src/govbudget/cli.py tests/jbooks/test_p1_loader.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1b): p-1 rollup loader aggregating to bli grain

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live smoke — full defense-wide, both families (network + Postgres, manual)

- [ ] **Step 1: Re-register everything + load rollups**

```bash
uv run python -m govbudget jbooks scrape
uv run python -m govbudget jbooks acquire   # ~34 books, 5-15MB each; failures print + exit 1
uv run python -m govbudget jbooks load-rollups; echo "exit=$?"
```

Expected: scrape re-registers the rows trimmed during the 1A smoke; acquire downloads the rest (already-downloaded docs are not status='registered', so only new ones fetch); load-rollups now loads r1 AND p1/p1r (expect tens of thousands of P-1 BLI-grain rows). Record org-vocabulary check: `psql govbudget -c "select distinct organization from budget_lines where exhibit='P-1' limit 15"` — compare to `select distinct org from jbook_documents where exhibit_family='procurement'`. Mismatches will surface as Gate B "no P-1 row" queue items — record the mapping gaps; if widespread, STOP and report (org aliasing becomes a tracked fix) rather than accepting noise.

- [ ] **Step 2: Extract everything**

```bash
uv run python -m govbudget jbooks extract
```

Expected: one line per document with reconcile counters + gaps. RDT&E orgs should look like DARPA's run (high pass rates, zero-absent rule covering empty cells). Procurement: CBDP's two BLIs should reconcile against the P-1 sums.

- [ ] **Step 3: Review triage** — `uv run python -m govbudget review list`. Investigate every Gate B failure class before accepting; accept structural ones with reasons.

- [ ] **Step 4: Acceptance gates across the full scope**

```bash
ORGS=$(/opt/homebrew/opt/postgresql@17/bin/psql govbudget -tA -c "select string_agg(distinct org, ',') from jbook_documents where has_embedded_xml and status='downloaded' and exhibit_family='rdte'")
uv run python -m govbudget verify-phase1 --orgs "$ORGS"; echo "exit=$?"
```

Expected: coverage ≥99% (gaps rows make legitimate holes explicit), accuracy silent=0, provenance 50/50, PASS. Orgs whose jbook name doesn't match the R-1 organization column will show 0/0 coverage — record them; their PEs are still extracted and reconciled (Gate B scoping uses the same org string, so they will be queue-visible, not silent).

- [ ] **Step 5: Commit smoke record**

```bash
git add -A data/manifest.jsonl docs 2>/dev/null
git commit --author="Andes Lee <andes.lee444@gmail.com>" --allow-empty -m "chore(phase1b): record defense-wide smoke outcomes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Body should record: docs acquired, extraction pass rates per family, org-vocabulary mismatches found, verify-phase1 output.)

---

## Self-Review Notes

- **Spec §8 coverage:** item 1 (scenario lifecycle) → Task 1; item 2 (gaps producer) → Task 2; item 3 (P-1/P-1R loaders) → Task 5; item 4 (procurement Tier 0) → Tasks 3–4; item 5 (sentinel rows) → Task 2 step 4; item 6 (acquire idempotency / review --id) → NOT in 1B (cleanup; tracked for 1C alongside crosswalk, marts, Tier 1 eval, Army, gates 5–6).
- **Type consistency:** `parse_p40_xml -> list[ProcurementLineRecord]` consumed by `load_procurement_details`; `_parse_funding/_child/_text/_local` imported from xml_parser (they exist there with those names); `load_p1_rollup(dsn, xlsx_path, *, exhibit, fiscal_year, source_document_id=None) -> int` mirrors `load_rollup`; `record_extraction_gaps(dsn, *, document_id) -> int` used in CLI and tests; `DESIGN_EXCLUDED_SCENARIOS` exported from reconcile.
- **Known judgment calls:** P-1 'Add/Non-Add' filter assumes the literal values seen in recon ('Add'/'Non-Add' — case-insensitive match used); org-vocabulary mismatches between jbook filenames and workbook Organization columns are expected for some defense-wide agencies and are queue-visible/recorded, never silent; the unlabeled FY-2026-Reconciliation pair is excluded by the `.endswith(" Amount")` filter by construction.
