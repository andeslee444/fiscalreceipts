"""One-shot backfill: PB2024 P-1R BLI titles (backlog #25).

The PB2024 P-1R display workbook names its title column 'Program
Element/Budget Line Item (BLI) Title' — the same R-1 spelling PB2024's
P-1 uses (live evidence: p1r_display.xlsx header row 2). The P-1 fix
(commit 88c9da5) added that variant to p1_loader's P1_ID_HEADERS but
only reloaded the P-1 document, so the edition's 582 P-1R rows stayed
title-NULL. With the mapping already in place, this script wipes and
reloads ONLY the PB2024 P-1R rollup document — the same delete-then-
reload pattern scripts/backfill_pb2024_p1_titles.py used (the upsert
key excludes title, so a wipe keeps the reload honest and idempotent).

Verifies before/after: total row count unchanged, per-grain amounts
byte-identical, title-NULL count → 0.

Usage: uv run python scripts/backfill_pb2024_p1r_titles.py
"""
from __future__ import annotations

from pathlib import Path

import psycopg

from govbudget import config
from govbudget.jbooks.p1_loader import load_p1_rollup

FY = 2024
EXHIBIT = "P-1R"


def main() -> None:
    dsn = config.PG_DSN
    with psycopg.connect(dsn) as con:
        doc = con.execute(
            "select id, file_path from jbook_documents"
            " where exhibit_family='rollup' and fiscal_year=%s"
            " and status='downloaded' and title like 'p1r\\_%%'",
            (FY,),
        ).fetchall()
        if len(doc) != 1:
            raise SystemExit(f"expected exactly one PB{FY} p1r rollup document, got {doc}")
        doc_id, file_path = doc[0]
        before = con.execute(
            "select count(*), count(*) filter (where title is null)"
            " from budget_lines where exhibit=%s and fiscal_year=%s",
            (EXHIBIT, FY),
        ).fetchone()
        con.execute(
            "create temp table _before as select account, organization,"
            " budget_activity, pe_bli, amount_type, amount_thousands"
            " from budget_lines where exhibit=%s and fiscal_year=%s",
            (EXHIBIT, FY),
        )
        n = con.execute(
            "delete from budget_lines where exhibit=%s and fiscal_year=%s",
            (EXHIBIT, FY),
        ).rowcount
        con.commit()
        print(f"fy{FY}: deleted {n} {EXHIBIT} budget_lines rows"
              f" ({before[1]} title-NULL before)")

        upserted = load_p1_rollup(
            dsn, Path(file_path), exhibit=EXHIBIT, fiscal_year=FY,
            source_document_id=doc_id,
        )
        print(f"fy{FY}: reloaded doc {doc_id} — {upserted} upserts")

        after = con.execute(
            "select count(*), count(*) filter (where title is null)"
            " from budget_lines where exhibit=%s and fiscal_year=%s",
            (EXHIBIT, FY),
        ).fetchone()
        drift = con.execute(
            """
            select count(*) from _before b
            full outer join (
              select account, organization, budget_activity, pe_bli,
                     amount_type, amount_thousands
              from budget_lines where exhibit=%s and fiscal_year=%s
            ) a using (account, organization, budget_activity, pe_bli, amount_type)
            where a.amount_thousands is distinct from b.amount_thousands
            """,
            (EXHIBIT, FY),
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
