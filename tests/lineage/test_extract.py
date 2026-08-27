from govbudget.lineage.extract import drop_superseded, extract_stated_edges
from govbudget.lineage.model import LineageEdge

def test_extracts_transferred_from_as_predecessor_edge():
    narr = [{"pe_bli": "0604294D8Z", "fiscal_year": 2019, "fact_id": "abc123",
             "page": 114,
             "body": "Program Change Summary: $62.4M was transferred from PE 0603826D "
                     "(Advanced Sensor Technology) to consolidate the effort."}]
    edges = extract_stated_edges(narr)
    assert LineageEdge(from_pe_bli="0603826D", to_pe_bli="0604294D8Z", fiscal_year=2019,
                       relation="realigned", confidence="stated",
                       evidence_fact_id="abc123", evidence_page=114,
                       evidence_sentence="$62.4M was transferred from PE 0603826D "
                       "(Advanced Sensor Technology) to consolidate the effort.",
                       portion_amount=None, inference_basis=None) in edges

def test_transferred_to_is_successor_direction():
    narr = [{"pe_bli": "0603178C", "fiscal_year": 2018, "fact_id": "f2", "page": 9,
             "body": "This work was transferred to PE 0603294C in FY2018."}]
    edges = extract_stated_edges(narr)
    assert edges[0].from_pe_bli == "0603178C" and edges[0].to_pe_bli == "0603294C"

def test_ignores_self_reference_and_non_pe_tokens():
    narr = [{"pe_bli": "0602702E", "fiscal_year": 2024, "fact_id": "f3", "page": 3,
             "body": "Funds transferred to O&M; PE 0602702E continues research."}]
    assert extract_stated_edges(narr) == []  # 'O&M' is not a PE; self-ref dropped

def test_extracts_edge_from_unterminated_final_clause():
    narr = [{"pe_bli": "0603178C", "fiscal_year": 2018, "fact_id": "f4", "page": 12,
             "body": "Baseline effort continues. This work was transferred to PE 0603294C"}]
    edges = extract_stated_edges(narr)
    assert edges and edges[0].to_pe_bli == "0603294C"

def test_pe_token_captures_digit_bearing_agency_suffix():
    narr = [{"pe_bli": "0605294D8Z", "fiscal_year": 2020, "fact_id": "f5", "page": 7,
             "body": "The sensor work was transferred from PE 0604294D8Z last cycle."}]
    edges = extract_stated_edges(narr)
    assert any(e.from_pe_bli == "0604294D8Z" for e in edges)


# --------------------------------------------------------------------------- #
# Both-named-endpoint sentences (Defect 1, 2026-07-28): when one sentence names
# BOTH the source and the destination PE, the edge must pair THOSE two — the
# narrative's own line (`this`, often a rollup like 837300/834190 aggregating
# statements about other PEs) must not be involved at all.
# --------------------------------------------------------------------------- #

def test_both_endpoints_named_pairs_them_not_the_narrative_line():
    """A third-person rollup narrative naming source AND destination must mint
    source -> destination, never rollup -> destination (the live 837300 defect)."""
    narr = [{"pe_bli": "837300", "fiscal_year": 2026, "fact_id": "f6", "page": 21,
             "body": "In FY2021, PE 0207436F (Engineering and Installation Support AF), "
                     "efforts were transferred to PE 0303004F (EIT Connect)."}]
    edges = extract_stated_edges(narr)
    assert [(e.from_pe_bli, e.to_pe_bli) for e in edges] == [("0207436F", "0303004F")]
    assert not any("837300" in (e.from_pe_bli, e.to_pe_bli) for e in edges)
    # both endpoints are named IN the evidence sentence (stronger evidence)
    assert "0207436F" in edges[0].evidence_sentence
    assert "0303004F" in edges[0].evidence_sentence


def test_subject_position_source_with_intervening_words():
    """The live 834190 defect shape: 'funding in PE X supporting ... was
    transferred to PE Y' names X as the true source."""
    narr = [{"pe_bli": "834190", "fiscal_year": 2026, "fact_id": "f7", "page": 3,
             "body": "In FY 2025 3080 funding in PE 0207604 supporting Combat "
                     "Training Ranges was transferred to PE 0207429F."}]
    edges = extract_stated_edges(narr)
    assert [(e.from_pe_bli, e.to_pe_bli) for e in edges] == [("0207604", "0207429F")]


