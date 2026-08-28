#!/usr/bin/env python3
"""volumes-recompute.py — gate 14 leg (cv) helper.

Answers, on stdout as JSON, the ONE question the coverage gate cannot answer
in Node: of the FY2026 justification volumes SITTING IN THIS REPO, how many
has the ingestion actually parsed?

Why this exists. /coverage/ published, for months, that the program pages
without R-2/P-40 detail were missing it because "the services publish no
matching R-2/P-40 justification" and that "the missing volumes do not exist
publicly". Both sentences were false at the moment they shipped: the volumes
were downloaded, in this repository, unparsed. Every NUMBER on that page was
recomputed and correct; the false claim rode in the prose beside them, where
no number-vs-citation gate could see it.

So this leg checks a CLAIM DIRECTION against the world, not a figure against
its citation. The reconciliation is exact and per-file, never a pair of
counts that could both be wrong in the same direction:

  on disk    = every file under data/raw_docs/fy2026/{org}/ whose extension
               is one the ingestion actually consumes (derived from the
               extensions present in documents.parquet — never a literal
               list, so a new source format cannot silently escape the
               reconciliation)
  ingested   = rel_path values in data/parquet/jbooks/documents.parquet
               for fiscal_year 2026
  unparsed   = on-disk files whose rel_path is absent from that parquet

Read from the RAW download tree and the STAGED lake — both upstream of
site_meta, programs_excluded.json and every sidecar /coverage/ renders from.
Reading any of those here would make the leg tautological: the exporter
would be marking its own homework.

Output:
{
  "fiscal_year": 2026,
  "on_disk": 81, "ingested": 56, "unparsed": 25,
  "by_org": {"n": {"on_disk": 13, "ingested": 2, "unparsed": 11}, ...},
  "unparsed_orgs": ["a", "f", "n"],
  "sample_unparsed": ["fy2026/n/SCN_Book.pdf", ...]
}

`unparsed_orgs` is sorted; `sample_unparsed` is capped so a gate failure
message stays readable.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FISCAL_YEAR = "2026"
SAMPLE_CAP = 12


def _repo_root() -> Path:
    # site/scripts/gates/ -> site/scripts -> site -> repo root
    return Path(__file__).resolve().parents[3]


def main() -> int:
    root = _repo_root()
    raw_dir = root / "data" / "raw_docs" / f"fy{FISCAL_YEAR}"
    docs_pq = root / "data" / "parquet" / "jbooks" / "documents.parquet"

    # A checkout without the raw tree or the staged lake cannot answer the
    # question. Say so explicitly rather than reporting a fabricated zero —
    # "unparsed: 0" is exactly the answer that would let the false claim back
    # onto the page.
    if not raw_dir.is_dir():
        print(json.dumps({"__skip__": f"no raw_docs tree at {raw_dir}"}))
        return 0
    if not docs_pq.exists():
        print(json.dumps({"__skip__": f"no documents.parquet at {docs_pq}"}))
        return 0

    try:
        import duckdb
    except ImportError as e:  # pragma: no cover - environment guard
        print(json.dumps({"__error__": f"duckdb unavailable: {e}"}))
        return 0

    con = duckdb.connect()
    try:
        pq = str(docs_pq).replace("'", "''")
        rows = con.execute(
            f"select rel_path from read_parquet('{pq}')"
            f" where fiscal_year = '{FISCAL_YEAR}' and rel_path is not null"
        ).fetchall()
    finally:
        con.close()

    ingested = {r[0] for r in rows}
    # The extensions the ingestion demonstrably consumes, derived rather than
    # listed: today {.pdf, .xlsx}. A .csv source added upstream would join the
    # reconciliation automatically instead of being quietly exempt from it.
    exts = {os.path.splitext(p)[1].lower() for p in ingested if os.path.splitext(p)[1]}
    if not exts:
        print(json.dumps({"__error__": "documents.parquet holds no FY2026 rel_paths"}))
        return 0

    by_org: dict[str, dict[str, int]] = {}
    unparsed_files: list[str] = []
    on_disk_total = 0

    for org_dir in sorted(p for p in raw_dir.iterdir() if p.is_dir()):
        org = org_dir.name
        disk = sorted(
            f"fy{FISCAL_YEAR}/{org}/{f.name}"
            for f in org_dir.iterdir()
            if f.is_file() and f.suffix.lower() in exts
        )
        if not disk:
            continue
        missing = [d for d in disk if d not in ingested]
        by_org[org] = {
            "on_disk": len(disk),
            "ingested": len(disk) - len(missing),
            "unparsed": len(missing),
        }
        unparsed_files.extend(missing)
        on_disk_total += len(disk)

    print(
        json.dumps(
            {
                "fiscal_year": int(FISCAL_YEAR),
                "on_disk": on_disk_total,
                "ingested": on_disk_total - len(unparsed_files),
                "unparsed": len(unparsed_files),
                "by_org": by_org,
                "unparsed_orgs": sorted(
                    o for o, v in by_org.items() if v["unparsed"] > 0
                ),
                "sample_unparsed": sorted(unparsed_files)[:SAMPLE_CAP],
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
