"""Analyst agent — text-to-SQL via manual tool loop.

The agent runs a manual loop (messages.create + while tool_use + execute
run_sql + append tool_result). The final turn is tool_choice-forced to
submit_answer. Max 8 turns.

Tool definitions
----------------
run_sql(sql: str) → rows + touched_tables
submit_answer(answer, refuse, refuse_reason_class, sql, citation_kind,
              citation) → terminal

Cost accumulation
-----------------
Prints dossier-style cost estimates after each live run.

BLOCKED path
------------
When ANTHROPIC_API_KEY is absent, require_client raises SystemExit with the
analyst-specific BLOCKED message.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from govbudget.analyst.schema_card import REFUSE_CLASSES, render_system_prompt
from govbudget.analyst.sql_tool import SqlError, SqlTool
from govbudget.common.anthropic_client import require_client
from govbudget.evals_refresh import _canonicalize

# ---------------------------------------------------------------------------
# Model + cost constants
# ---------------------------------------------------------------------------

MODEL = "claude-sonnet-4-6"

# Sonnet 4.6 pricing (per MTok)
INPUT_USD_PER_MTOK = 3.0
OUTPUT_USD_PER_MTOK = 15.0
CACHE_READ_USD_PER_MTOK = 0.30

MAX_TURNS = 8

# ---------------------------------------------------------------------------
# BLOCKED message
# ---------------------------------------------------------------------------

_NO_KEY_MESSAGE = """\
analyst: ANTHROPIC_API_KEY is not set — the live analyst run is BLOCKED.

Export a key and re-run:

    export ANTHROPIC_API_KEY=sk-ant-...
    uv run python -m govbudget analyst "your question here"

