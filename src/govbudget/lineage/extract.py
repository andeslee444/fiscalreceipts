"""Stated-edge extraction: verb + adjacent `PE ####` token in R-2/P-40 narratives.

Precision over recall by design (spec §4): a wrong lineage is worse than none, so we
only mint an edge when a transfer verb sits next to an explicit PE token. The ~1,950
prose transfers without an adjacent PE code are left for the Inferred tier / Phase-2 LLM.

Both-named sentences (Defect 1, 2026-07-28): when ONE sentence names BOTH endpoints
("…PE 0207436F…, efforts were transferred to PE 0303004F…"), the sentence itself is
the strongest evidence — the edge pairs the two NAMED PEs and the narrative's own
line (`this`) is not involved at all. Rollup lines (837300/834190-style) aggregate
third-person statements about other PEs; pairing `this` with the matched PE there
fabricated a source the sentence never asserted. Only when a sentence names a single
direction (first-person R-2 narratives: "This work was transferred to PE X") does
`this` supply the unnamed endpoint, exactly as before.
"""
from __future__ import annotations
import hashlib
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

# Same character class as _SENT's clause body: any non-delimiter, or an
# inter-digit decimal point ($62.4M must not end the span mid-number).
_CLAUSE_CHAR = r"(?:[^.:]|(?<=\d)\.(?=\d))"

