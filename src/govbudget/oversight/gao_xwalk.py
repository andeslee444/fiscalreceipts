"""GAO program work -> budget-line crosswalk, and its precision measurement.

Why this is a seed file and not an algorithm
--------------------------------------------
Attributing a GAO finding to the wrong weapons program is a defamation-shaped
error, not a formatting one.  So the exporter does **no matching at all**: it
reads ``data-seeds/gao_program_xwalk.csv``, where every row carries a human
verdict.  Nothing reaches a program page that a person did not ratify.

What the matcher here is for
----------------------------
1. It generates the CANDIDATES a person adjudicates — so the ratified set is
   reproducible and auditable rather than a list somebody typed.
2. It re-runs when a new GAO edition lands and reports candidates that carry
   no verdict yet, so new work surfaces instead of silently not appearing.
3. Its precision against the ratified verdicts is the measured number the
   ROADMAP asks for: ``verdict=y / (y + n)`` over every adjudicated candidate.

Matching rules, deliberately strict
-----------------------------------
Recall is cheap to add later and expensive to be wrong about, and the owner's
standing decision is to publish the smaller true number.  So:

* **Rule A (forward containment).**  The GAO name's tokens appear as a
  CONTIGUOUS run inside the budget line's title.  Tokens are runs of letters
  or runs of digits, so "F-15EX" is ``f|15|ex`` and never matches "F-15E".
* **Rule B (reverse containment).**  The budget line's whole title (≥ 3
  tokens) appears as a contiguous run inside the GAO name — this is how
  "LONG-RANGE HYPERSONIC WEAPON" reaches "Long Range Hypersonic Weapon
  System".
* **Service agreement.**  A GAO assessment names its service; a candidate in
  another service's book is not generated.  This is the rule that stops
  GAO's Air Force *LGM-35A Sentinel* assessment from landing on the Army's
  *Sentinel Mods* procurement line — the exact defect ROADMAP #55 had to fix
  in the lobbying alias table.
* Related products carry no service field, so they get Rule A on a
  model-designator only (a token that mixes letters and digits: F-35, F-22,
  KC-46) and are adjudicated one by one.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

_TOKEN_RE = re.compile(r"[a-z]+|[0-9]+")
_TRAILING_PAREN_RE = re.compile(r"\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$")
# A model designator mixes letters and digits: F-35, KC-46, MQ-25, CH-47F.
_DESIGNATOR_RE = re.compile(r"\b[A-Za-z]{1,4}[-/]?\d{1,3}[A-Za-z]?\b")

# GAO service -> org codes in the budget corpus.  Space Force program
# elements are carried in the Air Force book (org "F", PE suffix "SF"), which
# is why both services map to the same code.
SERVICE_ORGS: dict[str, tuple[str, ...]] = {
    "Air Force": ("F",),
    "Space Force": ("F",),
    "Army": ("A",),
    "Navy": ("N",),
    "Marine Corps": ("N",),
}

_MIN_REVERSE_TOKENS = 3

VERDICTS = ("y", "n")


def tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def contiguous(haystack: list[str], needle: list[str]) -> bool:
    if not needle or len(needle) > len(haystack):
        return False
    return any(
        haystack[i:i + len(needle)] == needle
        for i in range(len(haystack) - len(needle) + 1)
    )


@dataclass(frozen=True)
class Candidate:
    product_number: str
    gao_program: str      # common_name for assessments, subject for products
    slug: str
    org: str
    corpus_title: str
    matched_on: str
    rule: str


def _assessment_terms(common_name: str, program_name: str) -> list[str]:
    terms = [common_name]
    full = _TRAILING_PAREN_RE.sub("", program_name).strip()
    if full and full != common_name:
        terms.append(full)
    return [t for t in terms if t]


def candidates_for_assessment(
    *, common_name: str, program_name: str, service: str, programs
) -> list[Candidate]:
    orgs = SERVICE_ORGS.get(service, ())
    out: list[Candidate] = []
    for term in _assessment_terms(common_name, program_name):
        tt = tokens(term)
        for p in programs:
            if p["org"] not in orgs:
                continue
            ht = tokens(p["title"])
            if contiguous(ht, tt):
                rule = "A"
            elif len(ht) >= _MIN_REVERSE_TOKENS and contiguous(tt, ht):
                rule = "B"
            else:
                continue
            out.append(
                Candidate(
                    product_number="",
                    gao_program=common_name,
                    slug=p["slug"],
                    org=p["org"],
                    corpus_title=p["title"],
                    matched_on=term,
                    rule=rule,
                )
            )
    return out


def candidates_for_related(*, subject: str, programs) -> list[Candidate]:
    designators = [
        d for d in _DESIGNATOR_RE.findall(subject)
        if any(c.isalpha() for c in d) and any(c.isdigit() for c in d)
    ]
    out: list[Candidate] = []
    for d in designators:
        dt = tokens(d)
        for p in programs:
            if contiguous(tokens(p["title"]), dt):
                out.append(
                    Candidate(
                        product_number="",
                        gao_program=subject,
                        slug=p["slug"],
                        org=p["org"],
                        corpus_title=p["title"],
                        matched_on=d,
                        rule="A",
                    )
                )
    return out


def generate_candidates(rows, programs) -> list[Candidate]:
    """All candidates for a set of ingested GAO rows.

    ``rows`` are dicts with the parquet's columns; ``programs`` are dicts with
    ``slug``, ``org``, ``title``.

    The key is ``slug``, not ``pe_bli``: 23 budget lines share a ``pe_bli``
    with an unrelated program in another appropriation account, and ``slug``
    is what identifies a page.  Keying on ``pe_bli`` would put GAO's *Medium
    Landing Ship* assessment on *Ship Communications Automation* as well —
    both are Navy line 3050.
    """
    seen: set[tuple[str, str, str]] = set()
    out: list[Candidate] = []
    for r in rows:
        if r["kind"] == "assessment":
            found = candidates_for_assessment(
                common_name=r["common_name"],
                program_name=r["program_name"],
                service=r["service"],
                programs=programs,
            )
        else:
            found = candidates_for_related(
                subject=r["program_name"], programs=programs
            )
        for c in found:
            c = Candidate(
                product_number=r["product_number"],
                gao_program=c.gao_program,
                slug=c.slug,
                org=c.org,
                corpus_title=c.corpus_title,
                matched_on=c.matched_on,
                rule=c.rule,
            )
            key = (c.product_number, c.gao_program, c.slug)
            if key in seen:
                continue
            seen.add(key)
            out.append(c)
    return out


# ── The ratified seed ───────────────────────────────────────────────────────

SEED_FIELDS = (
    "product_number",
    "gao_program",
    "slug",
    "verdict",
    "org",
    "corpus_title",
    "matched_on",
    "curator_notes",
)


def load_ratified(seed_path: Path) -> dict[tuple[str, str, str], dict]:
    """Read the seed, keyed by (product_number, gao_program, slug)."""
    out: dict[tuple[str, str, str], dict] = {}
    with open(seed_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            verdict = (row.get("verdict") or "").strip()
            if verdict not in VERDICTS:
                raise ValueError(
                    f"gao_program_xwalk.csv: verdict {verdict!r} for "
                    f"{row.get('gao_program')} -> {row.get('slug')} is not "
                    f"one of {VERDICTS}; an unadjudicated row must not exist"
                )
            key = (
                (row["product_number"] or "").strip(),
                (row["gao_program"] or "").strip(),
                (row["slug"] or "").strip(),
            )
            out[key] = {**row, "verdict": verdict}
    return out


@dataclass
class PrecisionReport:
    adjudicated: int
    accepted: int
    rejected: int
    unadjudicated: list[Candidate]
    stale: list[tuple[str, str, str]]

    @property
    def precision(self) -> float:
        return self.accepted / self.adjudicated if self.adjudicated else 0.0


def measure(candidates: list[Candidate], ratified: dict) -> PrecisionReport:
    """Matcher precision against the human verdicts, plus the two drifts.

    ``unadjudicated`` — a candidate with no verdict.  New GAO work, or a
    matcher change; either way a person owes it a decision and nothing about
    it ships meanwhile.
    ``stale`` — a ratified row the matcher no longer proposes.  Its evidence
    has moved; the row must be re-examined, not trusted on inertia.
    """
    keys = {(c.product_number, c.gao_program, c.slug) for c in candidates}
    accepted = sum(
        1 for k, r in ratified.items()
        if k in keys and r["verdict"] == "y"
    )
    rejected = sum(
        1 for k, r in ratified.items()
        if k in keys and r["verdict"] == "n"
    )
    return PrecisionReport(
        adjudicated=accepted + rejected,
        accepted=accepted,
        rejected=rejected,
        unadjudicated=[
            c for c in candidates
            if (c.product_number, c.gao_program, c.slug) not in ratified
        ],
        stale=[k for k in ratified if k not in keys],
    )
