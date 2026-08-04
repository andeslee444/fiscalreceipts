#!/usr/bin/env python3
"""datatruth-recompute.py — gate 24 parquet-truth helper (PM Sprint 2, §P1-5).

Answers, on stdout as JSON, the ONE question the gate cannot answer in Node:
what is the real row count of every Explorer parquet shipped in
data/site/data/?

Recomputed INDEPENDENTLY from the parquet files themselves via DuckDB —
never from manifest.json, site_meta.json or datasets.json (those are the
artifacts under test; reading them here would make the gate tautological).

Output:
{
  "budget_lines": {"rows": 8549, "bytes": 185690},
  ...
}
"""

import json
import os
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
DATA_DIR = REPO / "data" / "site" / "data"


def main() -> int:
    if not DATA_DIR.is_dir():
        print(json.dumps({"__error__": f"missing {DATA_DIR}"}))
        return 1
    out: dict[str, dict[str, int]] = {}
    for pq in sorted(DATA_DIR.glob("*.parquet")):
        n = duckdb.sql(
            f"select count(*) from read_parquet('{pq.as_posix()}')"
        ).fetchone()[0]
        out[pq.stem] = {"rows": int(n), "bytes": os.path.getsize(pq)}
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
