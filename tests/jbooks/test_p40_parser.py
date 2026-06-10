from decimal import Decimal
from pathlib import Path

from govbudget.jbooks.p40_parser import parse_p40_xml

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "cbdp_fy2026_excerpt.xml"


def test_parses_line_items_with_golden_values():
    items = parse_p40_xml(FIXTURE)
    assert len(items) == 2
    li = [x for x in items if x.number == "7001SA1000"][0]
    assert li.title == "Chemical Biological Situational Awareness"
    assert li.p1_line_number == "120"
    assert li.appropriation_number == "0300D"
    assert li.budget_activity == "3"
    assert li.budget_subactivity == "1"
    assert li.budget_year == 2026
    funding = {f.scenario: f.amount_millions for f in li.funding}
    assert funding["PriorYear"] == Decimal("148.64")
    assert funding["CurrentYear"] == Decimal("186.841")
    assert funding["BudgetYearOne"] == Decimal("208.051")
    assert li.description and li.justification
    assert li.xml_path.startswith("LineItem[")


def test_parse_is_deterministic():
    a = [(x.xml_path, x.number) for x in parse_p40_xml(FIXTURE)]
    b = [(x.xml_path, x.number) for x in parse_p40_xml(FIXTURE)]
    assert a == b
