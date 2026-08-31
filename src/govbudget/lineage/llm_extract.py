"""ROADMAP #29(a) — LLM-read lineage edges, and the check that keeps them honest.

Methodology, fixed before the first API call:
``docs/superpowers/specs/2026-08-31-lineage-llm-extraction-precision.md``.

Why a language model at all
---------------------------
``lineage/extract.py``'s rules require the PE code ADJACENT to the transfer verb
and preposition ("transferred to PE 0609277A"). Real J-book prose interposes
clauses and decorates the code a dozen ways — "transferred to Budget Activity-9
(BA-9) Program Element (PE) 0609277A", "Realignment starting FY 2026 to Lethal
Semi-Autonomous Aerial Unmanned Sys-Eng Dev (0609345A/A49) funding line",
"Program 0604009F". Those misses are MECHANICAL, not semantic: the sentence names
both endpoints plainly, and only the adjacency rule cannot see it. Reading such a
sentence is what a model is for.

Why it still cannot fabricate
-----------------------------
The model NEVER supplies an endpoint. Candidate clauses are pre-filtered to those
that already contain at least one PE-shaped token, and the verifier (``verify()``)
drops any proposal whose endpoints are not verbatim tokens of the cited clause (or
the narrating PE, under a strict single-code condition). So the worst a wrong model
output can do is propose a pairing of codes the sentence really contains — which is
then adjudicated by a person before anything ships.

Three tiers, in order, and nothing skips one:

  1. ``candidates()``    deterministic clause selection (no API, no model)
  2. ``submit``/``collect``  one Batch request per clause -> raw proposals archived
  3. ``verify()``        deterministic refusals -> rows written to the SEED
  4. a human verdict in ``data-seeds/lineage_llm_edges.csv``
  5. ``lineage/load.py`` mints ONLY verdict-'y' rows
  6. ``verify-lineage`` leg (j) proves 5 never drifts from 4

This mirrors ``oversight/gao_xwalk.py`` exactly, and for the same reason: naming
the wrong predecessor for a federal program is a false claim about where public
money went, not a formatting error. The exporter does no matching; it reads
ratified rows.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from govbudget.lineage.extract import (
    _SENT,
    _pe_named,
    _window_is_negated,
    sentence_named_pairs,
)
from govbudget.lineage.model import LineageEdge

MODEL = "claude-opus-5"
MAX_OUTPUT_TOKENS = 2000
# Batch-discounted Claude Opus 5 rates: 50% off $5/$25 per MTok.
BATCH_INPUT_USD_PER_MTOK = 2.50
BATCH_OUTPUT_USD_PER_MTOK = 12.50
# A real ceiling for this pass, not a knob to turn up until a batch fits. The
# measured population is 313 clauses at well under a cent each; $5 is roughly
# 8x the forecast and still an order of magnitude under the dossier cap.
COST_CAP_USD = 5.0

# The program-element shape, identical to extract.py's _PE but as a standalone
# whole-token matcher (extract.py embeds it inside verb rules).
PE_TOKEN = re.compile(r"(?<![A-Za-z0-9])(\d{7}(?:[A-Z][A-Z0-9]{0,3})?)(?![A-Za-z0-9])")

# Clause pre-filter verb set. Deliberately WIDER than extract.py's _RULES: this
# is recall-side selection, and every downstream stage is precision-side. A verb
# here costs one cheap Batch request; a verb missing here costs an edge nobody
# ever sees.
CANDIDATE_VERB = re.compile(
    r"\btransferr?ed?\b|\btransfers?\b|\brealign\w*\b|\bformerly\b"
    r"|\bpreviously (?:funded|budgeted)\b|\brenamed\b|\bmigrat\w*\b|\bmoved\b"
    r"|\bconsolidat\w*\b|\bmerged\b|\bsplit\b|\brestructur\w*\b",
    re.I,
)

RELATIONS = ("realigned", "renamed", "split", "merged")

# The seed's verdict vocabulary. Three values, because two cannot say the truth:
#
#   y  a person read the clause and its paragraph and judged the edge TRUE.
#      Only these are minted.
#   n  a person judged the edge FALSE. It must never appear in program_lineage
#      (verify-lineage leg j2), and it stays in the seed forever so the measured
#      precision includes it — the same discipline that keeps the single
#      rejected row in data-seeds/gao_program_xwalk.csv.
#   r  a person judged the edge TRUE and a downstream refusal rule declines to
#      ship it anyway. Recording these is the whole point: without an `r` the
#      only ways to represent a refused-but-true edge are to delete it (losing
#      the count of what caution costs) or to call it false (a lie about the
#      corpus). An `r` is NOT an extraction error, so it is excluded from the
#      precision denominator and reported on its own line.
VERDICTS = ("y", "n", "r")

SEED_FIELDS = (
    "clause_id",
    "from_pe_bli",
    "to_pe_bli",
    "relation",
    "verdict",
    "narrating_pe",
    "fiscal_year",
    "evidence_fact_id",
    "evidence_sentence",
    "from_title",
    "to_title",
    "curator_notes",
)


# ---------------------------------------------------------------------------
# 1. Candidates — deterministic, no model involved
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Clause:
    """One narrative clause that MIGHT state a lineage edge."""

    clause_id: str
    pe_bli: str
    fiscal_year: int
    fact_id: str
    page: int | None
    sentence: str
    prev_sentence: str
    next_sentence: str
    codes: tuple[str, ...]

    def as_prompt(self) -> str:
        return (
            f"NARRATING PROGRAM ELEMENT: {self.pe_bli}\n"
            f"J-BOOK EDITION: PB{self.fiscal_year}\n"
            f"PREVIOUS SENTENCE: {self.prev_sentence or '(none)'}\n"
            f"SENTENCE UNDER EXAMINATION: {self.sentence}\n"
            f"NEXT SENTENCE: {self.next_sentence or '(none)'}\n"
            f"PROGRAM-ELEMENT CODES PRESENT IN THE SENTENCE:"
            f" {', '.join(self.codes)}\n"
        )


def clause_id(fact_id: str, sentence: str) -> str:
    """Stable id for a (narrative, clause) pair — the seed's join key."""
    return hashlib.sha256(f"{fact_id}|{sentence.strip()}".encode()).hexdigest()[:16]


