#!/usr/bin/env python3
"""programs-excluded-recompute.py — gate 23 leg (h4) helper (#56 addendum).

Answers, on stdout as JSON, a question basis.mjs cannot answer in Node
without either DB access or a tautological re-read of the artifact under
test: "does every (pe_bli, title) with FY2026 money in the WAREHOUSE that is
absent from programs.json also appear in programs_excluded.json?"

Reads fct_budget_lines DIRECTLY from the duckdb warehouse — never
programs.json's or programs_excluded.json's own upstream reasoning (that
would make the gate tautological: it would only ever confirm the exporter
agrees with itself). programs.json and programs_excluded.json are read only
as the two SHIPPED ARTIFACTS being checked — membership sets, not logic.

The universe grain is (pe_bli, title): a program KEY (pe_bli) can be present
in the index (one program under that key won a #56 re-key) while a
DIFFERENT, unrelated program sharing the same key is still fully absent —
title is what actually identifies which program a row describes when a key
collides; pe_bli alone does not.

Output:
{
  "n_universe_pairs": <int>,           # distinct (pe_bli, title) pairs with FY2026 money
  "n_index_pe_blis": <int>,
  "n_disclosed": <int>,                # rows in programs_excluded.json
  "undisclosed": [                     # THE FAILURE LIST — must be empty
    {"pe_bli", "title", "amount_thousands", "why"}
  ],
  "resolved_known_keys": [...],        # of the 10 #56 keys, which this
                                        # recompute independently confirmed
                                        # ARE correctly disclosed
}
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
DUCKDB_PATH = REPO / "data" / "duckdb" / "govbudget.duckdb"
PROGRAMS_JSON = REPO / "data" / "site" / "json" / "programs.json"
PROGRAMS_EXCLUDED_JSON = REPO / "data" / "site" / "json" / "programs_excluded.json"

# #56: the ten pe_bli values known (as of the 2026-08-11 warehouse) to
# coincidentally span two real appropriation accounts within one edition.
# 9999999999 is the intentional classified sentinel — never one of these.
KNOWN_COLLISION_KEYS = {
    "0145", "1350", "2101", "2210", "2292",
    "3010", "3050", "3215", "3302", "4217",
}

TOL = 0.5  # USD thousands — float accumulation only


def main() -> int:
    for required in (DUCKDB_PATH, PROGRAMS_JSON, PROGRAMS_EXCLUDED_JSON):
        if not required.exists():
            print(json.dumps({"__error__": f"missing {required}"}))
            return 0

    programs = json.loads(PROGRAMS_JSON.read_text(encoding="utf-8"))
    index_pe_blis = {p["pe_bli"] for p in programs}
    index_fy26_by_pe = {
        p["pe_bli"]: (p.get("trajectory") or {}).get("fy2026_total") or 0.0
        for p in programs
    }

    disclosed = json.loads(PROGRAMS_EXCLUDED_JSON.read_text(encoding="utf-8"))
    disclosed_pairs = {(row["pe_bli"], row["title"]) for row in disclosed}

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    try:
        rows = con.execute(
            "select pe_bli, title, sum(amount_thousands) as amt"
            " from fct_budget_lines"
            " where amount_type = 'fy_2026_total' and title is not null"
            "   and pe_bli <> '9999999999'"
            " group by pe_bli, title"
        ).fetchall()
    finally:
        con.close()

    by_pe: dict[str, dict[str, float]] = defaultdict(dict)
    for pe, title, amt in rows:
        by_pe[pe][title] = float(amt)

    undisclosed: list[dict] = []
    resolved_known_keys: set[str] = set()

    for pe, by_title in by_pe.items():
        if pe not in index_pe_blis:
            # (a) whole pe_bli absent from the index — every title under it
            # must be disclosed.
            for title, amt in by_title.items():
                if (pe, title) not in disclosed_pairs:
                    undisclosed.append({
                        "pe_bli": pe, "title": title, "amount_thousands": amt,
                        "why": "pe_bli has no program page and this title is"
                               " not in programs_excluded.json",
                    })
                elif pe in KNOWN_COLLISION_KEYS:
                    resolved_known_keys.add(pe)
            continue

        if len(by_title) < 2:
            continue  # single title under this pe_bli: it IS the index entry

        # (b) pe_bli present, but does it cover EVERY title's money? The
        # title whose OWN sum matches what the index counts for this pe_bli
        # is the represented program; every other title must be disclosed.
        index_amt = index_fy26_by_pe.get(pe, 0.0)
        for title, amt in by_title.items():
            if abs(amt - index_amt) < TOL:
                continue  # this title IS what the index counts here
            if (pe, title) not in disclosed_pairs:
                undisclosed.append({
                    "pe_bli": pe, "title": title, "amount_thousands": amt,
                    "why": f"pe_bli={pe!r} has a program page, but its index"
                           f" total ({index_amt}) does not cover this"
                           f" title's own money ({amt}), and this title is"
                           " not in programs_excluded.json",
                })
            elif pe in KNOWN_COLLISION_KEYS:
                resolved_known_keys.add(pe)

    print(json.dumps({
        "n_universe_pairs": sum(len(t) for t in by_pe.values()),
        "n_index_pe_blis": len(index_pe_blis),
        "n_disclosed": len(disclosed_pairs),
        "undisclosed": undisclosed,
        "resolved_known_keys": sorted(resolved_known_keys),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
