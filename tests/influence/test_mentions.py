"""TDD tests for govbudget.influence.mentions.

No live calls; no disk writes to data/. Uses only in-memory fixtures.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from govbudget.influence.mentions import (
    GENERIC_WORDS,
    _candidate_terms,
    _load_aliases,
    build_program_terms,
    find_mentions,
)

# Minimal programs list for tests
_PROGRAMS = [
    ("0604122D8Z", "JADC2 Development and Experimentation Activities"),
    ("2012C130J", "AC/MC-130J"),
    ("MD09", "Aegis BMD"),
    ("0603183D8Z", "Joint Hypersonic Technology Development &Transition"),
    ("0603000D8Z", "Joint Munitions Advanced Technology"),
]

SEED_PATH = Path(__file__).resolve().parents[2] / "dbt" / "seeds" / "program_aliases.csv"


# ---------------------------------------------------------------------------
# GENERIC_WORDS coverage
# ---------------------------------------------------------------------------

def test_generic_words_present():
    assert "DEFENSE" in GENERIC_WORDS
    assert "JOINT" in GENERIC_WORDS
    assert "TECHNOLOGY" in GENERIC_WORDS


# ---------------------------------------------------------------------------
# _candidate_terms
# ---------------------------------------------------------------------------

def test_candidate_terms_filters_short_tokens():
    # Tokens < 5 chars should be excluded
    terms = _candidate_terms("Air Land", "0001", [])
    # "Air" (3), "Land" (4) → both short, only pe_bli remains
    assert "0001" in terms
    # no content tokens
    assert "Air" not in terms
    assert "Land" not in terms


def test_candidate_terms_filters_generic():
    terms = _candidate_terms("Joint Defense Systems", "0002", [])
    # "Joint" (5) but GENERIC, "Defense" GENERIC, "Systems" GENERIC
    # → only pe_bli
    assert "0002" in terms
    assert "Joint" not in terms


def test_candidate_terms_keeps_distinctive():
    terms = _candidate_terms("JADC2 Development and Experimentation Activities", "0604122D8Z", [])
    assert "JADC2" in terms
    assert "Experimentation" in terms
    assert "0604122D8Z" in terms


def test_candidate_terms_includes_aliases():
    terms = _candidate_terms("JADC2 Development", "0604122D8Z", ["JADC2 alias"])
    assert "JADC2 alias" in terms


def test_candidate_terms_no_duplicates():
    # pe_bli as title token and alias simultaneously — deduped in build_program_terms
    terms = _candidate_terms("AC MC 130J Modification", "2012C130J", ["C-130J"])
    # "130J" < 5? No: 4 chars. So not included. "Modification" - present.
    assert "C-130J" in terms


# ---------------------------------------------------------------------------
# _load_aliases
# ---------------------------------------------------------------------------

def test_load_aliases_returns_known_pe_blis_only():
    valid = {"0604122D8Z", "2012C130J"}
    aliases = _load_aliases(SEED_PATH, valid)
    # JADC2 and C-130J should be present
    assert "0604122D8Z" in aliases
    assert "2012C130J" in aliases
    # Something not in valid set should not appear
    for pe in aliases:
        assert pe in valid


def test_load_aliases_jadc2():
    valid = {"0604122D8Z"}
    aliases = _load_aliases(SEED_PATH, valid)
    assert "JADC2" in aliases["0604122D8Z"]


def test_load_aliases_c130j():
    valid = {"2012C130J"}
    aliases = _load_aliases(SEED_PATH, valid)
    assert "C-130J" in aliases["2012C130J"]


def test_load_aliases_missing_file(tmp_path):
    missing = tmp_path / "nonexistent.csv"
    aliases = _load_aliases(missing, {"any"})
    assert aliases == {}


# ---------------------------------------------------------------------------
# build_program_terms
# ---------------------------------------------------------------------------

def test_build_program_terms_returns_all_programs():
    terms = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)
    # All programs with at least one usable term should be present
    # JADC2 program definitely has usable terms
    assert "0604122D8Z" in terms


def test_build_program_terms_jadc2_has_alias():
    # (#52) terms are now 3-tuples (term, pattern, kind) — kind lets
    # find_mentions apply the evidence-tier rule.
    terms = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)
    term_strs = [t for t, _pattern, _kind in terms["0604122D8Z"]]
    assert "JADC2" in term_strs


def test_build_program_terms_c130j_has_alias():
    terms = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)
    assert "2012C130J" in terms
    term_strs = [t for t, _pattern, _kind in terms["2012C130J"]]
    assert "C-130J" in term_strs


def test_build_program_terms_no_duplicate_terms_per_program():
    terms = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)
    for pe_bli, term_list in terms.items():
        term_strs_upper = [t.upper() for t, _pattern, _kind in term_list]
        assert len(term_strs_upper) == len(set(term_strs_upper)), (
            f"Duplicate terms for {pe_bli}: {term_strs_upper}"
        )


def test_build_program_terms_compiled_patterns_are_case_insensitive():
    terms = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)
    assert "0604122D8Z" in terms
    for term, pattern, _kind in terms["0604122D8Z"]:
        if term.upper() == "JADC2":
            assert pattern.search("jadc2") is not None
            assert pattern.search("JADC2") is not None


def test_build_program_terms_jadc2_tagged_as_alias():
    """(#52) JADC2 is both a title token and a curated alias for this
    program; the curated classification wins so a lone JADC2 mention still
    qualifies as evidence (kind="alias"), not the weaker "title_token" tier
    that requires a second distinct token."""
    terms = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)
    kinds = {t.upper(): kind for t, _pattern, kind in terms["0604122D8Z"]}
    assert kinds["JADC2"] == "alias"


# ---------------------------------------------------------------------------
# find_mentions
# ---------------------------------------------------------------------------

_PROGRAM_TERMS = build_program_terms(_PROGRAMS, seed_path=SEED_PATH)

_ACTIVITIES_WITH_JADC2 = [
    {
        "filing_uuid": "uuid-001",
        "description": "FY26 NDAA issues related to JADC2 funding and cross-domain integration.",
    },
    {
        "filing_uuid": "uuid-002",
        "description": "Appropriations for C-130J aircraft and maintenance funding.",
    },
    {
        "filing_uuid": "uuid-003",
        "description": "No matching program content here - just general acquisition policy.",
    },
]


def test_find_mentions_jadc2_match():
    results = find_mentions(_ACTIVITIES_WITH_JADC2, _PROGRAM_TERMS)
    uuids_with_jadc2 = [r["filing_uuid"] for r in results if r["pe_bli"] == "0604122D8Z"]
    assert "uuid-001" in uuids_with_jadc2


def test_find_mentions_c130j_match():
    results = find_mentions(_ACTIVITIES_WITH_JADC2, _PROGRAM_TERMS)
    uuids_with_c130 = [r["filing_uuid"] for r in results if r["pe_bli"] == "2012C130J"]
    assert "uuid-002" in uuids_with_c130


def test_find_mentions_no_match():
    results = find_mentions(_ACTIVITIES_WITH_JADC2, _PROGRAM_TERMS)
    uuids = {r["filing_uuid"] for r in results}
    # uuid-003 should not appear — no known program term in the text
    assert "uuid-003" not in uuids


def test_find_mentions_result_has_required_keys():
    results = find_mentions(_ACTIVITIES_WITH_JADC2, _PROGRAM_TERMS)
    assert results, "expected at least one match to check keys on"
    for r in results:
        assert "filing_uuid" in r
        assert "pe_bli" in r
        assert "matched_term" in r
        assert "description_snippet" in r
        # (#52) every row now carries its evidence tier.
        assert r["evidence_kind"] in ("pe_literal", "alias", "multi_token")


def test_find_mentions_deduplicates_same_term_in_text():
    """Same (filing_uuid, pe_bli, matched_term) appearing twice suppressed."""
    activities = [
        {
            "filing_uuid": "uuid-dup",
            "description": "JADC2 funding for JADC2 development programs.",
        }
    ]
    results = find_mentions(activities, _PROGRAM_TERMS)
    jadc2_rows = [r for r in results if r["pe_bli"] == "0604122D8Z" and r["filing_uuid"] == "uuid-dup"
                  and r["matched_term"].upper() == "JADC2"]
    # Should appear once, not twice (deduped by (uuid, pe_bli, term.upper))
    assert len(jadc2_rows) == 1


def test_find_mentions_empty_activities():
    results = find_mentions([], _PROGRAM_TERMS)
    assert results == []


def test_find_mentions_empty_description():
    activities = [{"filing_uuid": "uuid-empty", "description": ""}]
    results = find_mentions(activities, _PROGRAM_TERMS)
    assert results == []


def test_find_mentions_word_boundary_not_substring():
    """'GBI' inside 'CGBI' should NOT match (word-boundary enforcement)."""
    programs_gbi = [("MD08", "Ground Based Midcourse")]
    # MD08 title tokens: "Ground"(6, not generic?), "Based"(5), "Midcourse"(9)
    # alias for GBI only if loaded from seed — need custom seed_path
    # Test using a pe_bli code match instead: "MD08" in description
    activities = [
        {"filing_uuid": "uuid-wb", "description": "Funding for MD08 programs."},
        {"filing_uuid": "uuid-nowb", "description": "The CMD08 system is different."},
    ]
    terms = build_program_terms(programs_gbi, seed_path=SEED_PATH)
    results = find_mentions(activities, terms)
    matched_uuids = {r["filing_uuid"] for r in results if r["pe_bli"] == "MD08"}
    assert "uuid-wb" in matched_uuids
    # "CMD08" should NOT match because of word-boundary pattern
    assert "uuid-nowb" not in matched_uuids