def test_header_prefixed_clause_names_source_not_its_own_header_pe():
    """The live 0303005F defect shape: a clause starting with a header line
    ('PE 0303005F EIT END USER DEVICES') followed by the transfer statement.
    The header PE equals the destination (self-pair, dropped); the named
    source 0208550F must win over the narrative line 837300."""
    narr = [{"pe_bli": "837300", "fiscal_year": 2026, "fact_id": "f8", "page": 22,
             "body": "PE 0303005F EIT END USER DEVICES \nIn FY2021, PE 0208550F "
                     "(Information Technology Services Management - Tactical Air "
                     "Forces), efforts were transferred to PE 0303005F (EIT End "
                     "Devices), in order to align resources."}]
    edges = extract_stated_edges(narr)
    assert [(e.from_pe_bli, e.to_pe_bli) for e in edges] == [("0208550F", "0303005F")]


def test_two_transfer_sentence_does_not_chain_destinations():
    """A first-person sentence with TWO 'transferred to' constructions must
    mint this->dest1 and this->dest2, and NEVER dest1->dest2 (the first
    destination is not the second transfer's source)."""
    narr = [{"pe_bli": "0604270F", "fiscal_year": 2026, "fact_id": "f9", "page": 5,
             "body": "In FY 2026 PE 0604270F, Project 653891 Electromagnetic Battle "
                     "Management (EMBM) efforts were transferred to PE 0207407F and "
                     "Cognitive Electromagnetic Warfare efforts were transferred to "
                     "PE 0207039F."}]
    edges = extract_stated_edges(narr)
    pairs = {(e.from_pe_bli, e.to_pe_bli) for e in edges}
    assert pairs == {("0604270F", "0207407F"), ("0604270F", "0207039F")}


def test_previously_funded_plus_transferred_to_cross_pairs_as_realigned():
    """A rename-rule source ('previously funded under PE X') combined with an
    explicit 'transferred to PE Y' in the same sentence cross-pairs X -> Y with
    the DIRECTIONAL to-rule's relation (realigned): the explicit transfer verb
    is the stronger classification signal than the identity note."""
    narr = [{"pe_bli": "0604014N", "fiscal_year": 2026, "fact_id": "f10", "page": 8,
             "body": "IRST was previously funded under Program Element 0204136N "
                     "F/A-18 Squadrons and has been transferred to Program Element "
                     "0604014N F/A-18 Infrared Search and Track."}]
    edges = extract_stated_edges(narr)
    assert len(edges) == 1
    assert (edges[0].from_pe_bli, edges[0].to_pe_bli) == ("0204136N", "0604014N")
    assert edges[0].relation == "realigned"


def test_single_direction_still_pairs_with_this():
    """Regression: a first-person single-direction sentence keeps today's
    behavior — the narrative's own PE supplies the unnamed endpoint."""
    narr = [{"pe_bli": "0605216A", "fiscal_year": 2026, "fact_id": "f11", "page": 2,
             "body": "FY 2026 funding and beyond, this project was realigned to "
                     "PE 0604818A / Army Tactical Command & Control Hardware & "
                     "Software, Projects EJ6 and EK9."}]
    edges = extract_stated_edges(narr)
    assert [(e.from_pe_bli, e.to_pe_bli) for e in edges] == [("0605216A", "0604818A")]


# ===========================================================================
# Multi-edition behaviour (#29(b), 2026-08-27)
# ===========================================================================


def _n(pe, fy, fid, body):
    return {"pe_bli": pe, "fiscal_year": fy, "fact_id": fid, "page": None,
            "body": body}


