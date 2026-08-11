"""Tests for backlog #49: /programs/ publishes a row counter over a
59%-complete dollar universe.

"1,741 of 1,741 programs" denominates the index by itself — true and
useless. build_programs_coverage denominates it by the FY2026 request
universe the site publishes elsewhere (fct_budget_lines, amount_type=
'fy_2026_total') and names the largest excluded lines, so a reader who
filters for a $10.9B program that lacks R-2/P-40 detail gets an
explanation instead of "No programs match the filter."
"""
from __future__ import annotations

from govbudget.export_site import build_programs_coverage


def test_coverage_reports_dollars_not_rows():
    cov = build_programs_coverage(
        index_total_millions=228_460.8,
        universe_total_millions=385_270.0,
        excluded=[("1045", "COLUMBIA Class Submarine", 10_920.5)],
    )
    assert cov["index_billions"] == 228.5
    assert cov["universe_billions"] == 385.3
    assert cov["coverage_pct"] == 59.3


def test_coverage_names_the_largest_excluded_lines():
    cov = build_programs_coverage(
        index_total_millions=100.0,
        universe_total_millions=200.0,
        excluded=[("A", "Big", 60.0), ("B", "Small", 5.0)],
    )
    assert [e["pe_bli"] for e in cov["largest_excluded"]] == ["A", "B"]
    assert cov["largest_excluded"][0]["title"] == "Big"


def test_coverage_refuses_to_claim_full_coverage_when_dollars_are_missing():
    """The counter may not read 100% while a dollar of the universe is absent."""
    cov = build_programs_coverage(
        index_total_millions=199.0, universe_total_millions=200.0, excluded=[]
    )
    assert cov["coverage_pct"] < 100.0


# ── #56 addendum: reason threading ──────────────────────────────────────────
#
# THE REGRESSION THIS GUARDS AGAINST: a pe_bli whose program key collides
# with another program (#56) is a program page in the index (one of the two
# won the re-key) while the OTHER one's money is fully absent — a different
# defect from #49's original "no R-2/P-40 detail" exclusion, and the page
# must not claim the wrong reason for it.


def test_bare_3tuple_defaults_to_no_detail_reason():
    """Backward compat: an un-migrated 3-tuple (every pre-#56 caller) still
    gets a reason field, defaulting to the only reason that existed before
    this field did."""
    cov = build_programs_coverage(
        index_total_millions=100.0,
        universe_total_millions=200.0,
        excluded=[("A", "Big", 60.0)],
    )
    assert cov["largest_excluded"][0]["reason"] == "no_detail"


def test_4tuple_carries_its_own_reason():
    cov = build_programs_coverage(
        index_total_millions=100.0,
        universe_total_millions=300.0,
        excluded=[
            ("A", "No-detail line", 60.0, "no_detail"),
            ("3010", "LPD Flight II", 140.0, "key_collision"),
        ],
    )
    by_title = {e["title"]: e["reason"] for e in cov["largest_excluded"]}
    assert by_title["No-detail line"] == "no_detail"
    assert by_title["LPD Flight II"] == "key_collision"


def test_mixed_3tuple_and_4tuple_rows_both_thread_correctly():
    """A caller migrating incrementally can mix bare 3-tuples (default
    reason) with explicit 4-tuples in the same call."""
    cov = build_programs_coverage(
        index_total_millions=100.0,
        universe_total_millions=300.0,
        excluded=[
            ("A", "Old-style row", 60.0),
            ("3010", "LPD Flight II", 140.0, "key_collision"),
        ],
    )
    by_title = {e["title"]: e["reason"] for e in cov["largest_excluded"]}
    assert by_title["Old-style row"] == "no_detail"
    assert by_title["LPD Flight II"] == "key_collision"
