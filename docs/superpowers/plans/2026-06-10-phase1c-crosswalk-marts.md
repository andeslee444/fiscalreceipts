# Phase 1C: Crosswalk + Marts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect budget intent to actual spend: confidence-scored PE→award crosswalk, J-book facts exported into the DuckDB mart layer, the recon-request scenario made first-class, queue hygiene, and the Gate-6 holistic trace test green.

**Architecture:** Four increments: (1) `export-facts` writes live reconciled Postgres facts to `data/parquet/jbooks/` + dbt sources/marts; (2) `jbooks/crosswalk.py` joins budget accounts to award funding accounts via DuckDB (`federal_accounts_funding_this_award` carries `097-0400`-style codes matching `budget_lines.account`), scores confidence with title-token overlap, lands `budget_line_awards` in Postgres (migration 002); (3) reconcile gains derived `total − reconciliation_request` candidates + per-document check pruning; (4) `verify-phase1 --trace` implements Gate 6.

**Tech Stack:** unchanged. **Verified ground truth:** contracts parquet columns `treasury_accounts_funding_this_award` (semicolon-delimited TAS like `097-0400`), `federal_accounts_funding_this_award` (semicolon-delimited `agency-account` like `097-0400`), `transaction_description`, `prime_award_base_transaction_description`, `awarding_sub_agency_name`, `award_id_piid`, `recipient_name`, `recipient_uei`. DARPA budget_lines carry `account='0400'`; AppropriationCode 0400 ↔ federal account `097-0400`.

**Conventions:** as Phases 1A/1B (same commit author/trailer, run from GovBudget/, Postgres up). Baseline: `uv run pytest -q` → 81 passed. Branch: `govbudget-phase1c`.

**Recorded design decisions (user granted autonomous continuation):** crosswalk v1 is fully deterministic (account join + token overlap; no LLM — Claude-assisted adjudication deferred to Phase 2/3 where entity context improves it); crosswalk grain is prime award (`award_id_piid` aggregated), FY-scoped via the detail scenario→FY map; Gate-5 Tier-1 eval descoped with evidence (34/34 books embed XML; recorded in phase-gates doc).

---

### Task 1: Migration 002 + export-facts + dbt marts

**Files:**
- Create: `migrations/002_crosswalk.sql`, `src/govbudget/jbooks/export_facts.py`, `dbt/models/staging/stg_budget_lines.sql`, `dbt/models/staging/stg_budget_details.sql`, `dbt/models/marts/fct_budget_lines.sql`, `dbt/models/marts/dim_programs.sql`
- Modify: `src/govbudget/cli.py`, `dbt/models/sources.yml`
- Test: `tests/jbooks/test_export_facts.py`

- [ ] **Step 1: Write `migrations/002_crosswalk.sql`:**

```sql
create table if not exists budget_line_awards (
  id bigserial primary key,
  pe_bli text not null,
  exhibit text not null,
  fiscal_year int not null,
  organization text not null,
  award_piid text not null,
  recipient_name text,
  recipient_uei text,
  matched_obligation numeric,
  method text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  score numeric,
  rationale text,
  created_at timestamptz not null default now(),
  unique (pe_bli, exhibit, fiscal_year, award_piid)
);
```

- [ ] **Step 2: Write the failing test** (`tests/jbooks/test_export_facts.py`):

```python
from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.export_facts import export_facts
from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import reconcile_document
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def test_export_facts_writes_parquet(pg_dsn, tmp_path):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands)"
            " values ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    out = export_facts(pg_dsn, parquet_dir=tmp_path)
    assert sorted(p.name for p in out) == [
        "budget_line_awards.parquet", "budget_lines.parquet",
        "detail_narratives.parquet", "details.parquet",
    ]
    n = duckdb.sql(
        f"select count(*) from read_parquet('{tmp_path}/jbooks/budget_lines.parquet')"
    ).fetchone()[0]
    assert n == 1
    rec = duckdb.sql(
        f"select count(*) from read_parquet('{tmp_path}/jbooks/details.parquet')"
        " where reconciled"
    ).fetchone()[0]
    assert rec > 0
```

