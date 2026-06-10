from govbudget.jbooks.orgs import doc_orgs_for, workbook_org


def test_aliases():
    assert workbook_org("CYBERCOM") == "CYBER"
    assert workbook_org("CHIPS") == "OSD"
    assert workbook_org("DARPA") == "DARPA"
    assert set(doc_orgs_for("OSD")) == {"OSD", "CHIPS", "DPAP"}
    assert doc_orgs_for("DARPA") == ["DARPA"]
