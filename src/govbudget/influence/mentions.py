"""Deterministic program-mention extractor for LDA lobbying activity descriptions.

Strategy (LLM-free, citation-ready):
  For each program in dim_programs, generate candidate match terms:
    1. Title tokens ≥5 chars that are non-generic (see GENERIC_WORDS).
    2. The pe_bli code itself (exact, case-insensitive).
    3. Curated aliases from dbt/seeds/program_aliases.csv where the pe_bli
       exists in the provided programs set.

  Match each term against activity description text using word-boundary
  regex (case-insensitive).  Every match row carries:
    filing_uuid, pe_bli, matched_term  (citation-ready: UUID → LDA URL).

Honesty conventions:
  - Column names contain no causal language ('caused', 'because', 'won_due').
  - Presence of a mention indicates a statutory disclosure; no inference
    of causation or influence is made here or in the SQL marts.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Sequence

# Words too generic to be meaningful single-token program identifiers.
GENERIC_WORDS = {
    "ADVANCED", "ANALYSIS", "BASIC", "CAPABILITIES", "CENTER", "COMMAND",
    "COMMON", "CONTROL", "CYBER", "DEFENSE", "DEPARTMENT", "DEVELOPMENT",
    "DOMAIN", "ENTERPRISE", "EVALUATION", "FEDERAL", "FUTURE", "GLOBAL",
    "HIGH", "INFORMATION", "INNOVATION", "INTEGRATION", "INTELLIGENCE",
    "INTERNATIONAL", "JOINT", "LONG", "MANAGEMENT", "MISSION", "NATIONAL",
    "NETWORK", "NUCLEAR", "OFFICE", "OPERATIONAL", "OPERATIONS", "OTHER",
    "POLICY", "PRODUCTION", "PROGRAM", "PROGRAMS", "RAPID", "RANGE",
    "RESEARCH", "SCIENCE", "SECURITY", "SERVICE", "SHORT", "SMALL",
    "SPACE", "SPECIAL", "STRATEGIC", "SUPPORT", "SYSTEM", "SYSTEMS",
    "TACTICAL", "TECHNICAL", "TECHNOLOGY", "TESTING", "TRANSITION",
    "UNITED", "WARFIGHTING",
}

_SEED_PATH = (
    Path(__file__).resolve().parents[4] / "dbt" / "seeds" / "program_aliases.csv"
)


def _load_aliases(
    seed_path: Path,
    valid_pe_blis: set[str],
) -> dict[str, list[str]]:
    """Load program_aliases.csv; return {pe_bli: [alias, ...]} for known pe_blis only."""
    result: dict[str, list[str]] = {}
    if not seed_path.exists():
        return result
    with seed_path.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pe_bli = (row.get("pe_bli") or "").strip()
            alias = (row.get("alias") or "").strip()
            if pe_bli and alias and pe_bli in valid_pe_blis:
                result.setdefault(pe_bli, []).append(alias)
    return result


def _candidate_terms(
    title: str,
    pe_bli: str,
    aliases: list[str],
) -> list[str]:
    """Generate candidate match terms for a single program.

    Terms: non-generic title tokens ≥5 chars + pe_bli + aliases.
    Returned list may be empty if no usable tokens found.
    """
    terms: list[str] = []
    # Title tokens
    tokens = re.split(r"[^A-Za-z0-9]+", title)
    for tok in tokens:
        up = tok.upper()
        if len(up) >= 5 and up not in GENERIC_WORDS:
            terms.append(tok)
    # PE/BLI code
    if pe_bli:
        terms.append(pe_bli)
    # Aliases (multi-word phrases allowed)
    terms.extend(aliases)
    return terms


def _build_word_boundary_re(term: str) -> re.Pattern:
    """Build a case-insensitive word-boundary regex for term."""
    escaped = re.escape(term)
    return re.compile(r"(?<![A-Za-z0-9])" + escaped + r"(?![A-Za-z0-9])", re.IGNORECASE)


def build_program_terms(
    programs: Sequence[tuple[str, str]],
    *,
    seed_path: Path | None = None,
) -> dict[str, list[tuple[str, re.Pattern]]]:
    """Build {pe_bli: [(term, compiled_regex), ...]} for all programs.

    programs: sequence of (pe_bli, title) tuples.
    seed_path: path to program_aliases.csv (defaults to dbt/seeds/program_aliases.csv).
    """
    if seed_path is None:
        seed_path = _SEED_PATH
    valid_pe_blis = {pe for pe, _ in programs}
    alias_map = _load_aliases(seed_path, valid_pe_blis)

    result: dict[str, list[tuple[str, re.Pattern]]] = {}
    for pe_bli, title in programs:
        aliases = alias_map.get(pe_bli, [])
        terms = _candidate_terms(title, pe_bli, aliases)
        if not terms:
            continue
        # Deduplicate terms while preserving order
        seen: set[str] = set()
        compiled: list[tuple[str, re.Pattern]] = []
        for t in terms:
            tu = t.upper()
            if tu not in seen:
                seen.add(tu)
                compiled.append((t, _build_word_boundary_re(t)))
        if compiled:
            result[pe_bli] = compiled
    return result


def find_mentions(
    activities: Sequence[dict],
    program_terms: dict[str, list[tuple[str, re.Pattern]]],
) -> list[dict]:
    """Find program mentions in a list of activity dicts.

    activities: list of dicts with 'filing_uuid' and 'description'.
    program_terms: output of build_program_terms().

    Returns list of match dicts:
      {filing_uuid, pe_bli, matched_term, description_snippet}
    Duplicate (filing_uuid, pe_bli, matched_term) triples are suppressed.
    """
    seen: set[tuple[str, str, str]] = set()
    results: list[dict] = []
    for act in activities:
        uuid = act.get("filing_uuid") or ""
        desc = act.get("description") or ""
        if not uuid or not desc:
            continue
        for pe_bli, terms in program_terms.items():
            for term, pattern in terms:
                if pattern.search(desc):
                    key = (uuid, pe_bli, term.upper())
                    if key not in seen:
                        seen.add(key)
                        # Snippet: first 120 chars of description for context
                        snippet = desc[:120].replace("\n", " ").strip()
                        results.append({
                            "filing_uuid": uuid,
                            "pe_bli": pe_bli,
                            "matched_term": term,
                            "description_snippet": snippet,
                        })
    return results
