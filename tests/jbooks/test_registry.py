import httpx
import psycopg

from govbudget.jbooks.registry import discover_documents, upsert_documents

INDEX_HTML = """
<html><body>
<a href="/Portals/45/Documents/defbudget/FY2026/r1_display.xlsx">R-1 Display</a>
<a href="/Portals/45/Documents/defbudget/FY2026/p1_display.xlsx">P-1 Display</a>
<a href="/Portals/45/Documents/defbudget/FY2026/FY2026_r1.pdf">R-1 PDF</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf">DARPA</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_Vol5_DTRA_MasterJustificationBook_PB_2026.pdf">DTRA</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/02_Procurement/PROC_Vol1_SOCOM_JustificationBook_PB_2026.pdf">SOCOM</a>
</body></html>
"""

BASE = "https://comptroller.war.gov"


def test_discover_classifies_documents():
    def handler(request):
        return httpx.Response(200, text=INDEX_HTML)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        docs = discover_documents(client, BASE + "/Budget-Materials/Budget2026/", fiscal_year=2026)
    by_family = {}
    for d in docs:
        by_family.setdefault(d["exhibit_family"], []).append(d)
    assert {d["title"] for d in by_family["rollup"]} == {"r1_display.xlsx", "p1_display.xlsx"}
    rdte_orgs = {d["org"] for d in by_family["rdte"]}
    assert rdte_orgs == {"DARPA", "DTRA"}
    assert {d["org"] for d in by_family["procurement"]} == {"SOCOM"}
    darpa = [d for d in by_family["rdte"] if d["org"] == "DARPA"][0]
    assert darpa["source_url"].startswith(BASE + "/Portals/")
    # plain exhibit summary PDFs (FY2026_r1.pdf) are NOT registered
    all_urls = [d["source_url"] for d in docs]
    assert not any(u.endswith("FY2026_r1.pdf") for u in all_urls)


def test_upsert_is_idempotent(pg_dsn):
    docs = [
        {
            "org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
            "title": "RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf",
            "source_url": "https://example.test/darpa.pdf",
        }
    ]
    assert upsert_documents(pg_dsn, docs) == 1
    assert upsert_documents(pg_dsn, docs) == 0
    with psycopg.connect(pg_dsn) as con:
        n = con.execute("select count(*) from jbook_documents").fetchone()[0]
    assert n == 1
