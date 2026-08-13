"""Tests for the bounded, recorded citation-resolution retry (backlog #36).

`verify-phase5`'s citation gate is a 100% bar sampled ONCE from a
nondeterministic LLM agent (temperature=0 is not a determinism guarantee —
see analyst/agent.py's own comment on why it's set). q011 has flaked twice:
the agent's FINAL `submit_answer(sql=...)` was occasionally a literal echo
("SELECT 293.145", no FROM/JOIN) even though the answer was correct, which
leaves `touched_tables` empty and the citation unresolvable. An immediate
re-run of the same gate against the same build/data scored 43/43 — the
build was never wrong; one sample of the agent was unlucky.

Two groups of tests here:

  1. `resolve_citation_with_retry` — the generic bounded-retry primitive,
     exactly as specified in the drawdown plan (Task A5 / backlog #36).
     These use a FakeRecompute and know nothing about SQL, agents, or cost.

  2. Wiring tests (`_citation_retry_recompute` + `eval_gate` integration) —
     proof that retrying is wired around a genuine RE-SAMPLE of the agent,
     not a re-execution of the same frozen SQL string. That distinction is
     load-bearing: `_extract_touched_tables` (analyst/sql_tool.py) is a pure
     regex function of the SQL TEXT alone, so re-running the SAME agent.sql
     through a fresh SqlTool is mathematically guaranteed to reproduce the
     SAME touched_tables every time. A retry that reruns only the frozen SQL
     can never rescue this specific flake — see the wiring's own docstring
     in verify_phase5.py for the full argument. These tests use FakeClient
     to script a SECOND, DIFFERENT agent response on retry, which is the
     only thing that can plausibly change the outcome, and confirm the
     retry is invoked ONLY when the original answer already scored correct
     and the failure was specifically the empty-touched-tables reason —
     never for a wrong answer, a REFUSE, or an agent crash (`error: True`).
"""
from __future__ import annotations

from types import SimpleNamespace

import duckdb
import pytest
import yaml

from govbudget.verify_phase5 import (
    _EMPTY_TOUCHED_REASON,
    resolve_citation_with_retry,
)


# ---------------------------------------------------------------------------
# Group 1: resolve_citation_with_retry (generic primitive, as specified)
# ---------------------------------------------------------------------------


class FakeRecompute:
    """First call yields an empty touched_tables (the q011 flake); second succeeds."""

    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    def __call__(self, question_id):
        self.calls += 1
        return self.results.pop(0)


def test_retries_once_when_touched_tables_is_empty():
    rec = FakeRecompute([{"touched_tables": []}, {"touched_tables": ["fct_award_transactions"]}])
    out = resolve_citation_with_retry("q011", rec, max_attempts=2)
    assert out["touched_tables"] == ["fct_award_transactions"]
    assert out["retried"] is True
    assert rec.calls == 2


def test_does_not_retry_when_the_first_attempt_resolves():
    rec = FakeRecompute([{"touched_tables": ["dim_programs"]}])
    out = resolve_citation_with_retry("q004", rec, max_attempts=2)
    assert out["retried"] is False
    assert rec.calls == 1


def test_gives_up_after_max_attempts_and_reports_failure():
    """PROOF-IT-CAN-FAIL (generic primitive): a genuinely-empty recompute stays
    empty after max_attempts — the retry cannot manufacture a citation that
    was never there, so the caller must still treat this as a FAIL."""
    rec = FakeRecompute([{"touched_tables": []}, {"touched_tables": []}])
    out = resolve_citation_with_retry("q011", rec, max_attempts=2)
    assert out["touched_tables"] == []
    assert out["retried"] is True
    assert rec.calls == 2


# ---------------------------------------------------------------------------
# Group 2: wiring — retry must genuinely re-sample the agent, bounded + recorded
# ---------------------------------------------------------------------------
#
# The FakeClient/tiny_db/entry scaffolding below intentionally mirrors
# tests/test_verify_phase5.py rather than importing it — that file's helpers
# are module-local, not a shared fixture surface, and duplicating ~30 lines
# here keeps this file runnable in isolation.


def _tool_use_block(name: str, tool_id: str, inp: dict):
    return SimpleNamespace(type="tool_use", name=name, id=tool_id, input=inp)


def _make_usage(inp=10, out=20, cache_read=0):
    return SimpleNamespace(input_tokens=inp, output_tokens=out, cache_read_input_tokens=cache_read)


def _make_resp(content, stop_reason="tool_use", usage=None):
    return SimpleNamespace(content=content, stop_reason=stop_reason, usage=usage or _make_usage())


