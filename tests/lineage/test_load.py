"""Task 4 — build_lineage load pipeline gate.

Throwaway-PG fixture mirrors tests/test_verify_phase5e.py: connect to an admin
DSN, drop/create govbudget_test_lineage, migrate migrations/*.sql, skip on
psycopg.OperationalError. A temp DuckDB seeds a tiny fct_decade_series +
dim_pe_titles that yields at least one inferred BA-maturation edge.
"""
import os
from urllib.parse import urlsplit, urlunsplit

import duckdb
import psycopg
import pytest

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test_lineage"


@pytest.fixture()
def pg_lineage():
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres unavailable ({e}); start local postgres to run lineage load test")
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()

    parts = urlsplit(ADMIN_DSN)
    dsn = urlunsplit(parts._replace(path="/" + TEST_DB))

    from govbudget.jbooks.db import migrate

    migrate(dsn)

    # Seed one document + extraction_run + a stated-edge narrative.
    with psycopg.connect(dsn, autocommit=True) as con:
        doc_id = con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, sha256, status) values (%s, %s, %s, %s, %s, %s, %s)"
            " returning id",
            ("DARPA", "rdte", 2026, "doc-2026-0", "https://example.test/2026/doc0.pdf",
             "sha_lineage_2026", "downloaded"),
        ).fetchone()[0]
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions, status)"
            " values (%s, 1, '{}', 'finished') returning id",
            (doc_id,),
        ).fetchone()[0]
        con.execute(
            "insert into detail_narratives (extraction_run_id, document_id, pe_bli,"
            " kind, title, body, xml_path, superseded) values"
            " (%s, %s, %s, %s, %s, %s, %s, false)",
            (run_id, doc_id, "0604294D8Z", "program_change",
             "Consolidation", "$62.4M was transferred from PE 0603826D to consolidate the effort.",
             "ProgramElement[0]/Narrative[0]"),
        )
    yield dsn


@pytest.fixture()
def tmp_duck(tmp_path):
    path = tmp_path / "wh.duckdb"
    con = duckdb.connect(str(path))
    con.execute(
        "create table fct_decade_series (pe_bli varchar, fy int, edition_year int,"
        " amount_type_kind varchar, amount double, amount_thousands double,"
        " scenario varchar, amount_type varchar, n_source_rows int, source_fact_id varchar)"
    )
    con.execute("create table dim_pe_titles (pe_bli varchar, title varchar)")
    # Same-title 0603xxx (BA3) -> 0604xxx (BA4) request taper => one inferred edge.
    rows = [
        ("0603XYZ", 2024, 2026, "request", 30.0, 30.0, "req", "R", 1, "f1"),
        ("0603XYZ", 2025, 2026, "request", 5.0, 5.0, "req", "R", 1, "f2"),
        ("0604XYZ", 2025, 2026, "request", 40.0, 40.0, "req", "R", 1, "f3"),
    ]
    con.executemany("insert into fct_decade_series values (?,?,?,?,?,?,?,?,?,?)", rows)
    con.executemany(
        "insert into dim_pe_titles values (?,?)",
        [("0603XYZ", "Widget Science"), ("0604XYZ", "Widget Science")],
    )
    con.close()
    yield path


def test_build_lineage_persists_stated_and_inferred(pg_lineage, tmp_duck):
    from govbudget.lineage.load import build_lineage

    n = build_lineage(pg_lineage, tmp_duck)          # returns a counts dict
    with psycopg.connect(pg_lineage) as con:
        rows = con.execute(
            "select from_pe_bli,to_pe_bli,confidence from program_lineage order by 1"
        ).fetchall()
        fams = con.execute("select count(*) from program_family").fetchone()[0]
    assert ("0603826D", "0604294D8Z", "stated") in rows
    assert any(c == "inferred" for *_, c in rows)
    assert all(f != t for f, t, _ in rows)           # no self-loops
    assert fams >= 1
    assert n["edges"] == len(rows)
