import hashlib
from decimal import Decimal
from pathlib import Path

import psycopg

from govbudget.jbooks.provenance_pages import (
    amount_strings,
    build_provenance_pages,
    find_fact_page,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"


def test_amount_strings():
    assert amount_strings(Decimal("280.494")) == ["280.494"]
    assert amount_strings(Decimal("1234.5")) == ["1,234.500", "1234.500"]
    assert amount_strings(Decimal("-1.2")) == ["-1.200"]


def test_find_fact_page_resolves_with_anchor():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("280.494"))
    assert hit["page_number"] == 1                  # 1-based within the excerpt
    assert hit["resolution"] == "ambiguous_first"   # both pages carry anchor+amount
    assert hit["candidate_pages"] == 2
    assert 200 < hit["x0"] < 300 and 150 < hit["top_pt"] < 175


def test_find_fact_page_word_boundary():
    """'280.494' must NOT match inside '1,280.494'-style strings; the prefilter
    is regex word-boundary, not substring. Probe with an amount absent from the
    fixture but whose digits appear as a substring of present numbers."""
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("80.494"))
    assert hit["resolution"] == "unresolved"        # '80.494' only occurs inside '280.494'


def test_find_fact_page_zero_amount_policy():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("0"))
    assert hit["resolution"] == "zero_amount"
    assert hit["page_number"] is None


def test_find_fact_page_unresolved():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("999999.999"))
    assert hit["page_number"] is None
    assert hit["resolution"] == "unresolved"


def _seed_fact(pg_dsn, amount="280.494"):
    sha = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'excerpt.pdf','https://example.mil/x.pdf',%s,%s,"
            " now(),'downloaded') on conflict (source_url) do nothing",
            (str(FIXTURE), sha),
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','PriorYear',%s,'ProgramElement[0]')",
            (run_id, doc_id, amount),
        )


def test_build_provenance_pages_inserts_and_caches(pg_dsn):
    _seed_fact(pg_dsn)
    assert build_provenance_pages(pg_dsn) == 1
    assert build_provenance_pages(pg_dsn) == 0   # cached by identity incl. amount
    with psycopg.connect(pg_dsn) as con:
        row = con.execute(
            "select page_number, resolution, amount_text, amount_millions"
            " from provenance_pages"
        ).fetchone()
    assert row[0] == 1 and row[2] == "280.494"


def test_build_provenance_pages_distinct_amounts_both_stored(pg_dsn):
    """Live data has duplicate keys differing only in amount — both must store."""
    _seed_fact(pg_dsn, amount="280.494")
    _seed_fact(pg_dsn, amount="281.000")
    assert build_provenance_pages(pg_dsn) == 2
