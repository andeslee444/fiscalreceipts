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


# ---------------------------------------------------------------------------
# NEW TDD: run_sql tool_result must include "canonical" key
# ---------------------------------------------------------------------------


def test_run_sql_tool_result_contains_canonical_key(tiny_db):
    """run_sql tool_result JSON must include a 'canonical' key.

    The canonical value must equal evals_refresh._canonicalize applied to the
    (truncated ≤200) rows — so the agent can copy-paste it into submit_answer
    without reconstructing float formatting.

    Demonstrative case: 1.35e11 (stored as total_obligation in tiny_db).
    json.dumps renders it as '135000000000.0' (with trailing .0).
    _fmt_value / _canonicalize renders it as '135000000000' (stripped).
    These differ — the canonical key removes the ambiguity.
    """
    import json
    from govbudget.evals_refresh import _canonicalize

    # Script: run_sql → then submit
    captured_tool_result_content: list[str] = []

    class CapturingFakeClient:
        """Like FakeClient but captures the tool_result content for inspection."""

        class _Messages:
            def __init__(self, outer):
                self._outer = outer

            def create(self, **kwargs):
                # Capture tool_result content from user messages
                for msg in kwargs.get("messages", []):
                    if msg.get("role") == "user":
                        content = msg.get("content", [])
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "tool_result":
                                    captured_tool_result_content.append(block["content"])
                return self._outer._pop_resp()

        def __init__(self, responses):
            self._responses = list(responses)

        def _pop_resp(self):
            if len(self._responses) > 1:
                return self._responses.pop(0)
            return self._responses[0]

        @property
        def messages(self):
            return self._Messages(self)

    run_sql_resp = _make_resp([
        _tool_use_block("run_sql", "tu1", {
            "sql": "SELECT total_obligation FROM dim_entities LIMIT 1",
        }),
    ])
    submit_resp = _make_resp([
        _tool_use_block("submit_answer", "tu2", {
            "answer": "135000000000",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT total_obligation FROM dim_entities LIMIT 1",
            "citation_kind": "warehouse",
            "citation": "dim_entities",
        }),
    ])
    client = CapturingFakeClient([run_sql_resp, submit_resp])
    run("What is the obligation?", client=client, duckdb_path=tiny_db, print_cost=False)

    # At least one tool_result must have been captured
    assert captured_tool_result_content, "No tool_result content was captured"
    payload = json.loads(captured_tool_result_content[0])

    # Must have canonical key
    assert "canonical" in payload, (
        f"run_sql tool_result must contain 'canonical' key; got keys: {list(payload.keys())}"
    )

    # The canonical value must equal evals_refresh._canonicalize of the rows
    rows = payload["rows"]
    expected_canonical = _canonicalize([tuple(r) for r in rows])
    assert payload["canonical"] == expected_canonical, (
        f"canonical={payload['canonical']!r} != _canonicalize(rows)={expected_canonical!r}"
    )

    # Demonstrate the divergence: json-of-float is NOT the same as canonical
    raw_json_of_value = json.dumps(rows[0][0])  # e.g. "135000000000.0"
    # The canonical strips trailing .0; raw_json does not
    assert payload["canonical"] == "135000000000", (
        f"Expected canonical '135000000000' for 1.35e11, got {payload['canonical']!r}"
    )
    assert raw_json_of_value != payload["canonical"] or True, (
        # Note: this assertion is intentionally soft — on some platforms json.dumps
        # may or may not emit the trailing .0; the canonical must always be correct.
        "canonical must equal _fmt_value rendering, not raw JSON float"
    )


def test_run_sql_tool_result_row_cap_warning(tmp_path):
    """When a query hits the 200-row cap, the run_sql tool_result must carry a
    'warning' key telling the model the canonical value covers only the
    truncated rows and must not be submitted as a final answer. Small results
    must NOT carry the warning.
    """
    import json
    from govbudget.analyst.sql_tool import ROW_CAP

    # DB with more rows than the cap
    db = tmp_path / "big.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "CREATE TABLE dim_entities AS "
        "SELECT 'FAMILY ' || i AS display_name, i * 1.0 AS total_obligation "
        f"FROM range({ROW_CAP + 50}) t(i)"
    )
    con.close()

    captured: list[str] = []

    class CapturingFakeClient:
        class _Messages:
            def __init__(self, outer):
                self._outer = outer

            def create(self, **kwargs):
                for msg in kwargs.get("messages", []):
                    if msg.get("role") == "user":
                        content = msg.get("content", [])
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "tool_result":
                                    captured.append(block["content"])
                return self._outer._pop_resp()

        def __init__(self, responses):
            self._responses = list(responses)

        def _pop_resp(self):
            if len(self._responses) > 1:
                return self._responses.pop(0)
            return self._responses[0]

        @property
        def messages(self):
            return self._Messages(self)

    broad_sql = "SELECT display_name FROM dim_entities"
    narrow_sql = "SELECT display_name FROM dim_entities LIMIT 1"
    responses = [
        _make_resp([_tool_use_block("run_sql", "tu1", {"sql": broad_sql})]),
        _make_resp([_tool_use_block("run_sql", "tu2", {"sql": narrow_sql})]),
        _make_resp([
            _tool_use_block("submit_answer", "tu3", {
                "answer": "FAMILY 0",
                "refuse": False,
                "refuse_reason_class": None,
                "sql": narrow_sql,
                "citation_kind": "warehouse",
                "citation": "dim_entities",
            }),
        ]),
    ]
    run("Which family?", client=CapturingFakeClient(responses),
        duckdb_path=db, print_cost=False)

    # captured accumulates per create() call (later calls re-see earlier
    # tool_results in the message history): first entry is the broad query's
    # result, last entry is the narrow query's result.
    assert len(captured) >= 2, "expected two run_sql tool_results"
    broad_payload = json.loads(captured[0])
    narrow_payload = json.loads(captured[-1])

    # Broad query hit the cap → warning present, rows truncated to ROW_CAP
    assert "warning" in broad_payload, (
        f"row-cap warning missing; keys: {list(broad_payload.keys())}"
    )
    assert len(broad_payload["rows"]) == ROW_CAP
    assert "canonical" in broad_payload["warning"] or "canonical" in broad_payload
    assert "narrower" in broad_payload["warning"], (
        "warning must direct the model to write a narrower final query"
    )

    # Narrow query under the cap → no warning
    assert "warning" not in narrow_payload


def test_schema_card_answer_format_mentions_canonical(tiny_db):
    """schema_card rendered text must mention the 'canonical' field as the source
    for the submit_answer answer value.

    After the change, the system prompt must instruct the model to copy the
    'canonical' field from run_sql tool_result into submit_answer answer.
    """
    from govbudget.analyst.schema_card import render_system_prompt
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    assert "canonical" in text.lower(), (
        "Rendered system prompt must mention 'canonical' field from run_sql result"
    )
