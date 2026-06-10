import psycopg


def test_migrate_creates_schema_and_is_idempotent(pg_dsn):
    from govbudget.jbooks.db import migrate

    assert migrate(pg_dsn) == []  # session fixture already applied it; second run is a no-op
    with psycopg.connect(pg_dsn) as con:
        tables = {
            r[0]
            for r in con.execute(
                "select table_name from information_schema.tables where table_schema='public'"
            )
        }
    assert {
        "jbook_documents", "budget_lines", "extraction_runs", "budget_line_details",
        "detail_narratives", "reconciliation_checks", "review_queue", "extraction_gaps",
        "schema_migrations",
    } <= tables
