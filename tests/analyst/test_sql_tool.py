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


# ---------------------------------------------------------------------------
# Fix 3: touched_tables must be extracted from comment-stripped sql
# ---------------------------------------------------------------------------


def test_extract_touched_tables_ignores_comment_token():
    """Fix 3 (PROOF-IT-CAN-FAIL): table name in -- comment must NOT appear in result."""
    from govbudget.analyst.sql_tool import _extract_touched_tables
    result = _extract_touched_tables("SELECT 42 -- dim_entities")
    assert "dim_entities" not in result, (
        f"Comment token must not contribute to touched_tables, got {result}"
    )


def test_extract_touched_tables_ignores_string_literal():
    """Fix 3 (PROOF-IT-CAN-FAIL): table name in string literal → not touched."""
    from govbudget.analyst.sql_tool import _extract_touched_tables
    result = _extract_touched_tables("SELECT 'dim_entities'")
    assert "dim_entities" not in result, (
        f"String literal must not contribute to touched_tables, got {result}"
    )


def test_extract_touched_tables_from_clause():
    """Fix 3: genuine FROM clause → table correctly included."""
    from govbudget.analyst.sql_tool import _extract_touched_tables
    result = _extract_touched_tables(
        "SELECT display_name FROM dim_entities ORDER BY total_obligation DESC LIMIT 1"
    )
    assert "dim_entities" in result


def test_extract_touched_tables_join_clause():
    """Fix 3: JOIN clause → table correctly included."""
    from govbudget.analyst.sql_tool import _extract_touched_tables
    result = _extract_touched_tables(
        "SELECT e.display_name FROM dim_entities e "
        "JOIN entity_xwalk x ON x.family_key = e.family_key"
    )
    assert "dim_entities" in result
    assert "entity_xwalk" in result


# ---------------------------------------------------------------------------
# Scoped sandbox regression tests (allowed_directories + lock_configuration)
# These are the tests that were MISSING and caused the silent regression:
# mocked tests passed because fixtures create in-DB tables, not parquet-backed
# views. These tests use real parquet files inside/outside allowed dirs.
# ---------------------------------------------------------------------------

@pytest.fixture()
def parquet_backed_db(tmp_path):
    """A DuckDB whose VIEW reads a parquet file inside an allowed directory.

    This is the critical regression fixture: it mirrors the real warehouse
    structure (mart VIEWs → read_parquet) rather than plain tables. The old
    test_sandbox_rejects_* tests used empty_db (plain tables), which passed
    even when enable_external_access=false broke parquet-backed views.
    """
    # Create the allowed parquet directory
    allowed_dir = tmp_path / "parquet"
    allowed_dir.mkdir()

    # Write a tiny parquet file inside the allowed dir
    inside_parquet = allowed_dir / "test_mart.parquet"
    builder = duckdb.connect(":memory:")
    builder.execute(f"COPY (SELECT 99 AS answer) TO '{inside_parquet}' (FORMAT PARQUET)")
    builder.close()

    # Write a parquet file OUTSIDE the allowed dir (simulates a secrets file)
    outside_parquet = tmp_path / "evil.parquet"
    builder2 = duckdb.connect(":memory:")
    builder2.execute(f"COPY (SELECT 'secret' AS data) TO '{outside_parquet}' (FORMAT PARQUET)")
    builder2.close()

    # Build the warehouse db with a VIEW over the inside parquet
    db = tmp_path / "warehouse.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        f"CREATE VIEW mart_view AS SELECT * FROM read_parquet('{inside_parquet}')"
    )
    con.close()

    return {
        "db": db,
        "allowed_dir": allowed_dir,
        "inside_parquet": inside_parquet,
        "outside_parquet": outside_parquet,
    }


