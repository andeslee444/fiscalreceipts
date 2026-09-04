"""Root pytest fixtures.

`tests/jbooks/` and `tests/test_verify_lineage.py` already define their own
Postgres scratch-database fixtures (different DB names, so the suites never
collide). This root conftest provides the same `pg_dsn` fixture pattern for
DB-backed tests that live directly under `tests/` (e.g.
test_precision_study.py): a dedicated throwaway database, migrated from
migrations/*.sql, dropped again once the session ends.

It also puts scripts/ on sys.path so standalone operator scripts (not part
of the govbudget package, e.g. scripts/precision_study.py) are importable
by name from test modules.
"""
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test_root"


@pytest.fixture(scope="session")
def pg_dsn():
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres unavailable ({e}); start local postgres to run this suite")
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()

    parts = urlsplit(ADMIN_DSN)
    dsn = urlunsplit(parts._replace(path="/" + TEST_DB))

    from govbudget.jbooks.db import migrate

    migrate(dsn)
    yield dsn

    admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.close()
