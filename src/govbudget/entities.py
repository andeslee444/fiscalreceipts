"""Deterministic entity-name normalization for the beneficiary graph (v1).

Canonical family = parent UEI when present; otherwise normalized name.
The dbt layer additionally merges parent UEIs whose names normalize
identically (Boeing's 'THE BOEING COMPANY' vs 'BOEING COMPANY, THE (INC)').
Probabilistic matching (Splink) is deliberately deferred until a gate fails.

Boeing subsidiary fix (loop iteration 1): Self-parented Boeing subsidiaries
(BOEING NORTH AMERICAN, INC; BOEING CAPITAL CORPORATION; BOEING REALTY CORP;
BOEING AEROSPACE OPERATIONS, I) were splitting from the main BOEING family.
Added DIVISION_SUFFIX_SEQS — ordered multi-token sequences stripped after
legal suffixes — so these all normalize to "BOEING". Regression tests in
test_entities.py confirm the goldens.
"""
import re

LEGAL_SUFFIXES = {
    "INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "LIMITED", "CORP",
    "CORPORATION", "CO", "COMPANY", "PLC", "GMBH", "SA", "AG", "PTY",
    "JV", "TRUST", "FOUNDATION", "REALTY",
}

# Multi-token trailing sequences stripped after legal suffixes, longest first.
# Only stripped when tokens remain after removal (never reduce to empty).
DIVISION_SUFFIX_SEQS: list[tuple[str, ...]] = [
    ("AEROSPACE", "OPERATIONS", "I"),
    ("AEROSPACE", "OPERATIONS"),
    ("NORTH", "AMERICAN"),
    ("CAPITAL",),
    ("SYSTEMS", "CORPORATION"),
    ("SYSTEMS", "CORP"),
    ("DEFENSE", "SYSTEMS"),
    ("GOVERNMENT", "SYSTEMS"),
    ("INFORMATION", "TECHNOLOGY"),
    ("INFORMATION", "SYSTEMS"),
    ("MISSION", "SYSTEMS"),
    ("GLOBAL",),
    ("TACTICAL", "SYSTEMS"),
]

_ABBREV = re.compile(r"(?<=[A-Z])\.(?=[A-Z])")  # dots inside abbreviations: L.L.C. → LLC
_PUNCT = re.compile(r"[^A-Z0-9 ]+")
_SPACES = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    up = (name or "").upper()
    up = _ABBREV.sub("", up)          # collapse L.L.C. → LLC before punct removal
    up = _PUNCT.sub(" ", up)
    tokens = [t for t in _SPACES.split(up) if t]
    # Strip leading THE
    if tokens and tokens[0] == "THE":
        tokens.pop(0)
    # Iteratively strip trailing legal suffixes and trailing/leading THE
    # until stable (handles "COMPANY, THE (INC)" → INC→THE→COMPANY all gone)
    changed = True
    while changed and tokens:
        changed = False
        while tokens and tokens[-1] in LEGAL_SUFFIXES:
            tokens.pop()
            changed = True
        while tokens and tokens[-1] == "THE":
            tokens.pop()
            changed = True
        while tokens and tokens[0] == "THE":
            tokens.pop(0)
            changed = True
    # Strip known division-suffix sequences (only when tokens would remain)
    for seq in DIVISION_SUFFIX_SEQS:
        n = len(seq)
        if len(tokens) > n and tuple(tokens[-n:]) == seq:
            tokens = tokens[:-n]
            break
    return " ".join(tokens)


def family_key(
    *, parent_uei: str | None, parent_name: str | None,
    recipient_uei: str | None, recipient_name: str | None,
) -> tuple[str, str]:
    """(method, key): parent UEI when present; else normalized parent name;
    else normalized recipient name; else the recipient UEI itself."""
    if parent_uei:
        return ("uei", parent_uei)
    if parent_name and normalize_name(parent_name):
        return ("name", normalize_name(parent_name))
    if recipient_name and normalize_name(recipient_name):
        return ("name", normalize_name(recipient_name))
    return ("uei", recipient_uei or "UNKNOWN")
