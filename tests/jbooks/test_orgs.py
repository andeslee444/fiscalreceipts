from govbudget.jbooks.orgs import CONSOLIDATED_ORGS, doc_orgs_for, workbook_org


def test_aliases():
    assert workbook_org("CYBERCOM") == "CYBER"
    assert workbook_org("CHIPS") == "OSD"
    assert workbook_org("DARPA") == "DARPA"
    assert "CHIPS" in doc_orgs_for("OSD") and "DPAP" in doc_orgs_for("OSD")
    assert doc_orgs_for("DARPA") == ["DARPA"]


def test_legacy_long_form_document_orgs_translate_to_workbook_codes():
    """PB2017–PB2019 filenames spell out the publishing agency; the R-1/P-1
    display workbooks use short codes (same vocabulary as PB2024+)."""
    assert workbook_org("Chemical_Biological_Defense_Program") == "CBDP"
    assert workbook_org("Chemical_and_Biological_Defense_Program") == "CBDP"
    assert workbook_org("Defense_Contract_Audit_Agency") == "DCAA"
    assert workbook_org("Defense_Contract_Management_Agency") == "DCMA"
    assert workbook_org("Defense_Human_Resources_Activity") == "DHRA"
    assert workbook_org("DoD_Human_Resources_Activity") == "DHRA"
    assert workbook_org("Defense_Information_Systems_Agency") == "DISA"
    assert workbook_org("Defense_Logistics_Agency") == "DLA"
    # P-1 display evidence (FY2017–FY2025): Defense Media Activity lines sit
    # under org code DMACT; the DPA Purchases account (0360D) under OSD; the
    # JUON Fund account (0303D) under DEFW.
    assert workbook_org("Defense_Media_Activity") == "DMACT"
    assert workbook_org("Defense_Production_Act_Purchases") == "OSD"
    assert workbook_org("Defense_Security_Cooperation_Agency") == "DSCA"
    assert workbook_org("Defense_Security_Service") == "DSS"
    assert workbook_org("Defense_Technical_Information_Center") == "DTIC"
    assert workbook_org("Defense_Threat_Reduction_Agency") == "DTRA"
    assert workbook_org("Department_of_Defense_Education_Activity") == "DODEA"
    assert workbook_org("Joint_Staff") == "TJS"
    assert workbook_org("The_Joint_Staff") == "TJS"
    assert workbook_org("Joint_Urgent_Operational_Needs_Fund") == "DEFW"
    assert workbook_org("Missile_Defense_Agency") == "MDA"
    assert workbook_org("Office_of_Secretary_Of_Defense") == "OSD"
    assert workbook_org("Operational_Test_Evaluation_Defense") == "OTE"
    assert workbook_org("United_States_Special_Operations_Command") == "SOCOM"
    assert workbook_org("Washington_Headquarters_Service") == "WHS"


def test_consolidated_orgs():
    """Consolidated Defense-Wide volumes span many workbook orgs; reconcile
    matches their details per-organization instead of via the document org."""
    assert workbook_org("Defense_Wide") == "DW"
    assert workbook_org("Defense-Wide") == "DW"
    assert "DW" in CONSOLIDATED_ORGS
    assert "DARPA" not in CONSOLIDATED_ORGS
