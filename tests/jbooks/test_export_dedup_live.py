"""PM Sprint 1 Task 3 — live-export regression: the 47 dual-volume pages must
not list each J-book display row twice (identical (project, scenario, amount)
across the two volume documents — byte-identical facts, ONE display row).

0601102A is the canonical dual-volume page (Army ILIR — two P-40 volumes).
Skips when the live export is absent (CI without the data lake)."""

import json
from pathlib import Path

import pytest

LIVE = (
    Path(__file__).resolve().parents[2]
    / "data" / "site" / "json" / "program_details" / "0601102A.json"
)


@pytest.mark.skipif(not LIVE.exists(), reason="live export not present")
def test_live_0601102A_details_have_no_duplicate_display_rows():
    rows = json.loads(LIVE.read_text())["details"]
    tuples = [
        (r["project_number"], r["scenario"], r["amount_millions"]) for r in rows
    ]
    dupes = {t for t in tuples if tuples.count(t) > 1}
    assert not dupes, f"duplicate display rows on 0601102A: {list(dupes)[:5]}"
