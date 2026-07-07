"""Stated-edge extraction: verb + adjacent `PE ####` token in R-2/P-40 narratives.

Precision over recall by design (spec §4): a wrong lineage is worse than none, so we
only mint an edge when a transfer verb sits next to an explicit PE token. The ~1,950
prose transfers without an adjacent PE code are left for the Inferred tier / Phase-2 LLM.
"""
from __future__ import annotations
import re
from govbudget.lineage.model import LineageEdge

# A PE token: 7 digits + an optional agency/service suffix that always starts with
# a LETTER and may then contain alphanumerics (e.g. 0604294D8Z, 1203154SF, 0603826D).
# Anchoring the suffix on a letter is what keeps a following digit attached (D8Z)
# instead of truncating the token at the first digit of the suffix.
_PE = r"(\d{7}(?:[A-Z][A-Z0-9]{0,3})?)"
# Clause splitter: DoD narratives are period-delimited and also use colon-led
# labels ("Program Change Summary: ..."), so we split on both `.` and `:` to get
# the searchable transfer clause on its own. Exception: a period between two
# digits is a decimal ($62.4M), not a boundary — don't split there, or the
# verbatim evidence_sentence would be truncated mid-number. A clause is a
# non-empty run of (non-delimiter chars | inter-digit periods), terminated by a
# `.`/`:` OR end-of-string — the end-of-string case keeps the final clause of an
# unterminated body (PDF table cells / truncated last lines lack a trailing period).
_SENT = re.compile(r"(?:[^.:]|(?<=\d)\.(?=\d))+(?:[.:]|$)")

# (verb pattern, direction) — direction 'pred' => matched PE is the predecessor (from),
# 'succ' => matched PE is the successor (to). relation is the classifier.
_RULES = [
    (re.compile(r"transferred?\s+from\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "realigned"),
    (re.compile(r"realign\w*\s+from\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "realigned"),
    (re.compile(r"previously\s+(?:funded|budgeted)\s+(?:in|under)\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "renamed"),
    (re.compile(r"formerly\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "renamed"),
    (re.compile(r"transferred?\s+to\s+(?:PE|program element)\s+" + _PE, re.I), "succ", "realigned"),
    (re.compile(r"realign\w*\s+to\s+(?:PE|program element)\s+" + _PE, re.I), "succ", "realigned"),
]

def extract_stated_edges(narratives: list[dict]) -> list[LineageEdge]:
    """narratives: dicts with pe_bli, fiscal_year, fact_id, page, body."""
    out: list[LineageEdge] = []
    seen: set[tuple[str, str, int, str]] = set()
    for n in narratives:
        this = n["pe_bli"]
        body = n.get("body") or ""
        for sent in _SENT.findall(body):
            for rx, direction, relation in _RULES:
                for m in rx.finditer(sent):
                    other = m.group(1)
                    if not other or other == this:
                        continue
                    frm, to = (other, this) if direction == "pred" else (this, other)
                    key = (frm, to, n["fiscal_year"], relation)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(LineageEdge(
                        from_pe_bli=frm, to_pe_bli=to, fiscal_year=n["fiscal_year"],
                        relation=relation, confidence="stated",
                        evidence_fact_id=n.get("fact_id"), evidence_page=n.get("page"),
                        evidence_sentence=sent.strip(), portion_amount=None,
                        inference_basis=None))
    return out
