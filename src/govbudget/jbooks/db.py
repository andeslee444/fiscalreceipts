from pathlib import Path

import psycopg

from govbudget import config

MIGRATIONS_DIR = config.ROOT / "migrations"


def connect(dsn: str | None = None) -> psycopg.Connection:
    return psycopg.connect(dsn or config.PG_DSN)


def migrate(dsn: str | None = None) -> list[str]:
    """Apply unapplied migrations/*.sql in name order. Returns names applied."""
    applied: list[str] = []
    with connect(dsn) as con:
        con.execute(
            "create table if not exists schema_migrations "
            "(name text primary key, applied_at timestamptz not null default now())"
        )
        done = {r[0] for r in con.execute("select name from schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            con.execute(path.read_text())
            con.execute("insert into schema_migrations (name) values (%s)", (path.name,))
            applied.append(path.name)
    return applied
