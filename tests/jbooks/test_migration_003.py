import psycopg


def test_provenance_pages_table_exists(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        cols = {
            r[0]
            for r in con.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'provenance_pages'"
            )
        }
    assert {
        "document_sha256", "pe_bli", "project_number", "scenario",
        "amount_millions", "amount_text", "page_number", "x0", "x1",
        "top_pt", "bottom_pt", "page_width", "page_height", "resolution",
        "candidate_pages",
    } <= cols


def test_provenance_pages_amount_in_unique_key(pg_dsn):
    """Two facts differing ONLY in amount must both be storable (live data has 11 such pairs)."""
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        for amt in ("1.000", "2.000"):
            con.execute(
                "insert into provenance_pages (document_sha256, pe_bli, scenario,"
                " amount_millions, amount_text, resolution) values"
                " ('abc','0601101E','BudgetYearOne',%s,%s,'unresolved')",
                (amt, amt),
            )
        n = con.execute("select count(*) from provenance_pages").fetchone()[0]
    assert n == 2


def test_budget_lines_cell_columns(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        cols = {
            r[0]
            for r in con.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'budget_lines'"
            )
        }
    assert {"source_sheet", "source_cells"} <= cols