def test_the_same_link_narrated_by_two_editions_mints_once():
    """The live shape this collapses: PB2020 "In 2020, QRF funding … will be
    transferred to PE 0603699D8Z" and PB2021 "In FY 2020, QRF funds
    transferred to PE 0603699D8Z" are ONE FY2020 transfer. Keying on the
    edition year shipped the rail two identical entries."""
    narr = [
        _n("0603826D8Z", 2021, "f21",
           "In FY 2020, QRF funds transferred to PE 0603699D8Z Emerging"
           " Capabilities Technology Development."),
        _n("0603826D8Z", 2020, "f20",
           "In 2020, QRF funding to support prototyping will be transferred"
           " to PE 0603699D8Z Emerging Capabilities Technology Development."),
    ]
    edges = extract_stated_edges(narr)
    assert len(edges) == 1
    # Latest edition first is the caller contract; the newest telling wins.
    assert edges[0].fiscal_year == 2021 and edges[0].evidence_fact_id == "f21"


def test_one_pair_never_ships_two_relation_labels():
    """0605140D8Z → 0604294D8Z is 'realigned' by one PB2018 sentence and
    'renamed' by another. One move, so one rail entry."""
    narr = [
        _n("0604294D8Z", 2018, "fa",
           "FY18 funds in the amount of $84.200M are being transferred from"
           " PE 0605140D8Z for the Verification and Validation activities."),
        _n("0604294D8Z", 2018, "fb",
           "This project was previously funded in PE 0605140D8Z BA 5 and has"
           " been transferred to this BA 4 PE."),
    ]
    edges = extract_stated_edges(narr)
    pairs = [(e.from_pe_bli, e.to_pe_bli) for e in edges]
    assert pairs.count(("0605140D8Z", "0604294D8Z")) == 1


def test_supersession_drops_a_link_a_later_edition_mirrors():
    narr = [
        _n("0601102E", 2024, "f24",
           "Funding was realigned to PE 0601101E to restore the original line."),
        _n("0601101E", 2019, "f19",
           "Funding was realigned to PE 0601102E for the follow-on effort."),
    ]
    edges = extract_stated_edges(narr)
    kept, dropped = drop_superseded(edges, narr)
    assert {(e.from_pe_bli, e.to_pe_bli) for e, _ in dropped} == {
        ("0601101E", "0601102E")}
    assert all("mirror link" in r for _, r in dropped)
    assert [(e.from_pe_bli, e.to_pe_bli) for e in kept] == [
        ("0601102E", "0601101E")]


def test_supersession_drops_a_link_a_later_edition_retracts():
    narr = [
        _n("0601102E", 2022, "f22",
           "Funds moved from PE 0601101E to PE 0601102E were transferred in"
           " error and will be returned."),
        _n("0601101E", 2019, "f19",
           "Funding was realigned to PE 0601102E for the follow-on effort."),
    ]
    edges = extract_stated_edges(narr)
    kept, dropped = drop_superseded(edges, narr)
    assert [(e.from_pe_bli, e.to_pe_bli) for e, _ in dropped] == [
        ("0601101E", "0601102E")]
    assert kept == []


def test_supersession_ignores_silence_and_earlier_retractions():
    """Absence is not contradiction, and an EARLIER book cannot take back a
    LATER statement."""
    narr = [
        _n("0601102E", 2026, "f26",
           "This program element continues prior-year work."),
        _n("0601101E", 2024, "f24",
           "Funding was realigned to PE 0601102E for the follow-on effort."),
        _n("0601102E", 2019, "f19",
           "An earlier move from PE 0601101E to PE 0601102E was made in error."),
    ]
    edges = extract_stated_edges(narr)
    kept, dropped = drop_superseded(edges, narr)
    assert dropped == []
    assert [(e.from_pe_bli, e.to_pe_bli) for e in kept] == [
        ("0601101E", "0601102E")]


def test_supersession_never_touches_an_inferred_edge():
    """Inferred edges carry no citation and are governed by their own tier —
    a narrative cue must not reach into them."""
    e = LineageEdge(from_pe_bli="0601101E", to_pe_bli="0601102E",
                    fiscal_year=2019, relation="matured_ba",
                    confidence="inferred", inference_basis="ba_maturation")
    narr = [_n("0601102E", 2022, "f22",
               "Funds from PE 0601101E to PE 0601102E were transferred in error.")]
    kept, dropped = drop_superseded([e], narr)
    assert dropped == [] and kept == [e]