- [ ] **Step 3: Run** — FAIL (ModuleNotFoundError).

- [ ] **Step 4: Write `src/govbudget/jbooks/export_facts.py`:**

```python
"""Export live Postgres jbook facts to Parquet for the DuckDB mart layer."""
from pathlib import Path

import duckdb
import psycopg

EXPORTS: dict[str, str] = {
    "budget_lines": (
        "select exhibit, fiscal_year, account, account_title, organization,"
        " budget_activity, budget_activity_title, pe_bli, title, amount_type,"
        " amount_thousands from budget_lines"
    ),
    "details": (
        "select d.pe_bli, d.project_number, d.project_title, d.scenario,"
        " d.amount_millions, d.xml_path, d.reconciled, j.org, j.exhibit_family,"
        " j.fiscal_year, d.document_id"
        " from budget_line_details d join jbook_documents j on j.id=d.document_id"
        " where not d.superseded"
    ),
    "detail_narratives": (
        "select n.pe_bli, n.project_number, n.kind, n.title, n.body, n.xml_path,"
        " j.org, j.fiscal_year"
        " from detail_narratives n join jbook_documents j on j.id=n.document_id"
        " where not n.superseded"
    ),
    "budget_line_awards": (
        "select pe_bli, exhibit, fiscal_year, organization, award_piid,"
        " recipient_name, recipient_uei, matched_obligation, method, confidence,"
        " score, rationale from budget_line_awards"
    ),
}


def export_facts(dsn: str, *, parquet_dir: Path) -> list[Path]:
    out_dir = parquet_dir / "jbooks"
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    con = duckdb.connect()
    try:
        with psycopg.connect(dsn) as pg:
            for name, sql in EXPORTS.items():
                cur = pg.execute(sql)
                cols = [d.name for d in cur.description]
                rows = cur.fetchall()
                out = out_dir / f"{name}.parquet"
                con.execute("drop table if exists _t")
                placeholder_cols = ", ".join(f'"{c}"' for c in cols)
                con.execute(
                    f"create table _t ({', '.join(f'%s varchar' % () or '' for _ in [])})"
                    if False else
                    f"create table _t as select * from (values {('(' + ', '.join(['null']*len(cols)) + ')')}) t({placeholder_cols}) where 1=0"
                )
                if rows:
                    con.executemany(
                        f"insert into _t values ({', '.join(['?'] * len(cols))})", rows
                    )
                con.execute(
                    f"copy _t to '{out}' (format parquet, compression zstd)"
                )
                written.append(out)
    finally:
        con.close()
    return sorted(written)
```

NOTE — the `create table _t` line above is intentionally awkward to write generically; implement it as the simpler, correct form below (this is the authoritative version):

```python
                out = out_dir / f"{name}.parquet"
                con.execute("drop table if exists _t")
                col_defs = ", ".join(f'"{c}" varchar' for c in cols)
                con.execute(f"create table _t ({col_defs})")
                if rows:
                    con.executemany(
                        f"insert into _t values ({', '.join(['?'] * len(cols))})",
                        [[None if v is None else str(v) for v in row] for row in rows],
                    )
                con.execute(f"copy _t to '{out}' (format parquet, compression zstd)")
                written.append(out)
```

All-varchar export matches the Phase 0 convention (typing happens in dbt staging via try_cast). Booleans export as 'True'/'False' strings — staging casts with `lower(reconciled)='true'`.

- [ ] **Step 5: dbt.** Append to `dbt/models/sources.yml` under the existing `lake` source tables:

```yaml
      - name: jbook_budget_lines
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/jbooks/budget_lines.parquet')"
      - name: jbook_details
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/jbooks/details.parquet')"
      - name: jbook_narratives
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/jbooks/detail_narratives.parquet')"
      - name: jbook_awards
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/jbooks/budget_line_awards.parquet')"
```

`dbt/models/staging/stg_budget_lines.sql`:

