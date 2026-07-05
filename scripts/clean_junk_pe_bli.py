"""One-shot cleanup: delete FY2026 budget_lines rows whose pe_bli is an
appropriation SECTION-HEADER label ('RDT&E', 'O&M', …) that mis-parsed into
the BLI slot from an Army P-1 workbook (audit FIX 2).

p1_loader now rejects these at load time (_is_valid_pe_bli), but rows already
in the warehouse from before the guard must be removed — they pollute any
budget_lines-by-pe_bli aggregate (the exporter route-safety filter only hides
them from PAGES, it doesn't clean the table).

SAFETY (verified live 2026-07-05, all confirmed before this script was written):
  * The only FY2026 pe_bli values with a non-alphanumeric char are exactly
    'RDT&E' and 'O&M' (8 rows: 2 labels × 4 amount_types, exhibit P-1, org A,
    account 0390D). This script re-verifies that invariant and REFUSES to run
    if it finds anything else.
  * Legitimate era-procurement keys ('0300D-CBDP-L70', …) contain hyphens but
    live ONLY in FY2017–2023 — the fiscal_year=2026 scope excludes them all.
    This script additionally asserts zero hyphenated era keys are in scope.
  * budget_lines has no inbound foreign keys; the 8 rows are unreferenced.

Idempotent: a second run finds zero junk rows and no-ops.

Usage: uv run python scripts/clean_junk_pe_bli.py [--apply]
       (dry-run by default; pass --apply to commit the DELETE)
"""
from __future__ import annotations

import argparse
import re

import psycopg

from govbudget import config

FY = 2026
# The genuinely-invalid appropriation-label pe_blis. Anything else with a
# non-alphanumeric char in FY2026 is a surprise that aborts the run.
EXPECTED_JUNK = {"RDT&E", "O&M"}
_VALID_BLI_RE = re.compile(r"^[A-Za-z0-9]+$")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="commit the DELETE (default: dry-run)")
    args = ap.parse_args()

    with psycopg.connect(config.PG_DSN) as con:
        found = {
            r[0] for r in con.execute(
                "select distinct pe_bli from budget_lines"
                " where pe_bli !~ '^[A-Za-z0-9]+$' and fiscal_year=%s",
                (FY,),
            ).fetchall()
        }
        print(f"fy{FY}: non-alphanumeric pe_bli values in scope: {sorted(found)}")

        # Guard: refuse if scope contains anything but the known labels — never
        # blindly delete an unexpected row (e.g. a legit hyphenated key that
        # somehow landed in FY2026).
        unexpected = found - EXPECTED_JUNK
        if unexpected:
            raise SystemExit(
                f"ABORT: unexpected non-BLI pe_bli(s) in FY{FY}: {sorted(unexpected)}"
                " — investigate before deleting (do NOT widen this script)."
            )
        # Belt-and-braces: assert no hyphenated era keys are in scope.
        era_in_scope = con.execute(
            "select count(*) from budget_lines"
            " where pe_bli ~ '-L[0-9]' and fiscal_year=%s",
            (FY,),
        ).fetchone()[0]
        if era_in_scope:
            raise SystemExit(
                f"ABORT: {era_in_scope} hyphenated era key(s) found in FY{FY}"
                " — they must never be in scope; investigate."
            )

        rows = con.execute(
            "select id, pe_bli, exhibit, organization, account, amount_type,"
            " amount_thousands from budget_lines"
            " where pe_bli = any(%s) and fiscal_year=%s order by pe_bli, amount_type",
            (list(EXPECTED_JUNK), FY),
        ).fetchall()
        for r in rows:
            print(f"  junk row id={r[0]} {r[1]!r} {r[2]} org={r[3]} acct={r[4]}"
                  f" {r[5]}={r[6]}")
        assert all(not _VALID_BLI_RE.match(r[1]) for r in rows)
        print(f"fy{FY}: {len(rows)} junk row(s) targeted for deletion")

        if not rows:
            print("nothing to clean (idempotent no-op).")
            return

        if not args.apply:
            print("DRY-RUN: pass --apply to commit the DELETE.")
            return

        n = con.execute(
            "delete from budget_lines where pe_bli = any(%s) and fiscal_year=%s",
            (list(EXPECTED_JUNK), FY),
        ).rowcount
        con.commit()
        print(f"fy{FY}: DELETED {n} junk budget_lines row(s).")

        remaining = con.execute(
            "select count(*) from budget_lines"
            " where pe_bli !~ '^[A-Za-z0-9]+$' and fiscal_year=%s",
            (FY,),
        ).fetchone()[0]
        if remaining:
            raise SystemExit(f"FAIL: {remaining} non-BLI FY{FY} row(s) remain")
        print(f"fy{FY}: verified 0 non-BLI rows remain.")


if __name__ == "__main__":
    main()
