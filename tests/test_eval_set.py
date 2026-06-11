"""Structural validation tests for evals/phase5_questions.yaml.

Checks:
- File parses as valid YAML
- At least 35 entries present
- Every entry has required fields
- answer_sql is read-only (no DML keywords) for non-REFUSE entries
- REFUSE entries have no answer_sql
"""
from pathlib import Path

import pytest
import yaml

EVAL_PATH = Path(__file__).parent.parent / "evals" / "phase5_questions.yaml"

REQUIRED_FIELDS = {"id", "question", "expected_answer", "expected_citation_kind", "notes"}

# DML keywords that must not appear in any answer_sql
DML_KEYWORDS = {"insert", "update", "delete", "copy", "create", "drop", "alter", "truncate"}

VALID_CITATION_KINDS = {"warehouse", "pdf_page", "filing_uuid", "source_url"}


@pytest.fixture(scope="module")
def entries():
    """Load and return the parsed YAML entries list."""
    assert EVAL_PATH.exists(), f"Eval file not found: {EVAL_PATH}"
    with open(EVAL_PATH) as fh:
        data = yaml.safe_load(fh)
    assert isinstance(data, list), "Top-level YAML must be a list"
    return data


def test_yaml_parses(entries):
    """YAML file loads without error and returns a non-empty list."""
    assert len(entries) > 0, "Eval file must not be empty"


def test_minimum_entry_count(entries):
    """At least 35 entries are required."""
    assert len(entries) >= 35, f"Expected ≥35 entries, got {len(entries)}"


def test_required_fields_present(entries):
    """Every entry must have all required fields."""
    for entry in entries:
        eid = entry.get("id", "<unknown>")
        for field in REQUIRED_FIELDS:
            assert field in entry, f"Entry {eid} missing required field: {field!r}"


def test_ids_are_unique(entries):
    """All entry ids must be unique."""
    ids = [e["id"] for e in entries]
    assert len(ids) == len(set(ids)), f"Duplicate entry IDs found: {[x for x in ids if ids.count(x) > 1]}"


def test_citation_kinds_valid(entries):
    """expected_citation_kind must be one of the allowed values."""
    for entry in entries:
        kind = entry["expected_citation_kind"]
        assert kind in VALID_CITATION_KINDS, (
            f"Entry {entry['id']}: invalid citation kind {kind!r}; "
            f"must be one of {VALID_CITATION_KINDS}"
        )


def test_refuse_entries_have_no_answer_sql(entries):
    """Entries with expected_answer == REFUSE must not have an answer_sql field."""
    for entry in entries:
        if entry["expected_answer"] == "REFUSE":
            assert "answer_sql" not in entry, (
                f"Entry {entry['id']}: REFUSE entries must not include answer_sql"
            )


def test_answer_sql_is_read_only(entries):
    """Non-REFUSE entries that have answer_sql must not contain DML keywords."""
    for entry in entries:
        sql = entry.get("answer_sql")
        if sql is None:
            continue  # REFUSE entries have no SQL
        sql_lower = sql.lower()
        for keyword in DML_KEYWORDS:
            # Check for keyword as a whole word to avoid false positives
            import re
            if re.search(rf"\b{keyword}\b", sql_lower):
                pytest.fail(
                    f"Entry {entry['id']}: answer_sql contains forbidden DML keyword {keyword!r}"
                )


def test_numeric_answers_have_tolerance_when_float(entries):
    """Entries whose expected_answer looks like a float should have a tolerance field."""
    import re
    float_pattern = re.compile(r"^-?\d+\.\d+$")
    for entry in entries:
        answer = str(entry["expected_answer"])
        if float_pattern.match(answer):
            assert "tolerance" in entry, (
                f"Entry {entry['id']}: float expected_answer {answer!r} "
                f"should include a 'tolerance' field"
            )


def test_at_least_five_refuse_entries(entries):
    """There must be at least 5 REFUSE entries to test honest-refusal behavior."""
    refuse_count = sum(1 for e in entries if e["expected_answer"] == "REFUSE")
    assert refuse_count >= 5, f"Expected ≥5 REFUSE entries, got {refuse_count}"


def test_nonrefuse_entries_have_answer_sql(entries):
    """Non-REFUSE entries must have an answer_sql (so answers can be reproduced)."""
    for entry in entries:
        if entry["expected_answer"] != "REFUSE":
            assert "answer_sql" in entry, (
                f"Entry {entry['id']}: non-REFUSE entry must include answer_sql"
            )
