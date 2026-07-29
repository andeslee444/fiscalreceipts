"""Task 6 — per-program `lineage` sidecar (rail + family funding line).

`_emit_lineage` is a PURE function: given the lineage edges, the family map, the
page universe (all_pe_blis / rollup_pes), titles, decade-series request grains and
the cited-fact-id set, it returns {pe_bli: lineage_block}. Testing it directly (no
DB, no exporter) pins the honesty contracts the gate review demanded:

  * a STATED rail entry carries a resolving evidence.fact_id;
  * an INFERRED rail entry is confidence=='inferred' with evidence is None
    (inferred edges are NEVER cited);
  * the family funding_line sums ONLY the one_to_one_chain members
    (a non-chain family member's request amount is excluded);
  * a rail entry whose `pe` is outside the page universe has resolved==False
    (never a clean link to a nonexistent page);
  * has_split is True for a family that fans out, False for a clean 1:1 chain.
"""
from __future__ import annotations

from govbudget.export_site import _emit_lineage
from govbudget.lineage.model import LineageEdge


def _series(*points):
    """decade_series_by_pe-style 'request' entries: (fy, v, fid) tuples."""
    return {"request": [{"fy": fy, "v": v, "fid": fid, "edition": fy} for fy, v, fid in points]}


def _emit(edges, families, *, all_pe_blis, rollup_pes, titles, series, cited):
    return _emit_lineage(
        edges=edges,
        families=families,
        all_pe_blis=set(all_pe_blis),
        rollup_pes=set(rollup_pes),
        titles_by_pe=titles,
        decade_series_by_pe=series,
        cited_fact_ids=set(cited),
    )


# --------------------------------------------------------------------------- #
# A clean 1:1 chain: PRED -> MID -> SUCC, plus an inferred MID -> INFSUCC edge,
# plus a dangling stated successor SUCC -> DANGLE where DANGLE has no page.
# --------------------------------------------------------------------------- #

def _chain_edges():
    return [
        # stated 1:1 chain
        LineageEdge("PRED", "MID", 2024, "realigned", "stated",
                    evidence_fact_id="factPRED", evidence_page=10,
                    evidence_sentence="PRED realigned into MID."),
        LineageEdge("MID", "SUCC", 2025, "realigned", "stated",
                    evidence_fact_id="factMID", evidence_page=11,
                    evidence_sentence="MID realigned into SUCC."),
        # dangling successor — DANGLE is NOT in the page universe
        LineageEdge("SUCC", "DANGLE", 2026, "realigned", "stated",
                    evidence_fact_id="factSUCC", evidence_page=12,
                    evidence_sentence="SUCC realigned into DANGLE."),
        # inferred edge off MID — must never be cited
        LineageEdge("MID", "INFSUCC", 2026, "matured_ba", "inferred",
                    inference_basis="ba_maturation_same_title"),
    ]


def _chain_fixture():
    edges = _chain_edges()
    # family 7 = {PRED, MID, SUCC, DANGLE}; NONCHAIN is a separate family (99).
    families = {"PRED": 7, "MID": 7, "SUCC": 7, "DANGLE": 7, "NONCHAIN": 99}
    all_pe_blis = {"PRED", "MID", "SUCC", "NONCHAIN"}  # DANGLE + INFSUCC absent
    rollup_pes: set[str] = set()
    titles = {"PRED": "Predecessor", "MID": "Middle", "SUCC": "Successor",
              "DANGLE": "Dangling", "NONCHAIN": "Not in chain", "INFSUCC": "Inferred succ"}
    # request trajectory: PRED tapers, MID rises then tapers, SUCC rises.
    series = {
        "PRED": _series((2023, 100.0, "fidPRED2023"), (2024, 50.0, "fidPRED2024")),
        "MID": _series((2024, 40.0, "fidMID2024"), (2025, 60.0, "fidMID2025")),
        "SUCC": _series((2025, 30.0, "fidSUCC2025"), (2026, 90.0, "fidSUCC2026")),
        # NONCHAIN is in family 99, must NOT contribute to family 7's funding_line
        "NONCHAIN": _series((2025, 999.0, "fidNON2025")),
    }
    cited = {"factPRED", "factMID", "factSUCC",
             "fidPRED2023", "fidPRED2024", "fidMID2024", "fidMID2025",
             "fidSUCC2025", "fidSUCC2026", "fidNON2025"}
    return _emit(edges, families, all_pe_blis=all_pe_blis, rollup_pes=rollup_pes,
                 titles=titles, series=series, cited=cited)


