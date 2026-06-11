"""Phase 4 acceptance gates: CA+CT state pilot, budget reconciliation, cross-jurisdiction comparable.

Gates (CLI: verify-phase4):
  1. provenance_gate4  — parquet files exist with source_url on every row; ACFR in manifest with
                         sha + file present on disk.
  2. reconcile_gate4  — pipeline-integrity reconciliation: per-department sums recomputed from
                         individual ca_budget.parquet lines agree with pre-aggregated
                         ca_checkbook_agg.parquet department totals within 0.5% for ≥95% of
                         departments.  Note: BOTH sources derive from the same Open Fi$Cal
                         per-department transaction files; this gate checks aggregation
                         consistency (not against an independently published total, which
                         ebudget.ca.gov does not provide in machine-readable form — recorded
                         substitution per plan task-3 context note).
  3. comparable_gate4 — Coverage + comparability gate:
                         (a) coverage check: captured CA aggregate total must be ≥80% of the
                             pointer manifest's implied total (sum over ALL departments listed
                             in the pointer CSV). Pairs only count when both CA and CT pass
                             coverage (CT full checkbook = 100% by definition of the Socrata
                             SoQL aggregate).
                         (b) ≥1 (comparable_category, fiscal_year) where CA and CT both have
                             per-capita figures > 0 AND both jurisdictions pass coverage.
                         (c) Prints coverage % per jurisdiction + the pairs with their values.
                         Threshold: 80% coverage minimum. May NOT be lowered.

  coverage_gate4 (standalone helper) — pure function: given captured_total_usd,
                         pointer_total_usd, departments_failed → ok/coverage_pct/coverage_note.
"""
from pathlib import Path

import duckdb


def provenance_gate4(
    ca_budget_path: Path,
    ca_checkbook_path: Path,
    ct_checkbook_path: Path,
    population_path: Path,
    manifest_path: Path,
    raw_docs_dir: Path,
) -> dict:
    """Gate 1: all four parquet files exist; every row has a non-empty source_url;
    ACFR present in manifest with sha256 and file present on disk."""
    import json

    con = duckdb.connect()

    results = {}
    all_ok = True

    for name, path in [
        ("ca_budget", ca_budget_path),
        ("ca_checkbook", ca_checkbook_path),
        ("ct_checkbook", ct_checkbook_path),
        ("population", population_path),
    ]:
        if not path.exists():
            results[name] = {"ok": False, "reason": "file missing"}
            all_ok = False
            continue
        total = con.execute(
            f"select count(*) from read_parquet('{path}')"
        ).fetchone()[0]
        rows_with_url = con.execute(
            f"select count(*) from read_parquet('{path}') "
            f"where source_url is not null and source_url <> ''"
        ).fetchone()[0]
        ok = total > 0 and rows_with_url == total
        results[name] = {"ok": ok, "total_rows": total, "rows_with_url": rows_with_url}
        if not ok:
            all_ok = False

    # ACFR manifest check
    acfr_sha = None
    acfr_file = None
    if manifest_path.exists():
        for line in manifest_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("dataset") == "state_acfr_ca":
                acfr_sha = rec.get("sha256", "")
                acfr_file = rec.get("file_name", "")
                break

    acfr_disk_path = raw_docs_dir / "state" / "ca" / acfr_file if acfr_file else None
    acfr_on_disk = acfr_disk_path is not None and acfr_disk_path.exists()
    acfr_ok = bool(acfr_sha) and acfr_on_disk

    results["acfr"] = {
        "ok": acfr_ok,
        "sha256": acfr_sha,
        "file_name": acfr_file,
        "on_disk": acfr_on_disk,
    }
    if not acfr_ok:
        all_ok = False

    return {"ok": all_ok, "files": results}