def candidates(narratives: list[dict]) -> list[Clause]:
    """Clauses carrying a transfer verb AND at least one PE-shaped token.

    `narratives`: the same dicts lineage/load.py assembles (pe_bli, fiscal_year,
    fact_id, page, body). Ordered input produces ordered output; the clause_id
    makes the ordering irrelevant downstream.

    The PE-token requirement is the anti-fabrication filter at its source: a
    clause with no code in it is never shown to a model, so a model can never
    be the origin of a code.
    """
    out: list[Clause] = []
    seen: set[str] = set()
    for n in narratives:
        body = n.get("body") or ""
        sents = _SENT.findall(body)
        for i, sent in enumerate(sents):
            stripped = sent.strip()
            if not stripped or not CANDIDATE_VERB.search(sent):
                continue
            codes = tuple(sorted(set(PE_TOKEN.findall(sent))))
            if not codes:
                continue
            cid = clause_id(n["fact_id"], stripped)
            if cid in seen:
                continue
            seen.add(cid)
            out.append(
                Clause(
                    clause_id=cid,
                    pe_bli=n["pe_bli"],
                    fiscal_year=int(n["fiscal_year"]),
                    fact_id=n["fact_id"],
                    page=n.get("page"),
                    sentence=stripped,
                    prev_sentence=(sents[i - 1].strip() if i else ""),
                    next_sentence=(
                        sents[i + 1].strip() if i + 1 < len(sents) else ""
                    ),
                    codes=codes,
                )
            )
    return out


# ---------------------------------------------------------------------------
# 2. The prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You read United States Department of Defense budget justification prose (R-2
RDT&E and P-40 procurement exhibits) for Fiscal Receipts, and you answer exactly
one question about one sentence:

  Does this sentence state that the money or the effort of one BUDGET IDENTITY
  became, or came from, another BUDGET IDENTITY?

A budget identity is a Program Element (a seven-digit code, sometimes with a
service suffix: 0604270A, 1206616SF, 0605140D8Z) or a procurement Budget Line
Item. It is NOT a project, a sub-project, an effort, a system, a contract, an
office, or a command.

WHAT COUNTS (answer yes)
  * "In FY 2021, Multi-domain Experimentation transfers to the Defense
    Modernization and Prototyping Program Element, 0603338D8Z."
  * "Administrative realignment of FY26 RDT&E funds for MFEW-AL transferred to
    Budget Activity-9 (BA-9) Program Element (PE) 0609345A"
  * "Realignment starting FY 2026 to Lethal Semi-Autonomous Aerial Unmanned
    Sys-Eng Dev (0609345A/A49) funding line."
  * "In FY 2026, the BA02 0602203F Aerospace Propulsion program is renamed
    Aerospace Systems Technologies program."  (a rename of the PROGRAM ELEMENT)

WHAT DOES NOT COUNT (answer no)
  * Technology transfer, technology transition, data transfer, information
    transfer, cross-domain transfer, heat transfer, Small Business Technology
    Transfer (STTR). These are subject matter, not budget movement.
  * Software, cloud, network or site MIGRATION.
  * Movement between PROJECTS inside one program element: "efforts were
    realigned from Project EY7 to Project/EY8", "Project 623145 ... transferred
    to 622403". The grain is wrong even when the verb is right.
  * A SYSTEM being renamed or re-branded: "Next Generation Jammer Mid-Band
    (formerly known as Next Generation Jammer Increment 1)", "The RGS, formerly
    termed as Weapon Control System". The budget line did not change identity.
  * Movement between Budget Activities, accounts, appropriations or commands
    with no second program element named.
  * A sentence that merely MENTIONS another program element (alignment,
    coordination, support, "efforts within this PE align with ...").

