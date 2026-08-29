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

  5. decade_parquet_gate5e — the typed site export
     data/site/data/budget_lines_decade.parquet recomputes from the
     parquet-lake budget_lines: sample ≥30 rows; each sampled row's grain
     (pe_bli, edition, amount_type) must sum, across the WHOLE decade
     parquet, to a scenario_map candidate sum in the lake (P-1R excluded —
     same _lake_candidate_match rule as gates 3/4). Closes the residual
     artifact-tamper window between exporter STOP-conditions and the
     sampled citation checks (backlog #23).

All gate functions take explicit paths/DSNs — never read config.
No network access in any gate.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

# PB editions the decade backfill promises (spec §1).
TARGET_EDITIONS: tuple[int, ...] = tuple(range(2017, 2027))

# jbook_documents.status lifecycle: 'registered' → 'downloaded' | 'failed',
# plus 'superseded' (Phase 5G): a real, downloaded document whose embedded XML
# duplicates a retained master's (the Navy BA-split books each embed the full
# master), intentionally excluded from extraction/export. Both 'downloaded' and
# 'superseded' are ACCOUNTED-FOR terminal states — a superseded doc is not a
# coverage gap, it's a deliberately-deduplicated duplicate. Counting it as
# missing would be a false failure. The `recon_checks > 0` requirement (below)
# still guards against a vacuous edition where every doc was superseded and no
# live facts loaded.
TERMINAL_STATUSES = ("downloaded", "superseded")
# Back-compat alias for the primary success state (used in failure messages).
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
    account: str | None = None,
    organization: str | None = None,
) -> tuple[bool, str]:
    """Any-candidate-matches rule (reconcile.scenario_map semantics).

    For each candidate amount_type slug, sum amount_thousands over the
    edition's lake rows for pe_bli; matched iff ANY candidate sum is within
    _TOL of target (PB books split base/OOC/total differently per org — the
    same rule the reconciliation gate uses). Returns (matched, detail) where
    detail lists the candidate sums for failure messages.

    P-1R rows are EXCLUDED from the candidate sums (Task 5 improvements —
    P-1R recompute correction): the P-1R exhibit is the reserve-component
    SUBSET of the P-1 line, and P-1 is the inclusive total (workbook ground
    truth: Aircraft Procurement Army FY2024 = $3.321B from P-1 alone).
    Modern (PB2024–PB2026) P-1R rows share (pe_bli, amount_type) with their
    P-1 line, so a naive whole-lake sum double-counts the reserve share —
    fct_decade_series applies the same exclusion in its lake_sums CTE.

    `account`/`organization` scope the sum for a SPLIT key. Thirteen pe_bli
    values are shared by two or more different programs — ten on the account
    axis (#56/#67) and three on the organization axis ('20', '30', '500',
    ROADMAP #45) — and fct_decade_series publishes one row per real slot for
    them. Summing the whole pe_bli there adds two unrelated programs together
    and mismatches BOTH of their rows. NULL on either argument keeps the
    unscoped sum, which is byte-for-byte the previous behavior for the ~1,940
    keys that are not split.
    """
    sums: list[str] = []
    scope_sql = ""
    scope_params: list[object] = []
    if account is not None:
        scope_sql += " and account = ?"
        scope_params.append(account)
    if organization is not None:
        scope_sql += " and organization = ?"
        scope_params.append(organization)
    for slug in candidates:
        n, s = lake_con.execute(
            f"""
            select count(*),
                   sum(try_cast(amount_thousands as decimal(20, 3)))
            from read_parquet('{_sql_path(lake_budget_lines)}')
            where pe_bli = ?
              and try_cast(fiscal_year as integer) = ?
              and amount_type = ?
              and exhibit <> 'P-1R'
            """ + scope_sql,
            [pe_bli, edition, slug, *scope_params],
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
        terminal = sum(by_fy_status.get((fy, s), 0) for s in TERMINAL_STATUSES)
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
                       from_value, to_value, delta, account, organization
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
        for (pe_bli, from_ed, to_ed, kind, from_v, to_v, delta,
             account, organization) in rows:
            grain = (
                f"{pe_bli}"
                + (f"/{account}" if account else "")
                + (f"/{organization}" if organization else "")
                + f" {from_ed}→{to_ed} {kind}"
            )
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
                lake, lake_budget_lines, pe_bli, int(from_ed), from_candidates, fd,
                account=account, organization=organization,
            )
            if not ok_from:
                failures.append(
                    (grain, f"from_value lake recompute mismatch:"
                            f" mart={fd} but candidates [{detail}]")
                )
                continue
            ok_to, detail = _lake_candidate_match(
                lake, lake_budget_lines, pe_bli, int(to_ed), to_candidates, td,
                account=account, organization=organization,
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

    - (pe_bli, account, organization, fy, edition_year) must be unique.

      WIDENED 2026-08-29. This gate still checked (pe_bli, fy, edition_year)
      — the grain fct_decade_series had before E2 (#56/#67) gave the ten
      account-collision keys one row per real account, and before ROADMAP
      #45 gave '20'/'30'/'500' one row per organization. The mart's own dbt
      test (assert_decade_series_grain_unique) was widened both times; this
      one was not, so it has been reporting duplicates for a grain the mart
      deliberately publishes. Measured on the 2026-08-29 warehouse: 100
      "duplicate" grains, of which 27 are the three ORGANIZATION-collision
      keys alone — the exact figure that dbt test records for the pre-#45
      grain, which dates this gate's staleness to 2026-08-21, before the
      Wave 5 ingestion that surfaced it. Widening it to the mart's
      documented grain is the stale check catching up, not a bar moving:
      account and organization are NULL for every non-split pe_bli, so this
      reproduces the old check byte-for-byte there.
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
                  select pe_bli, account, organization, fy, edition_year
                  from fct_decade_series
                  group by 1, 2, 3, 4, 5
                  having count(*) > 1
                )
                """
            ).fetchone()[0]
            rows = con.execute(
                """
                select pe_bli, fy, edition_year, amount, account, organization
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
            ("(grain)",
             f"{dupes} duplicate (pe_bli, account, organization, fy,"
             f" edition_year) grain(s)")
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
        for pe_bli, fy, edition_year, amount, account, organization in rows:
            grain = (
                f"{pe_bli}"
                + (f"/{account}" if account else "")
                + (f"/{organization}" if organization else "")
                + f" fy={fy} edition={edition_year}"
            )
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
                lake, lake_budget_lines, pe_bli, int(edition_year), candidates,
                amt, account=account, organization=organization,
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


# ---------------------------------------------------------------------------
# Gate 5: decade_parquet_gate5e
# ---------------------------------------------------------------------------

_DECADE_PARQUET_SAMPLE_SIZE = 30

# Scenarios fct_decade_series (and therefore the decade parquet's grains)
# can carry, in gate-4's edition-relative order (edition − fy = 2, 1, 0).
_DECADE_SCENARIOS = ("PriorYear", "CurrentYear", "BudgetYearOne")


def decade_parquet_gate5e(
    decade_parquet: Path,
    lake_budget_lines: Path,
    *,
    sample_size: int = _DECADE_PARQUET_SAMPLE_SIZE,
) -> dict:
    """budget_lines_decade.parquet ↔ jbooks-lake integrity (backlog #23).

    The typed decade export (data/site/data/budget_lines_decade.parquet)
    is EXPORTER output: _build_decade_citation_rows computes it from the
    Task-5 marts plus the jbooks lake, anchored until now only by exporter
    STOP-conditions, gate 4's mart recompute, and the 5B-1 sampled
    citation checks. This gate closes the residual artifact-tamper window
    by recomputing the shipped parquet directly from the lake, bypassing
    the marts entirely.

    Per sampled row (decade rows carry fiscal_year == edition_year):
      - grain = (pe_bli, edition, amount_type); the grain's sum of
        amount_thousands over the WHOLE decade parquet (so tampering ANY
        row of a sampled grain — edit, add, or partial delete — surfaces);
      - the row's amount_type slug must belong to scenario_map(edition)
        for one of the gate-4 scenarios (a fabricated slug FAILs);
      - the grain sum must recompute from the lake via
        _lake_candidate_match (any-candidate rule, P-1R excluded — the
        decade parquet ships only R-1/P-1 source rows, and P-1R is the
        reserve-component subset of the P-1 line).

    Scope note (backlog #23 decision): the main budget_lines.parquet is
    deliberately NOT given this leg — it is exported directly from
    Postgres (a different trust chain, already anchored by verify-phase5b1's
    workbook re-derivation + integrity set-equality against citations),
    whereas the decade parquet is computed FROM the lake, so the lake is
    its natural ground truth.

    Sub-sample guard: fewer than sample_size rows is a FAIL. FAIL if the
    parquet or the lake is absent — the decade tier is a Phase 5E
    deliverable and must not silently vanish.

    Returns: ok, total_rows, sampled, passed, failures [(grain, reason)],
             reason (structural failures only).
    """
    decade_parquet = Path(decade_parquet)
    lake_budget_lines = Path(lake_budget_lines)
    base = {"ok": False, "total_rows": 0, "sampled": 0, "passed": 0, "failures": []}
    if not decade_parquet.exists():
        return {**base, "reason": f"budget_lines_decade.parquet missing: {decade_parquet}"}
    if not lake_budget_lines.exists():
        return {
            **base,
            "reason": f"lake budget_lines parquet missing: {lake_budget_lines}",
        }

    import duckdb

    con = duckdb.connect()
    try:
        total = con.execute(
            f"select count(*) from read_parquet('{_sql_path(decade_parquet)}')"
        ).fetchone()[0]
        if total == 0:
            return {**base, "reason": "budget_lines_decade.parquet is empty"}
        rows = con.execute(
            f"""
            select fact_id, pe_bli, fiscal_year, amount_type
            from read_parquet('{_sql_path(decade_parquet)}')
            order by random()
            limit ?
            """,
            [sample_size],
        ).fetchall()
        if len(rows) < sample_size:
            return {
                **base,
                "total_rows": total,
                "sampled": len(rows),
                "reason": f"only {len(rows)} decade rows available —"
                          f" fewer than sample_size={sample_size}",
            }
        grain_sums = {
            (pe, fy, at): s
            for pe, fy, at, s in con.execute(
                f"""
                select pe_bli, fiscal_year, amount_type, sum(amount_thousands)
                from read_parquet('{_sql_path(decade_parquet)}')
                group by 1, 2, 3
                """
            ).fetchall()
        }
    finally:
        con.close()

    from govbudget.jbooks.reconcile import scenario_map

    failures: list[tuple[str, str]] = []
    lake = duckdb.connect()
    try:
        for fact_id, pe_bli, edition, at in rows:
            grain = f"{fact_id} ({pe_bli} PB{edition} {at})"
            target = _dec(grain_sums.get((pe_bli, edition, at)))
            if target is None:
                failures.append((grain, "grain sum null/non-numeric"))
                continue
            smap = scenario_map(int(edition))
            candidates = None
            for scenario in _DECADE_SCENARIOS:
                if at in smap[scenario]:
                    candidates = smap[scenario]
                    break
            if candidates is None:
                failures.append(
                    (grain, f"amount_type {at!r} is not a scenario_map"
                            f" candidate for edition {edition}")
                )
                continue
            matched, detail = _lake_candidate_match(
                lake, lake_budget_lines, pe_bli, int(edition), candidates, target
            )
            if not matched:
                failures.append(
                    (grain, f"lake recompute mismatch: parquet grain"
                            f" sum={target} but candidates [{detail}]")
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
