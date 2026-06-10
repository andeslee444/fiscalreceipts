# Phase 2: Beneficiary Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canonical entity graph (who ultimately receives the money) + geography dims, with `verify-phase2` gates green per the phase-gates doc.

**Architecture:** Deterministic v1 built entirely from transaction-embedded fields (live recon: 100% of top-1000 recipients carry `recipient_parent_uei`; Boeing family = 83 UEIs under one parent name). A small Python normalizer produces family keys; dbt builds `dim_entities` (canonical families), `entity_xwalk` (UEI → canonical, method+confidence), and `dim_geography`; `verify-phase2` implements the five phase-gate checks including Boeing/Huntington-Ingalls golden merges.

**Recorded decisions (autonomous continuation):** (1) SAM extract DEFERRED — requires a user-registered api.data.gov key (account creation is the user's action); transaction parents meet every Phase 2 gate; SAM lands later as enrichment. (2) Splink DEFERRED unless the resolution gate fails the loop — deterministic parent-grouping + name normalization first, measured, then escalate only on evidence. (3) Geography grain v1 = state + congressional district from transaction columns.

**Conventions:** as prior phases. Baseline: `uv run pytest -q` → 90 passed. Branch `govbudget-phase2`.

---

### Task 1: Entity name normalizer

**Files:**
- Create: `src/govbudget/entities.py`
- Test: `tests/test_entities.py`

- [ ] **Step 1: Failing test** (`tests/test_entities.py`):

```python
from govbudget.entities import family_key, normalize_name


def test_normalize_strips_legal_noise():
    assert normalize_name("THE BOEING COMPANY") == "BOEING"
    assert normalize_name("BOEING COMPANY, THE (INC)") == "BOEING"
    assert normalize_name("Huntington Ingalls Industries, Inc") == "HUNTINGTON INGALLS INDUSTRIES"
    assert normalize_name("LOCKHEED MARTIN CORPORATION") == "LOCKHEED MARTIN"
    assert normalize_name("ACME RESEARCH, L.L.C.") == "ACME RESEARCH"


def test_family_key_prefers_parent_then_normalized_name():
    assert family_key(parent_uei="P1", parent_name="THE BOEING COMPANY",
                      recipient_uei="U1", recipient_name="BOEING DEFENSE") == ("uei", "P1")
    assert family_key(parent_uei=None, parent_name=None,
                      recipient_uei="U2", recipient_name="SOLO LLC") == ("name", "SOLO")
    assert family_key(parent_uei=None, parent_name="ORPHAN PARENT INC",
                      recipient_uei="U3", recipient_name="X") == ("name", "ORPHAN PARENT")


def test_distinct_parents_same_normalized_name_share_family():
    # Two parent UEIs whose names normalize identically belong to one family
    # at the NAME level — the dbt layer merges via normalized parent name.
    assert normalize_name("THE BOEING COMPANY") == normalize_name("BOEING COMPANY, THE (INC)")
```

- [ ] **Step 2:** Run — ModuleNotFoundError.

- [ ] **Step 3:** Write `src/govbudget/entities.py`:

```python
"""Deterministic entity-name normalization for the beneficiary graph (v1).

Canonical family = parent UEI when present; otherwise normalized name.
The dbt layer additionally merges parent UEIs whose names normalize
identically (Boeing's 'THE BOEING COMPANY' vs 'BOEING COMPANY, THE (INC)').
Probabilistic matching (Splink) is deliberately deferred until a gate fails.
"""
import re

LEGAL_SUFFIXES = {
    "INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "LIMITED", "CORP",
    "CORPORATION", "CO", "COMPANY", "PLC", "GMBH", "SA", "AG", "PTY",
    "JV", "TRUST", "FOUNDATION",
}
_PUNCT = re.compile(r"[^A-Z0-9 ]+")
_SPACES = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    up = _PUNCT.sub(" ", (name or "").upper())
    tokens = [t for t in _SPACES.split(up) if t]
    while tokens and tokens[-1] in LEGAL_SUFFIXES:
        tokens.pop()
    if tokens and tokens[0] == "THE":
        tokens.pop(0)
    # handle ", THE" inversions that survive as a trailing THE
    while tokens and tokens[-1] == "THE":
        tokens.pop()
    return " ".join(tokens)


def family_key(
    *, parent_uei: str | None, parent_name: str | None,
    recipient_uei: str | None, recipient_name: str | None,
) -> tuple[str, str]:
    """(method, key): parent UEI when present; else normalized parent name;
    else normalized recipient name; else the recipient UEI itself."""
    if parent_uei:
        return ("uei", parent_uei)
    if parent_name and normalize_name(parent_name):
        return ("name", normalize_name(parent_name))
    if recipient_name and normalize_name(recipient_name):
        return ("name", normalize_name(recipient_name))
    return ("uei", recipient_uei or "UNKNOWN")
```

- [ ] **Step 4:** Run — tests pass; tune normalize until the goldens hold (e.g., "BOEING COMPANY, THE (INC)": INC stripped as suffix, trailing THE popped → "BOEING"). Full suite 93.

- [ ] **Step 5:** Commit `feat(phase2): entity name normalizer` (standard author/trailer).

---

### Task 2: Graph marts (dim_entities, entity_xwalk, dim_geography)

**Files:**
- Create: `src/govbudget/jbooks/entity_export.py` (no — entities are award-side; create `src/govbudget/entity_graph.py`), `dbt/models/marts/entity_xwalk.sql`, `dbt/models/marts/dim_entities.sql`, `dbt/models/marts/dim_geography.sql`
- Modify: `dbt/models/staging/stg_contracts.sql` + `stg_assistance.sql` (add district), `dbt/models/sources.yml` (entity_xwalk parquet source), `src/govbudget/cli.py`, `tests/test_dbt_build.py` (fixture columns)
- Test: `tests/test_entity_graph.py`

- [ ] **Step 1: Failing test** (`tests/test_entity_graph.py`):

```python
from pathlib import Path

import duckdb

from govbudget.entity_graph import build_entity_xwalk

AWARD_COLS = (
    "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name,"
    " federal_action_obligation"
)


def make_lake(tmp_path: Path) -> Path:
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('U1','BOEING DEFENSE SPACE','P1','THE BOEING COMPANY','100'),
          ('U2','BOEING AEROSPACE OPS','P2','BOEING COMPANY, THE (INC)','50'),
          ('U3','HII MISSION TECH','P3','HUNTINGTON INGALLS INDUSTRIES, INC','75'),
          ('U4','SOLO RESEARCH LLC',NULL,NULL,'10')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    return tmp_path


def test_build_entity_xwalk_merges_families(tmp_path):
    lake = make_lake(tmp_path)
    out = build_entity_xwalk(
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
        out_path=tmp_path / "entity_xwalk.parquet",
    )
    rows = duckdb.sql(f"select * from read_parquet('{out}')").fetchall()
    cols = [d[0] for d in duckdb.sql(f"describe select * from read_parquet('{out}')").fetchall()]
    by_uei = {r[cols.index("recipient_uei")]: r for r in rows}
    fam = cols.index("family_key")
    # P1 and P2 normalize to the same family name -> same canonical key
    assert by_uei["U1"][fam] == by_uei["U2"][fam] == "BOEING"
    assert by_uei["U3"][fam] == "HUNTINGTON INGALLS INDUSTRIES"
    assert by_uei["U4"][fam] == "SOLO RESEARCH"
    method = cols.index("method")
    assert by_uei["U1"][method] == "parent_name"
    assert by_uei["U4"][method] == "recipient_name"
```

- [ ] **Step 2:** Run — ModuleNotFoundError.

- [ ] **Step 3:** Write `src/govbudget/entity_graph.py`:

```python
"""Build the UEI -> canonical-family crosswalk parquet from the award lake."""
from pathlib import Path

import duckdb

from govbudget.entities import normalize_name


def build_entity_xwalk(*, award_glob: str, out_path: Path) -> Path:
    con = duckdb.connect()
    try:
        rows = con.execute(
            f"""
            select recipient_uei,
                   max(recipient_name) as recipient_name,
                   max(recipient_parent_uei) as parent_uei,
                   max(recipient_parent_name) as parent_name,
                   sum(try_cast(federal_action_obligation as double)) as total_obligation
            from read_parquet('{award_glob}', union_by_name=true)
            where recipient_uei is not null and recipient_uei <> ''
            group by recipient_uei
            """
        ).fetchall()
        out: list[tuple] = []
        for uei, rname, puei, pname, total in rows:
            if pname and normalize_name(pname):
                family, method = normalize_name(pname), "parent_name"
            elif puei:
                family, method = puei, "parent_uei"
            elif rname and normalize_name(rname):
                family, method = normalize_name(rname), "recipient_name"
            else:
                family, method = uei, "self_uei"
            confidence = "high" if method in ("parent_name", "parent_uei") else "medium"
            out.append((uei, rname, puei, pname, family, method, confidence, total))
        con.execute(
            "create table _x (recipient_uei varchar, recipient_name varchar,"
            " parent_uei varchar, parent_name varchar, family_key varchar,"
            " method varchar, confidence varchar, total_obligation double)"
        )
        con.executemany("insert into _x values (?,?,?,?,?,?,?,?)", out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        con.execute(f"copy _x to '{out_path}' (format parquet, compression zstd)")
    finally:
        con.close()
    return out_path
```

- [ ] **Step 4:** Run — pass (94). NOTE the family preference deviates from `family_key()` in Task 1 (name-first when parent_name exists, because cross-parent-UEI merges need the NAME level — record this in the module docstring; family_key remains the generic helper).

- [ ] **Step 5: dbt.** sources.yml add:

```yaml
      - name: entity_xwalk_src
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/entities/entity_xwalk.parquet')"
```

`dbt/models/marts/entity_xwalk.sql`:

```sql
select recipient_uei, recipient_name, parent_uei, parent_name,
       family_key, method, confidence,
       try_cast(total_obligation as double) as total_obligation
from {{ source('lake', 'entity_xwalk_src') }}
```

`dbt/models/marts/dim_entities.sql`:

```sql
select
    family_key,
    max(parent_name) as display_name,
    count(*) as uei_count,
    sum(total_obligation) as total_obligation,
    min(confidence) as worst_confidence
from {{ ref('entity_xwalk') }}
group by family_key
```

District columns: add to `stg_contracts.sql` and `stg_assistance.sql` select lists (before `pop_state`):

```sql
    prime_award_transaction_place_of_performance_cd_current as pop_district,
```

(both files — column verified present in both archive families via the data dictionary; the live smoke validates; if assistance lacks it, use `cast(null as varchar) as pop_district` there and report).

`dbt/models/marts/dim_geography.sql`:

```sql
select
    pop_state,
    pop_district,
    count(*) as transaction_count,
    sum(obligation) as total_obligation
from {{ ref('fct_award_transactions') }}
where pop_state is not null and pop_state <> ''
group by 1, 2
```

- [ ] **Step 6: CLI.** New top-level command `entity-graph`:

```python
def cmd_entity_graph(args) -> None:
    from govbudget.entity_graph import build_entity_xwalk

    out = build_entity_xwalk(
        award_glob=str(config.PARQUET_DIR / "contracts" / "*" / "*.parquet"),
        out_path=config.PARQUET_DIR / "entities" / "entity_xwalk.parquet",
    )
    print(f"entity-graph: wrote {out}")
```

register: `e = sub.add_parser("entity-graph", help="build uei->family crosswalk"); e.set_defaults(func=cmd_entity_graph)`.

- [ ] **Step 7:** Update `tests/test_dbt_build.py` make_lake: contracts/assistance fixtures gain the `prime_award_transaction_place_of_performance_cd_current` column (value 'CA-52' / 'MD-04'); add an `entities/entity_xwalk.parquet` fixture (one row, all 8 columns). Run `uv run pytest -q` (94) and live: `uv run python -m govbudget entity-graph && uv run python -m govbudget jbooks export-facts && uv run python -m govbudget build` — green.

- [ ] **Step 8:** Commit `feat(phase2): entity graph marts and geography dims`.

---

### Task 3: verify-phase2

**Files:**
- Create: `src/govbudget/verify_phase2.py`
- Modify: `src/govbudget/cli.py`
- Test: `tests/test_verify_phase2.py`

- [ ] **Step 1: Failing test:**

```python
from pathlib import Path

import duckdb

from govbudget.verify_phase2 import entity_gate, geography_gate, golden_gate


def make_marts(tmp_path: Path) -> Path:
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        """
        create table entity_xwalk as select * from (values
          ('U1','BOEING DEFENSE','P1','THE BOEING COMPANY','BOEING','parent_name','high',100.0),
          ('U2','BOEING AERO','P2','BOEING COMPANY, THE (INC)','BOEING','parent_name','high',50.0),
          ('U3','HII MISSION','P3','HUNTINGTON INGALLS INDUSTRIES, INC','HUNTINGTON INGALLS INDUSTRIES','parent_name','high',75.0),
          ('U4','MYSTERY','','','U4','self_uei','medium',10.0)
        ) t(recipient_uei, recipient_name, parent_uei, parent_name, family_key, method, confidence, total_obligation)
        """
    )
    con.execute(
        """
        create table fct_award_transactions as select * from (values
          ('K1','contract','CA','CA-52', 10.0),
          ('K2','contract','MD','MD-04', 20.0),
          ('K3','contract', null, null, 5.0)
        ) t(transaction_key, award_type, pop_state, pop_district, obligation)
        """
    )
    con.close()
    return db


def test_entity_gate(tmp_path):
    g = entity_gate(make_marts(tmp_path), top_n=4)
    assert g["resolved_pct"] == 75.0  # 3 of 4 via parent evidence
    assert g["top_n"] == 4


def test_golden_gate(tmp_path):
    g = golden_gate(make_marts(tmp_path))
    assert g["boeing_ueis"] == 2 and g["boeing_one_family"] is True
    assert g["hii_one_family"] is True


def test_geography_gate(tmp_path):
    g = geography_gate(make_marts(tmp_path))
    assert g["with_state"] == 2
    assert g["resolved_pct"] == 100.0  # both state-bearing rows have districts
```

- [ ] **Step 2:** Run — ModuleNotFoundError.

- [ ] **Step 3:** Write `src/govbudget/verify_phase2.py`:

```python
"""Phase 2 acceptance gates (phase-gates doc): entity resolution, golden
family merges, geography coverage. Runs against the DuckDB mart file."""
from pathlib import Path

import duckdb


def entity_gate(duckdb_path: Path, *, top_n: int = 1000) -> dict:
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        resolved, total = con.execute(
            f"""
            with top as (
              select * from entity_xwalk
              order by total_obligation desc nulls last limit {int(top_n)}
            )
            select count(*) filter (where method in ('parent_name','parent_uei','recipient_name')
                                    and family_key is not null and family_key <> recipient_uei),
                   count(*)
            from top
            """
        ).fetchone()
    finally:
        con.close()
    return {
        "top_n": total,
        "resolved": resolved,
        "resolved_pct": round(100.0 * resolved / total, 1) if total else 0.0,
    }


def golden_gate(duckdb_path: Path) -> dict:
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        boeing = con.execute(
            "select count(distinct recipient_uei), count(distinct family_key)"
            " from entity_xwalk where parent_name ilike '%boeing%'"
            " and parent_name not ilike '%bell boeing%'"
        ).fetchone()
        hii = con.execute(
            "select count(distinct family_key) from entity_xwalk"
            " where parent_name ilike 'huntington ingalls%'"
        ).fetchone()
    finally:
        con.close()
    return {
        "boeing_ueis": boeing[0],
        "boeing_one_family": boeing[1] == 1,
        "hii_one_family": hii[0] == 1,
    }


def geography_gate(duckdb_path: Path) -> dict:
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        with_state, with_district = con.execute(
            """
            select count(*) filter (where pop_state is not null and pop_state <> ''),
                   count(*) filter (where pop_state is not null and pop_state <> ''
                                    and pop_district is not null and pop_district <> '')
            from fct_award_transactions
            """
        ).fetchone()
    finally:
        con.close()
    return {
        "with_state": with_state,
        "with_district": with_district,
        "resolved_pct": round(100.0 * with_district / with_state, 1) if with_state else 0.0,
    }
```

- [ ] **Step 4:** Run — pass (97).

- [ ] **Step 5: CLI** `verify-phase2`:

```python
def cmd_verify_phase2(args) -> None:
    from govbudget.verify_phase2 import entity_gate, geography_gate, golden_gate

    e = entity_gate(config.DUCKDB_PATH)
    g = golden_gate(config.DUCKDB_PATH)
    geo = geography_gate(config.DUCKDB_PATH)
    print(f"gate e1 entities: {e['resolved']}/{e['top_n']} resolved ({e['resolved_pct']}%)")
    print(f"gate e2 goldens: boeing {g['boeing_ueis']} UEIs one_family={g['boeing_one_family']}"
          f" hii one_family={g['hii_one_family']}")
    print(f"gate e3 geography: {geo['with_district']}/{geo['with_state']}"
          f" ({geo['resolved_pct']}%) state-rows with districts")
    ok = (e["resolved_pct"] >= 95.0 and g["boeing_one_family"] and g["hii_one_family"]
          and geo["resolved_pct"] >= 99.0)
    print("verify-phase2:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
```

register: `v2 = sub.add_parser("verify-phase2", help="phase 2 acceptance gates"); v2.set_defaults(func=cmd_verify_phase2)`.

- [ ] **Step 6:** Commit `feat(phase2): verify-phase2 acceptance gates`.

---

### Task 4: Live loop until PASS + final review

- [ ] `uv run python -m govbudget entity-graph && uv run python -m govbudget build && uv run python -m govbudget verify-phase2` — THE LOOP: if any gate fails, diagnose (likely suspects: district column name variant in assistance archives → adjust staging with reported evidence; Boeing family split by a parent-name variant the normalizer misses → extend LEGAL_SUFFIXES/rules with a regression test; resolution % short → only then consider Splink). Iterate until PASS, recording every change.
- [ ] Full suite + `verify-phase1 --orgs DARPA --trace` still PASS (no regressions).
- [ ] Commit smoke record; final whole-implementation review (opus, range from branch base); fix anything blocking; merge to main + push.

## Self-Review Notes
- Gates ↔ phase-gates doc: e1=item 2 (≥95% top-1000), e2=item 3 (goldens), e3=item 4 (geography ≥99%); item 1 (SAM) recorded as deferred-with-evidence; item 5 (golden pytest corpus) = Tasks 1–3 tests.
- Type consistency: build_entity_xwalk(*, award_glob, out_path) -> Path; gates take duckdb_path. CLI binds config.
- Judgment calls: name-first family preference (cross-parent merges) recorded; district column name risk handled in the loop with evidence.