THE ENDPOINT RULE, AND IT IS ABSOLUTE
  Every program element you name MUST appear character-for-character in the
  SENTENCE UNDER EXAMINATION, or be the NARRATING PROGRAM ELEMENT. You may not
  supply a code from the previous or next sentence, from the edition header,
  from the program's title, or from your own knowledge. If the sentence states
  a transfer but names only one end and you cannot tell what the other end is,
  return no edge at all. A missing edge is a small loss; a wrong predecessor is
  a false public claim about where tax money went.

WHEN THE NARRATING PROGRAM ELEMENT MAY BE AN ENDPOINT
  Only when the sentence names exactly ONE program-element code and speaks in
  the first person about its own line ("this effort was transferred to PE X",
  "SLUAS transfers from RDTEN Program Element (PE) 0604562N"). If the sentence
  names TWO OR MORE codes, both endpoints must be codes from the sentence — a
  sentence that reports on several other programs is not reporting on this one.

DIRECTION
  from_pe_bli is where the money or effort WAS. to_pe_bli is where it WENT.
  "A transferred to B" is from=A, to=B. "B receives funding transferred from A"
  is still from=A, to=B. Read the preposition, not the word order.

RELATION
  realigned — money or effort moved between two program elements
  renamed   — one program element continued under a new code and/or new name
  split     — one program element became several
  merged    — several program elements became one

RETRACTIONS
  If the sentence, or the next sentence, says the move was erroneous, was made
  in error, is being realigned back, transferred back, returned, or rescinded,
  return no edge.

AMOUNTS
  Never return a dollar amount, even when the sentence states one.

Return JSON matching the requested schema. `edges` may be an empty array, and an
empty array is a complete, correct answer for most sentences.
"""

# ---------------------------------------------------------------------------
# The CONFIRMATION pass (V10), added after the pilot measured 90.5%
# ---------------------------------------------------------------------------
#
# The pilot's 21 candidates were adjudicated by hand against each clause's own
# paragraph and against the counterparty's book: 19 right, 2 wrong. Both wrong
# ones are ONE species — a true, correctly-cited transfer wearing a label the
# sentence does not support:
#
#   * 1206770SF -> 1206857SF. The clause really says EGS funding moved to Space
#     Rapid Capabilities Office. It also calls it "a one-time technical
#     adjustment in FY 2025 ... which improved funding execution", and the
#     PRECEDING sentence names EGS's actual successor (1206772SF, R2C2). An
#     execution-year accounting move is not a change of identity.
#   * 0603833D8Z -> 0605142D8Z. The clause says "$2.000 million of Systems
#     Engineering (0605142D8Z) resources will be used to sustain SERC
#     operations". That is spending, and the proposed direction is the reverse
#     of the only reading under which it is a transfer at all.
#
# Neither is fixable by a blacklist, and neither is reliably catchable by a
# regex without a hand-tuned window — the failure is semantic. So the second
# stage asks the model the ADJUDICATOR'S OWN four questions about a candidate
# it has already proposed, one endpoint pair at a time, and requires it to
# quote the words. Disagreement REFUSES; it can never create or repair an edge,
# so this stage can only raise precision, never recall. Its contribution is
# measured by ablation on the pilot (see the review file), exactly as ROADMAP
# #30 measured its service rule.
CONFIRM_SYSTEM_PROMPT = """\
You are checking one proposed program-lineage edge for Fiscal Receipts, a site
whose entire claim is that a reader cannot mistake a candidate for a fact.

You are given one sentence from a Department of Defense budget justification,
its neighbours, and a proposed edge FROM one program element TO another. Someone
has already decided this sentence describes a transfer. Your job is to try to
falsify that, not to confirm it. Answer four questions.

1. is_budget_identity_move — does the sentence state that money or effort moved
   between two BUDGET IDENTITIES (program elements / budget line items)? It is
   NOT one if the sentence describes technology transfer, data transfer,
   software or site migration, movement between projects inside one program
   element, a system being re-branded, or one program's money being SPENT ON or
   USED FOR an activity ("X resources will be used to sustain Y", "funded by X")
   — spending is not a transfer of identity.

2. direction_correct — does the sentence state the move ran FROM the proposed
   source TO the proposed destination, and not the other way round? Treat the
   reverse as a DIFFERENT claim and answer false if the sentence supports it
   instead, or if the sentence does not settle the direction.

