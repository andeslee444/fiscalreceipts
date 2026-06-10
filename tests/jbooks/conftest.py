import os

import psycopg
import pytest

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test"


@pytest.fixture(scope="session")
def pg_dsn():
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres unavailable ({e}); start local postgres to run jbooks tests")
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(ADMIN_DSN)
    dsn = urlunsplit(parts._replace(path="/" + TEST_DB))

    from govbudget.jbooks.db import migrate

    migrate(dsn)
    yield dsn


@pytest.fixture()
def pg(pg_dsn):
    import psycopg

    with psycopg.connect(pg_dsn) as con:
        yield con
        con.rollback()


@pytest.fixture(autouse=True)
def _clean_tables(request):
    """Truncate Phase 1 tables after any test that actually used the DB.

    Resolves pg_dsn only for tests that requested it, so DB-free tests
    (parser, attachments) never trigger the Postgres session fixture.
    """
    uses_db = "pg_dsn" in request.fixturenames
    dsn = request.getfixturevalue("pg_dsn") if uses_db else None
    yield
    if dsn:
        with psycopg.connect(dsn, autocommit=True) as con:
            con.execute(
                "truncate jbook_documents, budget_lines, extraction_runs, budget_line_details, "
                "detail_narratives, reconciliation_checks, review_queue, extraction_gaps "
                "restart identity cascade"
            )
