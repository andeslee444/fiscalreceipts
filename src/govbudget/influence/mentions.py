"""Deterministic program-mention extractor for LDA lobbying activity descriptions.

Strategy (LLM-free, citation-ready):
  For each program in dim_programs, generate candidate match terms, each
  tagged with a KIND:
    - "pe_code"     — the pe_bli code itself (exact, case-insensitive).
    - "alias"       — a curated alias from dbt/seeds/program_aliases.csv
                       (only for pe_blis present in the supplied programs set).
    - "title_token" — a title word ≥5 chars that is non-generic (see
                       GENERIC_WORDS) and is NOT already a curated alias for
                       this program (an alias-worthy word is tagged "alias"
                       even where it also happens to be a title token — the
                       curation is the stronger signal).

  Each term is matched against activity description text using a
  word-boundary regex (case-insensitive).

Evidence rule (#52 fix — see docs/superpowers/ROADMAP.md item 52):
  A single common title word appearing in a filing's activity description is
  NOT evidence that the filing names the program. Four independent reviewers
  found the previous one-token threshold producing rows like "Ground Based
  Midcourse (MD08) matched: Based" and "CYBERCOM Activities matched:
  Activities" (the latter via an unrelated company, BP AMERICA). No stoplist
  closes this — the fix is an evidence-tier threshold, not a bigger blocklist
  (GENERIC_WORDS is retained as a precision aid, not the sole defence).

  For a given (filing_uuid, pe_bli) pair, ALL matching terms are collected
  across every LDA activity row belonging to that filing (lda_activities is
  grained on (filing_uuid, issue_code); the mention row is grained on the
  filing, not one activity line) before a decision is made. A row is emitted
  ONLY when one of the following holds, in this priority order:
    1. evidence_kind="pe_literal"   — the exact pe_bli code appears.
    2. evidence_kind="alias"        — a curated, human-verified alias appears
                                       (single-word aliases are trusted alone
                                       because a person confirmed the mapping,
                                       unlike an arbitrary title word).
    3. evidence_kind="multi_token"  — >=2 DISTINCT non-generic title tokens
                                       appear. matched_term is those tokens
                                       joined by "|" in title order (e.g.
                                       "Ground|Midcourse") — this is the
                                       legible, auditable record of exactly
                                       which words co-occurred; a reader does
                                       not have to guess what "evidence" means.
  A single distinctive title token (e.g. "Midcourse" alone) still does NOT
  qualify — the rule is evidence, not rarity (see
  tests/influence/test_mentions_evidence.py::
  test_one_distinctive_token_still_does_not_qualify).

  Priority order (pe_literal > alias > multi_token) is this implementation's
  choice where more than one tier qualifies simultaneously; the task spec
  left it unordered. pe_literal is an exact code match (least ambiguous);
  alias is human-curated; multi_token is the weakest of the three qualifying
  tiers, so it only wins when nothing stronger is present.

  Every match row carries: filing_uuid, pe_bli, matched_term, evidence_kind,
  description_snippet.

Honesty conventions:
  - Column names contain no causal language ('caused', 'because', 'won_due').
  - Presence of a mention indicates a statutory disclosure; no inference
    of causation or influence is made here or in the SQL marts.
  - The claim rendered on the site is "keyword co-occurrence", never
    "named" — a single common word is not a naming (see #52).
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path
from typing import Sequence

# Words too generic to be meaningful single-token program identifiers.
# ACQUISITION, ACTIVITIES, BASED, CHEMICAL, EQUIPMENT, SERVICES, ARMED,
# STRIKE, FOREIGN added 2026-08 (#52) — the review found each of these
# slipping through the original 60-word list and producing a false-naming
# row (e.g. "Based" from "Ground Based Midcourse", "Services" from "Federal
# Investigative Services IT" — the list had only the singular SERVICE).
GENERIC_WORDS = {
    "ACQUISITION", "ACTIVITIES", "ADVANCED", "ANALYSIS", "ARMED", "BASED",
    "BASIC", "CAPABILITIES", "CENTER", "CHEMICAL", "COMMAND", "COMMON",
    "CONTROL", "CYBER", "DEFENSE", "DEPARTMENT", "DEVELOPMENT", "DOMAIN",
    "ENTERPRISE", "EQUIPMENT", "EVALUATION", "FEDERAL", "FOREIGN", "FUTURE",
    "GLOBAL", "HIGH", "INFORMATION", "INNOVATION", "INTEGRATION",
    "EDUCATION", "INTELLIGENCE", "INTERNATIONAL", "JOINT", "LONG",
    "MANAGEMENT", "MISSION", "NATIONAL", "NETWORK", "NUCLEAR", "OFFICE",
    "OPERATIONAL", "OPERATIONS", "OTHER", "POLICY", "PRODUCTION", "PROGRAM",
    "PROGRAMS", "RAPID", "RANGE", "RESEARCH", "SCIENCE", "SECURITY",
    "SERVICE", "SERVICES", "SHORT", "SMALL", "SPACE", "SPECIAL", "STRATEGIC",
    "STRIKE", "SUPPORT", "SYSTEM", "SYSTEMS", "TACTICAL", "TECHNICAL",
    "TECHNOLOGY", "TESTING", "TRAINING", "TRANSITION", "UNITED",
    "WARFIGHTING",
}
# EDUCATION and TRAINING were added past the task's prescribed list, found
# during this fix's own verification (#52 self-review, not the original
# review): PE 8101 "Training and Education Equipment" kept matching
# ALABAMA AEROSPACE AND AVIATION HIGH SCHOOL's filings via the boilerplate
# phrase "training, education and workforce" — two common English words
# co-occurring in unrelated aviation-workforce boilerplate, satisfying the
# letter of the multi_token rule while failing its purpose exactly the way
# the original single-token bug did. Same defect class, caught by testing
# the review's own named smell-test case rather than trusting the drop
# number alone. Disclosed per this sprint's substitution convention (see
# commit message and docs/superpowers/reviews/5c-gates-pre-failure.txt).

# parents[3] is the GovBudget project root (this file is at
# GovBudget/src/govbudget/influence/mentions.py). It was parents[4] until
# 2026-08-08, which resolved one level too high — outside the project — so
# _load_aliases hit its exists() guard and returned {} on every call, and the
# curated alias tier matched ZERO rows corpus-wide. Harmless while `alias` was
# only one of several signals; load-bearing once #52 made it a tier that
# qualifies a mention on its own.
_SEED_PATH = (
    Path(__file__).resolve().parents[3] / "dbt" / "seeds" / "program_aliases.csv"
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


def _candidate_terms_typed(
    title: str,
    pe_bli: str,
    aliases: list[str],
) -> list[tuple[str, str]]:
    """Generate (term, kind) candidate match terms for a single program.

    kind is one of "title_token", "pe_code", "alias". A title token whose
    uppercase form matches a curated alias is tagged "alias" (the curation is
    the stronger, human-verified signal, and a program's own name can
    legitimately be its own alias — e.g. JADC2 is both a title word and a
    seeded alias for 0604122D8Z).

    Returned list may be empty if no usable tokens found.
    """
    entries: list[tuple[str, str]] = []
    alias_upper = {a.upper() for a in aliases}
    # Title tokens
    tokens = re.split(r"[^A-Za-z0-9]+", title)
    for tok in tokens:
        up = tok.upper()
        if len(up) >= 5 and up not in GENERIC_WORDS:
            kind = "alias" if up in alias_upper else "title_token"
            entries.append((tok, kind))
    # PE/BLI code
    if pe_bli:
        entries.append((pe_bli, "pe_code"))
    # Aliases (multi-word phrases allowed)
    for alias in aliases:
        entries.append((alias, "alias"))
    return entries


def _candidate_terms(
    title: str,
    pe_bli: str,
    aliases: list[str],
) -> list[str]:
    """Flat term list (back-compat wrapper around _candidate_terms_typed).

    Terms: non-generic title tokens >=5 chars + pe_bli + aliases.
    """
    return [term for term, _kind in _candidate_terms_typed(title, pe_bli, aliases)]


def _build_word_boundary_re(term: str) -> re.Pattern:
    """Build a case-insensitive word-boundary regex for term."""
    escaped = re.escape(term)
    return re.compile(r"(?<![A-Za-z0-9])" + escaped + r"(?![A-Za-z0-9])", re.IGNORECASE)


def build_program_terms(
    programs: Sequence[tuple[str, str]],
    *,
    seed_path: Path | None = None,
) -> dict[str, list[tuple[str, re.Pattern, str]]]:
    """Build {pe_bli: [(term, compiled_regex, kind), ...]} for all programs.

    kind is one of "title_token", "pe_code", "alias" — see
    _candidate_terms_typed. Consumed by find_mentions() to apply the
    evidence-tier rule (#52): a lone "title_token" match is not sufficient
    evidence on its own; "pe_code" and "alias" are.

    programs: sequence of (pe_bli, title) tuples.
    seed_path: path to program_aliases.csv (defaults to dbt/seeds/program_aliases.csv).
    """
    if seed_path is None:
        seed_path = _SEED_PATH
    valid_pe_blis = {pe for pe, _ in programs}
    alias_map = _load_aliases(seed_path, valid_pe_blis)

    result: dict[str, list[tuple[str, re.Pattern, str]]] = {}
    for pe_bli, title in programs:
        aliases = alias_map.get(pe_bli, [])
        entries = _candidate_terms_typed(title, pe_bli, aliases)
        if not entries:
            continue
        # Deduplicate terms while preserving order. First occurrence wins —
        # title tokens are generated before the aliases list is appended, and
        # a title token that also matches a curated alias is already tagged
        # "alias" (see _candidate_terms_typed), so the first occurrence is
        # always the correctly-classified one.
        seen: set[str] = set()
        compiled: list[tuple[str, re.Pattern, str]] = []
        for term, kind in entries:
            tu = term.upper()
            if tu not in seen:
                seen.add(tu)
                compiled.append((term, _build_word_boundary_re(term), kind))
        if compiled:
            result[pe_bli] = compiled
    return result


def find_mentions(
    activities: Sequence[dict],
    program_terms: dict[str, list[tuple[str, re.Pattern, str]]],
) -> list[dict]:
    """Find program mentions in a list of activity dicts.

    activities: list of dicts with 'filing_uuid' and 'description'. A filing
      may contribute more than one activity dict (lda_activities is grained
      on (filing_uuid, issue_code)) — all of a filing's descriptions are
      pooled before the evidence rule is applied, because the mention row is
      about the FILING, not a single activity line.
    program_terms: output of build_program_terms().

    Evidence rule (#52 — see module docstring): a row is emitted for a given
    (filing_uuid, pe_bli) pair only when the pooled descriptions carry the
    exact pe_bli code ("pe_literal"), a curated alias ("alias"), or >=2
    distinct non-generic title tokens ("multi_token"). A single title token
    is never sufficient on its own.

    Returns list of match dicts:
      {filing_uuid, pe_bli, matched_term, evidence_kind, description_snippet}
    At most one row per (filing_uuid, pe_bli) — the grain the mart declares.
    """
    descs_by_uuid: dict[str, list[str]] = defaultdict(list)
    for act in activities:
        uuid = act.get("filing_uuid") or ""
        desc = act.get("description") or ""
        if not uuid or not desc:
            continue
        descs_by_uuid[uuid].append(desc)

    results: list[dict] = []
    for uuid, descs in descs_by_uuid.items():
        for pe_bli, terms in program_terms.items():
            pe_code_match: str | None = None
            alias_match: str | None = None
            title_token_matches: list[str] = []
            snippet_source: str | None = None

            for term, pattern, kind in terms:
                hit_desc = next((d for d in descs if pattern.search(d)), None)
                if hit_desc is None:
                    continue
                if snippet_source is None:
                    snippet_source = hit_desc
                if kind == "pe_code":
                    pe_code_match = term
                elif kind == "alias":
                    if alias_match is None:
                        alias_match = term
                else:  # title_token
                    title_token_matches.append(term)

            # Priority: pe_literal > alias > multi_token (see module
            # docstring — this implementation's choice when more than one
            # tier qualifies at once).
            if pe_code_match is not None:
                matched_term, evidence_kind = pe_code_match, "pe_literal"
            elif alias_match is not None:
                matched_term, evidence_kind = alias_match, "alias"
            elif len(title_token_matches) >= 2:
                matched_term = "|".join(title_token_matches)
                evidence_kind = "multi_token"
            else:
                continue  # no qualifying evidence — a lone common word is not a naming

            snippet = (snippet_source or "")[:120].replace("\n", " ").strip()
            results.append({
                "filing_uuid": uuid,
                "pe_bli": pe_bli,
                "matched_term": matched_term,
                "evidence_kind": evidence_kind,
                "description_snippet": snippet,
            })
    return results