```sql
select
    exhibit,
    cast(fiscal_year as integer) as fiscal_year,
    account,
    account_title,
    organization,
    budget_activity,
    budget_activity_title,
    pe_bli,
    title,
    amount_type,
    try_cast(amount_thousands as double) as amount_thousands
from {{ source('lake', 'jbook_budget_lines') }}
```

`dbt/models/staging/stg_budget_details.sql`:

```sql
select
    pe_bli,
    project_number,
    project_title,
    scenario,
    try_cast(amount_millions as double) as amount_millions,
    xml_path,
    lower(reconciled) = 'true' as reconciled,
    org,
    exhibit_family,
    cast(fiscal_year as integer) as fiscal_year
from {{ source('lake', 'jbook_details') }}
```

`dbt/models/marts/fct_budget_lines.sql`:

```sql
select * from {{ ref('stg_budget_lines') }}
```

`dbt/models/marts/dim_programs.sql`:

```sql
select
    pe_bli,
    org,
    exhibit_family,
    max(project_title) filter (where project_number is null) as title,
    count(distinct project_number) as project_count,
    sum(amount_millions) filter (where scenario = 'PriorYear' and project_number is null)
        as fy2024_actual_millions,
    bool_and(reconciled) as fully_reconciled
from {{ ref('stg_budget_details') }}
group by 1, 2, 3
```

`fct_budget_to_awards` arrives in Task 2 (needs the crosswalk table populated to be meaningful; the source is declared now).

- [ ] **Step 6: CLI.** Add to `cmd_jbooks` choices `"export-facts"` and branch:

```python
    elif args.action == "export-facts":
        from govbudget.jbooks.export_facts import export_facts

        out = export_facts(config.PG_DSN, parquet_dir=config.PARQUET_DIR.parent / "parquet")
        print("exported:", ", ".join(p.name for p in out))
```

Wait — `config.PARQUET_DIR` IS the parquet dir; use it directly: `export_facts(config.PG_DSN, parquet_dir=config.PARQUET_DIR)`. (The test passes tmp_path as parquet_dir and expects files under `tmp_path/jbooks/`.)

- [ ] **Step 7: Run** — `uv run pytest -q` (82 passed). Then `uv run python -m govbudget jbooks export-facts && uv run python -m govbudget build` — dbt builds green including the new staging/marts (jbook parquet exists from the live DB).

- [ ] **Step 8: Commit**

```bash
git add migrations/002_crosswalk.sql src/govbudget/jbooks/export_facts.py src/govbudget/cli.py dbt tests/jbooks/test_export_facts.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1c): export jbook facts to parquet, budget marts, crosswalk table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Crosswalk v1

**Files:**
- Create: `src/govbudget/jbooks/crosswalk.py`, `dbt/models/marts/fct_budget_to_awards.sql`
- Modify: `src/govbudget/cli.py`
- Test: `tests/jbooks/test_crosswalk.py`

- [ ] **Step 1: Write the failing test** (`tests/jbooks/test_crosswalk.py`) — uses a synthetic award parquet + live Postgres:

```python
from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.crosswalk import crosswalk_org

AWARD_COLS = (
    "contract_transaction_unique_key, award_id_piid, federal_action_obligation,"
    " federal_accounts_funding_this_award, transaction_description,"
    " prime_award_base_transaction_description, recipient_name, recipient_uei,"
    " awarding_sub_agency_name, action_date"
)


def make_award_parquet(tmp_path: Path) -> Path:
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('K1','HR001124C0001','5000000','097-0400','DEFENSE RESEARCH SCIENCES SUPPORT',
           'BASIC RESEARCH MATH SCIENCES','ACME RESEARCH LLC','UEIDARPA1',
           'Defense Advanced Research Projects Agency','2024-03-01'),
          ('K2','HR001124C0002','100','021-2040','UNRELATED ARMY THING',
           'TANK PARTS','TANKCO','UEITANK','Dept of the Army','2024-04-01'),
          ('K3','HR001124C0003','750000','021-1319;097-0400','RESEARCH SUPPORT SERVICES',
           'SOMETHING ELSE ENTIRELY','BETA LABS','UEIBETA',
           'Defense Advanced Research Projects Agency','2024-05-01')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    return tmp_path


