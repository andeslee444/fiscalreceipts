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

def test_no_edge_when_predecessor_lacks_prior_year_baseline():
    # successor rises in 2025 but predecessor only appears in 2025 -> no prior-year taper baseline
    series = [
        {"pe_bli": "0603ABC", "title": "Widget Science", "fy": 2025, "kind": "request", "amount": 100.0},
        {"pe_bli": "0604ABC", "title": "Widget Science", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    assert infer_edges(series) == []

def test_no_edge_for_non_rdte_codes_even_with_taper():
    # procurement/O&M line numbers are not RDT&E PEs; _ba_digit must reject them
    series = [
        {"pe_bli": "6670", "title": "Widget System", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "6670", "title": "Widget System", "fy": 2025, "kind": "request", "amount": 5.0},
        {"pe_bli": "0981", "title": "Widget System", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    assert infer_edges(series) == []

def test_no_edge_across_different_agency_suffix():
    # same title, adjacent BA, taper, but different service (F vs N) -> coincidence, not a maturation
    series = [
        {"pe_bli": "0602602F", "title": "Shared Title", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "0602602F", "title": "Shared Title", "fy": 2025, "kind": "request", "amount": 5.0},
        {"pe_bli": "0603602N", "title": "Shared Title", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    assert infer_edges(series) == []

def test_ba_maturation_requires_same_agency_suffix_positive():
    # same agency suffix (N), adjacent BA, same title, taper -> one inferred edge
    series = [
        {"pe_bli": "0603654N", "title": "Ordnance Dev", "fy": 2024, "kind": "request", "amount": 30.0},
        {"pe_bli": "0603654N", "title": "Ordnance Dev", "fy": 2025, "kind": "request", "amount": 5.0},
        {"pe_bli": "0604654N", "title": "Ordnance Dev", "fy": 2025, "kind": "request", "amount": 40.0},
    ]
    e = infer_edges(series)
    assert len(e) == 1 and e[0].from_pe_bli == "0603654N" and e[0].to_pe_bli == "0604654N"
