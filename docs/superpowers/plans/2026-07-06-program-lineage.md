# Program Lineage (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only; never
> weaken gates — fix data instead; TDD; every new gate leg ships with recorded
> proof-it-can-fail in `docs/superpowers/reviews/5c-gates-pre-failure.txt`. Sequential
> execution only (shared DuckDB warehouse + git index + site build); pgrep-quiet before
> builds. `.env` is gitignored — never print or commit its values. Python 3.12 via `uv`;
> dbt runs `uv run dbt build --project-dir dbt --profiles-dir dbt`; site is Next.js static
> export in `site/` (npm). The one known pre-existing pytest state is now clean (1,282/0).

**Goal:** Ship an evidence-tiered program-lineage layer so a user can follow one funded
activity across all the PE/BLI identities it wore over time (transfer / split / merge /
BA-maturation / rename), with Stated links cited to the source sentence and Inferred links
clearly flagged as unverified.

**Architecture:** A new `src/govbudget/lineage/` module extracts **Stated** edges (regex
over `detail_narratives.body`, each citing its sentence+page+fact_id) and builds
**Inferred** edges (deterministic, from `fct_decade_series`/`fct_budget_trajectory`/
`fct_book_diff`). Edges land in a Postgres `program_lineage` table; a Python union-find
computes `program_family` (connected components over Stated edges only). Both export to the
parquet lake; the site exporter emits per-program lineage sidecars; the program page gains
a `data-section="lineage"` rail + a Stated-1:1 family funding line; `/years/` threads
family rows. A new `verify-lineage` CLI gate + a render-static leg enforce the honesty
contract.

**Tech Stack:** Python/psycopg/DuckDB, dbt, Next.js/React/TypeScript, the existing `<Cite>`
+ cite-shards citation infra, the `/years/` matrix, the 22-gate npm suite.

**Spec:** `docs/superpowers/specs/2026-07-06-program-lineage-design.md` (read first — §5
honesty rules are the acceptance bar).

---

### Task 1: Migration + Stated-edge extractor (TDD)

**Files:**
- Create: `migrations/008_program_lineage.sql`
- Create: `src/govbudget/lineage/__init__.py` (empty)
- Create: `src/govbudget/lineage/model.py` (the `LineageEdge` dataclass)
- Create: `src/govbudget/lineage/extract.py`
- Test: `tests/lineage/__init__.py` (empty), `tests/lineage/test_extract.py`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/008_program_lineage.sql
create table if not exists program_lineage (
    id              bigserial primary key,
    from_pe_bli     text not null,
    to_pe_bli       text not null,
    fiscal_year     int  not null,
    relation        text not null check (relation in
                       ('matured_ba','realigned','split','merged','renamed','appropriation_transfer')),
    portion_amount  numeric,                 -- $thousands moved, when stated; else null
    confidence      text not null check (confidence in ('stated','inferred')),
    evidence_fact_id  text,                  -- stated only: the cited narrative fact_id
    evidence_sentence text,                  -- stated only: the verbatim source sentence
    evidence_page     int,                   -- stated only: PDF page
    inference_basis text check (inference_basis in
                       ('ba_maturation_same_title','funding_handoff','title_continuity')),
    unique (from_pe_bli, to_pe_bli, fiscal_year, relation, confidence)
);
create index if not exists ix_lineage_from on program_lineage(from_pe_bli);
create index if not exists ix_lineage_to   on program_lineage(to_pe_bli);
```

- [ ] **Step 2: Write the failing extractor test**

```python
# tests/lineage/test_extract.py
from govbudget.lineage.extract import extract_stated_edges
from govbudget.lineage.model import LineageEdge