def seed_budget(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','DEFENSE RESEARCH SCIENCES',"
            " 'fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )


def test_crosswalk_matches_by_account_and_scores_confidence(pg_dsn, tmp_path):
    seed_budget(pg_dsn)
    lake = make_award_parquet(tmp_path)
    n = crosswalk_org(
        pg_dsn, organization="DARPA", treasury_agency="097",
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
    )
    assert n == 2  # K1 and K3 (097-0400 in accounts); K2 excluded
    with psycopg.connect(pg_dsn) as con:
        rows = {
            r[0]: r for r in con.execute(
                "select award_piid, confidence, recipient_name, matched_obligation"
                " from budget_line_awards where pe_bli='0601101E'"
            )
        }
    assert rows["HR001124C0001"][1] == "high"   # account + title-token overlap
    assert rows["HR001124C0003"][1] == "medium" # account + DARPA sub-agency only
    assert rows["HR001124C0001"][3] == Decimal("5000000")


def test_crosswalk_is_idempotent(pg_dsn, tmp_path):
    seed_budget(pg_dsn)
    lake = make_award_parquet(tmp_path)
    kwargs = dict(organization="DARPA", treasury_agency="097",
                  award_glob=str(lake / "contracts" / "*" / "*.parquet"))
    crosswalk_org(pg_dsn, **kwargs)
    crosswalk_org(pg_dsn, **kwargs)
    with psycopg.connect(pg_dsn) as con:
        n = con.execute("select count(*) from budget_line_awards").fetchone()[0]
    assert n == 2
```

- [ ] **Step 2: Run** — FAIL (ModuleNotFoundError).

- [ ] **Step 3: Write `src/govbudget/jbooks/crosswalk.py`:**

```python
"""Deterministic budget-line -> award crosswalk (v1).

Method 1 (account): an award qualifies as a candidate for a budget line when
the line's federal account (e.g. 097-0400) appears in the award's
federal_accounts_funding_this_award list. Method 2 (token overlap): candidate
confidence is raised to 'high' when PE/title tokens overlap the award's
descriptions. Everything lands in budget_line_awards with method + confidence;
nothing is asserted silently. v1 is LLM-free by design (recorded decision).
"""
import re
from collections import Counter

import duckdb
import psycopg

STOPWORDS = {
    "the", "and", "for", "of", "to", "in", "a", "support", "services", "service",
    "program", "research", "development", "defense", "system", "systems",
}


def _tokens(text: str | None) -> set[str]:
    if not text:
        return set()
    return {
        t for t in re.split(r"[^a-z0-9]+", text.lower())
        if len(t) > 3 and t not in STOPWORDS
    }


def crosswalk_org(
    dsn: str, *, organization: str, treasury_agency: str, award_glob: str,
    min_overlap: int = 2,
) -> int:
    """Crosswalk all of one organization's budget lines against the award lake.

    Returns the number of (pe_bli, award) links upserted.
    """
    with psycopg.connect(dsn) as pg:
        lines = pg.execute(
            "select distinct pe_bli, exhibit, fiscal_year, account, title"
            " from budget_lines where organization=%s",
            (organization,),
        ).fetchall()
        titles = {
            (r[0] or "", r[1] or ""): None
            for r in pg.execute(
                "select pe_bli, project_title from budget_line_details"
                " where not superseded",
            )
        }
    title_tokens: dict[str, set[str]] = {}
    for pe_bli, proj_title in titles:
        title_tokens.setdefault(pe_bli, set()).update(_tokens(proj_title))

    con = duckdb.connect()
    upserts = 0
    try:
        for pe_bli, exhibit, fy, account, line_title in lines:
            fed_account = f"{treasury_agency}-{account}"
            rows = con.execute(
                f"""
                select award_id_piid,
                       any_value(recipient_name),
                       any_value(recipient_uei),
                       sum(try_cast(federal_action_obligation as double)),
                       any_value(transaction_description),
                       any_value(prime_award_base_transaction_description),
                       any_value(awarding_sub_agency_name)
                from read_parquet('{award_glob}', union_by_name=true)
                where federal_accounts_funding_this_award like '%{fed_account}%'
                  and award_id_piid is not null and award_id_piid <> ''
                group by award_id_piid
                """
            ).fetchall()
            pe_tokens = _tokens(line_title) | title_tokens.get(pe_bli, set())
            with psycopg.connect(dsn) as pg:
                for piid, rname, ruei, obligation, desc1, desc2, sub_agency in rows:
                    award_tokens = _tokens(desc1) | _tokens(desc2)
                    overlap = len(pe_tokens & award_tokens)
                    org_in_subagency = organization.lower() in (sub_agency or "").lower() or (
                        sub_agency or ""
                    ).lower().find("advanced research projects") >= 0 and organization == "DARPA"
                    if overlap >= min_overlap:
                        confidence, method = "high", "account+tokens"
                        rationale = f"account {fed_account}; token overlap {overlap}"
                    elif org_in_subagency:
                        confidence, method = "medium", "account+subagency"
                        rationale = f"account {fed_account}; sub-agency {sub_agency}"
                    else:
                        confidence, method = "low", "account"
                        rationale = f"account {fed_account} only"
                    pg.execute(
                        """
                        insert into budget_line_awards
                          (pe_bli, exhibit, fiscal_year, organization, award_piid,
                           recipient_name, recipient_uei, matched_obligation,
                           method, confidence, score, rationale)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (pe_bli, exhibit, fiscal_year, award_piid)
                        do update set confidence=excluded.confidence,
                                      method=excluded.method,
                                      score=excluded.score,
                                      rationale=excluded.rationale,
                                      matched_obligation=excluded.matched_obligation
                        """,
                        (pe_bli, exhibit, fy, organization, piid, rname, ruei,
                         obligation, method, confidence, overlap, rationale),
                    )
                    upserts += 1
    finally:
        con.close()
    return upserts
```

NOTE: account values come from our own loaders and `treasury_agency` from the CLI — not user input — but keep the LIKE pattern as-is and do NOT interpolate anything else into the DuckDB SQL.

- [ ] **Step 4: Run** — the confidence assertions are the tuning loop: if K3 lands `low` instead of `medium`, fix the sub-agency containment logic (the test's K3 sub-agency contains "Advanced Research Projects"). Iterate until 2 tests pass. Full suite 84 passed.

- [ ] **Step 5: `dbt/models/marts/fct_budget_to_awards.sql`:**

```sql
select
    a.pe_bli,
    a.exhibit,
    cast(a.fiscal_year as integer) as fiscal_year,
    a.organization,
    a.award_piid,
    a.recipient_name,
    a.recipient_uei,
    try_cast(a.matched_obligation as double) as matched_obligation,
    a.method,
    a.confidence,
    p.title as program_title
from {{ source('lake', 'jbook_awards') }} a
left join {{ ref('dim_programs') }} p
  on p.pe_bli = a.pe_bli
```

- [ ] **Step 6: CLI.** Add `crosswalk` action to `cmd_jbooks` (choices + branch):

```python
    elif args.action == "crosswalk":
        from govbudget.jbooks.crosswalk import crosswalk_org
        from govbudget.jbooks.orgs import workbook_org

        import psycopg

        with psycopg.connect(config.PG_DSN) as con:
            orgs = [r[0] for r in con.execute(
                "select distinct case when %s is not null then %s else organization end"
                " from budget_lines where organization <> ''",
                (args.org, args.org),
            )] if args.org else [r[0] for r in con.execute(
                "select distinct organization from budget_lines where organization <> ''"
            )]
        total = 0
        for org in sorted(set(workbook_org(o) for o in orgs)):
            n = crosswalk_org(
                config.PG_DSN, organization=org, treasury_agency="097",
                award_glob=str(config.PARQUET_DIR / "contracts" / "*" / "*.parquet"),
            )
            print(f"crosswalk {org}: {n} links")
            total += n
        print(f"crosswalk total: {total}")
```

(NOTE: treasury_agency 097 covers DoD-funded accounts; service-funded accounts like 021-2040 are out of scope until Army in a later phase.)

- [ ] **Step 7: Run** — `uv run pytest -q` (84) and live: `uv run python -m govbudget jbooks crosswalk --org DARPA` — expect hundreds-to-thousands of links (DARPA contracts cite 097-0400). Then `uv run python -m govbudget jbooks export-facts && uv run python -m govbudget build` — marts green.

- [ ] **Step 8: Commit**

```bash
git add src/govbudget/jbooks/crosswalk.py src/govbudget/cli.py dbt/models/marts/fct_budget_to_awards.sql tests/jbooks/test_crosswalk.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1c): deterministic budget-to-award crosswalk v1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Recon-request derived candidates + queue hygiene