class FakeClient:
    """Scripted client: each element of `runs` is the full list of responses
    for ONE agent_run() call (i.e. one full multi-turn conversation).

    Each response is popped exactly once. agent.py's loop calls create()
    exactly len(run) times per agent_run() — it stops calling create() the
    instant it sees a submit_answer tool_use — so refilling `_current` from
    the next scripted run only when the current one is fully drained
    correctly lines up call N+1 with agent_run() call N+1, however many
    turns each run took.
    """

    def __init__(self, runs: list[list]):
        self._runs = list(runs)
        self._current: list = []
        self.calls: list = []

    class _Messages:
        def __init__(self, outer):
            self._outer = outer

        def create(self, **kwargs):
            self._outer.calls.append(kwargs)
            if not self._outer._current:
                self._outer._current = list(self._outer._runs.pop(0))
            return self._outer._current.pop(0)

    @property
    def messages(self):
        return self._Messages(self)


@pytest.fixture()
def tiny_db(tmp_path):
    db = tmp_path / "tiny.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE dim_entities (display_name VARCHAR, total_obligation DOUBLE)")
    con.execute("INSERT INTO dim_entities VALUES ('LOCKHEED MARTIN', 1.35e11)")
    con.close()
    return db


def _literal_echo_submit(tool_id="t1"):
    """A submit_answer whose SQL is a literal echo (no FROM/JOIN) — the q011
    flake shape: correct answer, unresolvable citation."""
    return _make_resp([
        _tool_use_block("submit_answer", tool_id, {
            "answer": "LOCKHEED MARTIN",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT 'LOCKHEED MARTIN'",  # literal echo — touches nothing
            "citation_kind": "warehouse",
            "citation": "dim_entities",
        }),
    ])


def _real_sql_submit(tool_id="t2"):
    """A submit_answer whose SQL genuinely touches dim_entities."""
    return _make_resp([
        _tool_use_block("submit_answer", tool_id, {
            "answer": "LOCKHEED MARTIN",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT display_name FROM dim_entities ORDER BY total_obligation DESC LIMIT 1",
            "citation_kind": "warehouse",
            "citation": "dim_entities",
        }),
    ])


def _wrong_answer_submit(tool_id="t3"):
    return _make_resp([
        _tool_use_block("submit_answer", tool_id, {
            "answer": "THE BOEING COMPANY",
            "refuse": False,
            "refuse_reason_class": None,
            "sql": "SELECT 'THE BOEING COMPANY'",
            "citation_kind": "warehouse",
            "citation": "dim_entities",
        }),
    ])


def _entries(tmp_path):
    entries = [{
        "id": "q001",
        "question": "Which company has the highest total obligation?",
        "answer_sql": "SELECT display_name FROM dim_entities ORDER BY total_obligation DESC LIMIT 1",
        "expected_answer": "LOCKHEED MARTIN",
        "expected_citation_kind": "warehouse",
        "notes": "retry wiring test",
    }]
    yaml_path = tmp_path / "evals" / "phase5_questions.yaml"
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    with open(yaml_path, "w") as fh:
        yaml.dump(entries, fh)
    return yaml_path


