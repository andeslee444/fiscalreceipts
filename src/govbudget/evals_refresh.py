"""Eval refresh tooling for phase5_questions.yaml.

CLI sub-commands:
  govbudget evals refresh  — re-run every non-REFUSE entry's answer_sql against
                             the live DuckDB (read-only, cwd=config.ROOT) and
                             update expected_answer in-place; prints a diff
                             summary.
  govbudget evals check    — run every answer_sql and EXIT 1 if any expected
                             answer is stale (used in CI / freshness gate).

Design notes
------------
- Connects read-only to config.DUCKDB_PATH.
- Canonical formatter: numeric tuples are joined with ", "; single-value
  float/int results are converted to string with enough precision.
- Idempotency: refresh on an already-fresh file produces zero changes.
- Tamper detection (check mode): compares live result to expected_answer using
  the same canonical formatter; tolerance-aware for entries that carry one.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import duckdb
import yaml

from govbudget import config

EVAL_PATH = Path(__file__).resolve().parents[2] / "evals" / "phase5_questions.yaml"
REFUSE_SENTINEL = "REFUSE"

# Relative path prefix used in answer_sql for oversight/state parquets.
# Substituted with the absolute PARQUET_DIR path before execution so that
# _run_sql works correctly regardless of the process's working directory.
_RELATIVE_PARQUET_PREFIX = "data/parquet/"


# ---------------------------------------------------------------------------
# Canonical formatter
# ---------------------------------------------------------------------------

def _fmt_value(v: Any) -> str:
    """Render a single scalar to string in canonical eval form."""
    if isinstance(v, float):
        # Preserve up to 4 decimal places, strip trailing zeros
        s = f"{v:.4f}".rstrip("0").rstrip(".")
        return s
    return str(v)


def _canonicalize(rows: list[tuple]) -> str:
    """Turn DuckDB fetchall() result into the canonical expected_answer string."""
    if not rows:
        return ""
    if len(rows) == 1:
        row = rows[0]
        if len(row) == 1:
            return _fmt_value(row[0])
        return ", ".join(_fmt_value(v) for v in row)
    # Multi-row: join each row, newline-separated
    return "\n".join(", ".join(_fmt_value(v) for v in row) for row in rows)


# ---------------------------------------------------------------------------
# Core execution
# ---------------------------------------------------------------------------

def _resolve_parquet_paths(sql: str) -> str:
    """Replace relative 'data/parquet/' prefixes with the absolute PARQUET_DIR path.

    answer_sql entries use relative read_parquet('data/parquet/...') paths that
    are only valid when the process's cwd is the repo root. This substitution
    makes execution cwd-independent by converting to absolute paths.
    """
    absolute_prefix = str(config.PARQUET_DIR) + "/"
    return sql.replace(_RELATIVE_PARQUET_PREFIX, absolute_prefix)


def _run_sql(con: duckdb.DuckDBPyConnection, sql: str) -> list[tuple]:
    """Execute answer_sql and return rows.

    Resolves relative read_parquet('data/parquet/...') paths to absolute paths
    so the query works regardless of the process's current working directory.
    """
    return con.execute(_resolve_parquet_paths(sql)).fetchall()


def _load_yaml() -> list[dict]:
    assert EVAL_PATH.exists(), f"Eval file not found: {EVAL_PATH}"
    with open(EVAL_PATH) as fh:
        data = yaml.safe_load(fh)
    assert isinstance(data, list)
    return data


def _save_yaml(entries: list[dict]) -> None:
    """Write back the entries, preserving all fields."""
    # Use a custom representer so multi-line SQL stays as block scalars
    class _Dumper(yaml.Dumper):
        pass

    def _str_representer(dumper, data):
        if "\n" in data:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
        return dumper.represent_scalar("tag:yaml.org,2002:str", data)

    _Dumper.add_representer(str, _str_representer)

    with open(EVAL_PATH, "w") as fh:
        yaml.dump(entries, fh, Dumper=_Dumper,
                  allow_unicode=True, default_flow_style=False, sort_keys=False)


def _within_tolerance(live: str, expected: str, tolerance: float | None) -> bool:
    """Return True if live and expected are equal (or within numeric tolerance)."""
    if live == expected:
        return True
    if tolerance is None:
        return False
    try:
        return abs(float(live) - float(expected)) <= tolerance
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def refresh(*, duckdb_path: Path | None = None) -> dict:
    """Re-run all non-REFUSE answer_sql entries and update expected_answer.

    Returns a dict with keys:
      refreshed  — number of entries whose expected_answer changed
      unchanged  — number of entries that were already correct
      skipped    — number of REFUSE entries skipped
      errors     — list of (id, error_string)
    """
    db_path = duckdb_path or config.DUCKDB_PATH
    entries = _load_yaml()
    con = duckdb.connect(str(db_path), read_only=True)

    changed = 0
    unchanged = 0
    skipped = 0
    errors: list[tuple[str, str]] = []

    for entry in entries:
        if entry.get("expected_answer") == REFUSE_SENTINEL:
            skipped += 1
            continue
        sql = entry.get("answer_sql", "").strip()
        if not sql:
            skipped += 1
            continue
        eid = entry["id"]
        try:
            rows = _run_sql(con, sql)
            live = _canonicalize(rows)
        except Exception as exc:
            errors.append((eid, str(exc)))
            continue

        old = str(entry.get("expected_answer", ""))
        if live != old:
            entry["expected_answer"] = live
            changed += 1
        else:
            unchanged += 1

    con.close()

    if changed or True:  # always save to normalise formatting
        _save_yaml(entries)

    return {"refreshed": changed, "unchanged": unchanged,
            "skipped": skipped, "errors": errors}


def check(*, duckdb_path: Path | None = None) -> dict:
    """Check whether every non-REFUSE expected_answer is still current.

    Returns a dict with keys:
      stale    — list of (id, expected, live) for drifted entries
      ok       — list of ids that are correct
      skipped  — list of REFUSE ids
      errors   — list of (id, error_string)
    """
    db_path = duckdb_path or config.DUCKDB_PATH
    entries = _load_yaml()
    con = duckdb.connect(str(db_path), read_only=True)

    stale: list[tuple[str, str, str]] = []
    ok: list[str] = []
    skipped: list[str] = []
    errors: list[tuple[str, str]] = []

    for entry in entries:
        eid = entry["id"]
        if entry.get("expected_answer") == REFUSE_SENTINEL:
            skipped.append(eid)
            continue
        sql = entry.get("answer_sql", "").strip()
        if not sql:
            skipped.append(eid)
            continue
        try:
            rows = _run_sql(con, sql)
            live = _canonicalize(rows)
        except Exception as exc:
            errors.append((eid, str(exc)))
            continue

        expected = str(entry.get("expected_answer", ""))
        tolerance = entry.get("tolerance")
        if _within_tolerance(live, expected, tolerance):
            ok.append(eid)
        else:
            stale.append((eid, expected, live))

    con.close()
    return {"stale": stale, "ok": ok, "skipped": skipped, "errors": errors}


# ---------------------------------------------------------------------------
# CLI helpers (called from cli.py)
# ---------------------------------------------------------------------------

def cmd_evals_refresh(args) -> None:  # noqa: ARG001
    result = refresh()
    n_changed = result["refreshed"]
    n_ok = result["unchanged"]
    n_skip = result["skipped"]
    errors = result["errors"]
    print(f"evals refresh: {n_changed} updated, {n_ok} unchanged, {n_skip} skipped")
    for eid, err in errors:
        print(f"  ERROR {eid}: {err}", file=sys.stderr)
    if errors:
        sys.exit(1)


def cmd_evals_check(args) -> None:  # noqa: ARG001
    result = check()
    stale = result["stale"]
    ok = result["ok"]
    skip = result["skipped"]
    errors = result["errors"]
    print(f"evals check: {len(ok)} ok, {len(stale)} stale, {len(skip)} skipped")
    for eid, expected, live in stale:
        print(f"  STALE {eid}: expected={expected!r} live={live!r}")
    for eid, err in errors:
        print(f"  ERROR {eid}: {err}", file=sys.stderr)
    if stale or errors:
        print("evals check: FAIL")
        sys.exit(1)
    print("evals check: PASS")
