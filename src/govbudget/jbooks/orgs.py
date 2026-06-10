"""Document-org -> workbook-org translation.

J-book filenames name the publishing office; the R-1/P-1 display workbooks
use the budget organization. Verified live (FY2026): CYBERCOM books carry
workbook org CYBER; CHIPS and DPAP books' lines sit under OSD.
"""
ORG_ALIASES: dict[str, str] = {
    "CYBERCOM": "CYBER",
    "CHIPS": "OSD",
    "DPAP": "OSD",
}


def workbook_org(doc_org: str) -> str:
    return ORG_ALIASES.get(doc_org, doc_org)


def doc_orgs_for(workbook: str) -> list[str]:
    """All document orgs whose lines live under the given workbook org."""
    return [workbook] + [d for d, w in ORG_ALIASES.items() if w == workbook]
