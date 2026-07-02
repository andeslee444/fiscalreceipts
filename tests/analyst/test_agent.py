"""Tests for analyst/agent.py using FakeClient (no ANTHROPIC_API_KEY needed).

FakeClient pops scripted responses from a queue. Each response is a list of
content blocks (SimpleNamespace), matching the Anthropic SDK shape.

Tests cover:
  - numeric happy path (run_sql → submit_answer)
  - refusal path (submit_answer with refuse=True)
  - tool-loop termination (max turns exceeded)
  - forced final turn (tool_choice submit_answer)
  - BLOCKED when key absent (SystemExit with correct message)
  - cost accumulator arithmetic
"""
from __future__ import annotations

import json
import os
from types import SimpleNamespace

import duckdb
import pytest

from govbudget.analyst.agent import CostAccumulator, MAX_TURNS, run


# ---------------------------------------------------------------------------
# FakeClient (NEW — pops scripted responses for tool loops)
# ---------------------------------------------------------------------------


def _tool_use_block(name: str, tool_id: str, inp: dict):
    return SimpleNamespace(
        type="tool_use",
        name=name,
        id=tool_id,
        input=inp,
    )


def _text_block(text: str):
    return SimpleNamespace(type="text", text=text)


def _make_usage(inp=10, out=20, cache_read=0):
    return SimpleNamespace(
        input_tokens=inp,
        output_tokens=out,
        cache_read_input_tokens=cache_read,
    )


def _make_resp(content, stop_reason="tool_use", usage=None):
    return SimpleNamespace(
        content=content,
        stop_reason=stop_reason,
        usage=usage or _make_usage(),
    )


class FakeClient:
    """Anthropic client that pops pre-scripted responses from a queue.

    messages.create() pops the next response.
    The last scripted response is reused if the queue is exhausted (so
    forced-submit tests need only one entry).
    """

    def __init__(self, responses: list):
        self._responses = list(responses)
        self.calls: list = []  # record (model, tool_choice, messages) for inspection

    class _Messages:
        def __init__(self, outer):
            self._outer = outer

        def create(self, **kwargs):
            self._outer.calls.append(kwargs)
            if len(self._outer._responses) > 1:
                return self._outer._responses.pop(0)
            return self._outer._responses[0]

    @property
    def messages(self):
        return self._Messages(self)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tiny_db(tmp_path):
    """Tiny DuckDB with a known-table equivalent for testing."""
    db = tmp_path / "tiny.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE dim_entities (display_name VARCHAR, total_obligation DOUBLE)")
    con.execute("INSERT INTO dim_entities VALUES ('LOCKHEED MARTIN', 1.35e11)")
    con.close()
    return db


# ---------------------------------------------------------------------------
# Happy path: run_sql → submit_answer
# ---------------------------------------------------------------------------


def test_happy_path_numeric(tiny_db):
    """Agent runs SQL and submits a numeric answer correctly."""
    run_sql_resp = _make_resp([
        _tool_use_block("run_sql", "tu1", {"sql": "SELECT display_name FROM dim_entities LIMIT 1"}),
    ])
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu2", {
            "answer": "LOCKHEED MARTIN",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT display_name FROM dim_entities LIMIT 1",
            "citation_kind": "warehouse",
            "citation": "dim_entities",
        }),
    ])
    client = FakeClient([run_sql_resp, submit_resp])

    result = run("Which company?", client=client, duckdb_path=tiny_db, print_cost=False)

    assert result["answer"] == "LOCKHEED MARTIN"
    assert result["refuse"] is False
    assert result["refuse_reason_class"] is None
    assert result["citation_kind"] == "warehouse"
    assert "dim_entities" in result["touched_tables"]


# ---------------------------------------------------------------------------
# Refusal path
# ---------------------------------------------------------------------------


def test_refusal_path(tiny_db):
    """Agent can refuse a question with the correct enum class."""
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu1", {
            "answer": "REFUSE",
            "refuse": True,
            "refuse_reason_class": "data_not_ingested",
            "sql": None,
            "citation_kind": "none",
            "citation": "FY2023 J-book not ingested.",
        }),
    ])
    client = FakeClient([submit_resp])

    result = run("FY2023 budget?", client=client, duckdb_path=tiny_db, print_cost=False)

    assert result["refuse"] is True
    assert result["refuse_reason_class"] == "data_not_ingested"
    assert result["answer"] == "REFUSE"


