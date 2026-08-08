"""district-recompute.py — gate 9 (district) leg (e) helper (#51).

Recomputes the district headline total INDEPENDENTLY from the shipped
fct_district_totals.parquet (data/site/data/), so the gate can prove every
district sidecar's total_linkable_dollars agrees with the award-distinct
model rather than with a re-summed fct_district_programs figure.

Invoked by site/scripts/gates/district.mjs:
    uv run python site/scripts/gates/district-recompute.py

No request file needed — the whole table is small (~106 rows). Reads
data/site/data/fct_district_totals.parquet and prints one JSON object on
stdout: {pop_district: {"total_obligation": float, "award_count": int}}.
"""
from __future__ import annotations

import json
import sys

import duckdb

from govbudget.config import ROOT

DT_PARQUET = ROOT / "data" / "site" / "data" / "fct_district_totals.parquet"


def main() -> int:
    if not DT_PARQUET.exists():
        print(f"shipped parquet missing: {DT_PARQUET}", file=sys.stderr)
        return 2

    con = duckdb.connect()
    dt = str(DT_PARQUET).replace("'", "''")
    rows = con.execute(
        f"select pop_district, award_count, total_obligation"
        f" from read_parquet('{dt}')"
    ).fetchall()

    out = {
        pop_district: {"award_count": int(award_count), "total_obligation": float(total_obligation)}
        for pop_district, award_count, total_obligation in rows
    }
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
