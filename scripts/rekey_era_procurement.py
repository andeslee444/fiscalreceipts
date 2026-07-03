"""One-shot migration: namespace era (PB2017–PB2023) procurement pe_bli.

Adversarial review Finding D (Phase 5E): era procurement pe_bli values were
bare P-1 line numbers ('1', '10', …) — colliding with modern BLI codes,
spanning orgs, and conflating programs within consolidated documents.
era_keys.era_procurement_key namespaces both sides to '{account}-{org}-L{n}'.

Per edition this script:
  1. deletes the edition's P-1 budget_lines rows (the upsert key includes
     pe_bli, so a plain reload would duplicate rather than replace);
  2. reloads the edition's rollup workbooks (P-1 rows come back namespaced;
     R-1 / P-1R upsert byte-identically);
  3. re-extracts + reconciles the edition's procurement documents (the era
     load_details path now writes namespaced keys; superseding is built in);
  4. deletes the edition's procurement amount provenance rows — provenance
     identity is (sha, pe_bli, project, scenario, amount), so the re-key
     invalidates them — and rebuilds amounts provenance for the edition;
  5. refreshes the edition's manifest entry (counts + provenance rollup).

Idempotent: re-running repeats the same deletes/reloads and converges.

Usage: uv run python scripts/rekey_era_procurement.py [fy ...]
       (default: 2017–2022; 2023 is handled by `jbooks backfill
        --fiscal-year 2023`, which re-extracts the whole edition — run this
        script for 2023 afterwards only to rebuild provenance + manifest,
        it will skip already-namespaced work by construction)
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

from govbudget import config
from govbudget.jbooks import edition_probe, load_details, reconcile
from govbudget.jbooks.attachments import pick_book_xml
from govbudget.jbooks.gaps import record_extraction_gaps
from govbudget.jbooks.provenance_pages import build_provenance_pages

MANIFEST_PATH = config.RESEARCH_DIR / "edition_manifest.json"


def provenance_counts(con, fy: int) -> dict:
    rows = dict(con.execute(
        """
        select p.resolution, count(*)
        from provenance_pages p
        join (select distinct sha256, fiscal_year from jbook_documents
              where sha256 is not null) j on j.sha256 = p.document_sha256
        where p.target_kind = 'amount' and j.fiscal_year = %s
        group by 1
        """,
        (fy,),
    ).fetchall())
    return {
        "total": sum(rows.values()),
        "unique": rows.get("unique", 0),
        "ambiguous_first": rows.get("ambiguous_first", 0),
        "zero_amount": rows.get("zero_amount", 0),
        "unresolved": rows.get("unresolved", 0),
    }


def rekey_edition(fy: int, *, reload_rollups: bool = True) -> None:
    from govbudget.cli import _jbooks_load_rollups

    dsn = config.PG_DSN
    with psycopg.connect(dsn) as con:
        n = con.execute(
            "delete from budget_lines where exhibit='P-1' and fiscal_year=%s",
            (fy,),
        ).rowcount
        print(f"fy{fy}: deleted {n} P-1 budget_lines rows")

    if reload_rollups:
        loaded, failures = _jbooks_load_rollups(fiscal_year=fy)
        if failures:
            raise SystemExit(f"fy{fy}: rollup reload FAILED: {failures}")
        print(f"fy{fy}: reloaded {loaded} rollup workbook(s)")

    with psycopg.connect(dsn) as con:
        docs = con.execute(
            "select id, file_path from jbook_documents"
            " where exhibit_family='procurement' and fiscal_year=%s"
            " and status='downloaded' and has_embedded_xml",
            (fy,),
        ).fetchall()
    for doc_id, file_path in docs:
        book_xml = pick_book_xml(Path(file_path).parent / "xml", family="procurement")
        if book_xml is None:
            raise SystemExit(f"fy{fy}: doc {doc_id} has no procurement XML on disk")
        run_id = load_details.load_procurement_details(
            dsn, document_id=doc_id, xml_path=book_xml
        )
        result = reconcile.reconcile_document(
            dsn, document_id=doc_id, extraction_run_id=run_id
        )
        gaps = record_extraction_gaps(dsn, document_id=doc_id)
        print(f"fy{fy}: doc {doc_id} run {run_id} reconcile {result} gaps {gaps}")

    with psycopg.connect(dsn) as con:
        n = con.execute(
            """
            delete from provenance_pages p
            using (select distinct sha256 from jbook_documents
                   where exhibit_family='procurement' and fiscal_year=%s
                     and sha256 is not null) j
            where p.target_kind='amount' and p.document_sha256 = j.sha256
            """,
            (fy,),
        ).rowcount
        print(f"fy{fy}: deleted {n} stale procurement amount provenance rows")
    inserted = build_provenance_pages(dsn, fiscal_year=fy)
    print(f"fy{fy}: rebuilt provenance — {inserted} rows inserted")

    counts = edition_probe.edition_counts(dsn, fy)
    with psycopg.connect(dsn) as con:
        counts["provenance"] = provenance_counts(con, fy)
    entry = edition_probe.record_loaded(MANIFEST_PATH, fy, counts)
    print(f"fy{fy}: manifest — {entry['reason']}")


if __name__ == "__main__":
    fys = [int(a) for a in sys.argv[1:]] or list(range(2017, 2023))
    for fy in fys:
        rekey_edition(fy)
