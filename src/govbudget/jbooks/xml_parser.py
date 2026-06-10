"""Parser for the DoD comptroller J-book XML (jb schema, 02/2009 vintage).

Element names verified live against the FY2026 DARPA master justification
book. Namespace-agnostic: matches on local names so jb:/r2: prefix variants
across services parse identically.
"""
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

FUNDING_SCENARIOS = [
    "AllPriorYears", "PriorYear", "CurrentYear", "BudgetYearOne", "BudgetYearOneBase",
]


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _text(el: ET.Element, name: str) -> str | None:
    c = _child(el, name)
    if c is None or c.text is None:
        return None
    t = c.text.strip()
    return t or None


def _descendant(el: ET.Element, name: str) -> ET.Element | None:
    for c in el.iter():
        if _local(c.tag) == name:
            return c
    return None


@dataclass
class FundingLine:
    scenario: str
    amount_millions: Decimal


@dataclass
class NarrativeItem:
    kind: str
    title: str | None
    body: str
    xml_path: str


@dataclass
class ProjectRecord:
    number: str
    title: str | None
    mission_description: str | None
    funding: list[FundingLine] = field(default_factory=list)
    narratives: list[NarrativeItem] = field(default_factory=list)
    xml_path: str = ""


@dataclass
class ProgramElementRecord:
    number: str
    title: str | None
    r1_line_number: str | None
    appropriation_code: str | None
    appropriation_name: str | None
    budget_activity: str | None
    budget_activity_title: str | None
    service_agency: str | None
    budget_year: int | None
    mission_description: str | None
    funding: list[FundingLine] = field(default_factory=list)
    projects: list[ProjectRecord] = field(default_factory=list)
    xml_path: str = ""


def _parse_funding(container: ET.Element | None) -> list[FundingLine]:
    if container is None:
        return []
    lines: list[FundingLine] = []
    for c in container:
        name = _local(c.tag)
        if name in FUNDING_SCENARIOS and c.text:
            try:
                lines.append(FundingLine(name, Decimal(c.text.strip())))
            except InvalidOperation:
                continue
    return lines


def _parse_project(el: ET.Element, xml_path: str) -> ProjectRecord:
    r2a = _child(el, "R2aExhibit")
    mission = None
    narratives: list[NarrativeItem] = []
    if r2a is not None:
        m = _descendant(r2a, "ProjectMissionDescription")
        if m is not None and m.text:
            mission = m.text.strip()
        for i, app in enumerate(x for x in r2a.iter() if _local(x.tag) == "AccomplishmentPlannedProgram"):
            body = _text(app, "Description")
            if body:
                narratives.append(
                    NarrativeItem(
                        kind="accomplishment_planned_program",
                        title=_text(app, "Title"),
                        body=body,
                        xml_path=f"{xml_path}/AccomplishmentPlannedProgram[{i}]",
                    )
                )
    return ProjectRecord(
        number=_text(el, "ProjectNumber") or "",
        title=_text(el, "ProjectTitle"),
        mission_description=mission,
        funding=_parse_funding(_child(el, "ProjectFunding")),
        narratives=narratives,
        xml_path=xml_path,
    )


def parse_jbook_xml(path: Path) -> list[ProgramElementRecord]:
    root = ET.parse(path).getroot()
    pes: list[ProgramElementRecord] = []
    pe_idx = 0
    for el in root.iter():
        if _local(el.tag) != "ProgramElement":
            continue
        xml_path = f"ProgramElement[{pe_idx}]"
        by = _text(el, "BudgetYear")
        record = ProgramElementRecord(
            number=_text(el, "ProgramElementNumber") or "",
            title=_text(el, "ProgramElementTitle"),
            r1_line_number=_text(el, "R1LineNumber"),
            appropriation_code=_text(el, "AppropriationCode"),
            appropriation_name=_text(el, "AppropriationName"),
            budget_activity=_text(el, "BudgetActivityNumber"),
            budget_activity_title=_text(el, "BudgetActivityTitle"),
            service_agency=_text(el, "ServiceAgencyName"),
            budget_year=int(by) if by else None,
            mission_description=_text(el, "ProgramElementMissionDescription"),
            funding=_parse_funding(_child(el, "ProgramElementFunding")),
            xml_path=xml_path,
        )
        proj_list = _child(el, "ProjectList")
        if proj_list is not None:
            for j, p in enumerate(c for c in proj_list if _local(c.tag) == "Project"):
                record.projects.append(_parse_project(p, f"{xml_path}/Project[{j}]"))
        if record.number:
            pes.append(record)
            pe_idx += 1
    return pes