**Files:**
- Modify: `src/govbudget/jbooks/reconcile.py`, `src/govbudget/cli.py`
- Test: `tests/jbooks/test_reconcile.py`

- [ ] **Step 1: Failing tests** (append to `tests/jbooks/test_reconcile.py`):

```python
def test_budget_year_one_matches_total_minus_recon(pg_dsn):
    # R-1 total carries a reconciliation-request slice the PB book excludes.
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        for amount_type, amt in (
            ("fy_2026_total", Decimal("661219")),
            ("fy_2026_reconciliation_request", Decimal("661219")),
        ):
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
            " and pe_bli='0601101E' and scenario='BudgetYearOne'"
        ).fetchone()
    # fixture BudgetYearOne=0.000 == total(661.219) - recon(661.219)
    assert check[0] is True
    assert "minus_recon" in check[1]


def test_rereconcile_prunes_stale_open_queue_items(pg_dsn):
    doc_id, run_id = seed(pg_dsn, Decimal("999999"))  # mismatch -> queue
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        before = con.execute(
            "select count(*) from review_queue where status='open'"
        ).fetchone()[0]
    assert before > 0
    # fix the control, re-reconcile same run: stale open items must vanish
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "update budget_lines set amount_thousands=%s where pe_bli='0601101E'",
            (Decimal("280494"),),
        )
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    with psycopg.connect(pg_dsn) as con:
        open_now = con.execute(
            "select count(*) from review_queue where status='open'"
        ).fetchone()[0]
        accepted_kept = con.execute(
            "select count(*) from review_queue where status='accepted'"
        ).fetchone()[0]
    assert open_now == 0
    assert accepted_kept == 0  # nothing was accepted in this test
```

