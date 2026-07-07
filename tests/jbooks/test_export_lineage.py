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


def test_funding_line_sums_only_chain_members():
    by_pe = _chain_fixture()
    fam = by_pe["PRED"]["family"]
    # Root is PRED (stated in-degree 0). one_to_one_chain walks every clean 1:1
    # stated hop: PRED -> MID -> SUCC -> DANGLE (SUCC->DANGLE is itself 1:1, so
    # the reviewed helper legitimately extends to the dangling successor). DANGLE
    # has no request series, so it contributes nothing to the funding line — but
    # it IS a chain member per the stated evidence.
    assert fam["chain"] == ["PRED", "MID", "SUCC", "DANGLE"]
    fl = {p["fy"]: p["v"] for p in fam["funding_line"]}
    # Per-fy sums across chain members ONLY:
    assert fl[2023] == 100.0                       # PRED only
    assert fl[2024] == 50.0 + 40.0                 # PRED + MID overlap
    assert fl[2025] == 60.0 + 30.0                 # MID + SUCC overlap
    assert fl[2026] == 90.0                        # SUCC only
    # NONCHAIN (family 99) must NOT leak into family 7's funding line.
    assert 999.0 not in fl.values()
    # sorted by fy
    fys = [p["fy"] for p in fam["funding_line"]]
    assert fys == sorted(fys)
    # every point cites a resolving fid
    for p in fam["funding_line"]:
        assert p["fid"] is not None


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


def test_stated_evidence_nulled_when_fact_id_uncited():
    # Defensive: a stated edge whose evidence_fact_id is NOT in cited set must
    # ship evidence with fact_id None (no dead <Cite>), but still stated.
    edges = [
        LineageEdge("X", "Y", 2025, "realigned", "stated",
                    evidence_fact_id="ghost", evidence_page=5,
                    evidence_sentence="X to Y."),
    ]
    families = {"X": 1, "Y": 1}
    by_pe = _emit(edges, families, all_pe_blis={"X", "Y"}, rollup_pes=set(),
                  titles={"X": "X", "Y": "Y"}, series={}, cited=set())  # ghost uncited
    succ = by_pe["X"]["rail"]["successors"][0]
    assert succ["confidence"] == "stated"
    assert succ["evidence"]["fact_id"] is None        # nulled, not dropped
    assert succ["evidence"]["page"] == 5              # page/sentence still carried


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