# (verb pattern, direction, relation) — direction 'pred' => matched PE is the
# predecessor (from), 'succ' => matched PE is the successor (to). relation is the
# classifier. ORDER MATTERS: for a PE matched by several pred rules, the FIRST
# rule's relation wins (deterministic; the specific verb rules outrank the
# subject-position catch-all at the end).
_RULES = [
    (re.compile(r"transferred?\s+from\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "realigned"),
    (re.compile(r"realign\w*\s+from\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "realigned"),
    (re.compile(r"previously\s+(?:funded|budgeted)\s+(?:in|under)\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "renamed"),
    (re.compile(r"formerly\s+(?:PE|program element)\s+" + _PE, re.I), "pred", "renamed"),
    (re.compile(r"transferred?\s+to\s+(?:PE|program element)\s+" + _PE, re.I), "succ", "realigned"),
    (re.compile(r"realign\w*\s+to\s+(?:PE|program element)\s+" + _PE, re.I), "succ", "realigned"),
    # Subject-position source (Defect 1): a third-person clause naming both
    # endpoints ("… PE 0207436F …, efforts were transferred to PE 0303004F …")
    # names its true source at the SUBJECT PE. The trailing LOOKAHEAD requires a
    # later same-clause transferred/realigned-to construction, so this rule can
    # never fire without a succ-direction match in the same sentence — it only
    # ever contributes to the both-named branch, never to a `this`-paired edge.
    # The lookbehinds keep a "to PE X"/"from PE X" OBJECT token from
    # masquerading as a subject: in a two-transfer sentence ("…transferred to
    # PE A and … transferred to PE B") the first DESTINATION must not become
    # the second transfer's source. ("into PE X" is caught by the "to " case.)
    (re.compile(
        r"(?<!to )(?<!To )(?<!TO )(?<!from )(?<!From )(?<!FROM )"
        r"(?:PE|program element)\s+" + _PE +
        r"(?=" + _CLAUSE_CHAR + r"*?(?:transferred?|realign\w*)\s+to\s+(?:PE|program element)\s+\d)",
        re.I), "pred", "realigned"),
]


def _directional_matches(sent: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """All (pe, relation) matches in one clause, split by direction.

    Returns (pred_matches, succ_matches) in _RULES order (deterministic;
    duplicates preserved so the single-direction fallback reproduces the
    historical per-rule minting exactly).
    """
    preds: list[tuple[str, str]] = []
    succs: list[tuple[str, str]] = []
    for rx, direction, relation in _RULES:
        for m in rx.finditer(sent):
            other = m.group(1)
            if not other:
                continue
            (preds if direction == "pred" else succs).append((other, relation))
    return preds, succs


def sentence_named_pairs(sent: str) -> dict[tuple[str, str], str]:
    """The (from_pe, to_pe) -> relation cross-pairs a sentence NAMES itself.

    Empty when the sentence does not name both directions (or names them only
    as self-pairs). Per-PE relation is first-rule-wins in _RULES order; a
    cross-pair's relation is the from-rule's classification, EXCEPT a
    'formerly/previously' rename from-rule defers to the to-rule's (an explicit
    directional transfer verb is a stronger classification signal than an
    identity note about a past name — documented Defect-1 choice, deterministic).

    Shared by extract_stated_edges AND verify-lineage leg (a) so the extractor
    and the gate apply ONE rule set (_RULES) — the gate's endpoint-contradiction
    check can never drift from the extractor's pairing logic.
    """
    preds, succs = _directional_matches(sent)
    from_rel: dict[str, str] = {}
    to_rel: dict[str, str] = {}
    for pe, rel in preds:
        from_rel.setdefault(pe, rel)
    for pe, rel in succs:
        to_rel.setdefault(pe, rel)
    pairs: dict[tuple[str, str], str] = {}
    for f, frel in from_rel.items():
        for t, trel in to_rel.items():
            if f == t:
                continue  # self-pair (e.g. a header line repeating the destination)
            pairs.setdefault((f, t), frel if frel != "renamed" else trel)
    return pairs


# Cues that a transfer sentence describes an error, a reversal, or a
# non-event. "Stated" is the site's strongest evidence tier; a sentence that
# retracts itself cannot carry it (#53: /program/1203154SF/ shipped REALIGNED
# TO -> 1203609SF from "…was erroneously transferred to Program Element
# 1203609SF", whose own paragraph's NEXT sentence says the funds will be
# realigned BACK).
#
# Checked against the sentence AND its immediate successor via
# _window_is_negated — but NOT blindly: a same-sentence cue always negates,
# while a next-sentence cue only negates when that next sentence also names
# one of THIS edge's own PE endpoints. The endpoint scoping is not
# precautionary — a blind "does sent+next contain any cue" window was tried
# first and DISPROVEN against the live FY2026 corpus before this shipped: in
# 1203154SF's real narrative the CLEAN "…transferred to PE 1203155SF"
# sentence is immediately followed by the unrelated erroneous
# "…transferred to PE 1203609SF" sentence, so a blind window kills that
# legitimate edge too (see test_a_blind_current_plus_next_window_would_
# wrongly_kill_a_neighbor and the corpus scan in the #53 commit). Endpoint
# scoping keeps the real catch (the retraction sentence necessarily names
# where the money goes "back" to) without that false positive.
#
# "no longer" was in the original candidate list and is deliberately
# EXCLUDED: it describes a natural, EXPECTED side effect of any legitimate
# transfer ("PE X will no longer receive this funding") rather than a
# retraction of the transfer itself, and keeping it would risk suppressing
# correct edges on exactly the boilerplate follow-up sentence most transfers
# already carry. It had zero matches in the live FY2026 corpus either way
# (verified before shipping), so dropping it costs nothing measurable today
# and removes a structurally-broad future risk.
NEGATION_CUES = (
    "erroneously", "in error", "incorrectly", "realigned back",
    "transferred back", "will be returned", "rescinded",
)


def _window_is_negated(sent: str, next_sent: str | None, from_pe: str, to_pe: str) -> bool:
    """True iff `sent` retracts itself, directly or via its scoped successor.

    A cue found IN `sent` itself always negates unconditionally — the
    transfer clause and its own retraction share one sentence (#53's actual
    shipped bug: "was erroneously transferred to PE 1203609SF"). A cue found
    only in `next_sent` negates ONLY when that next sentence also mentions one
    of this edge's own endpoints (from_pe or to_pe) — see NEGATION_CUES'
    comment for the concrete false positive this scoping prevents.
    """
    if any(cue in sent.lower() for cue in NEGATION_CUES):
        return True
    if next_sent and any(cue in next_sent.lower() for cue in NEGATION_CUES):
        if from_pe in next_sent or to_pe in next_sent:
            return True
    return False


def extract_stated_edges(narratives: list[dict]) -> list[LineageEdge]:
    """narratives: dicts with pe_bli, fiscal_year, fact_id, page, body."""
    out: list[LineageEdge] = []
    seen: set[tuple[str, str, int, str]] = set()

    def mint(n: dict, frm: str, to: str, relation: str, sent: str) -> None:
        if frm == to:
            return
        key = (frm, to, n["fiscal_year"], relation)
        if key in seen:
            return
        seen.add(key)
        stripped = sent.strip()
        # Per-edge disambiguator (#53) — see model.py's edge_fact_id comment
        # for why this is NOT evidence_fact_id (which must stay the
        # narrative's own fact_id_narrative(...) value for citation
        # resolution; a shared evidence_fact_id across several edges from one
        # narrative is normal, not itself a defect).
        edge_fid = hashlib.sha256(
            f"{frm}|{to}|{n['fiscal_year']}|{relation}|{stripped}".encode()
        ).hexdigest()[:16]
        out.append(LineageEdge(
            from_pe_bli=frm, to_pe_bli=to, fiscal_year=n["fiscal_year"],
            relation=relation, confidence="stated",
            evidence_fact_id=n.get("fact_id"), evidence_page=n.get("page"),
            evidence_sentence=stripped, portion_amount=None,
            inference_basis=None, edge_fact_id=edge_fid))

    for n in narratives:
        this = n["pe_bli"]
        body = n.get("body") or ""
        sents = _SENT.findall(body)
        for i, sent in enumerate(sents):
            next_sent = sents[i + 1] if i + 1 < len(sents) else None
            named = sentence_named_pairs(sent)
            if named:
                # BOTH endpoints named: the sentence is the evidence for the
                # pair it asserts — `this` is not involved (Defect 1).
                for (frm, to), relation in named.items():
                    if _window_is_negated(sent, next_sent, frm, to):
                        continue
                    mint(n, frm, to, relation, sent)
                continue
            # Single direction (or only self-pairs): today's behavior — the
            # narrative's own PE supplies the unnamed endpoint (correct for
            # first-person R-2 narratives: "This work was transferred to PE X").
            preds, succs = _directional_matches(sent)
            for other, relation in preds:
                if other == this:
                    continue
                if _window_is_negated(sent, next_sent, other, this):
                    continue
                mint(n, other, this, relation, sent)
            for other, relation in succs:
                if other == this:
                    continue
                if _window_is_negated(sent, next_sent, this, other):
                    continue
                mint(n, this, other, relation, sent)
    return out