- [ ] **Step 2: Run** — both FAIL (no derived candidate; stale queue items linger).

- [ ] **Step 3: Implement in `reconcile.py`.**

(a) Derived candidates — in the Gate B loop, after building `present`, add:

```python
            if scenario in ("BudgetYearOne", "BudgetYearOneBase"):
                total = by_type.get("fy_2026_total")
                recon = by_type.get("fy_2026_reconciliation_request")
                if total is not None and recon is not None:
                    present.append((
                        "fy_2026_total_minus_recon",
                        (total - recon) / Decimal(1000),
                    ))
```

and widen the Gate B control query's candidate list so those columns are fetched:

```python
            fetch_types = list(candidates) + [
                "fy_2026_total", "fy_2026_reconciliation_request",
            ]
            row = con.execute(
                "select amount_type, sum(amount_thousands) from budget_lines "
                "where pe_bli=%s and amount_type = any(%s) "
                "and exhibit=%s and organization=%s and fiscal_year=%s "
                "group by amount_type",
                (pe_bli, fetch_types, exhibit, org, fy),
            ).fetchall()
```

(`match` then naturally considers the derived candidate; detail strings name `fy_2026_total_minus_recon`.)

(b) Stale-queue pruning — at the top of `reconcile_document` (after the doc-info fetch), add:

```python
        # Re-reconciling replaces this document's verdicts: drop prior checks
        # and their UNRESOLVED queue items (resolved items keep their audit trail).
        con.execute(
            """
            delete from review_queue rq using reconciliation_checks c, extraction_runs r
            where rq.check_id = c.id and c.extraction_run_id = r.id
              and r.document_id = %s and rq.status = 'open'
            """,
            (document_id,),
        )
        con.execute(
            """
            delete from reconciliation_checks c using extraction_runs r
            where c.extraction_run_id = r.id and r.document_id = %s
              and not exists (select 1 from review_queue rq where rq.check_id = c.id)
            """,
            (document_id,),
        )
```

