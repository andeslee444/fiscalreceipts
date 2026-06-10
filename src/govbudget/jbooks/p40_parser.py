"""Parser for procurement (P-40) records in the DoD comptroller jb schema.

Element names verified live against the FY2026 CBDP procurement MJB.
Funding uses ResourceSummary/NetProcurementP1 — the measure that
reconciles against the P-1 display. Namespace-agnostic local-name matching,
same convention as xml_parser.py.
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
        net = _child(rs, "NetProcurementP1") if rs is not None else None
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
                funding=_parse_funding(net),
                xml_path=f"LineItem[{idx}]",
            )
        )
        idx += 1
    return items
