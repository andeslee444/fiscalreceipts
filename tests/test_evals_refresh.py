"""Tests for src/govbudget/evals_refresh.py.

All tests are fully offline — no live DuckDB required.
Uses in-memory DuckDB to simulate warehouse queries.
"""
from __future__ import annotations

import yaml
import duckdb
import pytest

from govbudget.evals_refresh import (
    REFUSE_SENTINEL,
    _canonicalize,
    _within_tolerance,
    check,
    refresh,
)


# ---------------------------------------------------------------------------
# Unit tests: canonical formatter
# ---------------------------------------------------------------------------

def test_canonicalize_single_int():
    assert _canonicalize([(42,)]) == "42"


def test_canonicalize_single_float():
    assert _canonicalize([(3.14159,)]) == "3.1416"


def test_canonicalize_two_cols():
    assert _canonicalize([("TX", 61.15)]) == "TX, 61.15"


def test_canonicalize_multi_row():
    result = _canonicalize([("A",), ("B",)])
    assert result == "A\nB"


def test_canonicalize_empty():
    assert _canonicalize([]) == ""


def test_canonicalize_string_passthrough():
    assert _canonicalize([("LOCKHEED MARTIN CORPORATION",)]) == "LOCKHEED MARTIN CORPORATION"


# ---------------------------------------------------------------------------
# Unit tests: tolerance check
# ---------------------------------------------------------------------------

def test_within_tolerance_exact():
    assert _within_tolerance("42", "42", None)


def test_within_tolerance_float_within():
    assert _within_tolerance("280.494", "280.500", 0.01)


def test_within_tolerance_float_outside():
    assert not _within_tolerance("280.494", "281.000", 0.001)


def test_within_tolerance_no_tolerance_mismatch():
    assert not _within_tolerance("42", "43", None)


# ---------------------------------------------------------------------------
# Fixture helpers: build a minimal yaml file + in-memory DuckDB
# ---------------------------------------------------------------------------

def _write_yaml(path, entries):
    with open(path, "w") as fh:
        yaml.dump(entries, fh, default_flow_style=False, sort_keys=False)


def _make_db(tmp_path, rows=(42,)):
    """Build a tiny DuckDB with a single table used by test answer_sql."""
    db = tmp_path / "test.duckdb"
    con = duckdb.connect(str(db))
    con.execute("create table t (v integer)")
    for v in rows:
        con.execute(f"insert into t values ({v})")
    con.close()
    return db


# ---------------------------------------------------------------------------
# refresh() tests
# ---------------------------------------------------------------------------

def test_refresh_updates_stale_answer(tmp_path, monkeypatch):
    """refresh() re-runs answer_sql and overwrites a stale expected_answer."""
    db = _make_db(tmp_path, [99])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q001",
            "question": "How many?",
            "answer_sql": "select v from t",
            "expected_answer": "42",  # stale — DB has 99
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    # Monkeypatch EVAL_PATH and config.DUCKDB_PATH
    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = refresh(duckdb_path=db)
    assert result["refreshed"] == 1
    assert result["unchanged"] == 0
    assert result["errors"] == []

    # Reload and check
    with open(yaml_path) as fh:
        updated = yaml.safe_load(fh)
    assert updated[0]["expected_answer"] == "99"


def test_refresh_idempotent(tmp_path, monkeypatch):
    """refresh() on an already-fresh file changes nothing on second run."""
    db = _make_db(tmp_path, [42])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q001",
            "question": "How many?",
            "answer_sql": "select v from t",
            "expected_answer": "42",  # already correct
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    r1 = refresh(duckdb_path=db)
    r2 = refresh(duckdb_path=db)
    assert r1["refreshed"] == 0
    assert r2["refreshed"] == 0


def test_refresh_skips_refuse_entries(tmp_path, monkeypatch):
    """refresh() leaves REFUSE entries untouched."""
    db = _make_db(tmp_path, [42])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q041",
            "question": "Secret?",
            "expected_answer": "REFUSE",
            "expected_refuse_class": "classified",
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = refresh(duckdb_path=db)
    assert result["skipped"] == 1
    assert result["refreshed"] == 0


def test_refresh_reports_sql_errors(tmp_path, monkeypatch):
    """refresh() records SQL errors instead of raising."""
    db = _make_db(tmp_path, [42])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q001",
            "question": "Bad SQL?",
            "answer_sql": "select * from nonexistent_table",
            "expected_answer": "42",
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = refresh(duckdb_path=db)
    assert len(result["errors"]) == 1
    assert result["errors"][0][0] == "q001"


# ---------------------------------------------------------------------------
# check() tests
# ---------------------------------------------------------------------------

def test_check_passes_fresh_answer(tmp_path, monkeypatch):
    """check() reports ok when answer matches live DuckDB."""
    db = _make_db(tmp_path, [42])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q001",
            "question": "How many?",
            "answer_sql": "select v from t",
            "expected_answer": "42",
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = check(duckdb_path=db)
    assert result["stale"] == []
    assert "q001" in result["ok"]


def test_check_detects_tampered_answer(tmp_path, monkeypatch):
    """check() detects when expected_answer has been tampered to wrong value."""
    db = _make_db(tmp_path, [99])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q001",
            "question": "How many?",
            "answer_sql": "select v from t",
            "expected_answer": "42",  # tampered — DB has 99
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = check(duckdb_path=db)
    assert len(result["stale"]) == 1
    stale_id, expected, live = result["stale"][0]
    assert stale_id == "q001"
    assert expected == "42"
    assert live == "99"


def test_check_tolerance_aware(tmp_path, monkeypatch):
    """check() passes when live value is within stated tolerance."""
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))
    con.execute("create table t (v double)")
    con.execute("insert into t values (280.4942)")
    con.close()

    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q009",
            "question": "Amount?",
            "answer_sql": "select round(v, 3) from t",
            "expected_answer": "280.494",
            "tolerance": 0.001,
            "expected_citation_kind": "pdf_page",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = check(duckdb_path=db)
    assert result["stale"] == []


def test_check_skips_refuse_entries(tmp_path, monkeypatch):
    """check() skips REFUSE entries."""
    db = _make_db(tmp_path, [42])
    yaml_path = tmp_path / "q.yaml"
    entries = [
        {
            "id": "q041",
            "question": "Secret?",
            "expected_answer": "REFUSE",
            "expected_refuse_class": "classified",
            "expected_citation_kind": "warehouse",
            "notes": "test",
        }
    ]
    _write_yaml(yaml_path, entries)

    import govbudget.evals_refresh as er
    monkeypatch.setattr(er, "EVAL_PATH", yaml_path)

    result = check(duckdb_path=db)
    assert result["stale"] == []
    assert "q041" in result["skipped"]
