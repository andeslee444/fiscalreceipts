"""Unit tests for the FPDS account-narrowing tier decision.

2026-09-04 controller ruling: the earlier "unique matched line" high tier
(fpds-ap+account) measured 34/60 = 56.7% in a held-out precision study — 17
of 26 refutations were sibling-line ambiguity (a program's mods line and its
production line often share one appropriation account, so "unique among
mapped lines" was never "unique among the program's lines"). The high tier
is withdrawn: any award with >=1 account-matched line now publishes at
medium under method 'fpds-ap'.
"""
from derive_ap_links import tier_for  # scripts/ is on sys.path via conftest


def test_zero_matches_is_low():
    assert tier_for(0) == ("low", "fpds-ap")


def test_one_match_is_medium_not_high():
    # This used to be the "high" / 'fpds-ap+account' tier — withdrawn.
    assert tier_for(1) == ("medium", "fpds-ap")


def test_multiple_matches_is_medium():
    assert tier_for(2) == ("medium", "fpds-ap")
    assert tier_for(7) == ("medium", "fpds-ap")


def test_no_matched_count_ever_yields_fpds_ap_plus_account_method():
    # The withdrawn method string must never come out of tier_for again.
    for n in range(0, 10):
        _, method = tier_for(n)
        assert method != "fpds-ap+account"