def test_extracts_transferred_from_as_predecessor_edge():
    narr = [{"pe_bli": "0604294D8Z", "fiscal_year": 2019, "fact_id": "abc123",
             "page": 114,
             "body": "Program Change Summary: $62.4M was transferred from PE 0603826D "
                     "(Advanced Sensor Technology) to consolidate the effort."}]
    edges = extract_stated_edges(narr)
    assert LineageEdge(from_pe_bli="0603826D", to_pe_bli="0604294D8Z", fiscal_year=2019,
                       relation="realigned", confidence="stated",
                       evidence_fact_id="abc123", evidence_page=114,
                       evidence_sentence="$62.4M was transferred from PE 0603826D "
                       "(Advanced Sensor Technology) to consolidate the effort.",
                       portion_amount=None, inference_basis=None) in edges

def test_transferred_to_is_successor_direction():
    narr = [{"pe_bli": "0603178C", "fiscal_year": 2018, "fact_id": "f2", "page": 9,
             "body": "This work was transferred to PE 0603294C in FY2018."}]
    edges = extract_stated_edges(narr)
    assert edges[0].from_pe_bli == "0603178C" and edges[0].to_pe_bli == "0603294C"

def test_ignores_self_reference_and_non_pe_tokens():
    narr = [{"pe_bli": "0602702E", "fiscal_year": 2024, "fact_id": "f3", "page": 3,
             "body": "Funds transferred to O&M; PE 0602702E continues research."}]
    assert extract_stated_edges(narr) == []  # 'O&M' is not a PE; self-ref dropped
```

- [ ] **Step 3: Run it — Expected: FAIL (`ModuleNotFoundError: govbudget.lineage.extract`)**

Run: `uv run pytest tests/lineage/test_extract.py -q`

- [ ] **Step 4: Implement `model.py` then `extract.py`**

```python
# src/govbudget/lineage/model.py
from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class LineageEdge:
    from_pe_bli: str
    to_pe_bli: str
    fiscal_year: int
    relation: str            # matured_ba|realigned|split|merged|renamed|appropriation_transfer
    confidence: str          # stated|inferred
    evidence_fact_id: str | None = None
    evidence_sentence: str | None = None
    evidence_page: int | None = None
    portion_amount: float | None = None
    inference_basis: str | None = None
```

```python
# src/govbudget/lineage/extract.py
"""Stated-edge extraction: verb + adjacent `PE ####` token in R-2/P-40 narratives.

Precision over recall by design (spec §4): a wrong lineage is worse than none, so we
only mint an edge when a transfer verb sits next to an explicit PE token. The ~1,950
prose transfers without an adjacent PE code are left for the Inferred tier / Phase-2 LLM.
"""
from __future__ import annotations
import re
from govbudget.lineage.model import LineageEdge

# A PE token: 7 digits + 0-3 service/agency letters (e.g. 0604294D8Z, 1203154SF, 0603826D).
_PE = r"(\d{7}[A-Z]{0,3})"
# Sentence splitter (keep it simple; DoD prose is period-delimited).
_SENT = re.compile(r"[^.]*\.")

