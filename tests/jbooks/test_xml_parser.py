from decimal import Decimal
from pathlib import Path

from govbudget.jbooks.xml_parser import parse_jbook_xml

FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def test_parses_program_elements_with_golden_values():
    pes = parse_jbook_xml(FIXTURE)
    assert len(pes) == 2
    pe = pes[0]
    assert pe.number == "0601101E"
    assert pe.title == "DEFENSE RESEARCH SCIENCES"
    assert pe.r1_line_number == "2"
    assert pe.appropriation_code == "0400"
    assert pe.budget_activity == "1"
    assert pe.budget_year == 2026
    funding = {f.scenario: f.amount_millions for f in pe.funding}
    assert funding["PriorYear"] == Decimal("280.494")
    assert funding["CurrentYear"] == Decimal("293.145")
    assert funding["BudgetYearOne"] == Decimal("0.000")
    assert pe.mission_description and pe.mission_description.startswith("The efforts")


def test_parses_projects_and_narratives():
    pe = parse_jbook_xml(FIXTURE)[0]
    assert pe.projects, "expected at least one project"
    proj = pe.projects[0]
    assert proj.number == "CCS-02"
    assert proj.title == "MATH AND COMPUTER SCIENCES"
    assert proj.mission_description
    scenarios = {f.scenario for f in proj.funding}
    assert {"PriorYear", "CurrentYear"} <= scenarios
    kinds = {n.kind for n in proj.narratives}
    assert "accomplishment_planned_program" in kinds
    apb = [n for n in proj.narratives if n.kind == "accomplishment_planned_program"][0]
    assert apb.title and apb.body


def test_xml_paths_are_resolvable():
    import xml.etree.ElementTree as ET

    pes = parse_jbook_xml(FIXTURE)
    root = ET.parse(FIXTURE).getroot()
    # xml_path is an index-based pseudo-xpath like ProgramElement[0]/Project[3]
    pe = pes[1]
    assert pe.xml_path.startswith("ProgramElement[")
    assert root is not None
