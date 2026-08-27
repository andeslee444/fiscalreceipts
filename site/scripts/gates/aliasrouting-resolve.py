#!/usr/bin/env python3
"""aliasrouting-resolve.py — gate 23 leg (j) helper (ROADMAP #55).

Answers, on stdout as JSON, the two questions the basis gate cannot answer in
Node, both about the curated program aliases in dbt/seeds/program_aliases.csv:

  1. DOES THE TARGET EXIST?  An alias names a program element.  If that
     pe_bli has no row in dim_programs the alias resolves to nothing — the
     seed's own loader (`mentions.py::_load_aliases`) silently drops it, so a
     typo'd or retired code costs no error anywhere and simply makes the
     curation inert.

  2. WHERE DOES THE EVIDENCE LAND?  fct_program_lobbying carries one row per
     (filing_uuid, pe_bli) with the tier that qualified it.  Rows whose
     evidence_kind is 'alias' are there BECAUSE of the seed and nothing else
     — a single word was trusted because a person confirmed the mapping
     (#52).  So those rows are the seed's live blast radius, and grouping
     them by (matched_term, pe_bli) says exactly which program page each
     curated name is currently sending filings to.

Both read the WAREHOUSE (dim_programs, fct_program_lobbying), never the
exported site JSON — the sidecars are downstream of the artifact under test,
and reading them would only prove the exporter copied whatever it was given.

Output:
{
  "programs": {"<pe_bli>": "<title>"},        # min(title) per pe_bli, all rows
  "alias_mentions": [["<matched_term>", "<pe_bli>", <n>], ...],
  "alias_mentions_total": <int>,
  "mentions_total": <int>
}
or {"__error__": "..."} when the warehouse cannot be read.
"""

import json
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
DUCKDB_PATH = REPO / "data" / "duckdb" / "govbudget.duckdb"


def main() -> int:
    if not DUCKDB_PATH.exists():
        print(json.dumps({"__error__": f"warehouse not found at {DUCKDB_PATH}"}))
        return 0

    try:
        con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    except Exception as e:  # noqa: BLE001 — the gate reports, it does not raise
        print(json.dumps({"__error__": f"could not open warehouse: {e}"}))
        return 0

    out: dict = {}
    try:
        # dim_programs is deliberately NOT unique on pe_bli (Sprint E / #67
        # account-collision split keys, 8 of them). min(title) matches the
        # dedup fct_program_lobbying itself applies, so the gate reports the
        # same title the mart does.
        out["programs"] = {
            r[0]: r[1]
            for r in con.execute(
                "select pe_bli, min(title) from dim_programs"
                " where pe_bli is not null group by pe_bli"
            ).fetchall()
        }
        out["alias_mentions"] = [
            [r[0], r[1], int(r[2])]
            for r in con.execute(
                "select matched_term, pe_bli, count(*)"
                " from fct_program_lobbying where evidence_kind = 'alias'"
                " group by 1, 2 order by 1, 2"
            ).fetchall()
        ]
        out["alias_mentions_total"] = sum(row[2] for row in out["alias_mentions"])
        out["mentions_total"] = int(
            con.execute("select count(*) from fct_program_lobbying").fetchone()[0]
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"__error__": f"query failed: {e}"}))
        return 0
    finally:
        con.close()

    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
