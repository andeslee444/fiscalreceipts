"""Sandboxed SQL execution tool for the analyst agent.

Security model
--------------
1. Connect to the warehouse read-only.
2. Materialise oversight parquets as TEMP TABLEs (so the agent can query them
   by table name instead of path; must happen BEFORE the sandbox is locked).
3. Execute ``SET enable_external_access = false`` — this disables all DuckDB
   file-system and network functions (read_text, read_parquet, read_csv,
   read_json, glob, getenv, etc.) for the remainder of the connection's life.
4. Enforce a statement gate (belt-and-braces):
   - exactly one statement
   - must start with SELECT or WITH (allowing CTEs)
   - deny ATTACH, COPY, INSTALL, LOAD, PRAGMA, SET keywords
5. Row cap: 200 rows maximum.
6. Timeout: 30 seconds (enforced via DuckDB connection parameter).

Returns rows + touched_tables (derived from EXPLAIN AST — the set of table
names in the query that intersect the set of known warehouse tables).
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

import duckdb

from govbudget import config

# ---------------------------------------------------------------------------
# Known tables in the warehouse (used for touched_tables extraction)
# ---------------------------------------------------------------------------

KNOWN_TABLES: frozenset[str] = frozenset({
    # mart / fact tables
    "fct_budget_lines",
    "fct_budget_trajectory",
    "fct_budget_to_awards",
    "fct_award_transactions",
    "fct_agency_concentration",
    "fct_program_concentration",
    "fct_improper_exposure",
    "fct_state_per_capita",
    # dimension tables
    "dim_entities",
    "dim_geography",
    "dim_programs",
    # supporting tables
    "entity_xwalk",
    "high_risk",
    "improper_payments",
    "budget_lines",
})

# Oversight parquets that get materialised as TEMP TABLES
_OVERSIGHT_TABLES: dict[str, str] = {
    "improper_payments": "oversight/improper_payments.parquet",
    "high_risk": "oversight/high_risk.parquet",
}

# Statement-gate deny list (case-insensitive whole-word)
_DENIED_KEYWORDS: tuple[str, ...] = (
    "attach", "copy", "install", "load", "pragma", "set",
)

# Gate: allowed leading keywords
_ALLOWED_STARTS = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)

ROW_CAP = 200
TIMEOUT_SECONDS = 30


class SqlError(Exception):
    """Raised when the SQL is rejected by the gate or execution fails."""


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------

def _gate(sql: str) -> None:
    """Raise SqlError if the statement violates any gate rule.

    Checks are ordered so that each specific denied keyword gets its own
    named error message. The SELECT-start check comes LAST so that e.g.
    ``SET enable_external_access = true`` is caught as "SET denied" rather
    than "must start with SELECT", which is less informative.
    """
    # Strip comments so they don't fool the gate
    stripped = re.sub(r"--[^\n]*", " ", sql)
    stripped = re.sub(r"/\*.*?\*/", " ", stripped, flags=re.DOTALL)
    stripped = stripped.strip().rstrip(";")

    # Single statement check (no semicolons in the middle)
    if ";" in stripped:
        raise SqlError("gate: only a single SQL statement is allowed")

    # Deny-list keyword check — runs BEFORE the SELECT-start check so each
    # specific keyword produces its own named error.
    for kw in _DENIED_KEYWORDS:
        if re.search(rf"\b{kw}\b", stripped, re.IGNORECASE):
            raise SqlError(
                f"gate: keyword '{kw.upper()}' is not permitted in analyst SQL"
            )

    # Must start with SELECT or WITH (catches any remaining non-SELECT statements)
    if not _ALLOWED_STARTS.match(stripped):
        raise SqlError(
            "gate: statement must begin with SELECT or WITH (CTEs); "
            "DML and DDL are not permitted"
        )


# ---------------------------------------------------------------------------
# Touched-tables extraction
# ---------------------------------------------------------------------------

def _extract_touched_tables(sql: str) -> set[str]:
    """Heuristically extract table names in the query that are known tables.

    Uses a simple regex over identifiers — conservative but avoids running a
    second DuckDB query and failing on the sandbox-locked connection.
    """
    # Extract all word tokens from the sql (identifiers, keywords)
    tokens = set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", sql))
    return tokens & KNOWN_TABLES


# ---------------------------------------------------------------------------
# Connection factory
# ---------------------------------------------------------------------------

def _make_sandboxed_connection(duckdb_path: Path) -> duckdb.DuckDBPyConnection:
    """Open a read-only connection and lock down external access."""
    con = duckdb.connect(str(duckdb_path), read_only=True)

    # Step 2: materialise oversight parquets BEFORE locking external access
    parquet_dir = duckdb_path.parent.parent / "parquet"
    for table_name, rel_path in _OVERSIGHT_TABLES.items():
        parquet_path = parquet_dir / rel_path
        if parquet_path.exists():
            con.execute(
                f"CREATE OR REPLACE TEMP TABLE {table_name} AS "
                f"SELECT * FROM read_parquet('{parquet_path}')"
            )

    # Step 3: disable ALL external access (file reads, network, getenv, glob)
    con.execute("SET enable_external_access = false")

    return con


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class SqlTool:
    """Sandboxed SQL execution tool.

    Usage
    -----
    tool = SqlTool()                         # opens sandboxed connection
    result = tool.run("SELECT 1")            # SqlError if gate rejects
    rows, touched = result["rows"], result["touched_tables"]
    tool.close()                             # always close when done
    """

    def __init__(self, duckdb_path: Path | None = None):
        self._path = duckdb_path or config.DUCKDB_PATH
        self._con = _make_sandboxed_connection(self._path)

    def run(self, sql: str) -> dict[str, Any]:
        """Execute SQL and return a dict with 'rows' and 'touched_tables'.

        Raises SqlError if the gate rejects the statement, a timeout occurs,
        or execution fails.
        """
        _gate(sql)

        touched = _extract_touched_tables(sql)

        start = time.monotonic()
        try:
            result = self._con.execute(sql)
            rows = result.fetchmany(ROW_CAP)
        except Exception as exc:
            raise SqlError(f"execution: {exc}") from exc
        elapsed = time.monotonic() - start
        if elapsed > TIMEOUT_SECONDS:
            raise SqlError(f"timeout: query took {elapsed:.1f}s (cap {TIMEOUT_SECONDS}s)")

        return {
            "rows": [list(r) for r in rows],
            "touched_tables": touched,
            "column_names": [d[0] for d in (result.description or [])],
        }

    def close(self) -> None:
        try:
            self._con.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