def reconcile_gate4(ca_budget_path: Path, ca_checkbook_path: Path) -> dict:
    """Gate 2: pipeline-integrity reconciliation.

    Both ca_budget.parquet (individual transaction lines) and ca_checkbook_agg.parquet
    (pre-aggregated per department/category/year) derive from the same Open Fi$Cal
    per-department transaction CSV files. This gate recomputes department totals from
    the individual lines and compares them to the pre-aggregated checkbook totals.
    Agreement within 0.5% for ≥95% of departments is required.

    Substitution note: ebudget.ca.gov does not publish machine-readable line-item
    budgets. The plan's 'published totals' control is therefore implemented as an
    aggregation-consistency check between the two pipeline outputs from the same source.
    """
    con = duckdb.connect()

    # Recompute dept totals from line-level budget parquet
    budget_totals = {
        r[0]: r[1]
        for r in con.execute(
            f"""
            select department, sum(try_cast(amount_usd as double)) as total
            from read_parquet('{ca_budget_path}')
            where is_total = 'False' or is_total is null
            group by department
            """
        ).fetchall()
    }

    # Pre-aggregated checkbook dept totals
    ck_totals = {
        r[0]: r[1]
        for r in con.execute(
            f"""
            select department, sum(try_cast(amount_usd as double)) as total
            from read_parquet('{ca_checkbook_path}')
            group by department
            """
        ).fetchall()
    }

    dept_union = set(budget_totals.keys()) | set(ck_totals.keys())
    total_depts = len(dept_union)
    passing = []
    failing = []

    for dept in sorted(dept_union):
        b = budget_totals.get(dept)
        c = ck_totals.get(dept)
        if b is None or c is None:
            failing.append({"department": dept, "reason": "missing in one source", "b": b, "c": c})
            continue
        max_val = max(abs(b), abs(c))
        diff_pct = abs(b - c) / max_val * 100.0 if max_val > 0 else 0.0
        if diff_pct <= 0.5:
            passing.append(dept)
        else:
            failing.append({"department": dept, "diff_pct": round(diff_pct, 4), "b": b, "c": c})

    pass_count = len(passing)
    pass_pct = round(100.0 * pass_count / total_depts, 1) if total_depts else 0.0
    ok = pass_pct >= 95.0

    return {
        "ok": ok,
        "total_departments": total_depts,
        "passing": pass_count,
        "failing_count": len(failing),
        "pass_pct": pass_pct,
        "threshold_pct": 0.5,
        "failing_details": failing[:10],  # cap output to first 10 failures
    }


COVERAGE_THRESHOLD_PCT = 80.0  # may NOT be lowered


def coverage_gate4(
    *,
    jurisdiction: str,
    captured_total_usd: float,
    pointer_total_usd: float,
    departments_failed: int,
) -> dict:
    """Pure coverage gate: captured_total_usd / pointer_total_usd ≥ 80%.

    Used to screen whether a jurisdiction's data is complete enough to
    participate in cross-jurisdiction comparables.

    Args:
        jurisdiction: 2-letter jurisdiction code (e.g. 'CA').
        captured_total_usd: sum of amount_usd in the captured parquet.
        pointer_total_usd: implied total from the pointer manifest (sum over
            all departments listed, regardless of download success).
        departments_failed: count of files that failed to download.

    Returns dict with keys:
        ok: bool — True if coverage_pct >= 80%.
        coverage_pct: float — 100 * captured / pointer.
        threshold_pct: float — always 80.0 (may not be lowered).
        departments_failed: int — passed through for reporting.
        coverage_note: str — human-readable provenance note.
    """
    if pointer_total_usd <= 0:
        return {
            "ok": False,
            "coverage_pct": 0.0,
            "threshold_pct": COVERAGE_THRESHOLD_PCT,
            "departments_failed": departments_failed,
            "coverage_note": f"{jurisdiction}: pointer_total_usd = 0 (no pointer data)",
        }
    coverage_pct = round(100.0 * captured_total_usd / pointer_total_usd, 2)
    ok = coverage_pct >= COVERAGE_THRESHOLD_PCT
    note = (
        f"{jurisdiction}: captured ${captured_total_usd:,.0f} / "
        f"pointer ${pointer_total_usd:,.0f} = {coverage_pct:.1f}% coverage"
        + (f"; {departments_failed} dept file(s) failed" if departments_failed else "")
    )
    return {
        "ok": ok,
        "coverage_pct": coverage_pct,
        "threshold_pct": COVERAGE_THRESHOLD_PCT,
        "departments_failed": departments_failed,
        "coverage_note": note,
    }


