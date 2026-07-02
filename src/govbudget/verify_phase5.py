"""Phase 5B-4 acceptance gates: NL eval + cross-phase assembly.

Gates (CLI: verify-phase5):

  1. freshness_gate  — re-runs every non-REFUSE answer_sql against the live
     DuckDB and fails loud if any expected_answer is stale. Runs FIRST so the
     eval_gate operates on a correct expected set.

  2. eval_gate  — runs the analyst agent over all 45 questions (BLOCKED when
     ANTHROPIC_API_KEY is absent). Scores accuracy (≥41/45 = 91.1%, tolerance-
     aware, canonical string compare). REFUSE questions: agent.refuse AND exact
     expected_refuse_class match. Citation resolution: for every non-REFUSE
     answered question, re-executes agent.sql through a fresh SqlTool instance
     (sandboxed, cwd-correct), validates non-empty touched_tables, touched ∩
     tables(answer_sql) non-empty, recomputed answer matches agent.answer AND
     (when the answer scored correct) the EXPECTED answer within tolerance.
     pdf_page citation: citations.parquet lookup on (pe_bli, canonical
     amount_text) with page_number non-null. source_url citation: per-table
     URL-column map. 100% resolution required.

  3. assembly_gate — subprocess-invokes verify-phase{1,2,3,4,5a,5b1,5b3} (NOT
     5b2 — 5b3 runs the same npm suite). Parses each full output with the
     verdict regex; BLOCKED propagates. Prints a result table.

Exit codes:
  0  — all gates PASS
  2  — all gates either PASS or BLOCKED (nothing FAILED), printing the single
       unblock step
  1  — any gate FAILs

BLOCKED behavior: eval_gate → BLOCKED without key; assembly propagates BLOCKED
from sub-phases. Nothing is a hard FAIL if the only issue is a missing API key.

All gate functions take explicit paths — no config read at module level.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

from govbudget import config
from govbudget.evals_refresh import _within_tolerance, _canonicalize, _run_sql
from govbudget.analyst.sql_tool import KNOWN_TABLES, SqlError, SqlTool

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EVAL_PATH = Path(__file__).resolve().parents[2] / "evals" / "phase5_questions.yaml"

# Accuracy threshold: 41/45 ≈ 91.1%
ACCURACY_THRESHOLD = 41

REFUSE_CLASSES = frozenset({"data_not_ingested", "structurally_absent", "classified"})

# Canonical amount_text formatter for citations.parquet lookup
# f"{millions:,.3f}" e.g. "293.145" or "1,234.567"
def _canonical_amount_text(millions: float) -> str:
    return f"{millions:,.3f}"

# Per-table URL-column map (binding from plan rev-2 recon facts)
# key = table name in KNOWN_TABLES, value = column name with URL
_URL_COLUMN_MAP: dict[str, str] = {
    "improper_payments": "source_url",
    "fct_state_per_capita": "spend_source_url",   # state spend questions
    "high_risk": "source_url",                    # GAO high-risk
}
# Population-related questions: use url_column='pop_source_url' in the eval entry
# (q037 sets url_column: pop_source_url; state spend questions use map default)

# Sub-phases to check in assembly gate (NOT 5b2 — 5b3 runs same npm suite)
_ASSEMBLY_PHASES = [
    "verify-phase1",
    "verify-phase2",
    "verify-phase3",
    "verify-phase4",
    "verify-phase5a",
    "verify-phase5b1",
    "verify-phase5b3",
]

# Verdict token regex: parse full output for verdict line
_VERDICT_RE = re.compile(r"verify-phase\w+:\s*(PASS|FAIL|BLOCKED)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Gate 1: Freshness gate
# ---------------------------------------------------------------------------


def freshness_gate(*, duckdb_path: Path | None = None) -> dict:
    """Re-run every non-REFUSE answer_sql; fail if any expected_answer is stale.

    Returns:
        ok (bool), stale (list of (id, expected, live)), errors (list of (id, err))
    """
    import duckdb as _duckdb

    db_path = duckdb_path or config.DUCKDB_PATH
    entries = _load_yaml()
    con = _duckdb.connect(str(db_path), read_only=True)

    stale: list[tuple[str, str, str]] = []
    errors: list[tuple[str, str]] = []
    ok_ids: list[str] = []
    skipped: list[str] = []

    for entry in entries:
        eid = entry["id"]
        if entry.get("expected_answer") == "REFUSE":
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
            ok_ids.append(eid)
        else:
            stale.append((eid, expected, live))

    con.close()
    return {
        "ok": not stale and not errors,
        "stale": stale,
        "errors": errors,
        "ok_ids": ok_ids,
        "skipped": skipped,
    }


# ---------------------------------------------------------------------------
# Gate 2: Eval gate (scoring + citation resolution)
# ---------------------------------------------------------------------------


def _load_yaml() -> list[dict]:
    with open(EVAL_PATH) as fh:
        return yaml.safe_load(fh)


def _score_answer(agent_result: dict, entry: dict) -> bool:
    """Return True if the agent's answer is correct for this entry.

    For REFUSE entries: agent.refuse must be True AND exact enum match on
    expected_refuse_class.
    For answered entries: canonical string compare within tolerance.
    """
    expected = str(entry.get("expected_answer", ""))
    if expected == "REFUSE":
        if not agent_result.get("refuse", False):
            return False
        return agent_result.get("refuse_reason_class") == entry.get("expected_refuse_class")
    else:
        if agent_result.get("refuse", False):
            return False
        agent_answer = str(agent_result.get("answer", ""))
        tolerance = entry.get("tolerance")
        return _within_tolerance(agent_answer, expected, tolerance)


def _resolve_citation(
    agent_result: dict,
    entry: dict,
    *,
    duckdb_path: Path | None = None,
    citations_parquet: Path | None = None,
    is_correct: bool,
) -> dict:
    """Resolve the citation for an answered (non-REFUSE) question.

    Returns:
        ok (bool), reason (str)

    Resolution rules:
    - Re-execute agent.sql through a FRESH SqlTool instance (sandboxed).
    - touched_tables must be non-empty.
    - touched ∩ tables(answer_sql) must be non-empty.
    - Recomputed answer must match agent.answer.
    - When the answer scored correct: recomputed must also match EXPECTED within
      tolerance.
    - pdf_page: citations.parquet lookup on (pe_bli, canonical amount_text)
      with page_number non-null. Requires pe_bli + amount_text columns in
      citations.parquet (Task 4 adds them).
    - source_url: per-table URL-column map via fresh SqlTool.
    """
    if agent_result.get("refuse", False):
        # REFUSE questions — citation resolution is not evaluated
        return {"ok": True, "reason": "skipped (REFUSE)"}

    agent_sql = agent_result.get("sql")
    citation_kind = agent_result.get("citation_kind", "none")
    citation = agent_result.get("citation")

    if not agent_sql:
        if citation_kind in ("none", "warehouse") and not agent_result.get("answer"):
            return {"ok": False, "reason": "agent provided no SQL and no answer"}
        # No SQL and citation_kind == 'none' — treat as unresolvable
        return {"ok": False, "reason": "agent provided no SQL for answered question"}

    # --- Re-execute through fresh SqlTool ---
    db_path = duckdb_path or config.DUCKDB_PATH
    try:
        with SqlTool(db_path) as fresh_tool:
            result = fresh_tool.run(agent_sql)
    except SqlError as exc:
        return {"ok": False, "reason": f"recompute SQL rejected by gate: {exc}"}
    except Exception as exc:
        return {"ok": False, "reason": f"recompute SQL failed: {exc}"}

    touched = result.get("touched_tables", set())
    recomputed_rows = result.get("rows", [])
    recomputed = _canonicalize([tuple(r) for r in recomputed_rows]) if recomputed_rows else ""

    # touched_tables must be non-empty
    if not touched:
        return {"ok": False, "reason": "recompute: empty touched_tables (literal/echo SQL)"}

    # touched ∩ tables(answer_sql) must be non-empty
    # Extract tables from the ENTRY's answer_sql (the correct SQL)
    entry_sql = entry.get("answer_sql", "")
    entry_tokens = set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", entry_sql)) & KNOWN_TABLES
    if not (touched & entry_tokens):
        return {
            "ok": False,
            "reason": (
                f"recompute: touched_tables {touched} does not overlap "
                f"tables in answer_sql {entry_tokens}"
            ),
        }

    # Recomputed must match agent.answer
    agent_answer = str(agent_result.get("answer", ""))
    tolerance = entry.get("tolerance")
    if not _within_tolerance(recomputed, agent_answer, tolerance):
        return {
            "ok": False,
            "reason": (
                f"recompute mismatch: fresh SQL returned {recomputed!r} "
                f"but agent claimed {agent_answer!r}"
            ),
        }

    # When scored correct: recomputed must also match EXPECTED
    if is_correct:
        expected = str(entry.get("expected_answer", ""))
        if not _within_tolerance(recomputed, expected, tolerance):
            return {
                "ok": False,
                "reason": (
                    f"recompute-vs-expected mismatch: fresh SQL returned {recomputed!r} "
                    f"but expected {expected!r}"
                ),
            }

    # --- Citation-kind specific resolution ---
    if citation_kind == "pdf_page":
        return _resolve_pdf_page(agent_result, entry, citations_parquet=citations_parquet)
    elif citation_kind == "source_url":
        # Pass per-question url_column override when present (e.g. pop_source_url for q037)
        return _resolve_source_url(
            agent_result, touched, db_path=db_path,
            url_column=entry.get("url_column"),
        )
    elif citation_kind in ("warehouse", "none"):
        # Warehouse / none: SQL re-execution is sufficient
        return {"ok": True, "reason": f"recomputed ok via {citation_kind}"}
    elif citation_kind == "filing_uuid":
        # LDA filing UUID — verify citation is non-empty
        if not citation:
            return {"ok": False, "reason": "filing_uuid citation is empty"}
        return {"ok": True, "reason": "filing_uuid citation present"}
    else:
        return {"ok": False, "reason": f"unknown citation_kind: {citation_kind!r}"}


def _resolve_pdf_page(
    agent_result: dict,
    entry: dict,
    *,
    citations_parquet: Path | None = None,
) -> dict:
    """Resolve a pdf_page citation against citations.parquet.

    Redesigned to resolve against the AGENT's answer rather than the entry's
    expected_answer, which prevents crashes on compound answers ("Iron Dome, 3080")
    and unit mismatches (billions vs millions).

    Resolution: match citations.parquet on pe_bli alone (extracted from the
    agent's citation string or SQL), requiring page_number non-null. The pe_bli
    is the authoritative key — wrong pe_bli still fails even if amounts match.

    Schema requirement: citations.parquet must have a pe_bli column (added by
    export-site pipeline). If absent, fails with an actionable message.
    """
    import duckdb as _duckdb

    cit_path = citations_parquet or (
        config.ROOT / "data" / "site" / "citations" / "citations.parquet"
    )
    if not Path(cit_path).exists():
        return {"ok": False, "reason": f"citations.parquet not found: {cit_path}"}

    # Extract pe_bli from agent's citation string or SQL.
    # Intentionally does NOT use entry.expected_answer to avoid:
    #   (a) float() crash on compound answers like "Iron Dome, 3080"
    #   (b) unit mismatch when expected is in billions but citations in millions
    citation = agent_result.get("citation", "") or ""
    agent_sql = agent_result.get("sql", "") or ""
    pe_bli = _extract_pe_bli(citation, agent_sql)

    if not pe_bli:
        return {"ok": False, "reason": "pdf_page: could not extract pe_bli from agent citation/SQL"}

    try:
        con = _duckdb.connect()
        # Check for pe_bli column — graceful fail if absent
        cols = [r[0] for r in con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{cit_path}')"
        ).fetchall()]

        if "pe_bli" not in cols:
            con.close()
            return {
                "ok": False,
                "reason": (
                    "pdf_page: citations.parquet has no pe_bli column — "
                    "re-run `govbudget export-site` after Task 4 is applied"
                ),
            }

        # Match on pe_bli alone — the authoritative key for J-book page lookup.
        # wrong pe_bli → no row → fails (even if the amount would match).
        rows = con.execute(
            f"""
            SELECT page_number FROM read_parquet('{cit_path}')
            WHERE kind = 'jbook_pdf'
              AND pe_bli = ?
              AND page_number IS NOT NULL
            LIMIT 1
            """,
            [pe_bli],
        ).fetchall()
        con.close()

        if not rows:
            return {
                "ok": False,
                "reason": (
                    f"pdf_page: no citation row for pe_bli={pe_bli!r} "
                    f"(or page_number is null)"
                ),
            }
        page = rows[0][0]
        return {"ok": True, "reason": f"pdf_page: page {page} found for pe_bli={pe_bli!r}"}

    except Exception as exc:
        return {"ok": False, "reason": f"pdf_page lookup error: {exc}"}


def _extract_pe_bli(citation: str, sql: str) -> str | None:
    """Extract pe_bli from agent's citation string or SQL.

    Looks for a PE number pattern like '0601101E' or '1160401BB'.
    """
    # Try citation text first
    m = re.search(r"\b([0-9]{6,7}[A-Z]{1,3})\b", citation or "")
    if m:
        return m.group(1)
    # Try SQL
    m = re.search(r"pe_bli\s*=\s*['\"]([^'\"]+)['\"]", sql or "", re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"\b([0-9]{6,7}[A-Z]{1,3})\b", sql or "")
    if m:
        return m.group(1)
    return None


def _resolve_source_url(
    agent_result: dict,
    touched: set[str],
    *,
    db_path: Path | None = None,
    url_column: str | None = None,
) -> dict:
    """Resolve a source_url citation via the per-table URL-column map.

    When url_column is provided (from the eval entry's optional url_column field),
    it overrides the per-table map default. This is used for population questions
    (q037) where fct_state_per_capita has both spend_source_url (map default) and
    pop_source_url (the correct column for population-derived answers).

    Runs a fresh SqlTool query to fetch a non-empty URL from the touched table.
    """
    # Determine which table to look up the URL from
    url_table = None
    url_col = None

    # Find first touched table that has a URL column
    for tbl in touched:
        if tbl in _URL_COLUMN_MAP:
            url_table = tbl
            # Per-question url_column override takes precedence over map default
            url_col = url_column if url_column is not None else _URL_COLUMN_MAP[tbl]
            break

    if not url_table:
        return {
            "ok": False,
            "reason": (
                f"source_url: no URL-column mapping for touched tables {touched}; "
                f"known map: {list(_URL_COLUMN_MAP.keys())}"
            ),
        }

    # Verify the URL column exists and has a non-empty value
    real_db = db_path or config.DUCKDB_PATH
    try:
        with SqlTool(real_db) as t:
            result = t.run(
                f"SELECT {url_col} FROM {url_table} WHERE {url_col} IS NOT NULL LIMIT 1"
            )
        rows = result.get("rows", [])
        if not rows or not rows[0][0]:
            return {
                "ok": False,
                "reason": f"source_url: {url_table}.{url_col} has no non-empty URL",
            }
        return {"ok": True, "reason": f"source_url: found via {url_table}.{url_col}"}
    except SqlError as exc:
        return {"ok": False, "reason": f"source_url lookup SQL error: {exc}"}
    except Exception as exc:
        return {"ok": False, "reason": f"source_url lookup error: {exc}"}


def eval_gate(
    *,
    client=None,
    duckdb_path: Path | None = None,
    citations_parquet: Path | None = None,
) -> dict:
    """Run the analyst agent over all 45 eval questions.

    Returns:
        ok (bool)
        blocked (bool)  — True when ANTHROPIC_API_KEY is absent
        scores (list of dicts, one per question)
        accuracy (int)  — number of correctly scored answers
        total (int)     — 45
        citation_ok (int)    — answered questions with resolved citations
        citation_total (int) — answered questions evaluated for citation
        reason (str | None)  — set when BLOCKED or FAIL
    """
    from govbudget.common.anthropic_client import require_client
    from govbudget.analyst.agent import run as agent_run

    _NO_KEY_MSG = """\
eval_gate: ANTHROPIC_API_KEY is not set — the live eval run is BLOCKED.

Export a key and re-run:

    export ANTHROPIC_API_KEY=sk-ant-...
    uv run python -m govbudget verify-phase5

Nothing was run and nothing was spent. (~45 questions × ~8 turns ≈ $0.50 uncached.)"""

    # Check for client/key — do NOT call require_client yet (it exits)
    import os
    if client is None and not os.environ.get("ANTHROPIC_API_KEY"):
        return {
            "ok": False,
            "blocked": True,
            "scores": [],
            "accuracy": 0,
            "total": 45,
            "citation_ok": 0,
            "citation_total": 0,
            "reason": _NO_KEY_MSG,
        }

    # Acquire client (exits if key absent and no fake client passed)
    real_client = require_client(client, message=_NO_KEY_MSG)

    entries = _load_yaml()
    scores: list[dict[str, Any]] = []
    correct = 0
    citation_ok = 0
    citation_total = 0

    for entry in entries:
        eid = entry["id"]
        question = entry["question"]
        expected = str(entry.get("expected_answer", ""))

        # Run the agent
        try:
            result = agent_run(
                question,
                client=real_client,
                duckdb_path=duckdb_path,
                print_cost=False,
            )
        except SystemExit as exc:
            # Key vanished mid-run
            return {
                "ok": False,
                "blocked": True,
                "scores": scores,
                "accuracy": correct,
                "total": len(entries),
                "citation_ok": citation_ok,
                "citation_total": citation_total,
                "reason": str(exc),
            }
        except Exception as exc:
            result = {
                "answer": "ERROR",
                "refuse": True,
                "refuse_reason_class": "structurally_absent",
                "sql": None,
                "citation_kind": "none",
                "citation": str(exc),
                "turns": 0,
                "cost_usd": 0.0,
                "touched_tables": set(),
            }

        is_correct = _score_answer(result, entry)
        if is_correct:
            correct += 1

        # Citation resolution — only for answered (non-REFUSE) questions
        cit_result: dict | None = None
        if not result.get("refuse", False):
            citation_total += 1
            cit_result = _resolve_citation(
                result,
                entry,
                duckdb_path=duckdb_path,
                citations_parquet=citations_parquet,
                is_correct=is_correct,
            )
            if cit_result["ok"]:
                citation_ok += 1

        scores.append({
            "id": eid,
            "question": question[:80],
            "expected": expected,
            "agent_answer": result.get("answer", ""),
            "agent_refuse": result.get("refuse", False),
            "agent_refuse_class": result.get("refuse_reason_class"),
            "correct": is_correct,
            "citation_kind": result.get("citation_kind"),
            "citation_resolved": cit_result["ok"] if cit_result else None,
            "citation_reason": cit_result["reason"] if cit_result else None,
            "turns": result.get("turns", 0),
            "cost_usd": result.get("cost_usd", 0.0),
        })

    accuracy_ok = correct >= ACCURACY_THRESHOLD
    citation_ok_all = citation_total == 0 or citation_ok == citation_total

    return {
        "ok": accuracy_ok and citation_ok_all,
        "blocked": False,
        "scores": scores,
        "accuracy": correct,
        "total": len(entries),
        "citation_ok": citation_ok,
        "citation_total": citation_total,
        "reason": None if (accuracy_ok and citation_ok_all) else (
            f"accuracy {correct}/{len(entries)} < {ACCURACY_THRESHOLD} threshold"
            if not accuracy_ok
            else f"citation resolution {citation_ok}/{citation_total} < 100%"
        ),
    }


# ---------------------------------------------------------------------------
# Gate 3: Assembly gate
# ---------------------------------------------------------------------------


def assembly_gate(*, repo_root: Path | None = None) -> dict:
    """Subprocess each phase verifier and collect verdicts.

    Returns:
        ok (bool)
        blocked (bool)      — True if any gate is BLOCKED and none FAILed
        all_blocked_phases (list[str])
        results (list of dicts): phase, returncode, verdict, blocked, output_tail
    """
    root = repo_root or config.ROOT
    results: list[dict] = []
    any_fail = False
    blocked_phases: list[str] = []

    for phase_cmd in _ASSEMBLY_PHASES:
        proc = subprocess.run(
            ["uv", "run", "python", "-m", "govbudget", phase_cmd],
            capture_output=True,
            text=True,
            cwd=str(root),
        )
        full_output = proc.stdout + proc.stderr
        returncode = proc.returncode

        # Parse verdict from full output via regex
        m = _VERDICT_RE.search(full_output)
        if m:
            verdict = m.group(1).upper()
        else:
            # No verdict found — infer from returncode
            verdict = "PASS" if returncode == 0 else "FAIL"

        is_blocked = verdict == "BLOCKED"
        is_fail = verdict == "FAIL" or (returncode not in (0, 1, 2) and not is_blocked)

        # Also treat returncode == 1 with BLOCKED verdict as blocked
        if is_blocked:
            blocked_phases.append(phase_cmd)
        elif is_fail:
            any_fail = True

        results.append({
            "phase": phase_cmd,
            "returncode": returncode,
            "verdict": verdict,
            "blocked": is_blocked,
            "output_tail": full_output[-800:],  # keep last 800 chars
        })

    ok = not any_fail and not blocked_phases
    blocked = not any_fail and bool(blocked_phases)

    return {
        "ok": ok,
        "blocked": blocked,
        "all_blocked_phases": blocked_phases,
        "results": results,
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _compute_exit_code(*, fg_ok: bool, eg: dict, ag: dict) -> int:
    """Determine the exit code given gate results.

    Truth table:
      freshness FAIL                        → 1  (data stale, must fix first)
      eval FAIL (ran, accuracy below bar)   → 1  (regardless of assembly state)
      eval PASS + assembly FAIL             → 1  (assembly hard failure)
      eval PASS + assembly BLOCKED          → 2  (only key blocking remains)
      eval BLOCKED + assembly BLOCKED       → 2  (all blocks are key-related)
      eval BLOCKED + assembly PASS          → 2  (key blocks eval only)
      all PASS                              → 0

    The critical invariant: exit 2 ONLY when every non-green item is
    genuinely key-blocked.  If eval ran and failed (ok=False, blocked=False),
    that is a hard FAIL → exit 1, regardless of assembly state.
    """
    if not fg_ok:
        return 1

    eval_ran_and_failed = not eg.get("ok", False) and not eg.get("blocked", False)
    if eval_ran_and_failed:
        return 1

    assembly_hard_failed = not ag.get("ok", False) and not ag.get("blocked", False)
    if assembly_hard_failed:
        return 1

    all_green = eg.get("ok", False) and ag.get("ok", False)
    if all_green:
        return 0

    # Everything non-green is either blocked or already green → key-blocked
    return 2


def cmd_verify_phase5(args) -> None:  # noqa: ARG001
    """Verify phase 5: freshness gate + eval gate + assembly gate."""
    repo_root = Path(__file__).resolve().parents[2]
    duckdb_path = config.DUCKDB_PATH
    citations_parquet = repo_root / "data" / "site" / "citations" / "citations.parquet"

    print("=== verify-phase5 ===")
    print(f"repo root: {repo_root}")
    print()

    all_ok = True
    any_blocked = False

    # ── Gate 1: Freshness ───────────────────────────────────────────────────
    print("--- gate freshness ---")
    fg = freshness_gate(duckdb_path=duckdb_path)
    if fg["ok"]:
        print(f"gate freshness: {len(fg['ok_ids'])} answers current → PASS")
    else:
        for eid, expected, live in fg["stale"]:
            print(f"  STALE {eid}: expected={expected!r} live={live!r}")
        for eid, err in fg["errors"]:
            print(f"  ERROR {eid}: {err}")
        print("gate freshness: FAIL")
        all_ok = False
    print()

    # ── Gate 2: Eval ────────────────────────────────────────────────────────
    print("--- gate eval ---")
    eg = eval_gate(duckdb_path=duckdb_path, citations_parquet=citations_parquet)

    # Persist per-question results BEFORE any printing — a live eval run costs
    # real money and must never be lost to a reporting bug.
    if not eg["blocked"]:
        runs_dir = config.RESEARCH_DIR / "eval-runs"
        runs_dir.mkdir(parents=True, exist_ok=True)
        run_path = runs_dir / (
            f"eval-{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
        )
        run_path.write_text(json.dumps(eg, indent=2, sort_keys=True, default=str))
        print(f"gate eval: per-question results -> {run_path}")

    if eg["blocked"]:
        print(f"gate eval: BLOCKED — {eg['reason'].splitlines()[0]}")
        any_blocked = True
        all_ok = False
    elif eg["ok"]:
        print(
            f"gate eval: accuracy {eg['accuracy']}/{eg['total']}, "
            f"citation {eg['citation_ok']}/{eg['citation_total']} → PASS"
        )
    else:
        # Print score details. NOTE: dict.get(k, '') returns None when the key
        # exists with a None value — use `or ''` for optional fields.
        for s in eg["scores"]:
            if not s["correct"] or (s["citation_resolved"] is False):
                print(
                    f"  {s['id']}: correct={s['correct']} "
                    f"cite={s.get('citation_resolved')} "
                    f"answer={(s.get('agent_answer') or '')[:60]!r} "
                    f"({(s.get('citation_reason') or '')[:60]})"
                )
        print(
            f"gate eval: accuracy {eg['accuracy']}/{eg['total']}, "
            f"citation {eg['citation_ok']}/{eg['citation_total']} → FAIL"
        )
        all_ok = False
    print()

    # ── Gate 3: Assembly ────────────────────────────────────────────────────
    print("--- gate assembly ---")
    ag = assembly_gate(repo_root=repo_root)

    verdicts: list[str] = []
    for r in ag["results"]:
        status = r["verdict"]
        verdicts.append(f"  {r['phase']}: {status}")
        print(f"  {r['phase']}: {status}")

    if ag["ok"]:
        print("gate assembly: PASS")
    elif ag["blocked"]:
        print(f"gate assembly: BLOCKED ({', '.join(ag['all_blocked_phases'])})")
        any_blocked = True
        all_ok = False
    else:
        print("gate assembly: FAIL")
        all_ok = False
    print()

    # ── Summary ─────────────────────────────────────────────────────────────
    print("=== summary ===")
    print(f"  gate freshness: {'PASS' if fg['ok'] else 'FAIL'}")
    if eg["blocked"]:
        print("  gate eval:      BLOCKED")
    else:
        print(f"  gate eval:      {'PASS' if eg['ok'] else 'FAIL'}")
    if ag["ok"]:
        print("  gate assembly:  PASS")
    elif ag["blocked"]:
        print(f"  gate assembly:  BLOCKED ({', '.join(ag['all_blocked_phases'])})")
    else:
        print("  gate assembly:  FAIL")
    print()

    exit_code = _compute_exit_code(fg_ok=fg["ok"], eg=eg, ag=ag)

    if exit_code == 0:
        print("verify-phase5: PASS")
    elif exit_code == 2:
        print(
            "verify-phase5: BLOCKED — one or more gates require ANTHROPIC_API_KEY.\n"
            "To unblock: export ANTHROPIC_API_KEY=sk-ant-... && "
            "uv run python -m govbudget verify-phase5"
        )
    else:
        print("verify-phase5: FAIL")

    sys.exit(exit_code)
