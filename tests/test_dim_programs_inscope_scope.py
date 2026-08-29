"""dim_programs.reconciled_in_scope must exclude exactly what the reconciler
never checks — the SQL literal tied back to the Python contract.

Tri-persona review Wave 2. The badge defect this guards against was NOT a
wrong number: `fully_reconciled = bool_and(reconciled)` included the
AllPriorYears scenario, which reconcile.py never issues a check for, so 1,310
programs with zero in-scope failures wore the same "Partial Reconciliation"
badge as the 87 with a real one.

The fix introduces a second predicate with a literal scenario list in SQL —
and a literal in SQL is exactly the kind of copy this project has watched
drift from its source four times (CURRENCY_RE, BASIS_LABEL, CORPUS_SCOPE_TAIL,
the measured: figures). So the literal is asserted here against the two Python
objects that actually decide the scope, not against a second transcription of
itself:

  * reconcile.scenario_map(fy) — Gate B iterates `edition_map.get(scenario)`
    and `continue`s on a miss, so its KEYS are the checked set, definitionally.
  * reconcile.DESIGN_EXCLUDED_SCENARIOS — the frozenset that names the
    complement ("no R-1 display analog ... not-served-by-design").
  * xml_parser.FUNDING_SCENARIOS — every scenario the extractor can emit, so
    the two sets above are provably exhaustive over the real vocabulary.
"""
from __future__ import annotations

import re
from pathlib import Path

from govbudget.jbooks.reconcile import DESIGN_EXCLUDED_SCENARIOS, scenario_map
from govbudget.jbooks.xml_parser import FUNDING_SCENARIOS

MODEL = (
    Path(__file__).resolve().parents[1]
    / "dbt" / "models" / "marts" / "dim_programs.sql"
)

# The one filter clause the badge predicate is made of. Anchored on the column
# name so a future second `not in (...)` elsewhere in the model cannot satisfy
# this test by accident.
FILTER_RE = re.compile(
    r"bool_and\(dd\.reconciled\)\s*filter\s*\(\s*"
    r"where\s+dd\.scenario\s+not\s+in\s*\(([^)]*)\)\s*\)\s*"
    r"as\s+reconciled_in_scope",
    re.IGNORECASE,
)


def _sql_excluded_scenarios() -> set[str]:
    sql = MODEL.read_text()
    m = FILTER_RE.search(sql)
    assert m, (
        "dim_programs.sql no longer defines reconciled_in_scope as a "
        "bool_and(dd.reconciled) filtered by a `dd.scenario not in (...)` "
        "list — the badge predicate changed shape and this guard went blind"
    )
    return {s.strip().strip("'") for s in m.group(1).split(",") if s.strip()}


def test_sql_excluded_list_equals_design_excluded_frozenset():
    assert _sql_excluded_scenarios() == set(DESIGN_EXCLUDED_SCENARIOS)


def test_design_excluded_is_exactly_what_gate_b_never_checks():
    """The frozenset is not decorative: Gate B's real scope is scenario_map's
    keys, and the two must partition the extractor's vocabulary with no
    overlap and no gap — for every edition the corpus carries."""
    for fy in range(2017, 2027):
        checked = set(scenario_map(fy))
        assert checked & set(DESIGN_EXCLUDED_SCENARIOS) == set(), (
            f"PB{fy}: a scenario is both checked by Gate B and declared "
            f"design-excluded"
        )
        assert set(FUNDING_SCENARIOS) <= checked | set(DESIGN_EXCLUDED_SCENARIOS), (
            f"PB{fy}: the extractor can emit a scenario that is neither "
            f"checked nor declared out of scope — reconciled_in_scope would "
            f"silently absorb it"
        )


def test_excluded_scenarios_are_actually_present_in_the_vocabulary():
    """Non-vacuity: an exclusion list of terms nothing ever emits would make
    reconciled_in_scope identical to fully_reconciled and this whole guard
    a no-op. At least one excluded scenario must be a real emitted one."""
    assert set(DESIGN_EXCLUDED_SCENARIOS) & set(FUNDING_SCENARIOS), (
        "no design-excluded scenario is in FUNDING_SCENARIOS — the badge "
        "predicate excludes nothing the extractor can produce"
    )


def test_fully_reconciled_is_still_published_unfiltered():
    """The two columns must remain DIFFERENT predicates. Collapsing
    fully_reconciled into the filtered one would quietly widen every count
    already published on the old definition (agency pages, /coverage/)."""
    sql = MODEL.read_text()
    assert re.search(
        r"bool_and\(dd\.reconciled\)\s+as\s+fully_reconciled", sql
    ), "fully_reconciled is no longer the unfiltered bool_and it is documented as"