def test_refusal_classified(tiny_db):
    """Classified refuse class is correctly passed through."""
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu1", {
            "answer": "REFUSE",
            "refuse": True,
            "refuse_reason_class": "classified",
            "sql": None,
            "citation_kind": "none",
            "citation": "NRO budget is classified.",
        }),
    ])
    client = FakeClient([submit_resp])

    result = run("NRO budget?", client=client, duckdb_path=tiny_db, print_cost=False)

    assert result["refuse_reason_class"] == "classified"


# ---------------------------------------------------------------------------
# Max-turns exceeded
# ---------------------------------------------------------------------------


def test_max_turns_exceeded(tiny_db):
    """When agent never submits, run() returns a REFUSE after MAX_TURNS."""
    # Return a run_sql response every turn (never submits)
    run_sql_resp = _make_resp([
        _tool_use_block("run_sql", "tu1", {"sql": "SELECT 1"}),
    ])
    # Supply many responses
    client = FakeClient([run_sql_resp] * (MAX_TURNS + 2))

    result = run("Infinite loop?", client=client, duckdb_path=tiny_db, print_cost=False)

    assert result["refuse"] is True
    assert "turns" in result
    assert result["turns"] <= MAX_TURNS


# ---------------------------------------------------------------------------
# Forced final turn
# ---------------------------------------------------------------------------


def test_forced_final_submit(tiny_db):
    """On the final turn, tool_choice is forced to submit_answer."""
    # Run MAX_TURNS - 1 run_sql calls, then a submit on the last turn
    run_sql_resp = _make_resp([
        _tool_use_block("run_sql", "tu1", {"sql": "SELECT 1"}),
    ])
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu_final", {
            "answer": "42",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT 1",
            "citation_kind": "warehouse",
            "citation": "computed",
        }),
    ])
    # First MAX_TURNS - 1 turns use run_sql, last turn uses submit
    responses = [run_sql_resp] * (MAX_TURNS - 1) + [submit_resp]
    client = FakeClient(responses)

    result = run("Test?", client=client, duckdb_path=tiny_db, print_cost=False)

    # Verify that the last call used tool_choice forced to submit_answer
    last_call = client.calls[-1]
    assert last_call.get("tool_choice", {}).get("name") == "submit_answer"
    assert result["answer"] == "42"


# ---------------------------------------------------------------------------
# BLOCKED when key absent
# ---------------------------------------------------------------------------


