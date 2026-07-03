"""One-shot backfill: PB2024 P-1 BLI titles (Task 5 improvements).

The PB2024 P-1 display workbook names its title column 'Program
Element/Budget Line Item (BLI) Title' (the R-1 spelling, column J);
p1_loader's header map only knew PB2025+'s 'Budget Line Item (BLI) Title',
so the edition's 4,585 P-1 rows loaded title-NULL (the documented
detail-marker caveat in fct_decade_series). With the header variant mapped,
this script wipes and reloads ONLY the PB2024 P-1 rollup document — the
same delete-then-reload pattern scripts/rekey_era_procurement.py used per
era edition (the upsert key excludes title, but a wipe keeps the reload
honest and idempotent).

Verifies before/after: total row count unchanged, per-grain amounts
byte-identical, title-NULL count → 0.

Usage: uv run python scripts/backfill_pb2024_p1_titles.py
"""
from __future__ import annotations

from pathlib import Path

import psycopg

from govbudget import config
from govbudget.jbooks.p1_loader import load_p1_rollup

FY = 2024


def main() -> None:
    dsn = config.PG_DSN
    with psycopg.connect(dsn) as con:
        doc = con.execute(
            "select id, file_path from jbook_documents"
            " where exhibit_family='rollup' and fiscal_year=%s"
            " and status='downloaded' and title like 'p1\\_%%'",
            (FY,),
        ).fetchall()
        if len(doc) != 1:
            raise SystemExit(f"expected exactly one PB{FY} p1 rollup document, got {doc}")
        doc_id, file_path = doc[0]
        before = con.execute(
            "select count(*), count(*) filter (where title is null)"
            " from budget_lines where exhibit='P-1' and fiscal_year=%s",
            (FY,),
        ).fetchone()
        con.execute(
            "create temp table _before as select account, organization,"
            " budget_activity, pe_bli, amount_type, amount_thousands"
            " from budget_lines where exhibit='P-1' and fiscal_year=%s",
            (FY,),
        )
        n = con.execute(
            "delete from budget_lines where exhibit='P-1' and fiscal_year=%s",
            (FY,),
        ).rowcount
        con.commit()
        print(f"fy{FY}: deleted {n} P-1 budget_lines rows"
              f" ({before[1]} title-NULL before)")

        upserted = load_p1_rollup(
            dsn, Path(file_path), exhibit="P-1", fiscal_year=FY,
            source_document_id=doc_id,
        )
        print(f"fy{FY}: reloaded doc {doc_id} — {upserted} upserts")

        after = con.execute(
            "select count(*), count(*) filter (where title is null)"
            " from budget_lines where exhibit='P-1' and fiscal_year=%s",
            (FY,),
        ).fetchone()
        drift = con.execute(
            """
            select count(*) from _before b
            full outer join (
              select account, organization, budget_activity, pe_bli,
                     amount_type, amount_thousands
              from budget_lines where exhibit='P-1' and fiscal_year=%s
            ) a using (account, organization, budget_activity, pe_bli, amount_type)
            where a.amount_thousands is distinct from b.amount_thousands
            """,
            (FY,),
        ).fetchone()[0]
        print(f"fy{FY}: rows {before[0]} → {after[0]},"
              f" title-NULL {before[1]} → {after[1]}, amount drift rows: {drift}")
        if after[0] != before[0]:
            raise SystemExit("FAIL: row count changed")
        if drift:
            raise SystemExit("FAIL: per-grain amounts drifted")
        if after[1]:
            raise SystemExit(f"FAIL: {after[1]} title-NULL rows remain")


if __name__ == "__main__":
    main()
