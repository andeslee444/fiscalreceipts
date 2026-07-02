"""Phase 5B-3 acceptance gates: dossiers, feed, district, filing, OG, animation.

Gates (CLI: verify-phase5b3):

  The verify-phase5b3 command runs the following checks:

  1. dossier_gate — checks that dossier artifacts exist in data/site/json/dossiers/.
     If artifacts are absent → BLOCKED (live batch requires ANTHROPIC_API_KEY).
     To generate: uv run python -m govbudget dossiers submit

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
import subprocess
import sys
from pathlib import Path


def dossier_gate(site_json_dir: Path) -> dict:
    """Check that dossier artifacts exist in data/site/json/dossiers/.

    Returns:
        dict with keys: ok (bool), blocked (bool), count (int), reason (str)
    """
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

    return {
        "ok": True,
        "blocked": False,
        "count": len(dossier_files),
        "reason": None,
    }


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

    # ── Gate dossier: check artifact presence ─────────────────────────────────
    print("--- gate dossier ---")
    dg = dossier_gate(site_json_dir)

    if dg["blocked"]:
        print(f"gate dossier: BLOCKED — {dg['reason']}")
        gates_ok = False
    elif dg["ok"]:
        print(f"gate dossier: {dg['count']} dossier files present → PASS")
    else:
        print(f"gate dossier: FAIL — {dg['reason']}")
        gates_ok = False

    print()

    # ── Animation gate informational note ──────────────────────────────────────
    note = animation_gate_note(dossiers_blocked=dg["blocked"])
    print(f"note: {note}")
    print()

    # ── npm verify (gates 1-12) ────────────────────────────────────────────────
    print("--- npm verify (gates 1-12) ---")
    result = subprocess.run(
        ["npm", "--prefix", str(site_dir), "run", "verify"],
        cwd=str(repo_root),
    )
    npm_ok = result.returncode == 0

    if not npm_ok:
        gates_ok = False

    # ── Summary ────────────────────────────────────────────────────────────────
    print()
    print("=== summary ===")
    print(f"  gate dossier: {'PASS' if dg['ok'] else 'BLOCKED' if dg['blocked'] else 'FAIL'}")
    print(f"  npm verify:   {'PASS' if npm_ok else 'FAIL'}")
    print()

    if dg["blocked"]:
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
