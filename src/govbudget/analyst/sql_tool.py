"""Sandboxed SQL execution tool for the analyst agent.

Security model
--------------
1. Connect to the warehouse read-only.
2. Materialise oversight parquets as TEMP TABLEs (so the agent can query them
   by table name instead of path; must happen BEFORE the sandbox is locked).
3. Apply scoped filesystem sandbox (DuckDB 1.5.3):
   a. ``SET allowed_directories = ['<data/parquet>']`` — registers the parquet
      directory as ALWAYS accessible even when external access is otherwise off.
   b. ``SET enable_external_access = false`` — disables all file-system and
      network functions (read_text, read_parquet, read_csv, read_json, glob,
      getenv, etc.) except for paths matching allowed_directories.
   c. ``SET lock_configuration = true`` — makes all config immutable for the
      session, preventing any subsequent SET from re-enabling access.

   Result: mart VIEWs backed by read_parquet('<data/parquet>/...') work; any
   path outside data/parquet raises "Permission Error: file system operations
   are disabled by configuration".

4. Enforce a statement gate (belt-and-braces):
   - exactly one statement
   - must start with SELECT or WITH (allowing CTEs)
   - deny ATTACH, COPY, INSTALL, LOAD, PRAGMA, SET keywords
5. Row cap: 200 rows maximum.
6. Timeout: post-hoc elapsed check; runaway queries complete first
   (read-only, 200-row cap bounds output).

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

    Strips comments first (reusing the same logic as _gate) so that table
    names appearing only in comments or string literals are not counted.
    Only identifiers appearing directly after FROM or JOIN keywords are
    considered — this prevents spoofing via comment tokens or string literals.
    """
    # Strip comments (same approach as _gate)
    stripped = re.sub(r"--[^\n]*", " ", sql)
    stripped = re.sub(r"/\*.*?\*/", " ", stripped, flags=re.DOTALL)
    # Remove string literals to avoid 'dim_entities' in quoted strings
    stripped = re.sub(r"'[^']*'", " ", stripped)
    stripped = re.sub(r'"[^"]*"', " ", stripped)

    # Only count identifiers that follow FROM or JOIN keywords
    # (?:from|join)\s+([a-zA-Z_]\w*) — captures the table name token
    touched: set[str] = set()
    for m in re.finditer(r"(?:from|join)\s+([a-zA-Z_]\w*)", stripped, re.IGNORECASE):
        name = m.group(1)
        if name in KNOWN_TABLES:
            touched.add(name)
    return touched


# ---------------------------------------------------------------------------
# Connection factory
# ---------------------------------------------------------------------------

def _make_sandboxed_connection(duckdb_path: Path) -> duckdb.DuckDBPyConnection:
    """Open a read-only connection and lock down external access.

    Order of operations is critical:
      1. Materialise oversight parquets as TEMP TABLEs while external access
         is still unrestricted (they live in data/parquet, but the in-memory
         copy means the locked sandbox never needs to re-read them).
      2. Register the parquet directory as the ONLY allowed filesystem prefix.
      3. Disable all external access — paths inside allowed_directories remain
         reachable (so mart VIEWs over read_parquet() keep working), everything
         else raises a Permission Error.
      4. Lock configuration — no subsequent SET can widen the sandbox.
    """
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

    # Step 3a: register the parquet directory as the ONLY allowed prefix.
    # allowed_directories paths remain accessible even when enable_external_access
    # is false (DuckDB 1.5.3 docs: "ALWAYS allowed to be queried").
    con.execute(f"SET allowed_directories = ['{parquet_dir}']")

    # Step 3b: disable ALL external access except allowed_directories.
    # Mart VIEWs backed by read_parquet('<parquet_dir>/...') still work;
    # read_text, getenv, glob, and any path outside parquet_dir are blocked.
    con.execute("SET enable_external_access = false")

    # Step 3c: lock config — prevents any subsequent SET from widening the sandbox.
    con.execute("SET lock_configuration = true")

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