Nothing was run and nothing was spent. (The test suite covers the full
tool-loop pipeline without a key via FakeClient.)"""

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

_RUN_SQL_TOOL = {
    "name": "run_sql",
    "description": (
        "Execute a read-only SELECT statement against the GovBudget warehouse. "
        "Returns up to 200 rows. The sandbox blocks all file-read and network "
        "functions (read_text, read_parquet, glob, getenv, etc.). "
        "The result includes a 'canonical' key — the grader-exact string produced "
        "by _canonicalize(rows). Copy this value verbatim into submit_answer's "
        "'answer' field; do NOT reformat or rephrase it. "
        "Always close with submit_answer after you have the answer."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "sql": {
                "type": "string",
                "description": (
                    "A single SELECT statement (WITH/CTEs allowed). "
                    "DML, ATTACH, COPY, INSTALL, LOAD, PRAGMA and SET are rejected."
                ),
            }
        },
        "required": ["sql"],
    },
}

_SUBMIT_ANSWER_TOOL = {
    "name": "submit_answer",
    "description": (
        "Submit the final answer. Call this when you have the answer or are refusing."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "answer": {
                "type": "string",
                "description": (
                    "CANONICAL VALUE ONLY — the exact string that your final SQL "
                    "returns after canonicalization. No markdown, no prose, no "
                    "narrative sentences, no units label, no $ signs, no thousands "
                    "separators (commas). Numbers must match what SQL prints: "
                    "integers as plain digits (e.g. '76727' NOT '76,727'), floats "
                    "with up to 4 significant decimal places stripped of trailing "
                    "zeros (e.g. '280.494'). Preserve DB casing exactly — do NOT "
                    "re-case entity names (e.g. 'LOCKHEED MARTIN CORPORATION' not "
                    "'Lockheed Martin Corporation'). "
                    "Formatting rules matching the grader's _canonicalize(): "
                    "single value → bare scalar; single row multi-column → values "
                    "joined with ', ' (comma-space); multi-row → one row per line "
                    "with columns joined by ', ' within each row. "
                    "The submitted sql is re-executed by the grader and its "
                    "canonicalized result must equal this answer character-for-character. "
                    "Therefore sql must SELECT exactly the value(s) that answer the "
                    "question — no extra columns or rows. "
                    "When refusing, set answer='REFUSE'."
                ),
            },
            "explanation": {
                "type": "string",
                "description": (
                    "Optional human-readable prose summary of the answer. Write "
                    "context, units, caveats, or narrative here. This field is NOT "
                    "scored — it is the prose outlet so the 'answer' field stays "
                    "as a bare canonical value."
                ),
            },
            "refuse": {
                "type": "boolean",
                "description": "True if the question cannot be answered from the warehouse.",
            },
            "refuse_reason_class": {
                "type": ["string", "null"],
                "enum": list(REFUSE_CLASSES) + [None],
                "description": (
                    f"One of {REFUSE_CLASSES} when refuse=true, else null."
                ),
            },
            "sql": {
                "type": ["string", "null"],
                "description": (
                    "The SELECT statement used to derive the answer. The grader "
                    "re-executes this SQL and requires canonicalize(rows) == answer "
                    "character-for-character. SELECT only the columns/rows that form "
                    "the answer — no extra columns, no extra rows. Null if refusing."
                ),
            },
            "citation_kind": {
                "type": "string",
                "enum": ["warehouse", "pdf_page", "source_url", "filing_uuid", "none"],
                "description": "How the answer is cited.",
            },
            "citation": {
                "type": ["string", "null"],
                "description": (
                    "Citation detail: a table name, page reference, URL, or "
                    "refusal explanation."
                ),
            },
        },
        "required": ["answer", "refuse", "refuse_reason_class", "sql",
                     "citation_kind", "citation"],
    },
}

_TOOLS = [_RUN_SQL_TOOL, _SUBMIT_ANSWER_TOOL]

# ---------------------------------------------------------------------------
# Cost accumulator
# ---------------------------------------------------------------------------


class CostAccumulator:
    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0

    def add(self, usage) -> None:
        self.input_tokens += getattr(usage, "input_tokens", 0)
        self.output_tokens += getattr(usage, "output_tokens", 0)
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0)

    @property
    def total_usd(self) -> float:
        return (
            (self.input_tokens / 1e6) * INPUT_USD_PER_MTOK
            + (self.output_tokens / 1e6) * OUTPUT_USD_PER_MTOK
            + (self.cache_read_tokens / 1e6) * CACHE_READ_USD_PER_MTOK
        )

    def summary(self) -> str:
        return (
            f"analyst cost: {self.input_tokens} in / {self.output_tokens} out / "
            f"{self.cache_read_tokens} cache-read tokens "
            f"≈ ${self.total_usd:.4f}"
        )


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


def run(
    question: str,
    *,
    client=None,
    duckdb_path: Path | None = None,
    print_cost: bool = True,
) -> dict[str, Any]:
    """Run the analyst agent on a single question.

    Returns a dict with keys:
      answer, refuse, refuse_reason_class, sql, citation_kind, citation,
      turns, cost_usd, touched_tables
    """
    client = require_client(client, message=_NO_KEY_MESSAGE)
    system = render_system_prompt()
    messages: list[dict] = [{"role": "user", "content": question}]
    cost = CostAccumulator()
    turns = 0
    all_touched: set[str] = set()

    with SqlTool(duckdb_path) as tool:
        for turn_idx in range(MAX_TURNS):
            turns += 1

            # On the final turn, force submit_answer
            if turn_idx == MAX_TURNS - 1:
                tool_choice: dict = {"type": "tool", "name": "submit_answer"}
            else:
                tool_choice = {"type": "auto"}

            resp = client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=system,
                tools=_TOOLS,
                tool_choice=tool_choice,
                messages=messages,
            )
            cost.add(resp.usage)

            # Collect assistant turn
            messages.append({"role": "assistant", "content": resp.content})

            # Check stop_reason
            if resp.stop_reason == "end_turn":
                # Model stopped without submitting — force submission on next turn
                messages.append({
                    "role": "user",
                    "content": "Please call submit_answer now with your final answer.",
                })
                continue

            # Process tool uses
            tool_results = []
            submitted = None

            for block in resp.content:
                if getattr(block, "type", None) != "tool_use":
                    continue
                tool_name = block.name
                tool_input = block.input if isinstance(block.input, dict) else {}

                if tool_name == "submit_answer":
                    submitted = tool_input
                    # Acknowledge submit (not appended to messages — loop breaks)
                    break
                elif tool_name == "run_sql":
                    sql = tool_input.get("sql", "")
                    try:
                        result = tool.run(sql)
                        all_touched |= result["touched_tables"]
                        truncated_rows = result["rows"][:200]
                        content = json.dumps({
                            "rows": truncated_rows,
                            "column_names": result["column_names"],
                            "touched_tables": list(result["touched_tables"]),
                            "canonical": _canonicalize(
                                [tuple(r) for r in truncated_rows]
                            ),
                        })
                    except SqlError as exc:
                        content = json.dumps({"error": str(exc)})
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": content,
                    })
                else:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps({"error": f"unknown tool: {tool_name}"}),
                    })

            if submitted is not None:
                if print_cost:
                    print(cost.summary())
                return {
                    "answer": submitted.get("answer", ""),
                    "explanation": submitted.get("explanation", ""),
                    "refuse": bool(submitted.get("refuse", False)),
                    "refuse_reason_class": submitted.get("refuse_reason_class"),
                    "sql": submitted.get("sql"),
                    "citation_kind": submitted.get("citation_kind", "none"),
                    "citation": submitted.get("citation"),
                    "turns": turns,
                    "cost_usd": cost.total_usd,
                    "touched_tables": all_touched,
                }

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

    # Exceeded max turns — return a REFUSE with reason
    if print_cost:
        print(cost.summary())
    return {
        "answer": "REFUSE",
        "refuse": True,
        "refuse_reason_class": "structurally_absent",
        "sql": None,
        "citation_kind": "none",
        "citation": f"Max turns ({MAX_TURNS}) exceeded without an answer.",
        "turns": turns,
        "cost_usd": cost.total_usd,
        "touched_tables": all_touched,
    }
