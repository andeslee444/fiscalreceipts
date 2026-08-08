"""citations.json / citations.parquet parity — backlog #49 regression, closed
while implementing backlog #50 (Task A'4 follow-up).

Every citation fact must resolve on BOTH of the site's citation surfaces:
the JSON sidecars (citations.json, read by the running site and its citation
panel) and the downloadable Parquet dataset (citations.parquet, offered on
/data/ as one of the raw exports). A fact_id in one but not the other is a
receipt that only half-resolves — the same defect class this sprint exists
to close, just at the plumbing layer instead of the label layer.

export_site.py mints several TIERS of derived facts, each with its own
comment stating the same rule: land in citation_rows BEFORE
"Write citations.parquet" runs, never after (grep the file for "BEFORE
citations.parquet" to see every site that states it). Backlog #49's
programs-coverage facts (index total + universe total + up to 5
largest-excluded lines, minted by _mint_coverage_fact inside
_write_all_sidecars) were minted AFTER that write — verified on a real
full-corpus export: citations.json carried 134,966 fact_ids, citations.parquet
carried 134,959, and the 7 missing were exactly those programs-coverage
facts. Fixed by moving the "Write citations.parquet" call itself to run
AFTER _emit_json_sidecars() completes (see export_site.py's own comment at
that call site for why moving the WRITE, not each individual mint site, is
the general fix — the coverage computation depends on a DuckDB mart
connection and a slice of programs_list that only exist inside
_write_all_sidecars, so hoisting the computation the way backlog #50's
fy26_split facts were hoisted was not available here).

This test runs against the ACTUAL SHIPPED BUILD in data/site/ (skipped when
absent, e.g. a fresh checkout that has not run `govbudget export-site` yet).
The intended discipline, matching this sprint's own verification loop:

    uv run python -m govbudget export-site && uv run pytest
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

_REPO_ROOT = Path(__file__).resolve().parents[1]
_CITATIONS_JSON = _REPO_ROOT / "data" / "site" / "json" / "citations.json"
_CITATIONS_PARQUET = _REPO_ROOT / "data" / "site" / "citations" / "citations.parquet"


def test_citations_json_and_parquet_carry_the_same_fact_ids():
    """A fact_id in citations.json with no matching row in citations.parquet
    (or the reverse) is a receipt that resolves on only one of the site's two
    citation surfaces. Zero divergence, both directions."""
    if not _CITATIONS_JSON.exists() or not _CITATIONS_PARQUET.exists():
        pytest.skip(
            "data/site/ build artifacts not present — run "
            "`uv run python -m govbudget export-site` first"
        )

    json_ids = set(json.loads(_CITATIONS_JSON.read_text()).keys())
    con = duckdb.connect(":memory:")
    parquet_ids = {
        r[0]
        for r in con.execute(
            f"select fact_id from read_parquet('{_CITATIONS_PARQUET.as_posix()}')"
        ).fetchall()
    }

    json_only = sorted(json_ids - parquet_ids)
    parquet_only = sorted(parquet_ids - json_ids)

    def _sample(ids: list[str]) -> str:
        shown = ids[:10]
        tail = f", ... and {len(ids) - 10} more" if len(ids) > 10 else ""
        return f"{shown}{tail}"

    assert not json_only and not parquet_only, (
        f"citations.json ({len(json_ids)} fact_ids) and citations.parquet "
        f"({len(parquet_ids)} fact_ids) disagree: "
        f"{len(json_only)} fact_id(s) in citations.json ONLY (never reached "
        f"the published Parquet download) {_sample(json_only)}; "
        f"{len(parquet_only)} fact_id(s) in citations.parquet ONLY "
        f"{_sample(parquet_only)}. A derived fact must be minted before "
        "export_site.py's 'Write citations.parquet' step (or that step must "
        "run after every mint site has run) — never the other way around."
    )