3. is_one_time_or_temporary — does the sentence itself present the move as a
   one-time, temporary, or execution-year adjustment rather than a lasting
   change of budget identity? Words like "one-time", "temporary", "for FY 20XX
   only", or a stated purpose of improving execution in a single year mean true.
   A congressional or administrative adjustment that stands up a new program
   element, or that moves a line permanently, is NOT one-time.
   DATING A MOVE IS NOT MAKING IT TEMPORARY. Budget prose always says when
   something happened — "In FY 2018, funding was transferred from ...",
   "FY 2021 - FY 2025 funding was transferred to ...", "Effective FY2020". Those
   are effective dates, and the answer for them is false. Answer true only when
   the sentence says the arrangement itself does not persist.

4. grain_is_program_element — are BOTH ENDPOINTS OF THE PROPOSED EDGE program
   elements or budget line items, rather than projects, efforts, systems,
   offices, budget activities, or appropriations?
   Judge the ENDPOINTS, not the subject matter. A sentence very often says which
   project's money moved — "Project 3311 Navigation Systems moved from PE X to
   PE Y", "These funds were realigned from PE X, Project JC". The thing that
   moved is a project; the two ENDPOINTS are still program elements, so the
   answer is true. Answer false only when an endpoint of the proposed edge is
   itself a project, an effort, a system, an office, a budget activity or an
   appropriation — for instance a move between two projects inside one program
   element.

supporting_fragment — the shortest run of text, COPIED CHARACTER FOR CHARACTER
from the SENTENCE UNDER EXAMINATION, that settles question 2. It must be a
verbatim substring of that sentence; do not normalise whitespace, expand
abbreviations, or quote a neighbouring sentence. If no fragment of that sentence
settles the direction, answer direction_correct false and return an empty string.