def test_retry_rescues_a_correct_answer_whose_first_sql_was_a_literal_echo(
    tmp_path, tiny_db, monkeypatch
):
    """The documented q011 shape: run 1 is a correct answer with literal-echo
    SQL (unresolvable citation); a genuine re-sample of the agent on retry
    produces real SQL that resolves. The gate PASSES, and the artifact shows
    retried=True, attempts=2 — a retried pass is never silently invisible.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-fake")
    yaml_path = _entries(tmp_path)

    fake_client = FakeClient(runs=[
        [_literal_echo_submit()],  # original agent_run — flakes
        [_real_sql_submit()],      # retry's fresh agent_run — resolves
    ])

    import govbudget.verify_phase5 as vp5
    orig_path = vp5.EVAL_PATH
    vp5.EVAL_PATH = yaml_path
    try:
        result = vp5.eval_gate(client=fake_client, duckdb_path=tiny_db)
    finally:
        vp5.EVAL_PATH = orig_path

    assert result["accuracy"] == 1
    assert result["citation_ok"] == 1
    assert result["citation_total"] == 1
    # NOTE: result["ok"] also requires accuracy >= ACCURACY_THRESHOLD (44),
    # which a 1-question fixture can never reach — that threshold is about
    # the full 48-question set, not this test's concern. What matters here
    # is citation resolution specifically: 1/1 == 100%, so nothing about
    # this question's citation would drag the real 48-question gate down.
    assert result["citation_ok"] == result["citation_total"]

    score = result["scores"][0]
    assert score["citation_resolved"] is True
    assert score["citation_retried"] is True
    assert score["citation_retry_attempts"] == 2
    # Exactly one extra paid agent call happened (one retry, one turn each).
    assert len(fake_client.calls) == 2


def test_retry_exhausts_and_gate_still_fails_when_citation_never_resolves(
    tmp_path, tiny_db, monkeypatch
):
    """PROOF-IT-CAN-FAIL (wiring): the agent echoes a literal BOTH times —
    a genuinely unresolvable citation. The retry must not manufacture a
    resolution: gate FAILS, and the artifact still records retried=True,
    attempts=2 so the retry is visible even though it did not help.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-fake")
    yaml_path = _entries(tmp_path)

    fake_client = FakeClient(runs=[
        [_literal_echo_submit(tool_id="t1")],
        [_literal_echo_submit(tool_id="t2")],
    ])

    import govbudget.verify_phase5 as vp5
    orig_path = vp5.EVAL_PATH
    vp5.EVAL_PATH = yaml_path
    try:
        result = vp5.eval_gate(client=fake_client, duckdb_path=tiny_db)
    finally:
        vp5.EVAL_PATH = orig_path

    assert result["accuracy"] == 1  # the answer itself was always correct
    assert result["citation_ok"] == 0
    assert result["citation_total"] == 1
    # Citation resolution is NOT 100% (0/1) — the real 48-question gate's own
    # citation_ok_all check (`citation_total == 0 or citation_ok ==
    # citation_total`) would FAIL on this question. Checked directly rather
    # than via result["ok"], which a 1-question fixture would also report
    # False on for the unrelated reason that accuracy 1 < ACCURACY_THRESHOLD
    # (44) — that would be true even if the retry wrongly "fixed" this
    # citation, so it is not a strong enough assertion on its own.
    assert result["citation_ok"] != result["citation_total"]

    score = result["scores"][0]
    assert score["citation_resolved"] is False
    assert score["citation_retried"] is True
    assert score["citation_retry_attempts"] == 2
    assert score["citation_reason"] == _EMPTY_TOUCHED_REASON


def test_retry_never_triggers_for_a_wrong_answer(tmp_path, tiny_db, monkeypatch):
    """PROOF-IT-CAN-FAIL (cannot mask a wrong answer): even though the wrong
    answer's SQL is ALSO a literal echo (empty touched_tables → citation
    would also be unresolvable), the retry must never fire, because it only
    triggers when accuracy already passed. No second agent call is made.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-fake")
    yaml_path = _entries(tmp_path)

    fake_client = FakeClient(runs=[[_wrong_answer_submit()]])

    import govbudget.verify_phase5 as vp5
    orig_path = vp5.EVAL_PATH
    vp5.EVAL_PATH = yaml_path
    try:
        result = vp5.eval_gate(client=fake_client, duckdb_path=tiny_db)
    finally:
        vp5.EVAL_PATH = orig_path

    assert result["accuracy"] == 0
    score = result["scores"][0]
    assert score["citation_retried"] is False
    assert score["citation_retry_attempts"] == 1
    # Only the ORIGINAL agent_run's single turn happened — no retry call.
    assert len(fake_client.calls) == 1


def test_retry_never_triggers_for_an_agent_error(tmp_path, tiny_db, monkeypatch):
    """Interaction with the error:True flag (commit e243f51): a crashed run
    is `refuse=True` so eval_gate's citation-resolution block is skipped
    entirely — the retry must never see (and never resample) an errored run.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-fake")
    yaml_path = _entries(tmp_path)

    class ExplodingClient:
        class _Messages:
            def create(self, **kwargs):
                raise RuntimeError("simulated transport failure")

        @property
        def messages(self):
            return self._Messages()

    import govbudget.verify_phase5 as vp5
    orig_path = vp5.EVAL_PATH
    vp5.EVAL_PATH = yaml_path
    try:
        result = vp5.eval_gate(client=ExplodingClient(), duckdb_path=tiny_db)
    finally:
        vp5.EVAL_PATH = orig_path

    assert result["accuracy"] == 0
    score = result["scores"][0]
    assert score["agent_error"] is True
    assert score["citation_resolved"] is None  # citation resolution never attempted
    assert score["citation_retried"] is False
    assert score["citation_retry_attempts"] is None