def test_stated_rail_entry_carries_resolving_evidence_fact_id():
    by_pe = _chain_fixture()
    # MID has a predecessor PRED (stated). That rail entry must cite factPRED.
    preds = by_pe["MID"]["rail"]["predecessors"]
    pred = next(p for p in preds if p["pe"] == "PRED")
    assert pred["confidence"] == "stated"
    assert pred["evidence"] is not None
    assert pred["evidence"]["fact_id"] == "factPRED"       # resolving cite
    assert pred["evidence"]["page"] == 10
    assert pred["title"] == "Predecessor"


def test_inferred_rail_entry_has_no_evidence():
    by_pe = _chain_fixture()
    # MID -> INFSUCC is inferred; on MID it is a successor.
    succs = by_pe["MID"]["rail"]["successors"]
    inf = next(s for s in succs if s["pe"] == "INFSUCC")
    assert inf["confidence"] == "inferred"
    assert inf["evidence"] is None                          # inferred is NEVER cited


def test_funding_line_emits_per_member_cited_points():
    """Defect 2 (2026-07-28): the funding line NEVER sums — it emits one entry
    per (fy, chain member) with a request fact, each carrying EXACTLY that
    member's fact value and fid. An fy where two chain members coexist yields
    TWO labeled entries (the reader sees the handoff), never a single summed
    number whose citation backs only one member."""
    by_pe = _chain_fixture()
    fam = by_pe["PRED"]["family"]
    # Root is PRED (stated in-degree 0). one_to_one_chain walks every clean 1:1
    # stated hop: PRED -> MID -> SUCC -> DANGLE. DANGLE has no request series,
    # so it contributes no points — but it IS a chain member per the evidence.
    assert fam["chain"] == ["PRED", "MID", "SUCC", "DANGLE"]
    # One entry PER member per fy — the overlap fys carry BOTH members' points.
    assert [(p["fy"], p["pe"], p["v"], p["fid"]) for p in fam["funding_line"]] == [
        (2023, "PRED", 100.0, "fidPRED2023"),
        (2024, "PRED", 50.0, "fidPRED2024"),
        (2024, "MID", 40.0, "fidMID2024"),
        (2025, "MID", 60.0, "fidMID2025"),
        (2025, "SUCC", 30.0, "fidSUCC2025"),
        (2026, "SUCC", 90.0, "fidSUCC2026"),
    ]
    # No summed value appears within any overlap fy: the old defect emitted a
    # single {fy, v: sum} point, so an overlap fy must never carry an entry
    # whose v is the cross-member sum instead of a member's own fact value.
    from collections import defaultdict
    by_fy = defaultdict(list)
    for p in fam["funding_line"]:
        by_fy[p["fy"]].append(p["v"])
    assert sorted(by_fy[2024]) == [40.0, 50.0]     # never [90.0]
    assert sorted(by_fy[2025]) == [30.0, 60.0]     # never [90.0]
    # NONCHAIN (family 99) must NOT leak into family 7's funding line.
    assert 999.0 not in {p["v"] for p in fam["funding_line"]}


def test_no_funding_point_value_differs_from_its_cited_fact():
    """Every emitted point's v equals ITS OWN cited fact's value — the exporter
    can never display a number the citation does not back (Defect 2 teeth)."""
    by_pe = _chain_fixture()
    # Rebuild the fact table the fixture seeded: fid -> (pe, fy, v).
    facts = {}
    series = {
        "PRED": [(2023, 100.0, "fidPRED2023"), (2024, 50.0, "fidPRED2024")],
        "MID": [(2024, 40.0, "fidMID2024"), (2025, 60.0, "fidMID2025")],
        "SUCC": [(2025, 30.0, "fidSUCC2025"), (2026, 90.0, "fidSUCC2026")],
        "NONCHAIN": [(2025, 999.0, "fidNON2025")],
    }
    for pe, pts in series.items():
        for fy, v, fid in pts:
            facts[fid] = (pe, fy, v)
    for p in by_pe["PRED"]["family"]["funding_line"]:
        pe, fy, v = facts[p["fid"]]
        assert p["pe"] == pe and p["fy"] == fy and p["v"] == v


def test_family_carries_chain_head_title():
    # The family payload labels its funding line with the chain HEAD's title so
    # the /years/-linked summary is self-describing, not a bare-id reference.
    by_pe = _chain_fixture()
    fam = by_pe["PRED"]["family"]
    # chain head is PRED (root); its title comes from titles_by_pe.
    assert fam["chain"][0] == "PRED"
    assert fam["chain_head_title"] == "Predecessor"


