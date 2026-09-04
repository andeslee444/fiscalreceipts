"""Unit tests for the announcement-link money-color guard.

2026-09-04 controller ruling: a held-out precision study measured
'announcement+lexicon' at 54/60 = 90.0%; 3 of 6 refutations were O&M-only
awards attached to RDT&E/procurement lines. Announcement links now
additionally require the award's funding accounts to intersect the target
line's appropriation accounts ("money color"); a mismatch is skipped rather
than published.
"""
from load_announcement_links import money_color_ok  # scripts/ is on sys.path via conftest


def test_shared_account_matches():
    assert money_color_ok({"097-1319", "097-2040"}, {"097-1319"}) is True


def test_disjoint_accounts_do_not_match():
    # O&M-only award (e.g. '097-3400') funding an RDT&E line ('097-1319').
    assert money_color_ok({"097-3400"}, {"097-1319"}) is False


def test_empty_award_accounts_do_not_match():
    assert money_color_ok(set(), {"097-1319"}) is False


def test_empty_line_accounts_do_not_match():
    assert money_color_ok({"097-1319"}, set()) is False


def test_both_empty_do_not_match():
    assert money_color_ok(set(), set()) is False
