"""Tests for analyst/schema_card.py.

Checks:
- schema card dict has all required top-level keys
- REFUSE_CLASSES enum is stable and correct
- URL_COLUMN_MAP has entries for known citation tables
- render_system_prompt() returns correct structure with cache_control
- Schema card does not contain timestamps (stable for caching)
- Drift test: every table in SCHEMA_CARD.tables must exist in the live
  DuckDB (skipped if warehouse is absent — only runs in live environments)
"""
from __future__ import annotations

import re

import pytest

from govbudget.analyst.schema_card import (
    REFUSE_CLASSES,
    SCHEMA_CARD,
    URL_COLUMN_MAP,
    render_system_prompt,
)
from govbudget import config


# ---------------------------------------------------------------------------
# Static schema card shape
# ---------------------------------------------------------------------------

def test_schema_card_has_required_keys():
    assert "version" in SCHEMA_CARD
    assert "description" in SCHEMA_CARD
    assert "refuse_guidance" in SCHEMA_CARD
    assert "unit_traps" in SCHEMA_CARD
    assert "additivity_traps" in SCHEMA_CARD
    assert "data_windows" in SCHEMA_CARD
    assert "tables" in SCHEMA_CARD


def test_refuse_classes_enum():
    """REFUSE_CLASSES must contain the three binding values."""
    assert "data_not_ingested" in REFUSE_CLASSES
    assert "structurally_absent" in REFUSE_CLASSES
    assert "classified" in REFUSE_CLASSES
    assert len(REFUSE_CLASSES) == 3


def test_refuse_guidance_has_all_enum_values():
    """The refuse_guidance rules must mention all three enum values."""
    rules_text = " ".join(SCHEMA_CARD["refuse_guidance"]["rules"])
    for cls in REFUSE_CLASSES:
        assert cls in rules_text, f"REFUSE class '{cls}' not mentioned in refuse_guidance rules"


def test_url_column_map_has_key_tables():
    """URL_COLUMN_MAP must cover the tables used for source_url citations."""
    assert "improper_payments" in URL_COLUMN_MAP
    assert "high_risk" in URL_COLUMN_MAP
    assert "fct_state_per_capita" in URL_COLUMN_MAP


def test_url_column_map_columns():
    """Check the specific column names are correct per plan recon."""
    assert URL_COLUMN_MAP["improper_payments"] == "source_url"
    assert URL_COLUMN_MAP["high_risk"] == "source_url"
    # fct_state_per_capita spend column
    assert "spend_source_url" in URL_COLUMN_MAP["fct_state_per_capita"]


def test_unit_traps_mention_thousands():
    """Unit traps must explicitly mention the THOUSANDS unit in budget lines."""
    traps = " ".join(SCHEMA_CARD["unit_traps"])
    assert "THOUSANDS" in traps or "thousands" in traps


def test_additivity_trap_mentions_non_additive():
    """Additivity traps must call out the NON-ADDITIVE column."""
    traps = " ".join(SCHEMA_CARD["additivity_traps"])
    assert "NON-ADDITIVE" in traps or "non-additive" in traps.lower()


def test_data_windows_mentions_fy2027_not_ingested():
    """Data windows must note FY2027 is not in the warehouse."""
    windows_text = " ".join(str(v) for v in SCHEMA_CARD["data_windows"].values())
    assert "FY2027" in windows_text or "2027" in windows_text


def test_fct_improper_exposure_has_url_column_note():
    """fct_improper_exposure must carry the url_column_note (misleading table)."""
    info = SCHEMA_CARD["tables"].get("fct_improper_exposure", {})
    assert "url_column_note" in info
    assert "improper_payments" in info["url_column_note"]


# ---------------------------------------------------------------------------
# render_system_prompt()
# ---------------------------------------------------------------------------

def test_render_returns_list():
    blocks = render_system_prompt()
    assert isinstance(blocks, list)
    assert len(blocks) >= 1


def test_render_first_block_has_cache_control():
    blocks = render_system_prompt()
    assert blocks[0].get("cache_control") == {"type": "ephemeral"}


def test_render_first_block_has_text():
    blocks = render_system_prompt()
    assert "text" in blocks[0]
    assert len(blocks[0]["text"]) > 100


def test_render_no_timestamps():
    """Rendered text must not contain ISO timestamps (would break cache stability)."""
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", text)


def test_render_contains_refuse_enum():
    """Rendered system prompt must mention all three REFUSE class values."""
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    for cls in REFUSE_CLASSES:
        assert cls in text, f"REFUSE class {cls!r} missing from rendered system prompt"


def test_render_mentions_unit_traps():
    """Rendered system prompt must mention the THOUSANDS unit trap."""
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    assert "THOUSANDS" in text or "thousands" in text


def test_render_has_run_sql_preamble():
    """Rendered system prompt must contain the 'always run_sql' preamble rule.

    This guards against the q040 failure mode: the agent answered from the
    data_windows schema description without running SQL. The preamble must
    explicitly require run_sql before submit_answer.
    """
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    assert "run_sql" in text, "Rendered prompt must mention run_sql tool"
    assert "never answer from this schema description alone" in text or \
           "Always execute run_sql" in text, (
        "Rendered prompt must contain the 'always execute run_sql' preamble rule"
    )


def test_render_has_answer_format_block():
    """Rendered system prompt must contain an ANSWER FORMAT block with examples.

    The live model was submitting verbose prose instead of bare canonical values.
    The schema card preamble must have an explicit ANSWER FORMAT block with
    concrete examples to prevent this.
    """
    blocks = render_system_prompt()
    text = " ".join(b.get("text", "") for b in blocks)
    # Must have an ANSWER FORMAT section header
    assert "ANSWER FORMAT" in text, (
        "Rendered system prompt must contain an 'ANSWER FORMAT' block"
    )
    # Must show bare numeric example (no commas)
    assert "76727" in text, (
        "ANSWER FORMAT must show bare integer example '76727' (not '76,727' or prose)"
    )
    # Must mention no markdown
    assert "markdown" in text.lower() or "no prose" in text.lower(), (
        "ANSWER FORMAT must forbid markdown or prose"
    )
    # Must show REFUSE example
    assert "REFUSE" in text, (
        "ANSWER FORMAT must include REFUSE example"
    )


# ---------------------------------------------------------------------------
# Drift test: schema card tables vs live information_schema
# (skipped when DuckDB warehouse is absent)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not config.DUCKDB_PATH.exists(),
    reason="Live warehouse not present — drift test skipped",
)
def test_schema_card_tables_exist_in_warehouse():
    """Every table in SCHEMA_CARD.tables (except TEMP tables) must exist in the
    live DuckDB (information_schema.tables).
    """
    import duckdb

    # TEMP tables are created at runtime by SqlTool — skip them in drift check
    RUNTIME_TEMP_TABLES = {"improper_payments", "high_risk"}

    con = duckdb.connect(str(config.DUCKDB_PATH), read_only=True)
    rows = con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    ).fetchall()
    con.close()
    live_tables = {r[0] for r in rows}

    missing = []
    for table_name in SCHEMA_CARD["tables"]:
        if table_name in RUNTIME_TEMP_TABLES:
            continue
        if table_name not in live_tables:
            missing.append(table_name)

    assert not missing, (
        f"These tables are in SCHEMA_CARD but not in the live warehouse: {missing}\n"
        "Update schema_card.py or the DuckDB mart to match."
    )