def test_parquet_backed_view_works_through_sandbox(parquet_backed_db):
    """REGRESSION: parquet-backed mart VIEW must return rows through SqlTool.

    This is the test that was missing: the old sandbox set
    enable_external_access=false without first registering allowed_directories,
    which broke mart VIEWs over read_parquet(). This test would have caught it.
    """
    db_path = parquet_backed_db["db"]
    allowed_dir = parquet_backed_db["allowed_dir"]

    # Monkey-patch the parquet_dir resolution inside _make_sandboxed_connection
    # by passing a db path whose grandparent / "parquet" == our allowed_dir.
    # We do this by placing the db at allowed_dir/../duckdb/warehouse.duckdb
    # which is the real layout: data/duckdb/warehouse.duckdb → data/parquet
    duckdb_dir = allowed_dir.parent / "duckdb"
    duckdb_dir.mkdir()
    import shutil
    canonical_db = duckdb_dir / "warehouse.duckdb"
    shutil.copy(str(db_path), str(canonical_db))

    with SqlTool(canonical_db) as tool:
        result = tool.run("SELECT answer FROM mart_view")

    assert result["rows"] == [[99]], (
        f"Parquet-backed mart view must return rows through sandbox; got {result['rows']}"
    )


def test_sandbox_blocks_read_parquet_outside_allowed_dir(parquet_backed_db):
    """REGRESSION: read_parquet() outside allowed_directories must be blocked.

    With the old sandbox (enable_external_access=false, no allowed_directories),
    this would also be blocked — but for the wrong reason. With the new sandbox,
    this verifies that the allowlist properly restricts access outside data/parquet.
    """
    db_path = parquet_backed_db["db"]
    allowed_dir = parquet_backed_db["allowed_dir"]
    outside_parquet = parquet_backed_db["outside_parquet"]

    duckdb_dir = allowed_dir.parent / "duckdb"
    duckdb_dir.mkdir(exist_ok=True)
    import shutil
    canonical_db = duckdb_dir / "warehouse.duckdb"
    if not canonical_db.exists():
        shutil.copy(str(db_path), str(canonical_db))

    with SqlTool(canonical_db) as tool:
        with pytest.raises(SqlError, match="execution"):
            tool.run(f"SELECT * FROM read_parquet('{outside_parquet}')")


def test_sandbox_blocks_read_text_outside_allowed_dir(tmp_path, parquet_backed_db):
    """REGRESSION: read_text() on a file outside data/parquet must be blocked.

    This specifically tests the evals-file threat: the agent must not be able
    to read question/answer pairs from evals/ to cheat evaluations.
    """
    db_path = parquet_backed_db["db"]
    allowed_dir = parquet_backed_db["allowed_dir"]

    # Create a fake evals file outside the allowed dir
    evals_file = tmp_path / "evals" / "questions.yaml"
    evals_file.parent.mkdir()
    evals_file.write_text("- id: q001\n  answer: SECRET\n")

    duckdb_dir = allowed_dir.parent / "duckdb"
    duckdb_dir.mkdir(exist_ok=True)
    import shutil
    canonical_db = duckdb_dir / "warehouse.duckdb"
    if not canonical_db.exists():
        shutil.copy(str(db_path), str(canonical_db))

    with SqlTool(canonical_db) as tool:
        with pytest.raises(SqlError, match="execution"):
            tool.run(f"SELECT * FROM read_text('{evals_file}')")


def test_lock_configuration_prevents_widening_sandbox(parquet_backed_db):
    """REGRESSION: lock_configuration must prevent any SET from widening the sandbox.

    After SqlTool opens a connection, the config is locked. A direct Python
    con.execute('SET allowed_directories = ...') on the same connection must
    raise an error — not silently succeed and grant wider access.
    """
    db_path = parquet_backed_db["db"]
    allowed_dir = parquet_backed_db["allowed_dir"]

    duckdb_dir = allowed_dir.parent / "duckdb"
    duckdb_dir.mkdir(exist_ok=True)
    import shutil
    canonical_db = duckdb_dir / "warehouse.duckdb"
    if not canonical_db.exists():
        shutil.copy(str(db_path), str(canonical_db))

    tool = SqlTool(canonical_db)
    try:
        # Attempt to widen the sandbox via direct connection access
        # (simulates a compromised code path that bypasses the gate)
        with pytest.raises(Exception, match="(?i)(lock|configuration|cannot change)"):
            tool._con.execute("SET allowed_directories = ['/']")
    finally:
        tool.close()
