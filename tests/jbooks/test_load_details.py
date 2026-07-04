from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.registry import upsert_documents

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def seed_doc(pg_dsn) -> int:
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        return con.execute("select id from jbook_documents").fetchone()[0]


def test_load_details_writes_rows_and_run(pg_dsn):
    doc_id = seed_doc(pg_dsn)
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        run = con.execute(
            "select tier, status from extraction_runs where id=%s", (run_id,)
        ).fetchone()
        assert run == (0, "finished")
        pe_rows = con.execute(
            "select count(*) from budget_line_details "
            "where pe_bli='0601101E' and project_number is null"
        ).fetchone()[0]
        assert pe_rows >= 2  # PriorYear + CurrentYear at minimum
        proj_rows = con.execute(
            "select count(*) from budget_line_details where project_number='CCS-02'"
        ).fetchone()[0]
        assert proj_rows >= 1
        narr = con.execute(
            "select count(*) from detail_narratives where pe_bli='0601101E'"
        ).fetchone()[0]
        assert narr >= 1


def test_reextract_supersedes_prior_run(pg_dsn):
    doc_id = seed_doc(pg_dsn)
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        live = con.execute(
            "select count(*) from budget_line_details where not superseded"
        ).fetchone()[0]
        dead = con.execute(
            "select count(*) from budget_line_details where superseded"
        ).fetchone()[0]
    assert dead > 0, "first run wrote no rows — fixture may be broken"
    assert live == dead  # second run superseded the first, equal row counts


P40_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "cbdp_fy2026_excerpt.xml"


def seed_proc_doc(pg_dsn) -> int:
    upsert_documents(pg_dsn, [{
        "org": "CBDP", "exhibit_family": "procurement", "fiscal_year": 2026,
        "title": "cbdp.pdf", "source_url": "https://example.test/cbdp.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        return con.execute("select id from jbook_documents").fetchone()[0]


def test_load_procurement_details(pg_dsn):
    from decimal import Decimal

    from govbudget.jbooks.load_details import load_procurement_details

    doc_id = seed_proc_doc(pg_dsn)
    run_id = load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        run = con.execute(
            "select tier, status from extraction_runs where id=%s", (run_id,)
        ).fetchone()
        assert run == (0, "finished")
        amt = con.execute(
            "select amount_millions from budget_line_details"
            " where pe_bli='7001SA1000' and scenario='PriorYear' and not superseded"
        ).fetchone()[0]
        assert amt == Decimal("148.64")
        kinds = {r[0] for r in con.execute(
            "select distinct kind from detail_narratives where pe_bli='7001SA1000'")}
        assert {"description", "justification"} <= kinds
        path = con.execute(
            "select xml_path from budget_line_details where pe_bli='7001SA1000' limit 1"
        ).fetchone()[0]
        assert path.startswith("LineItem[")


def test_load_procurement_details_captures_account(pg_dsn):
    """The P-40 AppropriationNumber must land in budget_line_details.account so
    Gate B can scope its P-1 control lookup by account (Navy FY2026 line-number
    collision). The fixture's LineItem carries AppropriationNumber=0300D."""
    from govbudget.jbooks.load_details import load_procurement_details

    doc_id = seed_proc_doc(pg_dsn)
    load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        accts = {r[0] for r in con.execute(
            "select distinct account from budget_line_details"
            " where pe_bli='7001SA1000' and not superseded"
        )}
    assert accts == {"0300D"}


def test_reload_procurement_supersedes(pg_dsn):
    from govbudget.jbooks.load_details import load_procurement_details

    doc_id = seed_proc_doc(pg_dsn)
    load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        live = con.execute(
            "select count(*) from budget_line_details where not superseded"
        ).fetchone()[0]
        dead = con.execute(
            "select count(*) from budget_line_details where superseded"
        ).fetchone()[0]
    assert dead > 0
    assert live == dead


def test_loaders_raise_on_zero_records(pg_dsn, tmp_path):
    import pytest

    from govbudget.jbooks.load_details import load_document_details, load_procurement_details

    empty = tmp_path / "empty.xml"
    empty.write_text('<?xml version="1.0"?><root/>')
    doc_id = seed_proc_doc(pg_dsn)
    with pytest.raises(ValueError, match="no records"):
        load_procurement_details(pg_dsn, document_id=doc_id, xml_path=empty)
    with pytest.raises(ValueError, match="no records"):
        load_document_details(pg_dsn, document_id=doc_id, xml_path=empty)


def test_load_procurement_details_legacy_edition_keys_by_p1_line_number(pg_dsn):
    """PB2017–PB2023: the era P-1 workbooks and P-40 XMLs share only the P-1
    line number (the XML's P1LineNumber). LineItemNumber vocabulary is
    per-agency inconsistent in that era (line numbers for DISA, ad-hoc codes
    for SOCOM/CBDP/DCAA — verified live, Task 4 round 2). The key is
    namespaced to '{account}-{org}-L{line}' (Finding D): bare line numbers
    collide with modern BLI codes and conflate programs within one
    consolidated document."""
    from govbudget.jbooks.load_details import load_procurement_details

    upsert_documents(pg_dsn, [{
        "org": "CBDP", "exhibit_family": "procurement", "fiscal_year": 2017,
        "title": "cbdp17.pdf", "source_url": "https://example.test/cbdp17.pdf",
    }])
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
    load_procurement_details(pg_dsn, document_id=doc_id, xml_path=P40_FIXTURE)
    with psycopg.connect(pg_dsn) as con:
        keys = {r[0] for r in con.execute(
            "select distinct pe_bli from budget_line_details where not superseded"
        )}
        narr_keys = {r[0] for r in con.execute(
            "select distinct pe_bli from detail_narratives where not superseded"
        )}
    # the fixture's P1LineNumber (120), namespaced by AppropriationNumber
    # (0300D) + ServiceAgencyName→workbook-org (CBDP) — never the bare line
    # number or the LineItemNumber code
    assert "0300D-CBDP-L120" in keys
    assert "120" not in keys
    assert "7001SA1000" not in keys
    # narratives key identically (they join details by pe_bli downstream)
    assert "0300D-CBDP-L120" in narr_keys
