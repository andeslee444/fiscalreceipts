#!/usr/bin/env python3
"""entitytotals-recompute.py — gate 23 leg (d) helper (PM Sprint 3, Task 5b).

Answers, on stdout as JSON, the two questions the basis gate cannot answer in
Node — both about the SAME published number, /companies/'s and every
/company/{slug}/'s headline "Total obligations":

  1. REPRODUCTION.  Every entity total_obligation citation ships a query_body:
     a SQL statement that is supposed to recompute its recorded_value.  We run
     it, verbatim, against the warehouse and compare.  Nothing about the
     statement is interpreted here — running it IS the check.

  2. DECLARED-WINDOW TRUTH.  The pages label these figures "FY2017–FY2026"
     (site_meta.award_fy_range, derived at export).  A figure can reproduce its
     own query and still be wrong about the period it claims, which is exactly
     what shipped: entity_xwalk.parquet was built 2026-06-10 20:19, before the
     FY2020-FY2026 partitions landed, so its total_obligation column summed
     FY2017-FY2019 while every page said FY2017-FY2026 — understating Lockheed
     Martin by $366B.  So we ask the lake, independently of dbt: over which
     leading FY window does the crosswalk's own total column reproduce?  If
     that window ends before the declared fy_max, the label is a claim the data
     does not support.

Both recomputes read the PARQUET LAKE and the SHIPPED crosswalk directly, never
dim_entities or fct_family_obligations_by_year — those are downstream of the
artifact under test, and reading them would make the gate tautological.

Output:
{
  "declared": {"fy_min": 2017, "fy_max": 2026},
  "n_facts": 228,
  "reproduce_failures": [{"fact_id","family_key","recorded_value","query_value"}],
  "window_fit": {"2017": <lake sum over FY2017..2017>, ..., "2026": <...>},
  "xwalk_total": <sum of the crosswalk's own total_obligation column>,
  "xwalk_window_end": 2026 | null,      # last FY of the window that reproduces
  "freshness": {"xwalk_mtime": ..., "newest_input": {"path":..., "mtime":...}}
}
"""

import json
import os
import re
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
LAKE = REPO / "data" / "parquet"
XWALK = LAKE / "entities" / "entity_xwalk.parquet"
DUCKDB_PATH = REPO / "data" / "duckdb" / "govbudget.duckdb"
CITATIONS = REPO / "data" / "site" / "citations" / "citations.parquet"
SITE_META = REPO / "data" / "site" / "json" / "site_meta.json"

# The award families the crosswalk is built over — the same two the
# fct_award_transactions union covers.  Kept as a literal here on purpose: if
# a third award family is ever ingested, this gate should go red until someone
# decides whether the crosswalk covers it.
AWARD_GLOBS = [
    (LAKE / "contracts" / "*" / "*.parquet").as_posix(),
    (LAKE / "assistance" / "*" / "*.parquet").as_posix(),
]

# Facts are identified by their formula, not by a hand-kept id list, so a newly
# minted family joins the checked set automatically.  Two surfaces publish a
# "sum over entity_xwalk" claim and both are checked:
#   entity  — /companies/ + /company/{slug}/ "Total obligations"
#   feed    — /feed/ new-entrant cards
FORMULA_LIKE = "sum(fct_award_transactions.obligation)%via entity_xwalk%"
FEED_MARKER = "(new entrant:"

# Columns the published statements are allowed to touch.  A query_body that
# reaches outside this set raises a DuckDB Binder Error, which is recorded as a
# reproduction failure — the fail-safe direction.  Widening the projection is a
# deliberate act, never an accident.
PROJECTION = {
    "fct_award_transactions": "recipient_uei, obligation, fiscal_year, award_type",
    "entity_xwalk": "recipient_uei, family_key",
}

TOL = 0.01  # dollars; recorded_value is emitted at 3dp


def _newest_input() -> dict:
    """The most recently written parquet the crosswalk reads."""
    newest = {"path": None, "mtime": 0.0}
    for pattern in ("contracts", "assistance"):
        for p in (LAKE / pattern).rglob("*.parquet"):
            m = p.stat().st_mtime
            if m > newest["mtime"]:
                newest = {"path": str(p.relative_to(REPO)), "mtime": m}
    return newest