def comparable_gate4(
    duckdb_path: Path,
    *,
    ca_coverage: dict | None = None,
    ct_coverage: dict | None = None,
) -> dict:
    """Gate 3: Coverage-aware comparability gate.

    (a) Coverage check: each jurisdiction must have coverage_pct ≥ 80% (via
        ca_coverage / ct_coverage dicts from coverage_gate4). CT full checkbook
        Socrata aggregate is treated as 100% coverage when ct_coverage is None.
        If coverage fails, gate fails before checking pairs.

    (b) ≥1 (comparable_category, fiscal_year) where CA and CT both have
        per-capita figures > 0; provenance (spend_source_url + pop_source_url)
        non-null on each row.

    Args:
        duckdb_path: path to the DuckDB with fct_state_per_capita.
        ca_coverage: result from coverage_gate4(jurisdiction='CA', ...) or None.
            None = skip coverage check for CA (backward compat with existing tests).
        ct_coverage: result from coverage_gate4(jurisdiction='CT', ...) or None.
            None = assume 100% (CT Socrata full-checkbook aggregate).

    Reports the specific (category, year) pairs that satisfied the gate.
    Prints coverage % per jurisdiction.
    """
    from collections import defaultdict

    # ------------------------------------------------------------------
    # Coverage preflight
    # ------------------------------------------------------------------
    coverage_results = {}

    if ca_coverage is not None:
        coverage_results["CA"] = ca_coverage
        if not ca_coverage["ok"]:
            return {
                "ok": False,
                "reason": (
                    f"CA coverage insufficient: {ca_coverage['coverage_pct']:.1f}% "
                    f"(threshold {COVERAGE_THRESHOLD_PCT}%). "
                    "Re-run acquire-ca without --max-mb to get full capture."
                ),
                "comparable_pairs_found": 0,
                "comparable_pairs": [],
                "coverage": coverage_results,
            }

    if ct_coverage is not None:
        coverage_results["CT"] = ct_coverage
        if not ct_coverage["ok"]:
            return {
                "ok": False,
                "reason": (
                    f"CT coverage insufficient: {ct_coverage['coverage_pct']:.1f}% "
                    f"(threshold {COVERAGE_THRESHOLD_PCT}%). "
                    "Re-run acquire-ct."
                ),
                "comparable_pairs_found": 0,
                "comparable_pairs": [],
                "coverage": coverage_results,
            }

    # ------------------------------------------------------------------
    # Per-capita pair check
    # ------------------------------------------------------------------
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        rows = con.execute(
            """
            select
                comparable_category,
                fiscal_year,
                jurisdiction,
                amount_per_capita,
                spend_source_url,
                pop_source_url
            from fct_state_per_capita
            order by comparable_category, fiscal_year, jurisdiction
            """
        ).fetchall()
    finally:
        con.close()

    if not rows:
        return {
            "ok": False,
            "reason": "fct_state_per_capita is empty",
            "comparable_pairs_found": 0,
            "comparable_pairs": [],
            "coverage": coverage_results,
        }

    # Group by (category, year) and check both jurisdictions present with positive per-capita
    groups = defaultdict(dict)
    for cat, fy, jur, per_cap, spend_url, pop_url in rows:
        groups[(cat, fy)][jur] = {
            "amount_per_capita": per_cap,
            "spend_source_url": spend_url,
            "pop_source_url": pop_url,
        }

    valid_pairs = []
    invalid_pairs = []
    for (cat, fy), jur_data in sorted(groups.items()):
        ca = jur_data.get("CA")
        ct = jur_data.get("CT")
        if ca is None or ct is None:
            invalid_pairs.append({"category": cat, "fiscal_year": fy, "reason": "missing jurisdiction"})
            continue
        ca_ok = (ca["amount_per_capita"] or 0) > 0 and ca["spend_source_url"] and ca["pop_source_url"]
        ct_ok = (ct["amount_per_capita"] or 0) > 0 and ct["spend_source_url"] and ct["pop_source_url"]
        if ca_ok and ct_ok:
            valid_pairs.append({
                "category": cat,
                "fiscal_year": fy,
                "ca_per_capita": ca["amount_per_capita"],
                "ct_per_capita": ct["amount_per_capita"],
                "ca_spend_url": ca["spend_source_url"],
                "ct_spend_url": ct["spend_source_url"],
            })
        else:
            invalid_pairs.append({
                "category": cat,
                "fiscal_year": fy,
                "reason": f"ca_ok={ca_ok} ct_ok={ct_ok}",
            })

    ok = len(valid_pairs) >= 1
    return {
        "ok": ok,
        "comparable_pairs_found": len(valid_pairs),
        "comparable_pairs": valid_pairs,
        "invalid_pairs": invalid_pairs,
        "coverage": coverage_results,
    }
