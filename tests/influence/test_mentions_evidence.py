"""TDD tests for the #52 evidence-tier fix in govbudget.influence.mentions.

A single common title word appearing in an LDA filing's activity description
is not evidence that the filing names the program (see
docs/superpowers/ROADMAP.md item 52 and the mentions.py module docstring).
These tests pin the new rule: a row is emitted only for an exact pe_bli
literal, a curated alias, or >=2 distinct non-generic title tokens.
"""
from __future__ import annotations

from govbudget.influence.mentions import build_program_terms, find_mentions

PROGRAMS = [
    ("MD08", "Ground Based Midcourse Defense"),
    ("0208059JCY", "CYBERCOM Activities"),
    ("ATA000", "F-35 Joint Strike Fighter"),
]


def _terms():
    return build_program_terms(PROGRAMS)


def test_a_single_common_word_is_not_a_naming():
    acts = [{"filing_uuid": "u1", "description": "Issues related to based energy futures."}]
    assert find_mentions(acts, _terms()) == []


def test_the_pe_code_alone_is_sufficient_evidence():
    acts = [{"filing_uuid": "u2", "description": "Appropriations for PE 0208059JCY."}]
    got = find_mentions(acts, _terms())
    assert [m["pe_bli"] for m in got] == ["0208059JCY"]
    assert got[0]["evidence_kind"] == "pe_literal"


def test_two_distinctive_tokens_are_sufficient_evidence():
    acts = [{"filing_uuid": "u3",
             "description": "Funding for Ground Based Midcourse interceptors."}]
    got = find_mentions(acts, _terms())
    assert [m["pe_bli"] for m in got] == ["MD08"]
    assert got[0]["evidence_kind"] == "multi_token"
    # matched_term SHAPE (implementer's choice — the task left this open):
    # the distinct tokens joined by "|", in title order. "Based" is excluded
    # by GENERIC_WORDS (added by this fix), so the two qualifying tokens are
    # "Ground" and "Midcourse". This is legible on the rendered page: a
    # reader sees exactly which words co-occurred, not an opaque flag.
    assert got[0]["matched_term"] == "Ground|Midcourse"


def test_one_distinctive_token_still_does_not_qualify():
    """'Midcourse' is distinctive but alone — the rule is evidence, not rarity."""
    acts = [{"filing_uuid": "u4", "description": "Midcourse policy discussion."}]
    assert find_mentions(acts, _terms()) == []
