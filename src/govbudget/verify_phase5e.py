"""Phase 5E acceptance gates: decade backfill (PB2017–PB2025 J-book editions).

Gates (CLI: verify-phase5e):
  1. edition_coverage_gate5e — target editions PB2017..PB2026. Each edition
     must be fully loaded (discovered document count > 0 AND every discovered
     document reached the terminal lifecycle state 'downloaded' AND
     reconciliation checks exist for the edition) OR appear in
     data/research/edition_manifest.json with a non-empty status and reason.
     A manifest-excused edition prints WARN with the reason but does not fail
     the gate (spec §2.3 — an honest gap, never a silent skip). An edition
     with neither data nor a valid manifest entry FAILS.

  2. leakage_gate5e — sample ≥200 budget_lines rows joined to their source
     jbook_documents; 100% must satisfy budget_lines.fiscal_year ==
     jbook_documents.fiscal_year. Editions are parallel worlds (spec §2.1/2.2)
     — a single cross-edition row is a FAIL.

  3. book_diff_gate5e — the fct_book_diff mart exists in the dbt DuckDB
     output; sample ≥20 rows with a non-null delta; each delta recomputes as
     to_value − from_value from the mart's own input columns within 0.001.
     FAIL if the mart is absent or empty (Task 5 must turn this green).

  4. decade_series_gate5e — the fct_decade_series mart exists;
     (pe_bli, fy, edition_year) is unique; sample ≥20 rows and recompute each
     amount from the parquet-lake budget_lines using the edition-relative
     scenario map (PriorYear=FY(N−2) actuals, CurrentYear=FY(N−1),
     BudgetYearOne=FY(N)). FAIL if the mart is absent.

All gate functions take explicit paths/DSNs — never read config.
No network access in any gate.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

# PB editions the decade backfill promises (spec §1).
TARGET_EDITIONS: tuple[int, ...] = tuple(range(2017, 2027))

# jbook_documents.status lifecycle: 'registered' → 'downloaded' | 'failed'.
# 'downloaded' is the only terminal success state the schema records.
TERMINAL_STATUS = "downloaded"

_TOL = Decimal("0.001")


def _sql_path(p) -> str:
    """Return a path string safe for embedding in DuckDB SQL string literals."""
    return str(p).replace("'", "''")


def _dec(value) -> Decimal | None:
    """Best-effort Decimal conversion (lake parquet is all-varchar)."""
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


# ---------------------------------------------------------------------------
# Gate 1: edition_coverage_gate5e
# ---------------------------------------------------------------------------


def edition_coverage_gate5e(
    dsn: str,
    manifest_path: Path,
    *,
    editions: tuple[int, ...] = TARGET_EDITIONS,
) -> dict:
    """Per-edition coverage: fully loaded OR manifest-excused with a reason.

    For each target edition:
      - discovered      = jbook_documents rows with that fiscal_year
      - terminal        = rows in the terminal 'downloaded' state
      - recon_checks    = reconciliation_checks joined through
                          extraction_runs → jbook_documents for that edition
      loaded  iff discovered > 0 AND discovered == terminal AND recon_checks > 0
      excused iff manifest editions[str(fy)] carries non-empty status + reason
      missing otherwise → gate FAIL

    Returns: ok, editions {fy: {discovered, terminal, recon_checks, state,
             status?, reason?}}, warns [(fy, status, reason)], failures [str],
             reason (structural failures only).
    """
    manifest_path = Path(manifest_path)
    manifest_editions: dict = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except Exception as e:
            return {
                "ok": False,
                "editions": {},
                "warns": [],
                "failures": [],
                "reason": f"edition manifest unparseable: {manifest_path}: {e}",
            }
        raw = manifest.get("editions", {})
        if not isinstance(raw, dict):
            return {
                "ok": False,
                "editions": {},
                "warns": [],
                "failures": [],
                "reason": f"edition manifest 'editions' is not an object: {manifest_path}",
            }
        manifest_editions = raw

    import psycopg

    with psycopg.connect(dsn) as con:
        by_fy_status: dict[tuple[int, str], int] = {
            (fy, status): n
            for fy, status, n in con.execute(
                "select fiscal_year, status, count(*) from jbook_documents"
                " group by 1, 2"
            )
        }
        recon_by_fy: dict[int, int] = {
            fy: n
            for fy, n in con.execute(
                """
                select d.fiscal_year, count(*)
                from reconciliation_checks rc
                join extraction_runs er on er.id = rc.extraction_run_id
                join jbook_documents d on d.id = er.document_id
                group by 1
                """
            )
        }

    per_edition: dict[int, dict] = {}
    warns: list[tuple[int, str, str]] = []
    failures: list[str] = []

    for fy in editions:
        discovered = sum(n for (f, _s), n in by_fy_status.items() if f == fy)
        terminal = by_fy_status.get((fy, TERMINAL_STATUS), 0)
        recon = recon_by_fy.get(fy, 0)
        row = {
            "discovered": discovered,
            "terminal": terminal,
            "recon_checks": recon,
        }

        loaded = discovered > 0 and discovered == terminal and recon > 0
        entry = manifest_editions.get(str(fy))

        if loaded:
            row["state"] = "loaded"
        elif entry is not None:
            status = (entry or {}).get("status") if isinstance(entry, dict) else None
            reason = (entry or {}).get("reason") if isinstance(entry, dict) else None
            if status and reason:
                row["state"] = "excused"
                row["status"] = status
                row["reason"] = reason
                warns.append((fy, status, reason))
            else:
                row["state"] = "missing"
                failures.append(
                    f"edition {fy}: manifest entry invalid — must carry a"
                    f" non-empty status and reason (got {entry!r})"
                )
        else:
            row["state"] = "missing"
            detail = []
            if discovered == 0:
                detail.append("no jbook_documents rows")
            else:
                if discovered != terminal:
                    detail.append(
                        f"{terminal}/{discovered} documents in terminal"
                        f" state '{TERMINAL_STATUS}'"
                    )
                if recon == 0:
                    detail.append("no reconciliation checks")
            failures.append(
                f"edition {fy}: not loaded ({'; '.join(detail)}) and not"
                f" excused in {manifest_path.name}"
            )

        per_edition[fy] = row

    return {
        "ok": len(failures) == 0,
        "editions": per_edition,
        "warns": warns,
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Gate 2: leakage_gate5e
# ---------------------------------------------------------------------------

_LEAKAGE_SAMPLE_SIZE = 200


def leakage_gate5e(dsn: str, *, sample_size: int = _LEAKAGE_SAMPLE_SIZE) -> dict:
    """No cross-edition leakage: sampled budget_lines rows carry the same
    fiscal_year as their source jbook_documents row. 100% required.

    Returns: ok, joinable, unjoined (informational), sampled,
             mismatch_count, mismatches [(budget_line_id, bl_fy, doc_fy)],
             reason (structural failures only).
    """
    import psycopg

    with psycopg.connect(dsn) as con:
        joinable = con.execute(
            """
            select count(*)
            from budget_lines bl
            join jbook_documents d on d.id = bl.source_document_id
            """
        ).fetchone()[0]
        unjoined = con.execute(
            "select count(*) from budget_lines where source_document_id is null"
        ).fetchone()[0]
        if joinable == 0:
            return {
                "ok": False,
                "joinable": 0,
                "unjoined": unjoined,
                "sampled": 0,
                "mismatch_count": 0,
                "mismatches": [],
                "reason": "no budget_lines rows join to jbook_documents — nothing to verify",
            }
        rows = con.execute(
            """
            select bl.id, bl.fiscal_year, d.fiscal_year
            from budget_lines bl
            join jbook_documents d on d.id = bl.source_document_id
            order by random()
            limit %s
            """,
            (sample_size,),
        ).fetchall()

    mismatches = [
        (bl_id, bl_fy, doc_fy) for bl_id, bl_fy, doc_fy in rows if bl_fy != doc_fy
    ]
    return {
        "ok": len(rows) > 0 and len(mismatches) == 0,
        "joinable": joinable,
        "unjoined": unjoined,
        "sampled": len(rows),
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:10],
    }


# ---------------------------------------------------------------------------
# Gate 3: book_diff_gate5e
# ---------------------------------------------------------------------------

_MART_SAMPLE_SIZE = 20


def _mart_exists(con, table_name: str) -> bool:
    return bool(
        con.execute(
            "select count(*) from information_schema.tables"
            " where table_schema = 'main' and table_name = ?",
            [table_name],
        ).fetchone()[0]
    )


def book_diff_gate5e(duckdb_path: Path, *, sample_size: int = _MART_SAMPLE_SIZE) -> dict:
    """fct_book_diff conservation: delta recomputes as to_value − from_value.

    Samples ≥sample_size rows with a non-null delta; each must carry non-null
    from_value/to_value and recompute within 0.001. FAIL if the mart is
    absent or empty — the mart is Task 5's deliverable and this gate must be
    red until it lands.

    Returns: ok, total_rows, sampled, passed, failures [(grain, reason)],
             reason (structural failures only).
    """
    duckdb_path = Path(duckdb_path)
    base = {"ok": False, "total_rows": 0, "sampled": 0, "passed": 0, "failures": []}
    if not duckdb_path.exists():
        return {**base, "reason": f"duckdb warehouse missing: {duckdb_path}"}

    import duckdb

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        if not _mart_exists(con, "fct_book_diff"):
            return {
                **base,
                "reason": "fct_book_diff mart absent — run the 5E dbt build (Task 5)",
            }
        total = con.execute("select count(*) from fct_book_diff").fetchone()[0]
        if total == 0:
            return {**base, "reason": "fct_book_diff mart is empty"}
        try:
            rows = con.execute(
                """
                select pe_bli, from_edition, to_edition, diff_kind,
                       from_value, to_value, delta
                from fct_book_diff
                where delta is not null
                order by random()
                limit ?
                """,
                [sample_size],
            ).fetchall()
        except duckdb.Error as e:
            return {
                **base,
                "total_rows": total,
                "reason": f"fct_book_diff missing contract columns: {e}",
            }
    finally:
        con.close()

    failures: list[tuple[str, str]] = []
    for pe_bli, from_ed, to_ed, kind, from_v, to_v, delta in rows:
        grain = f"{pe_bli} {from_ed}→{to_ed} {kind}"
        fd, td, dd = _dec(from_v), _dec(to_v), _dec(delta)
        if fd is None or td is None:
            failures.append(
                (grain, f"non-null delta with null/non-numeric inputs:"
                        f" from_value={from_v!r} to_value={to_v!r}")
            )
            continue
        if dd is None:
            failures.append((grain, f"delta not numeric: {delta!r}"))
            continue
        expected = td - fd
        if abs(dd - expected) > _TOL:
            failures.append(
                (grain, f"delta recompute mismatch: {to_v} − {from_v} ="
                        f" {expected} but delta={delta}")
            )

    sampled = len(rows)
    return {
        "ok": sampled > 0 and len(failures) == 0,
        "total_rows": total,
        "sampled": sampled,
        "passed": sampled - len(failures),
        "failures": failures,
        **({} if sampled else {"reason": "no fct_book_diff rows carry a non-null delta"}),
    }


# ---------------------------------------------------------------------------
# Gate 4: decade_series_gate5e
# ---------------------------------------------------------------------------


def decade_series_gate5e(
    duckdb_path: Path,
    lake_budget_lines: Path,
    *,
    sample_size: int = _MART_SAMPLE_SIZE,
) -> dict:
    """fct_decade_series integrity: unique grain + lake recompute.

    - (pe_bli, fy, edition_year) must be unique.
    - ≥sample_size sampled rows: amount recomputes from the parquet-lake
      budget_lines as the sum of amount_thousands for that edition's rows
      whose amount_type matches the edition-relative scenario slugs
      (reconcile.scenario_map — PASS if ANY candidate slug matches, same
      rule the reconciliation gate uses).
    FAIL if the mart is absent.

    Returns: ok, total_rows, duplicate_grains, sampled, passed,
             failures [(grain, reason)], reason (structural failures only).
    """
    duckdb_path = Path(duckdb_path)
    lake_budget_lines = Path(lake_budget_lines)
    base = {
        "ok": False,
        "total_rows": 0,
        "duplicate_grains": 0,
        "sampled": 0,
        "passed": 0,
        "failures": [],
    }
    if not duckdb_path.exists():
        return {**base, "reason": f"duckdb warehouse missing: {duckdb_path}"}

    import duckdb

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        if not _mart_exists(con, "fct_decade_series"):
            return {
                **base,
                "reason": "fct_decade_series mart absent — run the 5E dbt build (Task 5)",
            }
        total = con.execute("select count(*) from fct_decade_series").fetchone()[0]
        if total == 0:
            return {**base, "reason": "fct_decade_series mart is empty"}
        try:
            dupes = con.execute(
                """
                select count(*) from (
                  select pe_bli, fy, edition_year
                  from fct_decade_series
                  group by 1, 2, 3
                  having count(*) > 1
                )
                """
            ).fetchone()[0]
            rows = con.execute(
                """
                select pe_bli, fy, edition_year, amount
                from fct_decade_series
                order by random()
                limit ?
                """,
                [sample_size],
            ).fetchall()
        except duckdb.Error as e:
            return {
                **base,
                "total_rows": total,
                "reason": f"fct_decade_series missing contract columns: {e}",
            }
    finally:
        con.close()

    failures: list[tuple[str, str]] = []
    if dupes:
        failures.append(
            ("(grain)", f"{dupes} duplicate (pe_bli, fy, edition_year) grain(s)")
        )

    if not lake_budget_lines.exists():
        return {
            **base,
            "total_rows": total,
            "duplicate_grains": dupes,
            "reason": f"lake budget_lines parquet missing: {lake_budget_lines}",
        }

    from govbudget.jbooks.reconcile import scenario_map

    _REL_TO_SCENARIO = {2: "PriorYear", 1: "CurrentYear", 0: "BudgetYearOne"}

    lake = duckdb.connect()
    try:
        for pe_bli, fy, edition_year, amount in rows:
            grain = f"{pe_bli} fy={fy} edition={edition_year}"
            amt = _dec(amount)
            if amt is None:
                failures.append((grain, f"amount null/non-numeric: {amount!r}"))
                continue
            rel = int(edition_year) - int(fy)
            scenario = _REL_TO_SCENARIO.get(rel)
            if scenario is None:
                failures.append(
                    (grain, f"fy outside edition window (edition−fy={rel};"
                            f" expected 0, 1, or 2)")
                )
                continue
            candidates = scenario_map(int(edition_year))[scenario]
            matched = False
            candidate_sums: list[str] = []
            for slug in candidates:
                n, s = lake.execute(
                    f"""
                    select count(*),
                           sum(try_cast(amount_thousands as decimal(20, 3)))
                    from read_parquet('{_sql_path(lake_budget_lines)}')
                    where pe_bli = ?
                      and try_cast(fiscal_year as integer) = ?
                      and amount_type = ?
                    """,
                    [pe_bli, int(edition_year), slug],
                ).fetchone()
                if n == 0 or s is None:
                    continue
                candidate_sums.append(f"{slug}={s}")
                if abs(Decimal(str(s)) - amt) <= _TOL:
                    matched = True
                    break
            if not matched:
                failures.append(
                    (grain, f"lake recompute mismatch: amount={amt} but"
                            f" candidates [{', '.join(candidate_sums) or 'no lake rows'}]")
                )
    finally:
        lake.close()

    sampled = len(rows)
    return {
        "ok": sampled > 0 and len(failures) == 0,
        "total_rows": total,
        "duplicate_grains": dupes,
        "sampled": sampled,
        "passed": sampled - len([f for f in failures if f[0] != "(grain)"]),
        "failures": failures,
    }