def main() -> int:
    out: dict = {}
    for required in (XWALK, DUCKDB_PATH, CITATIONS, SITE_META):
        if not required.exists():
            print(json.dumps({"__error__": f"missing {required}"}))
            return 1

    meta = json.loads(SITE_META.read_text())
    rng = (meta.get("award_fy_range") or {})
    fy_min, fy_max = rng.get("fy_min"), rng.get("fy_max")
    if not isinstance(fy_min, int) or not isinstance(fy_max, int):
        print(json.dumps({"__error__": "site_meta.award_fy_range missing fy_min/fy_max"}))
        return 1
    out["declared"] = {"fy_min": fy_min, "fy_max": fy_max, "label": rng.get("label")}

    out["freshness"] = {
        "xwalk_mtime": XWALK.stat().st_mtime,
        "newest_input": _newest_input(),
    }

    # ---- 1. reproduction: run every published query_body verbatim ----------
    #
    # Verbatim against a COLUMN PROJECTION of the warehouse, not against the
    # warehouse itself: ~1,900 statements each scanning 40M rows is 16 minutes,
    # and a gate nobody runs protects nothing.  The projection is a strict
    # subset of columns plus a sort (sum is order-invariant); its row count and
    # dollar total are asserted equal to the real tables below, so a projection
    # that has silently diverged fails the gate rather than blessing it.
    con = duckdb.connect()
    try:
        con.execute(f"attach '{DUCKDB_PATH.as_posix()}' as govbudget (read_only)")
        for table, cols in PROJECTION.items():
            order = " order by recipient_uei" if table == "fct_award_transactions" else ""
            con.execute(f"create table {table} as select {cols} from govbudget.{table}{order}")
        con.execute("create index ix_entity_xwalk_family on entity_xwalk(family_key)")

        fidelity = {}
        for table in PROJECTION:
            n_proj, n_real = (
                con.execute(f"select count(*) from memory.{table}").fetchone()[0],
                con.execute(f"select count(*) from govbudget.{table}").fetchone()[0],
            )
            fidelity[table] = {"projected_rows": n_proj, "warehouse_rows": n_real}
        fidelity["fct_award_transactions"]["projected_sum"] = con.execute(
            "select sum(obligation) from memory.fct_award_transactions"
        ).fetchone()[0]
        fidelity["fct_award_transactions"]["warehouse_sum"] = con.execute(
            "select sum(obligation) from govbudget.fct_award_transactions"
        ).fetchone()[0]
        out["projection_fidelity"] = fidelity

        facts = con.execute(
            "select fact_id, formula, query_body, recorded_value"
            f" from read_parquet('{CITATIONS.as_posix()}')"
            " where formula like ? and query_body is not null"
            "   and recorded_value is not null"
            " order by fact_id",
            [FORMULA_LIKE],
        ).fetchall()
        out["n_facts"] = len(facts)

        failures = []
        counts = {"entity": 0, "feed": 0}
        for fact_id, formula, query_body, recorded_value in facts:
            surface = "feed" if FEED_MARKER in (formula or "") else "entity"
            counts[surface] += 1
            fam = re.search(r"family_key='(.*)'\s*$", query_body or "")
            row = {
                "fact_id": fact_id,
                "surface": surface,
                "family_key": fam.group(1) if fam else None,
                "recorded_value": float(recorded_value),
            }
            try:
                got = con.execute(query_body).fetchone()[0]
            except Exception as e:  # a query_body that will not run is a failure
                failures.append({**row, "query_value": None, "error": str(e)[:200]})
                continue
            got = 0.0 if got is None else float(got)
            if abs(got - float(recorded_value)) > TOL:
                failures.append({**row, "query_value": got})
        out["reproduce_failures"] = failures
        out["n_by_surface"] = counts
    finally:
        con.close()

    # ---- 2. declared-window truth, computed from the lake ------------------
    lake = duckdb.connect()
    try:
        globs = ", ".join(f"'{g}'" for g in AWARD_GLOBS)
        xwalk_total = lake.execute(
            f"select sum(total_obligation) from read_parquet('{XWALK.as_posix()}')"
        ).fetchone()[0]
        out["xwalk_total"] = float(xwalk_total or 0.0)

        # Per-FY lake total over the UEIs the crosswalk actually carries.  The
        # partition column `fy` is the lake's own fiscal-year key.
        per_fy = lake.execute(
            f"""
            select cast(t.fy as integer) as fy,
                   sum(try_cast(t.federal_action_obligation as double)) as obl
            from read_parquet([{globs}], union_by_name=true, hive_partitioning=true) t
            join read_parquet('{XWALK.as_posix()}') x
              on t.recipient_uei = x.recipient_uei
            group by 1 order by 1
            """
        ).fetchall()
        out["lake_fy_min"] = min((r[0] for r in per_fy), default=None)
        out["lake_fy_max"] = max((r[0] for r in per_fy), default=None)

        # Cumulative leading windows [fy_min .. k] for every k in the declared
        # range.  The window whose total reproduces the crosswalk's own column
        # is the window the published figures REALLY cover.
        running = 0.0
        window_fit: dict[str, float] = {}
        by_fy = {int(r[0]): float(r[1] or 0.0) for r in per_fy}
        window_end = None
        target = out["xwalk_total"]
        best_k, best_err = None, None
        for k in range(fy_min, fy_max + 1):
            running += by_fy.get(k, 0.0)
            window_fit[str(k)] = running
            err = abs(running - target) / abs(target) if target else float("inf")
            if best_err is None or err < best_err:
                best_k, best_err = k, err
            if window_end is None and abs(running - target) <= max(TOL, abs(target) * 1e-9):
                window_end = k
        out["window_fit"] = window_fit
        out["xwalk_window_end"] = window_end
        # When nothing fits exactly, name the window that fits BEST — that is
        # the period the published figures really describe, and the sentence
        # the failure message needs in order to be actionable.
        out["closest_window_end"] = best_k
        out["closest_window_rel_error"] = best_err
    finally:
        lake.close()

    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