def test_blocked_when_no_key(tiny_db, monkeypatch):
    """run() raises SystemExit with ANTHROPIC_API_KEY message when key absent."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(SystemExit) as exc_info:
        run("Test?", duckdb_path=tiny_db, print_cost=False)
    msg = str(exc_info.value)
    assert "ANTHROPIC_API_KEY" in msg
    assert "export ANTHROPIC_API_KEY" in msg


# ---------------------------------------------------------------------------
# Cost accumulator
# ---------------------------------------------------------------------------


def test_cost_accumulator_arithmetic():
    """CostAccumulator totals tokens correctly."""
    acc = CostAccumulator()
    acc.add(SimpleNamespace(input_tokens=1000, output_tokens=200, cache_read_input_tokens=500))
    acc.add(SimpleNamespace(input_tokens=2000, output_tokens=100, cache_read_input_tokens=0))

    assert acc.input_tokens == 3000
    assert acc.output_tokens == 300
    assert acc.cache_read_tokens == 500

    from govbudget.analyst.agent import INPUT_USD_PER_MTOK, OUTPUT_USD_PER_MTOK, CACHE_READ_USD_PER_MTOK
    expected = (
        (3000 / 1e6) * INPUT_USD_PER_MTOK
        + (300 / 1e6) * OUTPUT_USD_PER_MTOK
        + (500 / 1e6) * CACHE_READ_USD_PER_MTOK
    )
    assert abs(acc.total_usd - expected) < 1e-10


def test_cost_summary_contains_tokens():
    acc = CostAccumulator()
    acc.add(SimpleNamespace(input_tokens=100, output_tokens=50, cache_read_input_tokens=0))
    summary = acc.summary()
    assert "100" in summary
    assert "50" in summary


# ---------------------------------------------------------------------------
# Schema card: cache_control is on the stable block
# ---------------------------------------------------------------------------


def test_schema_card_has_cache_control():
    """render_system_prompt() returns a list with cache_control on the first block."""
    from govbudget.analyst.schema_card import render_system_prompt
    blocks = render_system_prompt()
    assert len(blocks) >= 1
    assert blocks[0].get("cache_control") == {"type": "ephemeral"}


def test_schema_card_no_timestamps():
    """The schema card system block must not contain dynamic timestamps."""
    from govbudget.analyst.schema_card import render_system_prompt
    import re
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    # Timestamps look like 2026-07-01T00:00:00 or 2026-07-01
    assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", text), (
        "schema_card contains a timestamp — breaks prompt caching"
    )


# ---------------------------------------------------------------------------
# sql_tool sandbox: SET denied by gate (not just execution)
# (Proves agent cannot un-sandbox itself even if it tries)
# ---------------------------------------------------------------------------


def test_agent_sql_gate_denies_set(tiny_db):
    """SqlTool.run() raises SqlError for SET statements via the gate."""
    from govbudget.analyst.sql_tool import SqlTool, SqlError
    with SqlTool(tiny_db) as tool:
        with pytest.raises(SqlError, match="SET"):
            tool.run("SET enable_external_access = true")


# ---------------------------------------------------------------------------
# NEW: Canonical answer contract (TDD — added for live-model prose bug fix)
# ---------------------------------------------------------------------------


def test_submit_answer_description_contains_canonical_contract():
    """submit_answer schema 'answer' description must contain the canonical-contract language.

    The live model was submitting verbose markdown prose like
    'There are **76,727 distinct entity family groups** tracked in...'
    when the eval expects exact canonical values like '76727'.
    The schema description must explicitly forbid markdown and prose.
    """
    from govbudget.analyst.agent import _SUBMIT_ANSWER_TOOL
    answer_desc = _SUBMIT_ANSWER_TOOL["input_schema"]["properties"]["answer"]["description"]
    # Must forbid markdown and prose
    assert "markdown" in answer_desc.lower(), (
        "answer description must mention 'markdown' (to forbid it)"
    )
    assert "prose" in answer_desc.lower() or "narrative" in answer_desc.lower(), (
        "answer description must forbid prose/narrative"
    )
    # Must mention exact SQL casing
    assert "casing" in answer_desc.lower() or "case" in answer_desc.lower(), (
        "answer description must mention DB casing requirement"
    )
    # Must mention no thousands separators
    assert "comma" in answer_desc.lower() or "separator" in answer_desc.lower() or "thousands" in answer_desc.lower(), (
        "answer description must mention no thousands separators"
    )
    # Must state REFUSE keyword for refusals
    assert "REFUSE" in answer_desc, (
        "answer description must mention 'REFUSE' sentinel"
    )


def test_submit_answer_has_explanation_field():
    """submit_answer schema must have an optional 'explanation' field (prose outlet).

    This gives the live model a place to write human-readable prose that won't
    be scored — so the 'answer' field stays canonical.
    """
    from govbudget.analyst.agent import _SUBMIT_ANSWER_TOOL
    props = _SUBMIT_ANSWER_TOOL["input_schema"]["properties"]
    assert "explanation" in props, (
        "submit_answer schema must have an 'explanation' field"
    )
    # explanation must NOT be in required (it's optional)
    required = _SUBMIT_ANSWER_TOOL["input_schema"].get("required", [])
    assert "explanation" not in required, (
        "'explanation' must be optional (not in required list)"
    )


def test_explanation_threads_through_run(tiny_db):
    """explanation field in submit_answer is passed through to run() result dict."""
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu1", {
            "answer": "LOCKHEED MARTIN",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT display_name FROM dim_entities LIMIT 1",
            "citation_kind": "warehouse",
            "citation": "dim_entities",
            "explanation": "This is the top contractor by total obligation.",
        }),
    ])
    client = FakeClient([submit_resp])
    result = run("Which company?", client=client, duckdb_path=tiny_db, print_cost=False)
    assert "explanation" in result, "run() result must include 'explanation' key"
    assert result["explanation"] == "This is the top contractor by total obligation."


def test_explanation_defaults_to_empty_string(tiny_db):
    """When explanation is absent from submit_answer, run() returns empty string."""
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu1", {
            "answer": "LOCKHEED MARTIN",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT display_name FROM dim_entities LIMIT 1",
            "citation_kind": "warehouse",
            "citation": "dim_entities",
            # no explanation field
        }),
    ])
    client = FakeClient([submit_resp])
    result = run("Which company?", client=client, duckdb_path=tiny_db, print_cost=False)
    assert result.get("explanation", None) == "", (
        "run() must default explanation to '' when absent from submit_answer"
    )
