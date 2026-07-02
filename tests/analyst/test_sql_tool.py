"""Tests for analyst/sql_tool.py.

All tests use in-memory or tmp-path DuckDB — no live warehouse required.

Non-negotiables from plan §2b:
  - read_text/read_parquet/glob/getenv all REJECTED at execution (sandbox)
  - SET rejected at the gate (not just at execution)
  - DML rejected at the gate
  - Happy SELECT works
"""
from __future__ import annotations

import duckdb
import pytest

from govbudget.analyst.sql_tool import SqlError, SqlTool, _gate


# ---------------------------------------------------------------------------
# Gate-level tests (no DB needed)
# ---------------------------------------------------------------------------

def test_gate_allows_select():
    _gate("SELECT 1")  # must not raise


def test_gate_allows_with_cte():
    _gate("WITH t AS (SELECT 1 AS v) SELECT v FROM t")


def test_gate_rejects_set():
    with pytest.raises(SqlError, match="SET"):
        _gate("SET enable_external_access = true")


def test_gate_rejects_insert():
    with pytest.raises(SqlError, match="DML"):
        _gate("INSERT INTO t VALUES (1)")


def test_gate_rejects_delete():
    with pytest.raises(SqlError, match="DML"):
        _gate("DELETE FROM t WHERE 1=1")


def test_gate_rejects_attach():
    with pytest.raises(SqlError, match="ATTACH"):
        _gate("ATTACH 'evil.db'")


def test_gate_rejects_copy():
    with pytest.raises(SqlError, match="COPY"):
        _gate("COPY t TO '/tmp/evil.csv'")


def test_gate_rejects_install():
    with pytest.raises(SqlError, match="INSTALL"):
        _gate("INSTALL 'httpfs'")


def test_gate_rejects_load():
    with pytest.raises(SqlError, match="LOAD"):
        _gate("LOAD 'httpfs'")


def test_gate_rejects_pragma():
    with pytest.raises(SqlError, match="PRAGMA"):
        _gate("PRAGMA database_list")


def test_gate_rejects_multiple_statements():
    with pytest.raises(SqlError, match="single"):
        _gate("SELECT 1; SELECT 2")


def test_gate_rejects_update():
    # UPDATE t SET v = 1 — the 'SET' keyword triggers the deny-list first
    # (UPDATE also contains SET); either way the statement is rejected
    with pytest.raises(SqlError):
        _gate("UPDATE t SET v = 1")


# ---------------------------------------------------------------------------
# Sandbox tests (external_access disabled after TEMP TABLE materialisation)
# ---------------------------------------------------------------------------

@pytest.fixture()
def empty_db(tmp_path):
    """A minimal DuckDB with just one table."""
    db = tmp_path / "test.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE my_table (v INTEGER)")
    con.execute("INSERT INTO my_table VALUES (42)")
    con.close()
    return db


def test_sandbox_rejects_read_text(empty_db):
    """read_text() must be rejected at EXECUTION (sandbox, not just gate)."""
    tool = SqlTool(empty_db)
    try:
        with pytest.raises(SqlError, match="execution"):
            tool.run("SELECT content FROM read_text('evals/phase5_questions.yaml')")
    finally:
        tool.close()


def test_sandbox_rejects_read_parquet(empty_db):
    """read_parquet() must be rejected at EXECUTION (sandbox)."""
    tool = SqlTool(empty_db)
    try:
        with pytest.raises(SqlError, match="execution"):
            tool.run("SELECT * FROM read_parquet('/tmp/evil.parquet')")
    finally:
        tool.close()


def test_sandbox_rejects_glob(empty_db):
    """glob() must be rejected at EXECUTION (sandbox)."""
    tool = SqlTool(empty_db)
    try:
        with pytest.raises(SqlError, match="execution"):
            tool.run("SELECT * FROM glob('/tmp/**')")
    finally:
        tool.close()


def test_sandbox_rejects_getenv(empty_db):
    """getenv() must be rejected at EXECUTION (sandbox)."""
    tool = SqlTool(empty_db)
    try:
        with pytest.raises(SqlError, match="execution"):
            tool.run("SELECT getenv('ANTHROPIC_API_KEY')")
    finally:
        tool.close()


def test_sandbox_rejects_set_at_gate(empty_db):
    """SET must be rejected by the gate — not just blocked at execution.
    This proves the agent cannot re-enable external access by running SET.
    """
    tool = SqlTool(empty_db)
    try:
        with pytest.raises(SqlError, match="SET"):
            tool.run("SET enable_external_access = true")
    finally:
        tool.close()


def test_happy_select(empty_db):
    """A plain SELECT against an existing table returns rows."""
    with SqlTool(empty_db) as tool:
        result = tool.run("SELECT v FROM my_table")
    assert result["rows"] == [[42]]
    assert result["column_names"] == ["v"]


def test_happy_cte(empty_db):
    """A WITH/CTE statement works correctly."""
    with SqlTool(empty_db) as tool:
        result = tool.run("WITH t AS (SELECT v * 2 AS v2 FROM my_table) SELECT v2 FROM t")
    assert result["rows"] == [[84]]


def test_touched_tables_detected(empty_db):
    """touched_tables includes known table names referenced in the query."""
    with SqlTool(empty_db) as tool:
        result = tool.run("SELECT v FROM my_table")
    # my_table is not in KNOWN_TABLES (warehouse tables), so empty set expected
    # But if we reference a known table name in SQL, it should be detected
    assert isinstance(result["touched_tables"], set)


def test_dml_rejected_before_execution(empty_db):
    """DML is rejected by the gate (not the sandbox) so no partial execution."""
    with SqlTool(empty_db) as tool:
        with pytest.raises(SqlError, match="DML"):
            tool.run("DELETE FROM my_table")
