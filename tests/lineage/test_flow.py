"""Unit tests for the /lineage/ diagram payload builder (ROADMAP #29(c)).

The property under test is a REFUSAL, so most of these assert that something
does NOT happen: no ribbon is wider than any other, no node is taller than any
other, and an edge that suddenly carries a stated amount stops the build rather
than being drawn as if it carried none.
"""

import pytest

from govbudget.lineage.flow import (
    NODE_H,
    RIBBON_W,
    _assign_steps,
    build_lineage_flow,
)
from govbudget.lineage.model import LineageEdge


def _e(a, b, conf="stated", rel="renamed", fy=2026, fid="f" * 16, amt=None):
    return LineageEdge(
        from_pe_bli=a,
        to_pe_bli=b,
        fiscal_year=fy,
        relation=rel,
        confidence=conf,
        evidence_fact_id=fid if conf == "stated" else None,
        portion_amount=amt,
    )


def _build(edges, families, **kw):
    return build_lineage_flow(
        edges=edges,
        families=families,
        titles_by_pe=kw.get("titles", {}),
        page_pes=kw.get("pages", set()),
        decade_series_by_pe=kw.get("series", {}),
        cited_fact_ids=kw.get("cited", set()),
    )


def _all_bands(payload):
    for d in payload["families"] + payload["candidates"]:
        for e in d["edges"]:
            yield e["g"]


# ── The refusal ─────────────────────────────────────────────────────────────


def test_every_ribbon_is_the_same_width_on_both_faces():
    edges = [_e("A", "B"), _e("B", "C"), _e("A", "C"), _e("X", "Y")]
    p = _build(edges, {"A": 1, "B": 1, "C": 1, "X": 2, "Y": 2})
    bands = list(_all_bands(p))
    assert len(bands) == 4
    for sy0, sy1, ty0, ty1 in bands:
        assert sy1 - sy0 == pytest.approx(RIBBON_W, abs=0.011)
        assert ty1 - ty0 == pytest.approx(RIBBON_W, abs=0.011)


def test_every_identity_box_is_the_same_size():
    """A Sankey node's height is normally a value. None of these is."""
    edges = [_e("A", "B"), _e("B", "C"), _e("B", "D"), _e("E", "B")]
    p = _build(edges, {k: 1 for k in "ABCDE"})
    sizes = {
        (round(n["x1"] - n["x0"], 2), round(n["y1"] - n["y0"], 2))
        for d in p["families"]
        for n in d["nodes"]
    }
    assert len(sizes) == 1


def test_a_stated_portion_amount_stops_the_build():
    """The day a document states an amount, the diagram must be REDESIGNED.

    Silently drawing it at the same constant width would publish "no amount was
    stated" about an edge that states one.
    """
    edges = [_e("A", "B", amt=1234.0)]
    with pytest.raises(ValueError, match="portion_amount"):
        _build(edges, {"A": 1, "B": 1})


def test_bands_that_cannot_fit_a_node_face_raise_rather_than_overflow():
    fan_in = int(NODE_H // RIBBON_W) + 1
    edges = [_e(f"S{i}", "T") for i in range(fan_in)]
    fams = {"T": 1, **{f"S{i}": 1 for i in range(fan_in)}}
    with pytest.raises(ValueError, match="exceeds the"):
        _build(edges, fams)


# ── Layout ──────────────────────────────────────────────────────────────────


def test_a_fan_in_lands_right_of_every_source():
    """Longest-path depth, not first-seen depth: family 6's four-way merge."""
    edges = [_e("A", "M"), _e("B", "M"), _e("C", "M"), _e("A", "B")]
    step, cyclic = _assign_steps(["A", "B", "C", "M"], edges)
    assert not cyclic
    assert step["M"] > max(step["A"], step["B"], step["C"])
    assert step["B"] == step["A"] + 1


def test_a_cycle_is_parked_and_flagged_rather_than_hanging():
    edges = [_e("A", "B"), _e("B", "A")]
    step, cyclic = _assign_steps(["A", "B"], edges)
    assert cyclic
    assert set(step) == {"A", "B"}
    p = _build(edges, {"A": 1, "B": 1})
    assert p["families"][0]["cyclic"] is True


def test_inferred_edges_are_never_drawn_inside_a_family():
    edges = [_e("A", "B"), _e("A", "C", conf="inferred", rel="matured_ba")]
    p = _build(edges, {"A": 1, "B": 1})
    fam_edges = [e for d in p["families"] for e in d["edges"]]
    assert [e["confidence"] for e in fam_edges] == ["stated"]
    assert len(p["candidates"]) == 1
    assert p["candidates"][0]["edges"][0]["confidence"] == "inferred"
    assert p["candidates"][0]["edges"][0]["fid"] is None


def test_stated_edges_carry_their_evidence_fact_id():
    p = _build([_e("A", "B", fid="abc123abc123abc1")], {"A": 1, "B": 1})
    assert p["families"][0]["edges"][0]["fid"] == "abc123abc123abc1"


# ── Resolution + the one money column ───────────────────────────────────────


def test_an_identity_with_no_page_is_marked_unresolved():
    p = _build([_e("A", "B")], {"A": 1, "B": 1}, pages={"A"})
    by_pe = {n["pe"]: n for n in p["families"][0]["nodes"]}
    assert by_pe["A"]["resolved"] is True
    assert by_pe["B"]["resolved"] is False
    assert p["counts"]["identities_unresolved"] == 1


def test_only_cited_fy2026_request_points_become_the_money_column():
    series = {
        "A": {
            "request": [
                {"fy": 2025, "v": 1.0, "fid": "old", "edition": 2025,
                 "basis": "toa", "measure": "request"},
                {"fy": 2026, "v": 9.0, "fid": "good", "edition": 2026,
                 "basis": "toa", "measure": "request"},
            ]
        },
        "B": {
            "request": [
                # uncited → dropped rather than shipped bare
                {"fy": 2026, "v": 4.0, "fid": "missing", "edition": 2026,
                 "basis": "toa", "measure": "request"},
            ]
        },
    }
    p = _build([_e("A", "B")], {"A": 1, "B": 1}, series=series, cited={"good", "old"})
    by_pe = {n["pe"]: n for n in p["families"][0]["nodes"]}
    assert by_pe["A"]["amount"]["fid"] == "good"
    assert by_pe["A"]["amount"]["v"] == 9.0
    assert by_pe["B"]["amount"] is None
    assert p["counts"]["identities_with_amount"] == 1


def test_a_diverging_measure_is_omitted_not_relabelled():
    """A grain rendered under a different label cannot sit in a column that
    declares measure=request — the (fy, measure) group gate 23 leg e joins on."""
    series = {
        "A": {
            "request": [
                {"fy": 2026, "v": 3.0, "fid": "x", "edition": 2026,
                 "basis": "toa", "measure": "enacted-request"},
            ]
        }
    }
    p = _build([_e("A", "B")], {"A": 1, "B": 1}, series=series, cited={"x"})
    by_pe = {n["pe"]: n for n in p["families"][0]["nodes"]}
    assert by_pe["A"]["amount"] is None
