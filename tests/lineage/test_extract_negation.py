"""#53: a "Stated"-tier edge minted from a sentence that retracts itself.

/program/1203154SF/ shipped REALIGNED TO -> 1203609SF from "In FY 2026,
Project Auxiliary Payloads was erroneously transferred to Program Element
1203609SF." The very next sentence in the same paragraph: "This funding will
be realigned back to PE 1203154SF for proper execution following enactment."
extract_stated_edges walked _SENT.findall(body) one sentence at a time, so the
retraction was invisible to it. Fixed by making extraction negation-aware over
a (sentence, successor) window.

Deviation from the assigned test file (disclosed per task instructions,
verified against the LIVE program_lineage table before writing this):
test_each_edge_mints_its_own_fact_id below checks `e.edge_fact_id`, not
`e.evidence_fact_id` as originally specified. evidence_fact_id MUST remain
the narrative's own fact_id_narrative(...) value unchanged — verify-lineage
leg (a) re-derives it against detail_narratives, and export_site.py hard-
raises any stated edge whose evidence_fact_id is not in the site's
cite-shard universe (a freshly-minted per-edge hash resolves to neither).
Querying the live program_lineage table confirms TWO other fact_ids are
already, legitimately, shared by several edges — 595b7bc230776350 by 5
(one rollup paragraph naming five PE-to-PE transfers, page 607) and
76c131e6f01ef8fa by 2 (one PE fanning out to two destinations) — so shared
evidence_fact_id is normal, not itself a defect. Per-edge disambiguation
therefore lives on a NEW additive field, edge_fact_id, instead of hijacking
citation-bearing evidence_fact_id. See lineage/model.py and lineage/extract.py
for the full rationale.
"""
from govbudget.lineage.extract import extract_stated_edges

RETRACTED_BODY = (
    "In FY 2026, Project Auxiliary Payloads was erroneously transferred to "
    "Program Element 1203609SF. This funding will be realigned back to "
    "PE 1203154SF for proper execution following enactment."
)
CLEAN_BODY = (
    "In FY 2026, Project Moving Target Indicator is transferred to Program "
    "Element 1203155SF to better align efforts with the USSF mission areas."
)


def _narrative(body: str, fact_id: str = "10a4acbaa3270c74") -> dict:
    return {"pe_bli": "1203154SF", "fiscal_year": 2026,
            "fact_id": fact_id, "page": 647, "body": body}


def test_an_erroneous_transfer_yields_no_stated_edge():
    assert [e.to_pe_bli for e in extract_stated_edges([_narrative(RETRACTED_BODY)])] == []


def test_a_clean_transfer_still_yields_a_stated_edge():
    got = extract_stated_edges([_narrative(CLEAN_BODY)])
    assert [(e.from_pe_bli, e.to_pe_bli) for e in got] == [("1203154SF", "1203155SF")]
    assert got[0].confidence == "stated"


def test_the_negation_cue_may_sit_in_the_following_sentence():
    """The retraction on 1203154SF is the NEXT sentence, so a per-sentence
    window cannot see it. The window is the sentence pair."""
    body = ("Project X is transferred to Program Element 1203609SF. "
            "This funding will be realigned back to PE 1203154SF.")
    assert extract_stated_edges([_narrative(body)]) == []


def test_a_blind_current_plus_next_window_would_wrongly_kill_a_neighbor():
    """The naive fix ("does sent+next contain a cue?", no endpoint scoping)
    was tried first and DISPROVEN against the live corpus: in 1203154SF's
    real narrative, the clean MTI->1203155SF transfer sentence is immediately
    FOLLOWED by the unrelated erroneous ...->1203609SF sentence, so a blind
    window kills the legitimate edge too. Reproduced here in miniature: sentA
    (clean, no cue itself) is followed by sentB (a cue, but about a DIFFERENT
    PE pair entirely) — sentA must survive because sentB's retraction has
    nothing to do with sentA's own endpoints."""
    body = ("Project M is transferred to Program Element 1203155SF. "
            "Project N was erroneously transferred to Program Element 1203609SF.")
    got = extract_stated_edges([_narrative(body)])
    assert ("1203154SF", "1203155SF") in [(e.from_pe_bli, e.to_pe_bli) for e in got]
    assert ("1203154SF", "1203609SF") not in [(e.from_pe_bli, e.to_pe_bli) for e in got]


def test_each_edge_mints_its_own_fact_id():
    body = ("Project A is transferred to Program Element 1203155SF. "
            "Project B is transferred to Program Element 1203160SF.")
    got = extract_stated_edges([_narrative(body)])
    assert len(got) >= 2
    # Both edges legitimately share ONE evidence_fact_id (same narrative row,
    # same page) — see module docstring. Per-edge distinguishability is on
    # edge_fact_id instead.
    assert len({e.evidence_fact_id for e in got}) == 1
    assert len({e.edge_fact_id for e in got}) == len(got)
    assert "10a4acbaa3270c74" not in {e.edge_fact_id for e in got}
