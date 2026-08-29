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


# --------------------------------------------------------------------------
# The funding MEASURE. The CBDP excerpt above carries identical
# NetProcurementP1 and TotalObligationAuthority blocks, so its golden values
# cannot tell which element the parser read — which is exactly how the
# NetProcurementP1 premise survived. These two cases discriminate.
# --------------------------------------------------------------------------

_JB = "http://www.dtic.mil/comptroller/xml/schema/022009/jb"
_PROC = "http://www.dtic.mil/comptroller/xml/schema/20100219/procurement"


def _shipbuilding_xml(*, with_toa: bool) -> str:
    """A shipbuilding-shaped LineItem: net procurement backs out advance
    procurement and outfitting, so TOA and NetProcurementP1 differ.

    Values are Virginia Class (P-1 line 2013) from the FY2026 SCN master; the
    P-1 display sums to the TOA figures.
    """
    toa = (
        """      <ns1:TotalObligationAuthority>
        <ns1:PriorYear>10656.927</ns1:PriorYear>
        <ns1:CurrentYear>13320.211</ns1:CurrentYear>
        <ns1:BudgetYearOne>4453.936</ns1:BudgetYearOne>
      </ns1:TotalObligationAuthority>
"""
        if with_toa
        else ""
    )
    return f"""<?xml version='1.0' encoding='utf-8'?>
<ns0:MasterJustificationBook xmlns:ns0="{_JB}" xmlns:ns1="{_PROC}">
  <ns1:LineItem>
    <ns1:LineItemNumber>2013</ns1:LineItemNumber>
    <ns1:LineItemTitle>Virginia Class Submarine</ns1:LineItemTitle>
    <ns1:AppropriationNumber>1611N</ns1:AppropriationNumber>
    <ns1:BudgetYear>2026</ns1:BudgetYear>
    <ns1:ResourceSummary>
{toa}      <ns1:NetProcurementP1>
        <ns1:PriorYear>7129.965</ns1:PriorYear>
        <ns1:CurrentYear>7356.904</ns1:CurrentYear>
        <ns1:BudgetYearOne>816.705</ns1:BudgetYearOne>
      </ns1:NetProcurementP1>
    </ns1:ResourceSummary>
  </ns1:LineItem>
</ns0:MasterJustificationBook>
"""


def test_funding_is_total_obligation_authority_not_net_procurement(tmp_path):
    """TOA wins where the two measures disagree.

    Reading NetProcurementP1 published Virginia Class FY2024 as $7,129.965M
    against a P-1 line of $10,656.927M — a true number under a false label,
    and 79 of the shipbuilding book's 79 checked values are this shape.
    """
    p = tmp_path / "scn_excerpt.xml"
    p.write_text(_shipbuilding_xml(with_toa=True))
    (li,) = parse_p40_xml(p)
    funding = {f.scenario: f.amount_millions for f in li.funding}
    assert funding["PriorYear"] == Decimal("10656.927")
    assert funding["CurrentYear"] == Decimal("13320.211")
    assert funding["BudgetYearOne"] == Decimal("4453.936")
    # and specifically NOT the net-procurement subtotal
    assert Decimal("7129.965") not in set(funding.values())


def test_funding_falls_back_to_net_procurement_when_toa_absent(tmp_path):
    """No line on disk needs this, but a missing TOA must not drop the money."""
    p = tmp_path / "no_toa.xml"
    p.write_text(_shipbuilding_xml(with_toa=False))
    (li,) = parse_p40_xml(p)
    funding = {f.scenario: f.amount_millions for f in li.funding}
    assert funding["PriorYear"] == Decimal("7129.965")
    assert funding["BudgetYearOne"] == Decimal("816.705")
