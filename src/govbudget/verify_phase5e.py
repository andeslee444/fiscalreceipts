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
     — a single cross-edition row is a FAIL. Fewer joinable rows than the
     sample size is also a FAIL (sub-sample guard).

  3. book_diff_gate5e — the fct_book_diff mart exists in the dbt DuckDB
     output; sample ≥20 rows with a non-null delta (fewer available is a
     FAIL); each row must (a) conserve — delta == to_value − from_value —
     AND (b) recompute from the parquet-lake budget_lines per diff_kind
     using reconcile.scenario_map (see the gate docstring for the Task-5
     mart contract). FAIL if the mart is absent or empty (Task 5 must turn
     this green).

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

# Recompute tolerance. The 5E marts and the lake are both in USD thousands
# (the unit contract: mart values match budget_lines.amount_thousands), so
# Decimal("1.0") = $1,000 — the same materiality as reconcile.TOLERANCE_M
# (Decimal("0.001") in USD millions).
_TOL = Decimal("1.0")


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


def _lake_candidate_match(
    lake_con,
    lake_budget_lines: Path,
    pe_bli: str,
    edition: int,
    candidates: list[str],
    target: Decimal,
) -> tuple[bool, str]:
    """Any-candidate-matches rule (reconcile.scenario_map semantics).

    For each candidate amount_type slug, sum amount_thousands over the
    edition's lake rows for pe_bli; matched iff ANY candidate sum is within
    _TOL of target (PB books split base/OOC/total differently per org — the
    same rule the reconciliation gate uses). Returns (matched, detail) where
    detail lists the candidate sums for failure messages.
    """
    sums: list[str] = []
    for slug in candidates:
        n, s = lake_con.execute(
            f"""
            select count(*),
                   sum(try_cast(amount_thousands as decimal(20, 3)))
            from read_parquet('{_sql_path(lake_budget_lines)}')
            where pe_bli = ?
              and try_cast(fiscal_year as integer) = ?
              and amount_type = ?
            """,
            [pe_bli, edition, slug],
        ).fetchone()
        if n == 0 or s is None:
            continue
        sums.append(f"{slug}={s}")
        if abs(Decimal(str(s)) - target) <= _TOL:
            return True, ", ".join(sums)
    return False, ", ".join(sums) or "no lake rows"


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

    Sub-sample guard: fewer than sample_size joinable rows is a FAIL — a
    thin join means the warehouse under-delivers, not that the gate should
    quietly shrink its evidence base.

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

    if len(rows) < sample_size:
        return {
            "ok": False,
            "joinable": joinable,
            "unjoined": unjoined,
            "sampled": len(rows),
            "mismatch_count": 0,
            "mismatches": [],
            "reason": f"only {len(rows)} joinable rows available —"
                      f" fewer than sample_size={sample_size}",
        }

    mismatches = [
        (bl_id, bl_fy, doc_fy) for bl_id, bl_fy, doc_fy in rows if bl_fy != doc_fy
    ]
    return {
        "ok": len(mismatches) == 0,
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


def book_diff_gate5e(
    duckdb_path: Path,
    lake_budget_lines: Path,
    *,
    sample_size: int = _MART_SAMPLE_SIZE,
) -> dict:
    """fct_book_diff conservation, grounded in the parquet lake.

    Mart contract (Task 5 must build fct_book_diff to satisfy this gate):
      - Columns: pe_bli, from_edition, to_edition, diff_kind, from_value,
        to_value, delta. All values are in USD thousands, matching the
        lake's budget_lines.amount_thousands.
      - diff_kind = 'request_vs_request' (from_edition=N, to_edition=M):
          from_value = edition-N lake value under
                       scenario_map(N)["BudgetYearOne"] candidates
          to_value   = edition-M lake value under
                       scenario_map(M)["BudgetYearOne"] candidates
      - diff_kind = 'request_vs_actuals' (from_edition=N, to_edition=N+2):
          from_value = edition-N BudgetYearOne (the FY-N request)
          to_value   = edition-(N+2) PriorYear (the FY-N actuals,
                       slug fy_{N}_actuals)
      - delta = to_value − from_value.

    Each sampled row (non-null delta) must BOTH conserve (delta recomputes
    as to_value − from_value within _TOL) AND recompute from the lake:
    from_value and to_value each match a candidate-slug sum for their
    edition (any-candidate-matches rule, reconcile.scenario_map — same rule
    decade_series_gate5e uses). Recomputing from the lake keeps the gate
    independent of the dbt model's own arithmetic.

    Sub-sample guard: fewer than sample_size non-null-delta rows is a FAIL
    (Task 5's mart will carry thousands; unit tests pass small sizes).
    FAIL if the mart is absent or empty — the mart is Task 5's deliverable
    and this gate must be red until it lands.

    Returns: ok, total_rows, sampled, passed, failures [(grain, reason)],
             reason (structural failures only).
    """
    duckdb_path = Path(duckdb_path)
    lake_budget_lines = Path(lake_budget_lines)
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

    if len(rows) < sample_size:
        return {
            **base,
            "total_rows": total,
            "sampled": len(rows),
            "reason": f"only {len(rows)} non-null-delta rows available —"
                      f" fewer than sample_size={sample_size}",
        }

    if not lake_budget_lines.exists():
        return {
            **base,
            "total_rows": total,
            "reason": f"lake budget_lines parquet missing: {lake_budget_lines}",
        }

    from govbudget.jbooks.reconcile import scenario_map

    failures: list[tuple[str, str]] = []
    lake = duckdb.connect()
    try:
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
                continue
            # Lake grounding: recompute from_value/to_value per diff_kind.
            if kind == "request_vs_request":
                from_candidates = scenario_map(int(from_ed))["BudgetYearOne"]
                to_candidates = scenario_map(int(to_ed))["BudgetYearOne"]
            elif kind == "request_vs_actuals":
                if int(to_ed) - int(from_ed) != 2:
                    failures.append(
                        (grain, f"request_vs_actuals span invalid:"
                                f" to_edition − from_edition ="
                                f" {int(to_ed) - int(from_ed)}; expected 2"
                                f" (FY-{from_ed} actuals appear in"
                                f" PB{int(from_ed) + 2})")
                    )
                    continue
                from_candidates = scenario_map(int(from_ed))["BudgetYearOne"]
                # scenario_map(N+2)["PriorYear"] == ["fy_{N}_actuals"]
                to_candidates = scenario_map(int(to_ed))["PriorYear"]
            else:
                failures.append((grain, f"unknown diff_kind: {kind!r}"))
                continue
            ok_from, detail = _lake_candidate_match(
                lake, lake_budget_lines, pe_bli, int(from_ed), from_candidates, fd
            )
            if not ok_from:
                failures.append(
                    (grain, f"from_value lake recompute mismatch:"
                            f" mart={fd} but candidates [{detail}]")
                )
                continue
            ok_to, detail = _lake_candidate_match(
                lake, lake_budget_lines, pe_bli, int(to_ed), to_candidates, td
            )
            if not ok_to:
                failures.append(
                    (grain, f"to_value lake recompute mismatch:"
                            f" mart={td} but candidates [{detail}]")
                )
    finally:
        lake.close()

    sampled = len(rows)
    return {
        "ok": len(failures) == 0,
        "total_rows": total,
        "sampled": sampled,
        "passed": sampled - len(failures),
        "failures": failures,
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
            matched, detail = _lake_candidate_match(
                lake, lake_budget_lines, pe_bli, int(edition_year), candidates, amt
            )
            if not matched:
                failures.append(
                    (grain, f"lake recompute mismatch: amount={amt} but"
                            f" candidates [{detail}]")
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