(c) `cmd_review` accept must require an id — in `cmd_review`:

```python
        elif args.review_action == "accept":
            if args.id is None:
                print("review accept requires --id")
                sys.exit(2)
```

- [ ] **Step 4: Run** — `uv run pytest -q` (86 passed; the accuracy-gate test and earlier reconcile tests must still pass — the pruning keeps resolved rows).

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/jbooks/reconcile.py src/govbudget/cli.py tests/jbooks/test_reconcile.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1c): recon-request derived candidates, queue pruning, review id guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Gate 6 holistic trace + live loop

**Files:**
- Create: `src/govbudget/jbooks/trace.py`
- Modify: `src/govbudget/cli.py` (verify-phase1 --trace), `src/govbudget/jbooks/verify.py` (nothing — trace is separate module)
- Test: `tests/jbooks/test_trace.py`

- [ ] **Step 1: Failing test** (`tests/jbooks/test_trace.py`) — synthetic end-to-end:

```python
from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.trace import trace_gate


def test_trace_gate_walks_all_hops(pg_dsn, tmp_path):
    # budget line + reconciled detail + crosswalk link + award row in the lake
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, status) values ('DARPA','rdte',2026,'d.pdf','u1','downloaded')"
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','DEFENSE RESEARCH SCIENCES',"
            "  'fy_2024_actuals',280494)"
        )
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions, status)"
            " values (%s,0,'{}','finished') ", (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path, reconciled)"
            " values (%s,%s,'0601101E','PriorYear',280.494,'ProgramElement[0]',true)",
            (run_id, doc_id),
        )
        con.execute(
            "insert into budget_line_awards (pe_bli, exhibit, fiscal_year, organization,"
            " award_piid, recipient_name, recipient_uei, matched_obligation, method,"
            " confidence, score, rationale) values"
            " ('0601101E','R-1',2026,'DARPA','HR001124C0001','ACME','UEI1',5000000,"
            "  'account+tokens','high',4,'test')"
        )
    lake = tmp_path / "contracts" / "fy=2024"
    lake.mkdir(parents=True)
    duckdb.sql(
        "copy (select * from (values ('HR001124C0001','ACME RESEARCH LLC','UEI1','5000000'))"
        " t(award_id_piid, recipient_name, recipient_uei, federal_action_obligation))"
        f" to '{lake}/part.parquet' (format parquet)"
    )
    result = trace_gate(
        pg_dsn, pe_blis=["0601101E"],
        award_glob=str(tmp_path / "contracts" / "*" / "*.parquet"),
    )
    assert result["traced"] == 1
    assert result["failed"] == []


def test_trace_gate_reports_missing_hops(pg_dsn, tmp_path):
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0699999E','fy_2024_actuals',1)"
        )
    result = trace_gate(
        pg_dsn, pe_blis=["0699999E"],
        award_glob=str(tmp_path / "nope" / "*.parquet"),
    )
    assert result["traced"] == 0
    assert result["failed"][0][0] == "0699999E"
    assert "detail" in result["failed"][0][1]  # first missing hop named
```

- [ ] **Step 2: Run** — FAIL (ModuleNotFoundError).

- [ ] **Step 3: Write `src/govbudget/jbooks/trace.py`:**