# (verb pattern, direction) — direction 'pred' => matched PE is the predecessor (from),
# 'succ' => matched PE is the successor (to). relation is the classifier.
_RULES = [
    (re.compile(r"transferred?\s+from\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "realigned"),
    (re.compile(r"realign\w*\s+from\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "realigned"),
    (re.compile(r"previously\s+(?:funded|budgeted)\s+(?:in|under)\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "renamed"),
    (re.compile(r"formerly\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "renamed"),
    (re.compile(r"transferred?\s+to\s+(?:PE|program element)\s+" + _PE, re.I), "succ", "realigned"),
    (re.compile(r"realign\w*\s+to\s+(?:PE|program element)\s+" + _PE, re.I), "succ", "realigned"),
]

def extract_stated_edges(narratives: list[dict]) -> list[LineageEdge]:
    """narratives: dicts with pe_bli, fiscal_year, fact_id, page, body."""
    out: list[LineageEdge] = []
    seen: set[tuple] = set()
    for n in narratives:
        this = n["pe_bli"]
        body = n.get("body") or ""
        for sent in _SENT.findall(body):
            for rx, direction, relation in _RULES:
                for m in rx.finditer(sent):
                    other = m.group(1)
                    if not other or other == this:
                        continue
                    frm, to = (other, this) if direction == "pred" else (this, other)
                    key = (frm, to, n["fiscal_year"], relation)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(LineageEdge(
                        from_pe_bli=frm, to_pe_bli=to, fiscal_year=n["fiscal_year"],
                        relation=relation, confidence="stated",
                        evidence_fact_id=n.get("fact_id"), evidence_page=n.get("page"),
                        evidence_sentence=sent.strip(), portion_amount=None,
                        inference_basis=None))
    return out
```

- [ ] **Step 5: Run — Expected PASS.** `uv run pytest tests/lineage/test_extract.py -q`

- [ ] **Step 6: Commit**

```bash
git add migrations/008_program_lineage.sql src/govbudget/lineage/__init__.py \
  src/govbudget/lineage/model.py src/govbudget/lineage/extract.py \
  tests/lineage/__init__.py tests/lineage/test_extract.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "feat(lineage): program_lineage table + stated-edge regex extractor" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Inferred-edge builder (deterministic, TDD)

**Files:**
- Create: `src/govbudget/lineage/infer.py`
- Test: `tests/lineage/test_infer.py`

- [ ] **Step 1: Failing test**

```python
# tests/lineage/test_infer.py
from govbudget.lineage.infer import infer_edges

def test_ba_maturation_same_title_hands_off_funding():
    # 0603ABC (BA3) title matches 0604ABC (BA4); 0603 request tapers as 0604 rises.
    series = [
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2025, "kind": "request", "amount": 5.0},
        {"pe_bli": "0604ABC", "title": "Widget Science", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    edges = infer_edges(series)
    e = [x for x in edges if x.from_pe_bli == "0603ABC" and x.to_pe_bli == "0604ABC"]
    assert e and e[0].confidence == "inferred" and e[0].relation == "matured_ba"
    assert e[0].inference_basis == "ba_maturation_same_title"
    assert e[0].evidence_fact_id is None  # inferred edges are never cited

def test_no_edge_when_titles_differ():
    series = [
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "0604XYZ", "title": "Unrelated Gadget", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    assert infer_edges(series) == []
```

- [ ] **Step 2: Run — Expected FAIL** (`govbudget.lineage.infer` missing).
  `uv run pytest tests/lineage/test_infer.py -q`

- [ ] **Step 3: Implement**

```python
# src/govbudget/lineage/infer.py
"""Deterministic Inferred edges (spec §4). NEVER cited, NEVER summed into a total.

- ba_maturation_same_title: 06Nxxx… and 06(N+1)xxx… (or ...Nxxx→...(N+1)xxx) share a
  normalized title across adjacent budget activities, with the predecessor's request
  tapering as the successor's rises (a funding hand-off).
"""
from __future__ import annotations
import re
from govbudget.lineage.model import LineageEdge

def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()

def _ba_digit(pe: str) -> int | None:
    # RDT&E PE: 4th char is the budget activity (06[BA]xxx…). Return BA or None.
    m = re.match(r"\d{2}(\d)\d{4}", pe)
    return int(m.group(1)) if m else None

def infer_edges(series: list[dict]) -> list[LineageEdge]:
    """series rows: pe_bli, title, fy, kind ('request'), amount ($M)."""
    req = [r for r in series if r.get("kind") == "request"]
    by_title: dict[str, list[dict]] = {}
    for r in req:
        by_title.setdefault(_norm_title(r["title"]), []).append(r)
    out: list[LineageEdge] = []
    for title, rows in by_title.items():
        if not title:
            continue
        pes = {r["pe_bli"] for r in rows}
        for frm in pes:
            fba = _ba_digit(frm)
            if fba is None:
                continue
            for to in pes:
                tba = _ba_digit(to)
                if to == frm or tba is None or tba != fba + 1:
                    continue
                # funding hand-off: predecessor tapering AND successor rising in a shared FY
                frm_by_fy = {r["fy"]: r["amount"] for r in rows if r["pe_bli"] == frm}
                to_by_fy = {r["fy"]: r["amount"] for r in rows if r["pe_bli"] == to}
                handoff_fy = next((fy for fy in sorted(to_by_fy)
                                   if to_by_fy[fy] > 0 and frm_by_fy.get(fy, 0) < frm_by_fy.get(fy - 1, 1e9)), None)
                if handoff_fy is None:
                    continue
                out.append(LineageEdge(
                    from_pe_bli=frm, to_pe_bli=to, fiscal_year=handoff_fy,
                    relation="matured_ba", confidence="inferred",
                    inference_basis="ba_maturation_same_title"))
    return out
```

- [ ] **Step 4: Run — Expected PASS.** `uv run pytest tests/lineage/test_infer.py -q`
- [ ] **Step 5: Commit**

```bash
git add src/govbudget/lineage/infer.py tests/lineage/test_infer.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "feat(lineage): deterministic inferred edges (BA-maturation + funding hand-off)" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: program_family (union-find over Stated edges) (TDD)

**Files:**
- Create: `src/govbudget/lineage/family.py`
- Test: `tests/lineage/test_family.py`

- [ ] **Step 1: Failing test**

```python
# tests/lineage/test_family.py
from govbudget.lineage.family import build_families, one_to_one_chain
from govbudget.lineage.model import LineageEdge

def _e(a, b, conf="stated", rel="renamed"):
    return LineageEdge(from_pe_bli=a, to_pe_bli=b, fiscal_year=2024, relation=rel, confidence=conf)

def test_families_are_connected_components_over_stated_edges_only():
    edges = [_e("A", "B"), _e("B", "C"), _e("X", "Y"),
             _e("C", "Q", conf="inferred")]  # inferred must NOT merge families
    fams = build_families(edges)             # {pe_bli: family_id}
    assert fams["A"] == fams["B"] == fams["C"]
    assert fams["X"] == fams["Y"] != fams["A"]
    assert "Q" not in fams                    # inferred edge did not create a family

def test_one_to_one_chain_excludes_splits_and_merges():
    # A->B is 1:1; B splits to C and D  => chain is [A, B], stops at the split.
    edges = [_e("A", "B"), _e("B", "C", rel="split"), _e("B", "D", rel="split")]
    assert one_to_one_chain("A", edges) == ["A", "B"]
```

- [ ] **Step 2: Run — Expected FAIL.** `uv run pytest tests/lineage/test_family.py -q`

- [ ] **Step 3: Implement**

```python
# src/govbudget/lineage/family.py
"""Program families = connected components over STATED edges only (spec §3).

The funding line (Task 5) sums only the 1:1 chain: a run of stated edges where each hop's
predecessor has exactly one stated out-edge and each successor exactly one stated in-edge,
and neither hop is a split/merge. This helper returns that chain from a start PE.
"""
from __future__ import annotations
from collections import defaultdict
from govbudget.lineage.model import LineageEdge

def build_families(edges: list[LineageEdge]) -> dict[str, int]:
    parent: dict[str, str] = {}
    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)
    for e in edges:
        if e.confidence != "stated":
            continue
        union(e.from_pe_bli, e.to_pe_bli)
    roots = {n: find(n) for n in parent}
    ids = {r: i for i, r in enumerate(sorted(set(roots.values())))}
    return {n: ids[r] for n, r in roots.items()}

def one_to_one_chain(start: str, edges: list[LineageEdge]) -> list[str]:
    stated = [e for e in edges if e.confidence == "stated"]
    out_deg: dict[str, int] = defaultdict(int)
    in_deg: dict[str, int] = defaultdict(int)
    nxt: dict[str, str] = {}
    for e in stated:
        out_deg[e.from_pe_bli] += 1
        in_deg[e.to_pe_bli] += 1
    for e in stated:
        if e.relation in ("split", "merged"):
            continue
        nxt.setdefault(e.from_pe_bli, e.to_pe_bli)
    chain = [start]
    cur = start
    while cur in nxt:
        succ = nxt[cur]
        if out_deg[cur] != 1 or in_deg[succ] != 1:
            break  # split (cur has >1 out) or merge (succ has >1 in) → stop honestly
        chain.append(succ); cur = succ
    return chain
```

- [ ] **Step 4: Run — Expected PASS.** `uv run pytest tests/lineage/test_family.py -q`
- [ ] **Step 5: Commit**

```bash
git add src/govbudget/lineage/family.py tests/lineage/test_family.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "feat(lineage): stated-only program families + 1:1 chain helper" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Load pipeline + CLI + parquet export (TDD)

**Files:**
- Create: `src/govbudget/lineage/load.py` (assemble edges from the warehouse, upsert)
- Modify: `src/govbudget/cli.py` (add `lineage build` subcommand)
- Modify: `src/govbudget/jbooks/export_facts.py` (add `program_lineage`, `program_family` to `EXPORTS`)
- Test: `tests/lineage/test_load.py` (throwaway PG DB, mirrors `tests/test_verify_phase5e.py` fixture style)

- [ ] **Step 1: Failing test** — seed 2 narratives + a tiny decade series in a throwaway
  PG DB (migrate via `jbooks.db.migrate`), run `build_lineage(dsn, duckdb_path)`, assert
  `program_lineage` holds the expected stated + inferred rows and no self-loops.

```python
# tests/lineage/test_load.py  (skip-if-no-PG, per tests/test_verify_phase5e.py pattern)
def test_build_lineage_persists_stated_and_inferred(pg_lineage, tmp_duck):
    from govbudget.lineage.load import build_lineage
    n = build_lineage(pg_lineage, tmp_duck)          # returns counts
    import psycopg
    with psycopg.connect(pg_lineage) as con:
        rows = con.execute("select from_pe_bli,to_pe_bli,confidence from program_lineage order by 1").fetchall()
    assert ("0603826D", "0604294D8Z", "stated") in rows
    assert any(c == "inferred" for *_ , c in rows)
    assert all(f != t for f, t, _ in rows)           # no self-loops
```

- [ ] **Step 2: Run — Expected FAIL** (`build_lineage` missing).
  `uv run pytest tests/lineage/test_load.py -q`

- [ ] **Step 3: Implement `load.py`** — read narratives (join `detail_narratives` →
  `jbook_documents` for fiscal_year, and the citations parquet/table for each narrative's
  `fact_id`+`page`), call `extract_stated_edges`; read the decade series from DuckDB
  (`select pe_bli, title, fy, amount_type_kind as kind, amount_thousands/1000.0 as amount
  from fct_decade_series where edition_year = 2026`), call `infer_edges`; **drop any
  inferred edge whose (from,to) already exists as a stated edge** (stated wins); upsert all
  into `program_lineage` (idempotent on the unique key); compute + persist `program_family`
  via `build_families`. Wire `cli.py`: `govbudget lineage build`.

- [ ] **Step 4: Add parquet exports** — in `export_facts.py` `EXPORTS`, add
  `"program_lineage": "select * from program_lineage"` and
  `"program_family": "select * from program_family"` (mirrors the existing `copy _t to
  parquet` loop). Run `uv run python -m govbudget jbooks export-facts`; confirm
  `data/parquet/.../program_lineage.parquet` exists.

- [ ] **Step 5: Run tests + live build**

```bash
uv run pytest tests/lineage/ -q          # all green
uv run python -m govbudget migrate       # apply 008
uv run python -m govbudget lineage build # populate warehouse
uv run python -m govbudget jbooks export-facts
```

- [ ] **Step 6: Commit** (explicit paths; new lineage rows are data — the parquet lake is
  gitignored, so commit only source + migration).

---

### Task 5: verify-lineage gate — built to FAIL first, then PASS (proof-can-fail)

**Files:**
- Create: `src/govbudget/verify_lineage.py` (+ CLI wiring in `cli.py`, mirror
  `verify_phase5e.py`)
- Test: `tests/test_verify_lineage.py`
- Append: `docs/superpowers/reviews/5c-gates-pre-failure.txt`

- [ ] **Step 1: Write the gate + failing unit tests.** Legs (spec §7):
  (a) **stated-cite**: every `program_lineage` row with `confidence='stated'` has an
  `evidence_fact_id` that resolves in the citations universe AND its `evidence_sentence`
  actually contains the `to`/`from` PE token (sample ≥30; FAIL if any doesn't resolve);
  (b) **family-integrity**: `program_family` == connected components over stated edges,
  recomputed by `build_families` on the live edges (FAIL on mismatch);
  (c) **one-to-one-sum**: for ≥10 families, the reconstructed funding total equals the sum
  of exactly the `one_to_one_chain` members' `fct_decade_series` request facts — a
  split/merge/inferred member in a summed total FAILS.
  Unit tests: seed a stated edge with a bogus `evidence_fact_id` → leg (a) FAILS; seed an
  inferred edge into a family total → leg (c) FAILS.

- [ ] **Step 2: Run the gate against the REAL warehouse — record the pre-implementation
  failure.** Before the exporter/site emit anything, run
  `uv run python -m govbudget verify-lineage`; it should FAIL cleanly on whatever isn't
  wired yet. Append the verbatim output to `5c-gates-pre-failure.txt` under
  "verify-lineage (program-lineage Task 5)" with today's date.

- [ ] **Step 3: Make it PASS** on the real warehouse (fix data/build, never weaken the
  gate). `uv run python -m govbudget verify-lineage` → PASS.

- [ ] **Step 4: Full pytest green.** `uv run pytest -q`
- [ ] **Step 5: Commit** (gate + tests + pre-failure record).

---

### Task 6: Exporter — lineage sidecars + cite-shards (TDD)

**Files:**
- Modify: `src/govbudget/export_site.py` (new `_emit_lineage()` + program-sidecar field)
- Test: `tests/jbooks/test_export_lineage.py` (throwaway PG + tmp lake, mirror
  `tests/jbooks/test_export_ingested_orgs.py`)

- [ ] **Step 1: Failing exporter test** — a program with a stated predecessor + an inferred
  successor emits a `lineage` sidecar block: `{rail: {predecessors:[{pe,title,ba,fy,
  relation,confidence,evidence:{fact_id,page,sentence}}], successors:[...]}, family:
  {family_id, funding_line:[{fy,v,fid}], chain:[pe,...], has_split:bool}}`. Assert: stated
  rail entries carry `evidence.fact_id`; inferred entries have `confidence:"inferred"` and
  `evidence:null`; `funding_line` sums only the `one_to_one_chain` members; every
  `funding_line[].fid` and every stated `evidence.fact_id` is emitted into the cite-shards.

- [ ] **Step 2: Run — Expected FAIL.** `uv run pytest tests/jbooks/test_export_lineage.py -q`

- [ ] **Step 3: Implement `_emit_lineage()`** — read `program_lineage`/`program_family`
  from the lake, build per-PE rail + family payloads (reuse `one_to_one_chain` for the
  funding line summed over `fct_decade_series` request facts; set `has_split` when the
  family has any `split`/`merged` edge or a stated node with out-degree>1). Attach the
  `lineage` block to each program sidecar. Ensure new `evidence_fact_id`s resolve as real
  citations (they already exist — they're the narrative fact_ids) so cite-shards cover them.

- [ ] **Step 4: Run tests + export.** `uv run pytest tests/jbooks/test_export_lineage.py -q`
  then `uv run python -m govbudget export-site`.
- [ ] **Step 5: Commit.**

---

### Task 7: Site — lineage rail + family funding line + render-static honesty leg (TDD)

**Files:**
- Create: `site/src/components/lineage/lineage-rail.tsx`, `.../family-funding-line.tsx`
- Create: `site/src/lib/lineage.ts` (payload types + `hasLineage()`)
- Modify: `site/src/app/program/[peBli]/page.tsx` (add the `data-section="lineage"` block
  in the canonical section order — it currently renders 12 blocks; insert lineage after
  "Trajectory")
- Modify: `site/scripts/gates/render-static.mjs` (new honesty leg)
- Test: `site/src/components/lineage/*.test.tsx` (vitest), pre-failure record

- [ ] **Step 1: Failing vitest** — `LineageRail` renders stated links with a dotted-underline
  `<Cite>` (clickable → citation) and inferred links with `data-inferred="true"` + a
  visible "candidate (unverified)" label + dashed styling; `FamilyFundingLine` renders a
  point per `funding_line` entry (each a `<Cite>`), a split marker when `has_split`, and
  NEVER a point for a non-chain member.

- [ ] **Step 2: Run — Expected FAIL.** `cd site && npx vitest run src/components/lineage`

- [ ] **Step 3: Implement** the two components + `lineage.ts`; wire the section into the
  program page (honest empty state when `!hasLineage()`, matching the other sections).

- [ ] **Step 4: render-static honesty leg (proof-can-fail).** Add a leg to
  `render-static.mjs`: scan built `out/program/*/index.html`; every element carrying a
  lineage inferred edge must have `data-inferred="true"` and the "candidate/unverified"
  text; FAIL if any inferred lineage link renders as a bare fact (no flag). Record the
  pre-failure (temporarily strip the flag in a scratch page → leg FAILs) in
  `5c-gates-pre-failure.txt`, then restore.

- [ ] **Step 5: vitest + tsc green.** `cd site && npx vitest run && npx tsc --noEmit`
- [ ] **Step 6: Commit.**

---

### Task 8: Threaded /years/ matrix + build + judging + deploy

**Files:**
- Modify: `site/src/components/years-matrix.tsx` (family thread affordance), its vitest
- Modify: `docs/superpowers/ROADMAP.md` (ledger row + findings)

- [ ] **Step 1: Failing vitest** — rows whose PEs share a `family_id` render a family
  thread connector/badge (grouping affordance); a lone PE renders none. No new columns.
- [ ] **Step 2–3: Implement** (read `program_family` from the years payload — extend the
  exporter's years-matrix emit to include each program's `family_id`), tests green.
- [ ] **Step 4: Full build + gates.** pgrep-quiet, then
  `cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build`, then
  `NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify` → **22/22 + the new
  render-static leg**; `uv run python -m govbudget verify-lineage` PASS; `uv run pytest`
  green; vitest + tsc green.
- [ ] **Step 5: Visual judging** — capture the lineage rail (stated + inferred), the family
  funding line (with a split break), and a threaded /years/ view at 390/768/1440 → 3 opus
  judges (does the rail read as honest? do dashed candidates read as clearly-unverified?
  does the family line's honest break make sense?); median ≥4, ≤2 rounds.
- [ ] **Step 6: Deploy** (known drill: `out/.vercelignore` + `.vercel/project.json` +
  `vercel --prod --archive=tgz` from `site/out`); R2 sync (`upload_r2.sh --live` — no new
  PDFs expected, but keeps the belt-and-braces); live-verify a stated link opens its cited
  sentence in production and an inferred link is dashed/flagged.
- [ ] **Step 7: ROADMAP** ledger row + findings (extraction-probe reality: gold stated
  edges are few, inference gives coverage; the two-tier honesty model); note Phase 2
  (lineage Sankey + LLM-extracted stated edges) as a follow-on. Commit + push origin +
  subtree sync to the fiscalreceipts standalone.

---

## Phase 2 (deferred — separate spec/plan, NOT in this plan)
- Lineage **Sankey** at `/lineage/` or on program pages (reuse the `/flow/` renderer).
- **LLM extraction** over the ~1,950 prose transfers → more `stated` edges (uses the API;
  gated on an extraction-precision check).
- Cross-appropriation (RDT&E↔Procurement) money-color lineage.
