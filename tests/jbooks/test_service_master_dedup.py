"""Phase 5G — master-identity dedup at load time (dedup_service_master_dups).

Verifies the empirical rule that generalizes across services: two downloaded
books collapse only when the master XML pick_book_xml selects is byte-identical.
Uses tiny synthetic master XMLs written to per-doc xml/ dirs so the test is
hermetic (no network, no real 70 MB books) while exercising the real
pick_book_xml + sha256 grouping path.
"""
from pathlib import Path

import psycopg
import pytest

from govbudget.jbooks.service_fetch import dedup_service_master_dups

# Minimal jb-2009-shaped RDTE master; only the marker prefix + a ProgramElement
# matter for pick_book_xml (family marker U_RDTE_) and byte identity.
_MASTER_A = "<jbook><ProgramElement><ProgramElementNumber>0601A</ProgramElementNumber></ProgramElement></jbook>"
_MASTER_B = "<jbook><ProgramElement><ProgramElementNumber>0601B</ProgramElementNumber></ProgramElement></jbook>"


def _mkdoc(con, tmp_path, *, title, org, family, master_bytes, doc_key):
    """Create a downloaded jbook_documents row whose xml/ dir holds a master."""
    d = tmp_path / doc_key
    (d / "xml").mkdir(parents=True)
    (d / "xml" / "U_RDTE_MJB_master.xml").write_text(master_bytes)
    pdf = d / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4 stub")
    doc_id = con.execute(
        "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
        " source_url, file_path, status, acquisition, has_embedded_xml)"
        " values (%s,%s,2026,%s,%s,%s,'downloaded','archive',true) returning id",
        (org, family, title, f"https://gov.test/{doc_key}.pdf", str(pdf)),
    ).fetchone()[0]
    # a live detail row so supersede has something to flip
    run_id = con.execute(
        "insert into extraction_runs (document_id, tier, tool_versions)"
        " values (%s,0,'{}') returning id", (doc_id,)
    ).fetchone()[0]
    con.execute(
        "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
        " scenario, amount_millions, xml_path) values (%s,%s,'0601A','CurrentYear',1,'x')",
        (run_id, doc_id),
    )
    return doc_id


def test_dedup_collapses_identical_masters_keeps_distinct(pg_dsn, tmp_path):
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        # Two AF RDTE volumes with the IDENTICAL master (III/IV case) -> dedup.
        _mkdoc(con, tmp_path, title="AF RDTE Vol III", org="F", family="rdte",
               master_bytes=_MASTER_A, doc_key="af_v3")
        _mkdoc(con, tmp_path, title="AF RDTE Vol IV", org="F", family="rdte",
               master_bytes=_MASTER_A, doc_key="af_v4")
        # Space Force RDTE: same org 'F', same family, DIFFERENT master -> kept.
        _mkdoc(con, tmp_path, title="SF RDTE", org="F", family="rdte",
               master_bytes=_MASTER_B, doc_key="sf")

    superseded = dedup_service_master_dups(pg_dsn, fiscal_year=2026, org="F", log=lambda *_: None)

    # Exactly one AF volume superseded (the higher title, "Vol IV"); SF untouched.
    assert superseded == [("AF RDTE Vol IV", "AF RDTE Vol III")]
    with psycopg.connect(pg_dsn) as con:
        live = {t for (t,) in con.execute(
            "select title from jbook_documents where status='downloaded' and org='F'"
        )}
        dead = {t for (t,) in con.execute(
            "select title from jbook_documents where status='superseded' and org='F'"
        )}
    assert live == {"AF RDTE Vol III", "SF RDTE"}
    assert dead == {"AF RDTE Vol IV"}


def test_dedup_keeps_all_distinct_army_volumes(pg_dsn, tmp_path):
    """Army RDTE volumes each embed a DISTINCT master (genuine BA-split) — none
    are collapsed."""
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        _mkdoc(con, tmp_path, title="Army RDTE BA1", org="A", family="rdte",
               master_bytes=_MASTER_A, doc_key="a1")
        _mkdoc(con, tmp_path, title="Army RDTE BA2", org="A", family="rdte",
               master_bytes=_MASTER_B, doc_key="a2")

    superseded = dedup_service_master_dups(pg_dsn, fiscal_year=2026, org="A", log=lambda *_: None)
    assert superseded == []
    with psycopg.connect(pg_dsn) as con:
        n = con.execute(
            "select count(*) from jbook_documents where status='downloaded' and org='A'"
        ).fetchone()[0]
    assert n == 2


def test_dedup_idempotent(pg_dsn, tmp_path):
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        _mkdoc(con, tmp_path, title="AF RDTE Vol III", org="F", family="rdte",
               master_bytes=_MASTER_A, doc_key="af_v3")
        _mkdoc(con, tmp_path, title="AF RDTE Vol IV", org="F", family="rdte",
               master_bytes=_MASTER_A, doc_key="af_v4")
    first = dedup_service_master_dups(pg_dsn, fiscal_year=2026, org="F", log=lambda *_: None)
    second = dedup_service_master_dups(pg_dsn, fiscal_year=2026, org="F", log=lambda *_: None)
    assert len(first) == 1
    assert second == []  # nothing left to supersede