```python
"""Gate 6: the holistic trace — budget line -> reconciled detail -> crosswalk
-> award in the lake -> recipient. Every hop must be non-empty; the first
missing hop is reported by name."""
import duckdb
import psycopg


def trace_gate(dsn: str, *, pe_blis: list[str], award_glob: str) -> dict:
    traced = 0
    failed: list[tuple[str, str]] = []
    con = duckdb.connect()
    try:
        with psycopg.connect(dsn) as pg:
            for pe in pe_blis:
                line = pg.execute(
                    "select 1 from budget_lines where pe_bli=%s limit 1", (pe,)
                ).fetchone()
                if not line:
                    failed.append((pe, "budget_line missing"))
                    continue
                detail = pg.execute(
                    "select 1 from budget_line_details where pe_bli=%s"
                    " and not superseded and reconciled limit 1", (pe,)
                ).fetchone()
                if not detail:
                    failed.append((pe, "reconciled detail missing"))
                    continue
                links = pg.execute(
                    "select award_piid, confidence from budget_line_awards"
                    " where pe_bli=%s", (pe,)
                ).fetchall()
                if not links:
                    failed.append((pe, "crosswalk link missing"))
                    continue
                piids = [p for p, _ in links]
                try:
                    found = con.execute(
                        f"select count(*) from read_parquet('{award_glob}', union_by_name=true)"
                        " where award_id_piid = any(?) and recipient_name is not null",
                        [piids],
                    ).fetchone()[0]
                except duckdb.IOException:
                    found = 0
                if not found:
                    failed.append((pe, "award/recipient missing in lake"))
                    continue
                traced += 1
    finally:
        con.close()
    return {"traced": traced, "failed": failed}
```

- [ ] **Step 4: Run** — 88 passed.

- [ ] **Step 5: Wire `--trace` into `cmd_verify_phase1`:**

```python
    if args.trace:
        import psycopg

        from govbudget.jbooks.trace import trace_gate

        with psycopg.connect(config.PG_DSN) as con:
            sample = [r[0] for r in con.execute(
                """
                select pe_bli from budget_lines
                where organization='DARPA' and exhibit='R-1'
                  and amount_type='fy_2024_actuals'
                order by amount_thousands desc nulls last limit 5
                """
            )]
        t = trace_gate(
            config.PG_DSN, pe_blis=sample,
            award_glob=str(config.PARQUET_DIR / "contracts" / "*" / "*.parquet"),
        )
        print(f"gate 6 trace: {t['traced']}/{len(sample)} traced"
              + (f" failed: {t['failed']}" if t["failed"] else ""))
        ok = ok and t["traced"] == len(sample)
```

(insert before the final `print("verify-phase1: ...")`; restructure so `ok` is computed first, trace adjusts it, then the verdict prints and exits. Add `v.add_argument("--trace", action="store_true")`.)

- [ ] **Step 6: THE LOOP.** Live: `uv run python -m govbudget jbooks crosswalk --org DARPA && uv run python -m govbudget verify-phase1 --orgs DARPA --trace`. If trace < 5/5: inspect which hop failed for which PE, tune (token threshold, stopwords, or sample choice rationale — top-funded PEs must have contracts in loaded FYs; note FY2019-2026 lake completeness depends on the background sync). Iterate until `verify-phase1: PASS` with trace 5/5. Record each tuning change + rationale in the commit body.

- [ ] **Step 7: Full-scope gates + commit**

```bash
ORGS=$(/opt/homebrew/opt/postgresql@17/bin/psql govbudget -tA -c "select string_agg(distinct case org when 'CYBERCOM' then 'CYBER' when 'CHIPS' then 'OSD' when 'DPAP' then 'OSD' else org end, ',') from jbook_documents where has_embedded_xml and exhibit_family='rdte'")
uv run python -m govbudget verify-phase1 --orgs "$ORGS" --trace
git add src/govbudget/jbooks/trace.py src/govbudget/cli.py tests/jbooks/test_trace.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase1c): gate 6 holistic trace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Phase-gates doc item 1–4 ↔ Tasks 4, 1, 2, 3 respectively. Gate-5 descope recorded in phase-gates doc.
- Type consistency: `export_facts(dsn, *, parquet_dir) -> list[Path]`; `crosswalk_org(dsn, *, organization, treasury_agency, award_glob, min_overlap=2) -> int`; `trace_gate(dsn, *, pe_blis, award_glob) -> dict`; all consumed as defined in tests/CLI.
- Known judgment calls: all-varchar parquet export (typing in dbt, Phase 0 convention); crosswalk treasury_agency fixed at 097 (DoD) — service-funded accounts deferred; trace sample = top-5 funded DARPA PEs.
