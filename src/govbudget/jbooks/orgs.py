"""Document-org -> workbook-org translation.

J-book filenames name the publishing office; the R-1/P-1 display workbooks
use the budget organization. Verified live (FY2026): CYBERCOM books carry
workbook org CYBER; CHIPS and DPAP books' lines sit under OSD.

PB2017–PB2019 filenames spell the agency out in full ("Defense_Threat_
Reduction_Agency"); the display workbooks use the same short codes in every
edition, so the long forms translate here rather than at classify time
(classification of the modern short-code names is pinned byte-identical).
"""
ORG_ALIASES: dict[str, str] = {
    "CYBERCOM": "CYBER",
    "CHIPS": "OSD",
    "DPAP": "OSD",
    # --- legacy long-form document orgs (PB2017–PB2019 filenames) ---
    "Chemical_Biological_Defense_Program": "CBDP",
    "Chemical_and_Biological_Defense_Program": "CBDP",
    "Defense_Contract_Audit_Agency": "DCAA",
    "Defense_Contract_Management_Agency": "DCMA",
    "Defense_Human_Resources_Activity": "DHRA",
    "DoD_Human_Resources_Activity": "DHRA",
    "Defense_Information_Systems_Agency": "DISA",
    "Defense_Logistics_Agency": "DLA",
    "Defense_Media_Activity": "DMA",
    "Defense_Production_Act_Purchases": "DPA",
    "Defense_Security_Cooperation_Agency": "DSCA",
    "Defense_Security_Service": "DSS",
    "Defense_Technical_Information_Center": "DTIC",
    "Defense_Threat_Reduction_Agency": "DTRA",
    "Department_of_Defense_Education_Activity": "DODEA",
    "Joint_Staff": "TJS",
    "The_Joint_Staff": "TJS",
    "Joint_Urgent_Operational_Needs_Fund": "JUON",
    "Missile_Defense_Agency": "MDA",
    "Office_of_Secretary_Of_Defense": "OSD",
    "Operational_Test_Evaluation_Defense": "OTE",
    "United_States_Special_Operations_Command": "SOCOM",
    "Washington_Headquarters_Service": "WHS",
    # consolidated Defense-Wide volumes (PB2018–PB2023)
    "Defense_Wide": "DW",
    "Defense-Wide": "DW",
}

# Workbook orgs that stand for a whole edition's Defense-Wide consolidated
# volume rather than one agency. Their details reconcile per-organization
# (reconcile.py Gate B) because their budget lines span many workbook orgs.
CONSOLIDATED_ORGS = frozenset({"DW"})


def workbook_org(doc_org: str) -> str:
    return ORG_ALIASES.get(doc_org, doc_org)


def doc_orgs_for(workbook: str) -> list[str]:
    """All document orgs whose lines live under the given workbook org."""
    return [workbook] + [d for d, w in ORG_ALIASES.items() if w == workbook]