Answering "false" costs a real edge and that is acceptable. Answering "true"
about a sentence that does not say so puts a false claim about federal money on
a public page under a citation the reader will trust.
"""

CONFIRM_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "is_budget_identity_move": {"type": "boolean"},
        "direction_correct": {"type": "boolean"},
        "is_one_time_or_temporary": {"type": "boolean"},
        "grain_is_program_element": {"type": "boolean"},
        "supporting_fragment": {"type": "string"},
        "reasoning": {"type": "string"},
    },
    "required": [
        "is_budget_identity_move",
        "direction_correct",
        "is_one_time_or_temporary",
        "grain_is_program_element",
        "supporting_fragment",
        "reasoning",
    ],
    "additionalProperties": False,
}

# V11 backstop. A deterministic cue that the clause labels its own transfer
# transient — checked in ADDITION to the confirmation pass, so a one-time
# adjustment is refused even if the second read says otherwise. Same shape and
# same reasoning as extract.py's NEGATION_CUES: a sentence that qualifies itself
# cannot carry the site's strongest evidence tier.
#
# "technical adjustment" is deliberately NOT a cue on its own: the pilot's
# 0207431F -> 0303010F is a *congressional technical adjustment* that stood up a
# new program element out of an old one, which is exactly lineage. It is the
# word "one-time" that turns an adjustment into a non-event.
TRANSIENT_CUES = (
    "one-time", "one time", "onetime", "temporary", "temporarily",
)


def confirm_prompt(c: "Clause", frm: str, to: str) -> str:
    return (
        f"NARRATING PROGRAM ELEMENT: {c.pe_bli}\n"
        f"J-BOOK EDITION: PB{c.fiscal_year}\n"
        f"PREVIOUS SENTENCE: {c.prev_sentence or '(none)'}\n"
        f"SENTENCE UNDER EXAMINATION: {c.sentence}\n"
        f"NEXT SENTENCE: {c.next_sentence or '(none)'}\n"
        f"PROPOSED EDGE: FROM {frm} TO {to}\n"
    )


@dataclass
class Confirmation:
    clause_id: str
    from_pe_bli: str
    to_pe_bli: str
    is_budget_identity_move: bool
    direction_correct: bool
    is_one_time_or_temporary: bool
    grain_is_program_element: bool
    supporting_fragment: str

    def refusal(self, sentence: str) -> str | None:
        """Why this confirmation refuses the edge, or None if it stands."""
        if not self.is_budget_identity_move:
            return "the second read does not find a budget-identity move"
        if not self.grain_is_program_element:
            return "the second read finds an endpoint that is not a budget identity"
        if self.is_one_time_or_temporary:
            return (
                "the sentence presents the move as one-time or temporary, not a"
                " change of budget identity"
            )
        if not self.direction_correct:
            return "the second read does not confirm the stated direction"
        frag = (self.supporting_fragment or "").strip()
        if not frag:
            return "no fragment of the sentence was offered as settling the direction"
        if frag not in sentence:
            return (
                "the fragment offered as settling the direction is not verbatim in"
                f" the sentence: {frag[:110]!r}"
            )
        return None


def confirmation_from_result(
    clause_id: str, frm: str, to: str, payload: dict
) -> Confirmation:
    p = payload or {}
    return Confirmation(
        clause_id=clause_id,
        from_pe_bli=frm,
        to_pe_bli=to,
        is_budget_identity_move=bool(p.get("is_budget_identity_move")),
        direction_correct=bool(p.get("direction_correct")),
        is_one_time_or_temporary=bool(p.get("is_one_time_or_temporary")),
        grain_is_program_element=bool(p.get("grain_is_program_element")),
        supporting_fragment=str(p.get("supporting_fragment") or ""),
    )


def build_confirm_requests(pairs, clauses: dict, *, model: str = MODEL) -> list:
    """One request per (clause, from, to) candidate pair."""
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    out = []
    for cid, frm, to in pairs:
        c = clauses[cid]
        out.append(
            Request(
                custom_id=f"cfm-{cid}-{frm}-{to}",
                params=MessageCreateParamsNonStreaming(
                    model=model,
                    max_tokens=MAX_OUTPUT_TOKENS,
                    system=[
                        {
                            "type": "text",
                            "text": CONFIRM_SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral", "ttl": "1h"},
                        }
                    ],
                    output_config={
                        "format": {"type": "json_schema", "schema": CONFIRM_SCHEMA}
                    },
                    messages=[
                        {"role": "user", "content": confirm_prompt(c, frm, to)}
                    ],
                ),
            )
        )
    return out


PROPOSAL_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "is_budget_identity_move": {"type": "boolean"},
        "reasoning": {"type": "string"},
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from_pe_bli": {"type": "string"},
                    "to_pe_bli": {"type": "string"},
                    "relation": {"type": "string", "enum": list(RELATIONS)},
                    "from_is_narrating_pe": {"type": "boolean"},
                    "to_is_narrating_pe": {"type": "boolean"},
                },
                "required": [
                    "from_pe_bli",
                    "to_pe_bli",
                    "relation",
                    "from_is_narrating_pe",
                    "to_is_narrating_pe",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_budget_identity_move", "reasoning", "edges"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# 3. Cost — forecast from the real clauses, never from the output cap
# ---------------------------------------------------------------------------


def estimate_cost(clauses: list[Clause], *, client=None, model: str = MODEL) -> dict:
    """Batch-rate forecast, printing which basis the output figure came from.

    Output tokens are predicted from ARCHIVED runs when at least 5 exist, and
    otherwise fall back to MAX_OUTPUT_TOKENS — which is a CEILING, not a
    forecast, and the returned ``output_basis`` says so. (Same lesson
    dossiers/batch.py records: assuming the cap over-forecast dossier spend by
    an order of magnitude.)
    """
    observed = _observed_mean_output_tokens()
    out_tokens = observed if observed is not None else MAX_OUTPUT_TOKENS
    input_tokens = 0
    for c in clauses:
        input_tokens += _count_tokens(
            SYSTEM_PROMPT, c.as_prompt(), client=client, model=model
        )
    input_usd = input_tokens * BATCH_INPUT_USD_PER_MTOK / 1_000_000
    output_usd = out_tokens * len(clauses) * BATCH_OUTPUT_USD_PER_MTOK / 1_000_000
    return {
        "requests": len(clauses),
        "input_tokens": input_tokens,
        "output_tokens_assumed": out_tokens,
        "input_usd": input_usd,
        "output_usd": output_usd,
        "total_usd": input_usd + output_usd,
        "output_basis": "observed" if observed is not None else "cap",
    }


def _count_tokens(system: str, user: str, *, client=None, model: str = MODEL) -> int:
    if client is not None:
        return client.messages.count_tokens(
            model=model, system=system, messages=[{"role": "user", "content": user}]
        ).input_tokens
    # chars/4 heuristic for keyless runs and tests (never tiktoken).
    return max(1, (len(system) + len(user)) // 4)


_RAW_DIR_NAME = "lineage-raw"


def _observed_mean_output_tokens(raw_dir: Path | None = None) -> int | None:
    """Mean output tokens over archived batch results, or None below 5 samples."""
    if raw_dir is None:
        from govbudget import config

        raw_dir = config.RESEARCH_DIR / _RAW_DIR_NAME
    raw_dir = Path(raw_dir)
    if not raw_dir.is_dir():
        return None
    seen: list[int] = []
    for path in sorted(raw_dir.glob("results-*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            usage = (((rec.get("result") or {}).get("message") or {}).get("usage")) or {}
            if isinstance(usage.get("output_tokens"), int):
                seen.append(usage["output_tokens"])
    if len(seen) < 5:
        return None
    return max(1, round(sum(seen) / len(seen)))


def print_estimate(est: dict) -> None:
    basis = est.get("output_basis", "cap")
    assumed = est["output_tokens_assumed"]
    how = (
        f"output predicted at {assumed:,}tok/request from archived runs"
        if basis == "observed"
        else f"output assumed at the {assumed:,}tok CAP — no archived runs to"
        " predict from, so this is a CEILING and not a forecast"
    )
    print(
        f"lineage-llm: {est['requests']} request(s), {est['input_tokens']:,}"
        f" input tokens; {how}"
    )
    print(
        f"lineage-llm: estimated ${est['total_usd']:.4f}"
        f" (in ${est['input_usd']:.4f} + out ${est['output_usd']:.4f})"
        f" at Batch-discounted {MODEL} rates"
    )


# ---------------------------------------------------------------------------
# 4. Batch requests
# ---------------------------------------------------------------------------


def build_requests(clauses: list[Clause], *, model: str = MODEL) -> list:
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    return [
        Request(
            custom_id=f"lin-{c.clause_id}",
            params=MessageCreateParamsNonStreaming(
                model=model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral", "ttl": "1h"},
                    }
                ],
                output_config={
                    "format": {"type": "json_schema", "schema": PROPOSAL_SCHEMA}
                },
                messages=[{"role": "user", "content": c.as_prompt()}],
            ),
        )
        for c in clauses
    ]


# ---------------------------------------------------------------------------
# 5. The verifier — every refusal rule from the spec, applied here
# ---------------------------------------------------------------------------


@dataclass
class Proposal:
    """One model-proposed edge, before any refusal has been applied."""

    clause_id: str
    from_pe_bli: str
    to_pe_bli: str
    relation: str


@dataclass
class Refusal:
    clause_id: str
    from_pe_bli: str
    to_pe_bli: str
    rule: str
    reason: str


def verify(
    proposals: list[Proposal],
    clauses: dict[str, Clause],
    *,
    known_pes: set[str] | None = None,
    existing_pairs: set[tuple[str, str]] | None = None,
    confirmations: dict[tuple[str, str, str], Confirmation] | None = None,
    require_confirmation: bool = False,
) -> tuple[list[dict], list[Refusal]]:
    """Apply V1..V11 (spec §2, plus V9–V11). Returns (candidate rows, refusals).

    A candidate row is what a human adjudicates; a refusal never reaches one.
    Both are reported — the refusals are the durable part of the exercise.

    `known_pes` (optional): the corpus PE universe. When supplied, an endpoint
    outside it is refused as unresolvable rather than shipped as a dangling
    reference the reader cannot check.
    """
    existing_pairs = existing_pairs or set()
    rows: list[dict] = []
    refusals: list[Refusal] = []
    kept: set[tuple[str, str]] = set()

    def refuse(p: Proposal, rule: str, reason: str) -> None:
        refusals.append(
            Refusal(p.clause_id, p.from_pe_bli, p.to_pe_bli, rule, reason)
        )

    for p in proposals:
        c = clauses.get(p.clause_id)
        if c is None:
            refuse(p, "V0-orphan", "no candidate clause carries this clause_id")
            continue
        frm = (p.from_pe_bli or "").strip()
        to = (p.to_pe_bli or "").strip()

        # V7a self-loop
        if not frm or not to or frm == to:
            refuse(p, "V7-self-loop", f"from == to ({frm!r})")
            continue

        # V3 shape — PE grain only. Numeric-only line items are refused because
        # pe_bli is not unique for them (spec §6.1), and a 6-digit project code
        # is the wrong grain entirely (spec §6.3).
        misshapen = [pe for pe in (frm, to) if not PE_TOKEN.fullmatch(pe)]
        if misshapen:
            refuse(
                p,
                "V3-shape",
                f"{misshapen} is not a program-element code — numeric line"
                " items are refused (pe_bli is not unique for them) and"
                " project codes are the wrong grain",
            )
            continue

        # V1 verbatim endpoints, and V2 no this-pairing in a multi-code clause
        in_sentence = {pe for pe in (frm, to) if _pe_named(pe, c.sentence)}
        self_supplied = [
            pe for pe in (frm, to) if pe == c.pe_bli and pe not in in_sentence
        ]
        unnamed = sorted(
            {pe for pe in (frm, to) if pe not in in_sentence and pe != c.pe_bli}
        )
        if unnamed:
            refuse(
                p,
                "V1-fabricated-endpoint",
                f"{unnamed} appear(s) neither in the clause nor as the"
                f" narrating PE ({c.pe_bli}) — the sentence does not name"
                " this endpoint",
            )
            continue
        if self_supplied and len(c.codes) > 1:
            refuse(
                p,
                "V2-this-pairing-in-multi-code-clause",
                f"clause names {len(c.codes)} codes {list(c.codes)}; the"
                f" narrating PE {c.pe_bli} may not supply an endpoint in a"
                " clause that reports on other programs",
            )
            continue

        # V4 relation vocabulary
        if p.relation not in RELATIONS:
            refuse(p, "V4-relation", f"relation {p.relation!r} not in {RELATIONS}")
            continue

        # V9 the clause's own both-named pairs, when it has any, are binding.
        # verify_lineage's _edge_citation_resolves (leg a, clause 2) refuses any
        # stated edge whose endpoints contradict the pairs sentence_named_pairs
        # derives from its evidence sentence — the Defect-1 rule. So a proposal
        # that disagrees with those pairs could never ship anyway; refusing it
        # HERE means the seed never carries a row the gate would reject, and it
        # keeps ONE rule set (extract.py's _RULES) arbitrating both tiers rather
        # than two readers disagreeing about one sentence in production.
        named = sentence_named_pairs(c.sentence)
        if named and (frm, to) not in named:
            refuse(
                p,
                "V9-contradicts-named-pairs",
                f"the clause's own directional rules name {sorted(named)};"
                f" ({frm}, {to}) is not among them",
            )
            continue

        # V5 no self-retraction — extract.py's own predicate, imported
        if _window_is_negated(c.sentence, c.next_sentence, frm, to):
            refuse(
                p,
                "V5-retracted",
                "the clause or its scoped successor retracts the transfer",
            )
            continue

        if known_pes is not None:
            missing = [pe for pe in (frm, to) if pe not in known_pes]
            if missing:
                refuse(
                    p,
                    "V3b-unknown-pe",
                    f"{missing} absent from the corpus PE universe",
                )
                continue

        # V7b the regex tier already states this link; one link, one edge.
        # Deliberately BEFORE V10/V11: those two are the PAID stage, and a pair
        # the regex tier already carries must never be sent for a second read,
        # nor be reported as "unconfirmed" when the real reason it did not ship
        # is that it was already shipped.
        if (frm, to) in existing_pairs:
            refuse(p, "V7-already-stated", "the regex tier already mints this pair")
            continue
        if (frm, to) in kept:
            refuse(p, "V7-duplicate", "already proposed by an earlier clause")
            continue

        # V11 the clause labels its own transfer transient — a backstop that
        # holds whether or not the confirmation pass agrees (see TRANSIENT_CUES).
        low = c.sentence.lower()
        hit = next((cue for cue in TRANSIENT_CUES if cue in low), None)
        if hit is not None:
            refuse(
                p,
                "V11-transient",
                f"the clause calls its own move {hit!r} — an execution-year"
                " adjustment is not a change of budget identity",
            )
            continue

        # V10 the adversarial second read (see CONFIRM_SYSTEM_PROMPT). Absent a
        # confirmation, require_confirmation decides: True refuses (nothing ships
        # unconfirmed), False lets the proposal through so the ABLATION — what
        # the stage is worth — can be measured against the same corpus.
        if require_confirmation or confirmations:
            # ANY REFUSAL WINS, across every clause that proposes this pair.
            # One clause's text is often duplicated across narratives (the same
            # sentence in a mission block and a change summary), the second read
            # is a model and therefore not deterministic, and two identical
            # requests DID disagree in this corpus (2 pairs of 52). Taking the
            # per-clause verdict would let a refused pair in through whichever
            # duplicate happened to be confirmed — shopping for a clause that
            # passes. Refusing the pair outright costs recall and cannot cost
            # precision, which is the trade this tier exists to make.
            verdicts = [
                (cid, conf.refusal(clauses[cid].sentence))
                for (cid, f2, t2), conf in (confirmations or {}).items()
                if (f2, t2) == (frm, to) and cid in clauses
            ]
            refusing = [(cid, why) for cid, why in verdicts if why is not None]
            if not verdicts:
                if require_confirmation:
                    refuse(
                        p,
                        "V10-unconfirmed",
                        "no second read was archived for this pair",
                    )
                    continue
            elif refusing:
                extra = (
                    f" (this pair is proposed by {len(verdicts)} clause(s);"
                    f" {len(refusing)} refused, and any refusal is binding)"
                    if len(verdicts) > 1
                    else ""
                )
                refuse(p, "V10-unconfirmed", refusing[0][1] + extra)
                continue

        kept.add((frm, to))
        rows.append(
            {
                "clause_id": c.clause_id,
                "from_pe_bli": frm,
                "to_pe_bli": to,
                "relation": p.relation,
                "verdict": "",
                "narrating_pe": c.pe_bli,
                "fiscal_year": c.fiscal_year,
                "evidence_fact_id": c.fact_id,
                "evidence_sentence": c.sentence,
                "from_title": "",
                "to_title": "",
                "curator_notes": "",
            }
        )

    return rows, refusals


# ---------------------------------------------------------------------------
# 6. The ratified seed
# ---------------------------------------------------------------------------


def load_ratified(seed_path: Path) -> list[dict]:
    """Read the seed. An unadjudicated verdict is an ERROR, never a default."""
    seed_path = Path(seed_path)
    if not seed_path.is_file():
        return []
    out: list[dict] = []
    with open(seed_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            verdict = (row.get("verdict") or "").strip()
            if verdict not in VERDICTS:
                raise ValueError(
                    f"lineage_llm_edges.csv: verdict {verdict!r} for"
                    f" {row.get('from_pe_bli')} -> {row.get('to_pe_bli')} is not"
                    f" one of {VERDICTS}; an unadjudicated row must not exist"
                )
            out.append({**row, "verdict": verdict})
    return out


def ratified_edges(seed_path: Path, narratives: list[dict]) -> list[LineageEdge]:
    """The verdict-'y' seed rows, as LineageEdges bound to live narratives.

    Every row is re-bound to the CURRENT corpus before it becomes an edge: its
    evidence_fact_id must still name a narrative, and that narrative's body must
    still contain the clause byte for byte. A seed row whose evidence moved is
    DROPPED here and FAILED by leg (j) — never trusted on inertia.
    """
    by_fact: dict[str, dict] = {}
    for n in narratives:
        by_fact.setdefault(n["fact_id"], n)
    out: list[LineageEdge] = []
    for row in load_ratified(seed_path):
        if row["verdict"] != "y":
            continue
        n = by_fact.get(row["evidence_fact_id"])
        if n is None:
            continue
        sentence = row["evidence_sentence"]
        if sentence not in (n.get("body") or ""):
            continue
        frm, to = row["from_pe_bli"], row["to_pe_bli"]
        edge_fid = hashlib.sha256(
            f"{frm}|{to}|{n['fiscal_year']}|{row['relation']}|{sentence}".encode()
        ).hexdigest()[:16]
        out.append(
            LineageEdge(
                from_pe_bli=frm,
                to_pe_bli=to,
                fiscal_year=int(n["fiscal_year"]),
                relation=row["relation"],
                confidence="stated",
                evidence_fact_id=row["evidence_fact_id"],
                evidence_page=n.get("page"),
                evidence_sentence=sentence,
                portion_amount=None,  # spec §6.4 — never, even when stated
                inference_basis=None,
                edge_fact_id=edge_fid,
            )
        )
    return out


@dataclass
class PrecisionReport:
    adjudicated: int          # y + n; an `r` is a refusal, not an extraction error
    accepted: int
    rejected: int
    refused: int
    stale: list[str]

    @property
    def precision(self) -> float:
        # `adjudicated == 0` yields 0.0 and NOT 1.0. "Nothing was wrong" and
        # "there was nothing" are different facts, and this project has already
        # shipped one defect from conflating them.
        return self.accepted / self.adjudicated if self.adjudicated else 0.0


def measure(seed_rows: list[dict], live_clause_ids: set[str]) -> PrecisionReport:
    """Precision = y / (y + n) over adjudicated rows, plus the drift.

    `stale` — a ratified row whose clause the candidate generator no longer
    proposes. Its evidence has moved; it must be re-examined, not trusted.
    """
    accepted = sum(1 for r in seed_rows if r["verdict"] == "y")
    rejected = sum(1 for r in seed_rows if r["verdict"] == "n")
    refused = sum(1 for r in seed_rows if r["verdict"] == "r")
    stale = sorted(
        f"{r['from_pe_bli']}->{r['to_pe_bli']} ({r['clause_id']})"
        for r in seed_rows
        if r["clause_id"] not in live_clause_ids
    )
    return PrecisionReport(
        adjudicated=accepted + rejected,
        accepted=accepted,
        rejected=rejected,
        refused=refused,
        stale=stale,
    )


def write_seed(path: Path, rows: list[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(SEED_FIELDS))
        w.writeheader()
        for row in sorted(rows, key=lambda r: (r["from_pe_bli"], r["to_pe_bli"])):
            w.writerow({k: row.get(k, "") for k in SEED_FIELDS})


def clause_to_dict(c: Clause) -> dict:
    return asdict(c)


def proposals_from_result(clause_id: str, payload: dict) -> list[Proposal]:
    """Parse one Batch result body into Proposals (tolerant, never inventive)."""
    out: list[Proposal] = []
    for e in (payload or {}).get("edges") or []:
        if not isinstance(e, dict):
            continue
        out.append(
            Proposal(
                clause_id=clause_id,
                from_pe_bli=str(e.get("from_pe_bli") or "").strip(),
                to_pe_bli=str(e.get("to_pe_bli") or "").strip(),
                relation=str(e.get("relation") or "").strip(),
            )
        )
    return out


__all__ = [
    "Clause",
    "Confirmation",
    "PrecisionReport",
    "Proposal",
    "Refusal",
    "build_confirm_requests",
    "candidates",
    "confirm_prompt",
    "confirmation_from_result",
    "clause_id",
    "estimate_cost",
    "load_ratified",
    "measure",
    "print_estimate",
    "proposals_from_result",
    "ratified_edges",
    "sentence_named_pairs",
    "verify",
    "write_seed",
]
