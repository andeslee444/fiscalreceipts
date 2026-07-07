from govbudget.lineage.family import build_families, one_to_one_chain
from govbudget.lineage.model import LineageEdge

def _e(a, b, conf="stated", rel="renamed"):
    return LineageEdge(from_pe_bli=a, to_pe_bli=b, fiscal_year=2024, relation=rel, confidence=conf)

def test_families_are_connected_components_over_stated_edges_only():
    edges = [_e("A", "B"), _e("B", "C"), _e("X", "Y"),
             _e("C", "Q", conf="inferred")]  # inferred must NOT merge families
    fams = build_families(edges)             # {pe_bli: family_id}
    assert fams["A"] == fams["B"] == fams["C"]
    assert fams["X"] == fams["Y"] != fams["A"]
    assert "Q" not in fams                    # inferred edge did not create a family

def test_one_to_one_chain_excludes_splits_and_merges():
    # A->B is 1:1; B splits to C and D  => chain is [A, B], stops at the split.
    edges = [_e("A", "B"), _e("B", "C", rel="split"), _e("B", "D", rel="split")]
    assert one_to_one_chain("A", edges) == ["A", "B"]