def test_chain_head_title_none_when_head_untitled():
    # Head with no title in titles_by_pe → chain_head_title None (renderer
    # falls back to the bare id). Family root here is untitled.
    edges = [
        LineageEdge("H", "T", 2025, "realigned", "stated",
                    evidence_fact_id="fHT", evidence_page=1),
    ]
    families = {"H": 2, "T": 2}
    by_pe = _emit(edges, families, all_pe_blis={"H", "T"}, rollup_pes=set(),
                  titles={"T": "Tail only"}, series={}, cited={"fHT"})  # H untitled
    fam = by_pe["H"]["family"]
    assert fam["chain"][0] == "H"
    assert fam["chain_head_title"] is None


def test_out_of_universe_successor_is_unresolved():
    by_pe = _chain_fixture()
    # SUCC -> DANGLE; DANGLE has no page → resolved must be False.
    succs = by_pe["SUCC"]["rail"]["successors"]
    dangle = next(s for s in succs if s["pe"] == "DANGLE")
    assert dangle["resolved"] is False
    # a resolvable one (MID's predecessor PRED is in the universe) is True
    pred = by_pe["MID"]["rail"]["predecessors"][0]
    assert pred["resolved"] is True


def test_has_split_false_for_clean_chain():
    by_pe = _chain_fixture()
    # Family 7's stated edges: PRED->MID, MID->SUCC, SUCC->DANGLE — no node has
    # stated out-degree > 1, no split/merge relation → has_split False.
    assert by_pe["PRED"]["family"]["has_split"] is False


def test_has_split_true_for_fan_out_family():
    # ROOT fans out to two successors (stated out-degree 2) → has_split True.
    edges = [
        LineageEdge("ROOT", "A", 2025, "realigned", "stated",
                    evidence_fact_id="fRA", evidence_page=1),
        LineageEdge("ROOT", "B", 2025, "split", "stated",
                    evidence_fact_id="fRB", evidence_page=2),
    ]
    families = {"ROOT": 3, "A": 3, "B": 3}
    all_pe_blis = {"ROOT", "A", "B"}
    titles = {"ROOT": "Root", "A": "A", "B": "B"}
    series = {"ROOT": _series((2025, 10.0, "fidR"))}
    cited = {"fRA", "fRB", "fidR"}
    by_pe = _emit(edges, families, all_pe_blis=all_pe_blis, rollup_pes=set(),
                  titles=titles, series=series, cited=cited)
    assert by_pe["ROOT"]["family"]["has_split"] is True


def test_stated_edge_with_uncited_fact_id_raises():
    """A stated edge whose evidence_fact_id is NOT in the cite universe is a
    build-breaking contract violation (2026-07-28): with the narrative fence
    aligned end-to-end (CITED_NARRATIVE_FY) this is unreachable, so it must be
    LOUD — the export fails — never a silent print-and-null degrade that ships
    a stated edge without its citation."""
    import pytest

    edges = [
        LineageEdge("X", "Y", 2025, "realigned", "stated",
                    evidence_fact_id="ghost", evidence_page=5,
                    evidence_sentence="X to Y."),
    ]
    families = {"X": 1, "Y": 1}
    with pytest.raises(ValueError, match="ghost"):
        _emit(edges, families, all_pe_blis={"X", "Y"}, rollup_pes=set(),
              titles={"X": "X", "Y": "Y"}, series={}, cited=set())  # ghost uncited


def test_cyclic_family_falls_back_to_lexicographically_smallest_root():
    # A 2-cycle: M -> N and N -> M (no in-degree-0 member). Root = min("M","N") = "M".
    edges = [
        LineageEdge("M", "N", 2025, "realigned", "stated",
                    evidence_fact_id="fMN", evidence_page=1),
        LineageEdge("N", "M", 2026, "realigned", "stated",
                    evidence_fact_id="fNM", evidence_page=2),
    ]
    families = {"M": 4, "N": 4}
    by_pe = _emit(edges, families, all_pe_blis={"M", "N"}, rollup_pes=set(),
                  titles={"M": "M", "N": "N"}, series={}, cited={"fMN", "fNM"})
    # chain starts at the lexicographically smallest member under a cycle.
    assert by_pe["M"]["family"]["chain"][0] == "M"
