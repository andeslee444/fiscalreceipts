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
