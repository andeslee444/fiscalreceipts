"""Non-destructive cleanup of the Navy BA-split duplicate document rows (Phase 5G).

Each Navy FY2026 procurement PDF (APN/OPN/WPN/SCN/PMC/PANMC) embeds the SAME
full master XML, so registering all 12 loaded the procurement master 12×. Task 4
superseded the duplicate *details* (budget_line_details.superseded) — facts,
citations, and every gate already exclude them. What remained were the 11 stale
*document* rows: still status='downloaded', so a future `jbooks extract` (which
selects `where has_embedded_xml and status='downloaded'`) would re-create the
duplication, and they still appear in documents.parquet (same status filter,
export_facts.py:49).

Rather than DELETE (destructive, irreversible), this flips those rows to
status='superseded' — reversible, loses nothing, and because both `extract` and
the documents export filter on status='downloaded', it excludes them from both
paths. The retained masters (the RDTE master + one procurement master) keep their
live details and are never touched.

Selector is defensive: a Navy FY2026 document is superseded ONLY if it currently
has ZERO non-superseded budget_line_details — i.e. it carries no live facts. Any
document that still holds live detail (the two masters) is left alone. Idempotent:
re-running is a no-op once the rows are already 'superseded'.
"""

from __future__ import annotations

import psycopg

from govbudget import config

# Documents with live (non-superseded) details — must NEVER be flipped.
_LIVE_DETAIL_DOCS_SQL = """
    select distinct er.document_id
    from budget_line_details bld
    join extraction_runs er on er.id = bld.extraction_run_id
    where not bld.superseded
"""

# Navy FY2026 downloaded docs that carry NO live details = the stale duplicates.
_STALE_DOCS_SQL = f"""
    select id, title
    from jbook_documents d
    where d.fiscal_year = 2026
      and d.org = 'N'
      and d.status = 'downloaded'
      and d.id not in ({_LIVE_DETAIL_DOCS_SQL})
    order by id
"""


def main() -> int:
    # psycopg3 `with conn:` manages the transaction AND closes the connection at
    # block exit — so open a fresh connection for the post-update verification.
    with psycopg.connect(config.PG_DSN) as con:
        stale = con.execute(_STALE_DOCS_SQL).fetchall()
        if stale:
            ids = [r[0] for r in stale]
            print(f"superseding {len(ids)} stale Navy duplicate doc rows: {ids}")
            for _id, title in stale:
                print(f"  - {_id} {title}")
            con.execute(
                "update jbook_documents set status = 'superseded' where id = any(%s)",
                (ids,),
            )
        else:
            print("supersede_navy_dup_docs: no stale Navy FY2026 docs — already clean (no-op)")

    # Self-verify on a fresh connection: masters keep live details, stale set empty.
    with psycopg.connect(config.PG_DSN) as con:
        live = {r[0] for r in con.execute(_LIVE_DETAIL_DOCS_SQL + " and er.document_id >= 330").fetchall()}
        remaining = con.execute(_STALE_DOCS_SQL).fetchall()
    assert not remaining, f"post-update stale set must be empty, got {remaining}"
    assert 330 in live and 340 in live, f"masters 330/340 must keep live details, live={sorted(live)}"
    print(f"verified: masters {sorted(live)} retain live details; 0 stale docs remain in the download set")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
