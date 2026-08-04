"""Exporter side of the curated corporate-family merge (PM Sprint 2, §P1-3).

Covers the three things the exporter must get right for `/companies/` to show
one company as one row without ever double counting:

  1. the disjointness invariant is ASSERTED against the lake, not assumed;
  2. the curated layer goes inert (never partly applied) on a warehouse that
     cannot support the check;
  3. the combined-obligation citation recomputes — `_verify_derived`'s rule 4d
     is the double-count guard in its enforced form.
"""

from __future__ import annotations

import json

import duckdb
import pytest

from govbudget.export_site import (
    _assert_family_uei_disjoint,
    _resolved_entity_families,
    fact_id_derived,
)
from govbudget.verify_phase5b1 import _verify_derived

# Live values (dim_entities, 2026-08 build).
RAYTHEON = 43_730_561_330.37999
RTX = 24_624_474_165.710003


def warehouse(tmp_path, *, xwalk=True, dupe_uei=False):
    """A minimal warehouse carrying two curated members of the RTX family."""
    db = tmp_path / "wh.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table dim_entities (family_key varchar, display_name varchar,"
        " uei_count bigint, total_obligation double, worst_confidence varchar)"
    )
    con.execute(
        "insert into dim_entities values"
        f" ('RAYTHEON','RAYTHEON COMPANY',86,{RAYTHEON},'medium'),"
        f" ('RTX','RTX CORP',101,{RTX},'medium'),"
        " ('BOEING','THE BOEING COMPANY',89,75944399838.1,'medium')"
    )
    if xwalk:
        con.execute(
            "create table entity_xwalk (recipient_uei varchar, family_key varchar)"
        )
        rows = [("UEI-A", "RAYTHEON"), ("UEI-B", "RTX"), ("UEI-C", "BOEING")]
        if dupe_uei:
            # The forbidden shape: one recipient in two merged members.
            rows.append(("UEI-A", "RTX"))
        con.executemany("insert into entity_xwalk values (?, ?)", rows)
    return con


def test_families_resolve_against_the_warehouse(tmp_path):
    con = warehouse(tmp_path)
    families = _resolved_entity_families(con)
    rtx = next(f for f in families if f.label == "RTX")
    assert set(rtx.member_keys) == {"RAYTHEON", "RTX"}


def test_disjointness_is_asserted_not_assumed(tmp_path):
    con = warehouse(tmp_path)
    families = _resolved_entity_families(con)
    assert _assert_family_uei_disjoint(con, families) >= 2


def test_a_uei_in_two_members_refuses_the_merge(tmp_path):
    """The double-count hazard, caught at export rather than shipped."""
    con = warehouse(tmp_path, dupe_uei=True)
    families = _resolved_entity_families(con)
    with pytest.raises(ValueError, match="DOUBLE COUNT"):
        _assert_family_uei_disjoint(con, families)


def test_layer_is_inert_without_entity_xwalk(tmp_path):
    """No lake to check the invariant against → no merge at all, never a
    partly-applied one."""
    con = warehouse(tmp_path, xwalk=False)
    assert _resolved_entity_families(con) == []


def test_layer_is_inert_without_dim_entities(tmp_path):
    db = tmp_path / "empty.duckdb"
    con = duckdb.connect(str(db))
    assert _resolved_entity_families(con) == []


# ── the combined citation recomputes (verify_phase5b1 rule 4d) ──────────────

CIT_COLS = ["fact_id", "formula", "inputs", "recorded_value"]
IDX = {c: i for i, c in enumerate(CIT_COLS)}
FID_A = "a" * 16
FID_B = "b" * 16


def combined_row(inputs, recorded):
    return (
        fact_id_derived("entity_family", "rtx", "combined_obligation"),
        "sum(entity_family_members.total_obligation) across 2 registry families",
        json.dumps(inputs),
        recorded,
    )


def members(a=RAYTHEON, b=RTX):
    return [
        (FID_A, "sum(fct_award_transactions.obligation)", "[]", f"{a:.3f}"),
        (FID_B, "sum(fct_award_transactions.obligation)", "[]", f"{b:.3f}"),
    ]


def test_correct_combined_value_verifies():
    row = combined_row([FID_A, FID_B], f"{RAYTHEON + RTX:.3f}")
    assert _verify_derived(row, IDX, [row, *members()], IDX) is None


def test_a_member_dropped_from_the_sum_fails():
    """A member shown on the row but missing from the total."""
    row = combined_row([FID_A, FID_B], f"{RAYTHEON:.3f}")
    reason = _verify_derived(row, IDX, [row, *members()], IDX)
    assert reason is not None and "recompute mismatch" in reason


def test_a_member_counted_twice_fails():
    row = combined_row([FID_A, FID_A], f"{RAYTHEON * 2:.3f}")
    reason = _verify_derived(row, IDX, [row, *members()], IDX)
    assert reason is not None and "counted twice" in reason


def test_a_single_member_combined_fact_fails():
    """Nothing was combined — the fact should not have been minted."""
    row = combined_row([FID_A], f"{RAYTHEON:.3f}")
    reason = _verify_derived(row, IDX, [row, *members()], IDX)
    assert reason is not None and "fewer than 2" in reason


def test_a_member_with_no_recorded_value_fails():
    """The member fact exists but carries no value — the combined figure
    cannot be checked, so it is not accepted."""
    row = combined_row([FID_A, FID_B], f"{RAYTHEON + RTX:.3f}")
    valueless = (FID_B, "sum(fct_award_transactions.obligation)", "[]", None)
    reason = _verify_derived(row, IDX, [row, members()[0], valueless], IDX)
    assert reason is not None and "unresolvable" in reason


def test_a_missing_member_fact_fails_rule_4a():
    row = combined_row([FID_A, FID_B], f"{RAYTHEON + RTX:.3f}")
    reason = _verify_derived(row, IDX, [row], IDX)
    assert reason is not None and "not found in citations" in reason
