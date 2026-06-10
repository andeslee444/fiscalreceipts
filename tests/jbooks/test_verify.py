from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.load_details import load_document_details
from govbudget.jbooks.reconcile import reconcile_document
from govbudget.jbooks.registry import upsert_documents
from govbudget.jbooks.verify import accuracy_gate, coverage_gate, provenance_gate

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_fy2026_excerpt.xml"


def seed_full(pg_dsn, tmp_path):
    upsert_documents(pg_dsn, [{
        "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
        "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf",
    }])
    import hashlib
    import shutil

    doc_file = tmp_path / "darpa.pdf"
    shutil.copy(FIXTURE, doc_file)  # any file works for sha provenance in tests
    sha = hashlib.sha256(doc_file.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn) as con:
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "update jbook_documents set file_path=%s, sha256=%s, status='downloaded'"
            " where id=%s", (str(doc_file), sha, doc_id),
        )
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization, pe_bli,"
            " amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','fy_2024_actuals', %s)",
            (Decimal("280494"),),
        )
    run_id = load_document_details(pg_dsn, document_id=doc_id, xml_path=FIXTURE)
    reconcile_document(pg_dsn, document_id=doc_id, extraction_run_id=run_id)
    return doc_id


def test_coverage_gate_counts_extracted_vs_r1(pg_dsn, tmp_path):
    seed_full(pg_dsn, tmp_path)
    cov = coverage_gate(pg_dsn, organizations=["DARPA"])
    assert cov["r1_lines"] == 1
    assert cov["covered"] == 1
    assert cov["pct"] == 100.0


def test_accuracy_gate_no_silent_unreconciled(pg_dsn, tmp_path):
    seed_full(pg_dsn, tmp_path)
    acc = accuracy_gate(pg_dsn)
    assert acc["silent_unreconciled"] == 0


def test_provenance_gate_resolves_samples(pg_dsn, tmp_path):
    seed_full(pg_dsn, tmp_path)
    prov = provenance_gate(pg_dsn, sample_size=10)
    assert prov["sampled"] > 0
    assert prov["resolved"] == prov["sampled"]
