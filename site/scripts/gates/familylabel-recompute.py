#!/usr/bin/env python3
"""familylabel-recompute.py — gate 24 leg (l) helper (ROADMAP #10, option A).

Answers, on stdout as JSON, the one question the gate cannot answer in Node:
**by how much did each published family's label win the argmax that chose it?**

`dim_entities.display_name` is `max(coalesce(parent_name, recipient_name))
filter (rn = 1)` — the registered parent name of the family member holding the
most money. That member picked its own `(parent_uei, parent_name)` pair by an
argmax over obligations (`entity_graph._PICK_SQL parent_pick`), and the argmax
has no notion of "close" and no notion of "current". Measured at the time this
leg was written: 15 of the 200 published families ($255.2B, 9.7% of published
family dollars) carry a label that beat its runner-up by under 15%, and
`ROCKWELL COLLINS AUSTRALIA` — a family that is 97.3% RAYTHEON COMPANY — won by
3.1% with a registration RTX reverted in FY2026.

MARGIN = (d1 - d2) / d1 over the DOMINANT MEMBER's distinct
`(recipient_parent_uei, recipient_parent_name)` pairs in the award lake, ranked
the way `parent_pick` ranks them. A family whose dominant member has exactly one
registration has margin 1.0 — nothing was decided by a coin flip.

Recomputed INDEPENDENTLY from the warehouse and the lake. It never reads
data-seeds/entity_display_aliases.csv, entities_top.json or the built HTML —
those are the artifacts under test, and reading one here would make the leg
tautological.

Output:
{
  "families": [
    {"family_key": "...", "display_name": "...", "total_obligation": 1.9e10,
     "margin": 0.031, "won": "ROCKWELL COLLINS AUSTRALIA PTY LIMITED",
     "won_dollars": 6.58e9, "runner_up": "RAYTHEON COMPANY",
     "runner_up_dollars": 6.38e9, "dominant_uei": "XSV6AZJ6SDJ7",
     "dominant_name": "RAYTHEON COMPANY"},
    ...
  ],
  "published": 200,
  "published_dollars": 2.63e12
}
"""

import json
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
DUCKDB = REPO / "data" / "duckdb" / "govbudget.duckdb"
LAKE = [
    "data/parquet/contracts/fy=*/*.parquet",
    "data/parquet/assistance/fy=*/*.parquet",
]

#: The published set — the same ordering and limit export_site.py uses.
PUBLISHED_LIMIT = 200


def main() -> int:
    if not DUCKDB.exists():
        print(json.dumps({"__error__": f"missing {DUCKDB}"}))
        return 1
    globs = [str(REPO / g) for g in LAKE]
    if not any(Path(g).parent.parent.is_dir() for g in globs):
        print(json.dumps({"__error__": "award lake parquet directories missing"}))
        return 1

    con = duckdb.connect(str(DUCKDB), read_only=True)
    lake_literal = "[" + ",".join(f"'{g}'" for g in globs) + "]"
    # nullif('') mirrors _PICK_SQL exactly: an empty string is not a
    # registration, and treating it as one would invent a runner-up.
    con.execute(
        f"""
        create or replace temp view _tx as
        select recipient_uei,
               nullif(recipient_parent_uei, '')  as parent_uei,
               nullif(recipient_parent_name, '') as parent_name,
               try_cast(federal_action_obligation as double) as obligation
        from read_parquet({lake_literal}, union_by_name=true)
        where recipient_uei is not null and recipient_uei <> ''
        """
    )

    published = con.execute(
        "select family_key, display_name, total_obligation from dim_entities"
        f" order by total_obligation desc limit {PUBLISHED_LIMIT}"
    ).fetchall()

    # The family's dominant member — the rn=1 row dim_entities takes its
    # display_name from.
    dominant = {
        r[0]: (r[1], r[2])
        for r in con.execute(
            """
            select family_key, recipient_uei, recipient_name from (
              select *, row_number() over (
                  partition by family_key order by total_obligation desc nulls last
              ) rn from entity_xwalk
            ) where rn = 1
            """
        ).fetchall()
    }

    out = []
    for family_key, display_name, total in published:
        uei, dom_name = dominant.get(family_key, (None, None))
        if uei is None:
            continue
        regs = con.execute(
            """
            select parent_name, sum(obligation) d, count(*) n, parent_uei
            from _tx
            where recipient_uei = ?
              and (parent_uei is not null or parent_name is not null)
            group by parent_uei, parent_name
            order by d desc nulls last, n desc, parent_name nulls last,
                     parent_uei nulls last
            """,
            [uei],
        ).fetchall()
        if not regs:
            continue
        d1 = regs[0][1]
        d2 = regs[1][1] if len(regs) > 1 else 0.0
        if not d1:
            continue
        out.append(
            {
                "family_key": family_key,
                "display_name": display_name,
                "total_obligation": float(total or 0.0),
                "margin": float((d1 - d2) / d1),
                "won": regs[0][0],
                "won_dollars": float(d1),
                "runner_up": regs[1][0] if len(regs) > 1 else None,
                "runner_up_dollars": float(d2),
                "dominant_uei": uei,
                "dominant_name": dom_name,
            }
        )

    print(
        json.dumps(
            {
                "families": out,
                "published": len(published),
                "published_dollars": float(sum(r[2] or 0.0 for r in published)),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
