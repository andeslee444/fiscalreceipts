from govbudget.lineage.extract import extract_stated_edges
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
