"""Parser for procurement (P-40) records in the DoD comptroller jb schema.

Element names verified live against the FY2026 CBDP procurement MJB.
Namespace-agnostic local-name matching, same convention as xml_parser.py.

FUNDING MEASURE: ResourceSummary/TotalObligationAuthority. This module used
to read ResourceSummary/NetProcurementP1 on the recorded premise that it is
"the measure that reconciles against the P-1 display". For most appropriations
the two elements are byte-identical, so the premise looked right; for
shipbuilding it is not, and there the difference is the whole program.

NetProcurementP1 is the P-40's *net procurement* subtotal — full funding after
backing out advance procurement, outfitting and post-delivery, and
cost-to-complete. TotalObligationAuthority is the P-1 exhibit's own basis
(TOA), which is what the P-1 line-item row actually sums and what this site
publishes as its canonical basis.

Measured over every procurement master on disk, PB2017–PB2026, 6,695 scenario
values (2026-08-29): 201 values differ between the two elements (3.0%), of
which 171 are PB2026 and 79 are the Navy shipbuilding book alone. No line item
in any edition carries NetProcurementP1 without TotalObligationAuthority, and
NOT ONE of the 32 FY2026 procurement books reconciles better on
NetProcurementP1 — TOA ties the P-1 control on 2,891 of 3,030 checks against
NetProcurementP1's 2,793. The shipbuilding book is the extreme case: 59 of 79
against 23 of 79. Virginia Class FY2024 is $10,656.927M of TOA and
$7,129.965M of net procurement; the P-1 says $10,656.927M.

The fallback below is defensive only (no line on disk needs it) and is never
a per-scenario mix: a line item is read on ONE measure, so its scenarios stay
mutually comparable.
"""
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from govbudget.jbooks.xml_parser import FundingLine, _child, _local, _parse_funding, _text


@dataclass
class ProcurementLineRecord:
    number: str
    title: str | None
    p1_line_number: str | None
    appropriation_number: str | None
    appropriation_title: str | None
    budget_activity: str | None
    budget_subactivity: str | None
    service_agency: str | None
    budget_year: int | None
    description: str | None
    justification: str | None
    funding: list[FundingLine] = field(default_factory=list)
    xml_path: str = ""


def parse_p40_xml(path: Path) -> list[ProcurementLineRecord]:
    root = ET.parse(path).getroot()
    items: list[ProcurementLineRecord] = []
    idx = 0
    for el in root.iter():
        if _local(el.tag) != "LineItem":
            continue
        number = _text(el, "LineItemNumber")
        if not number:
            continue
        by = _text(el, "BudgetYear")
        try:
            budget_year = int(by) if by else None
        except ValueError:
            budget_year = None
        rs = _child(el, "ResourceSummary")
        toa = _child(rs, "TotalObligationAuthority") if rs is not None else None
        funding = _parse_funding(toa)
        if not funding:
            # No TOA element (or an empty one): fall back to the P-40's net
            # procurement subtotal rather than dropping the line's money.
            funding = _parse_funding(
                _child(rs, "NetProcurementP1") if rs is not None else None
            )
        items.append(
            ProcurementLineRecord(
                number=number,
                title=_text(el, "LineItemTitle"),
                p1_line_number=_text(el, "P1LineNumber"),
                appropriation_number=_text(el, "AppropriationNumber"),
                appropriation_title=_text(el, "AppropriationTitle"),
                budget_activity=_text(el, "BudgetActivityNumber"),
                budget_subactivity=_text(el, "BudgetSubActivityNumber"),
                service_agency=_text(el, "ServiceAgencyName"),
                budget_year=budget_year,
                description=_text(el, "Description"),
                justification=_text(el, "Justification"),
                funding=funding,
                xml_path=f"LineItem[{idx}]",
            )
        )
        idx += 1
    return items
