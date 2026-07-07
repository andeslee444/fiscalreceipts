from govbudget.lineage.infer import infer_edges

def test_ba_maturation_same_title_hands_off_funding():
    # 0603ABC (BA3) title matches 0604ABC (BA4); 0603 request tapers as 0604 rises.
    series = [
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2025, "kind": "request", "amount": 5.0},
        {"pe_bli": "0604ABC", "title": "Widget Science", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    edges = infer_edges(series)
    e = [x for x in edges if x.from_pe_bli == "0603ABC" and x.to_pe_bli == "0604ABC"]
    assert e and e[0].confidence == "inferred" and e[0].relation == "matured_ba"
    assert e[0].inference_basis == "ba_maturation_same_title"
    assert e[0].evidence_fact_id is None  # inferred edges are never cited

def test_no_edge_when_titles_differ():
    series = [
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "0604XYZ", "title": "Unrelated Gadget", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    assert infer_edges(series) == []
