"""Phase 5B-3 acceptance gates: dossiers, feed, district, filing, OG, animation.

Gates (CLI: verify-phase5b3):

  The verify-phase5b3 command runs the following checks:

  1. dossier_gate — when dossier artifacts are absent → BLOCKED (live batch
     requires ANTHROPIC_API_KEY). When artifacts are present, calls the REAL
     govbudget.dossiers.gate.dossier_gate which validates:
       - every top-50 pe_bli has a dossier file (dossiers_present)
       - dossier structure is valid (structure)
       - every fact_id ∈ citations.json keys; every url ∈ cached snapshot URLs
         (citations_resolvable)
       - required sections are non-empty (required_sections)
       - ≥80% corpus-wide claims carry warehouse fact_id citations (warehouse_ratio)
       - program_categories.csv covers all top-50 pe_blis with a valid enum
         category and resolvable source_ref (categories)
     Prints per-check lines and every unresolved citation.

  2. npm verify — shells `npm --prefix site run verify`, which runs all gates
     1-12 from site/scripts/verify.mjs (5B-2 gates + new 5B-3 gates 8-12).

  3. animation_gate_note — if dossiers are absent, notes that the animation gate
     is verifiable against taxonomy only (dossier pages are optional for PASS).

Exit codes:
  0 — all gates pass (dossiers present + npm verify passes)
  1 — one or more gates fail or are BLOCKED

BLOCKED behavior: dossier_gate BLOCKED prints a message and continues.
The exit code is 1 when dossiers are absent (phase cannot fully PASS).

All gate functions take explicit paths — never read config at module level.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def _dossier_blocked(site_json_dir: Path) -> dict | None:
    """Return a BLOCKED result dict if dossiers are absent/empty, else None."""
    dossiers_dir = site_json_dir / "dossiers"

    if not dossiers_dir.exists():
        return {
            "ok": False,
            "blocked": True,
            "count": 0,
            "reason": (
                "dossier artifacts absent — live batch requires ANTHROPIC_API_KEY "
                "(plan decision 6); run: uv run python -m govbudget dossiers submit"
            ),
        }

    dossier_files = list(dossiers_dir.glob("*.json"))
    if not dossier_files:
        return {
            "ok": False,
            "blocked": True,
            "count": 0,
            "reason": (
                "dossiers/ directory exists but contains no .json files — "
                "batch may not have completed; run: uv run python -m govbudget dossiers collect"
            ),
        }

    return None


def _run_real_gate(site_json_dir: Path, repo_root: Path) -> dict:
    """Call the real govbudget.dossiers.gate.dossier_gate with live paths."""
    from govbudget import config
    from govbudget.dossiers.gate import dim_programs_pe_set, dossier_gate
    from govbudget.dossiers.research import top50

    dossier_dir = site_json_dir / "dossiers"
    citations_path = site_json_dir / "citations.json"
    snapshots_index = repo_root / "data" / "research" / "snapshots" / "index.json"
    categories_csv = repo_root / "data-seeds" / "program_categories.csv"

    top50_list = top50(config.DUCKDB_PATH)
    dim_pe = dim_programs_pe_set(config.DUCKDB_PATH)

    return dossier_gate(
        dossier_dir,
        citations_path,
        snapshots_index,
        categories_csv,
        top50_list,
        dim_programs_pe=dim_pe,
    )


def _print_gate_result(result: dict) -> None:
    """Print per-check lines and every unresolved citation."""
    checks = result["checks"]
    for name, check in checks.items():
        status = "PASS" if check["ok"] else "FAIL"
        detail = ""
        if name == "warehouse_ratio":
            detail = (
                f" ({check['warehouse_cited']}/{check['claims']}"
                f" = {check['ratio']:.1%}, floor {check['floor']:.0%})"
            )
        elif name == "dossiers_present":
            detail = f" ({result['totals']['dossiers']}/{check['expected']} present)"
        print(f"  dossiers_{name}: {status}{detail}")
        # List unresolved citations verbosely
        if name == "citations_resolvable" and not check["ok"]:
            for item in check.get("unresolved", []):
                pe = item["pe_bli"]
                sec = item["section"]
                idx = item["claim"]
                if "fact_id" in item:
                    print(f"    unresolved: {pe} {sec}[{idx}] fact_id={item['fact_id']!r}")
                else:
                    print(f"    unresolved: {pe} {sec}[{idx}] url={item['url']!r}")
        elif name in ("dossiers_present", "structure", "required_sections", "categories"):
            for key in ("missing", "errors", "empty"):
                for item in check.get(key, []):
                    print(f"    {key[:-1] if key.endswith('s') else key}: {item}")

    totals = result.get("totals", {})
    print(
        f"  totals: {totals.get('dossiers', '?')} dossiers, "
        f"{totals.get('claims', '?')} claims, "
        f"{totals.get('warehouse_cited', '?')} warehouse-cited "
        f"({totals.get('warehouse_ratio', 0):.1%})"
    )
    print(f"gate dossier: → {'PASS' if result['ok'] else 'FAIL'}")


def animation_gate_note(dossiers_blocked: bool) -> str:
    """Return an informational note about the animation gate relative to dossiers.

    The animation gate (gate 12) checks category hero sections and CSS
    prefers-reduced-motion rules. It runs against taxonomy data and built pages
    only — dossier artifacts are not required.

    When dossiers are absent, program pages still render (with non-dossier layout).
    The hero section is emitted by the program page template for ALL programs;
    the dossier body sections are conditional on dossier artifacts.
    """
    if dossiers_blocked:
        return (
            "animation_gate (gate 12): INFORMATIONAL — category hero animations "
            "verified against taxonomy, but dossier program body sections are absent. "
            "The gate checks CSS prefers-reduced-motion and hero presence; "
            "these do NOT require dossier artifacts. Gate 12 can PASS without dossiers."
        )
    return "animation_gate (gate 12): dossiers present — full hero + body animation check active."


def cmd_verify_phase5b3(args) -> None:
    """Verify phase 5B-3: dossier_gate + npm verify (gates 1-12)."""
    # __file__ is at src/govbudget/verify_phase5b3.py
    # parents[0] = src/govbudget/
    # parents[1] = src/
    # parents[2] = GovBudget/  ← repo root
    repo_root = Path(__file__).resolve().parents[2]
    site_dir = repo_root / "site"
    site_json_dir = repo_root / "data" / "site" / "json"

    print("=== verify-phase5b3 ===")
    print(f"repo root: {repo_root}")
    print()

    gates_ok = True

    # ── Gate dossier ──────────────────────────────────────────────────────────
    print("--- gate dossier ---")
    blocked = _dossier_blocked(site_json_dir)
    dossiers_blocked = blocked is not None

    if blocked is not None:
        print(f"gate dossier: BLOCKED — {blocked['reason']}")
        gates_ok = False
        dg_ok = False
    else:
        # Dossiers exist — run the REAL gate
        try:
            result = _run_real_gate(site_json_dir, repo_root)
        except Exception as exc:
            print(f"gate dossier: ERROR running real gate — {exc}")
            gates_ok = False
            dg_ok = False
        else:
            _print_gate_result(result)
            dg_ok = result["ok"]
            if not dg_ok:
                gates_ok = False

    print()

    # ── Animation gate informational note ──────────────────────────────────────
    note = animation_gate_note(dossiers_blocked=dossiers_blocked)
    print(f"note: {note}")
    print()

    # ── npm verify (gates 1-12) ────────────────────────────────────────────────
    print("--- npm verify (gates 1-12) ---")
    # Gate 1's sitemap-origin leg needs the canonical site origin at verify
    # time; inheriting a shell without NEXT_PUBLIC_SITE_URL fails the gate on
    # environment, not content (the backlog-#18 footgun). Default it here so
    # the wrapped verify is deterministic; an explicit env still wins.
    npm_env = {
        **os.environ,
        "NEXT_PUBLIC_SITE_URL": os.environ.get(
            "NEXT_PUBLIC_SITE_URL", "https://fiscalreceipts.com"
        ),
    }
    result_npm = subprocess.run(
        ["npm", "--prefix", str(site_dir), "run", "verify"],
        cwd=str(repo_root),
        env=npm_env,
    )
    npm_ok = result_npm.returncode == 0

    if not npm_ok:
        gates_ok = False

    # ── Summary ────────────────────────────────────────────────────────────────
    print()
    print("=== summary ===")
    if dossiers_blocked:
        print("  gate dossier: BLOCKED")
    else:
        print(f"  gate dossier: {'PASS' if dg_ok else 'FAIL'}")
    print(f"  npm verify:   {'PASS' if npm_ok else 'FAIL'}")
    print()

    if dossiers_blocked:
        print(
            "verify-phase5b3: BLOCKED — dossier artifacts absent "
            "(phase cannot fully PASS without dossiers).\n"
            "To unblock: uv run python -m govbudget dossiers submit"
        )
    elif gates_ok:
        print("verify-phase5b3: PASS")
    else:
        print("verify-phase5b3: FAIL")

    sys.exit(0 if gates_ok else 1)
