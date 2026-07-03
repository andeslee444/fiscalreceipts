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
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_CBDP_PB_2026.pdf">CBDP</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/02_Procurement/PROC_OSD_PB_2026.pdf">OSD</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/02_Procurement/PROC_MDA_VOL2B_PB_2026.pdf">MDA PROC</a>
<a href="/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_Vol2_MDA_RDTE_PB26_Justification_Book.pdf">MDA RDTE</a>
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
    assert rdte_orgs == {"DARPA", "DTRA", "CBDP", "MDA"}
    assert {d["org"] for d in by_family["procurement"]} == {"SOCOM", "OSD", "MDA"}
    darpa = [d for d in by_family["rdte"] if d["org"] == "DARPA"][0]
    assert darpa["source_url"].startswith(BASE + "/Portals/")
    # plain exhibit summary PDFs (FY2026_r1.pdf) are NOT registered
    all_urls = [d["source_url"] for d in docs]
    assert not any(u.endswith("FY2026_r1.pdf") for u in all_urls)


def test_classify_jbook_name_variants():
    from govbudget.jbooks.registry import _classify_jbook

    assert _classify_jbook("RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf") == ("rdte", "DARPA")
    assert _classify_jbook("RDTE_CBDP_PB_2026.pdf") == ("rdte", "CBDP")
    assert _classify_jbook("PROC_OSD_PB_2026.pdf") == ("procurement", "OSD")
    assert _classify_jbook("PROC_MDA_VOL2B_PB_2026.pdf") == ("procurement", "MDA")
    assert _classify_jbook("RDTE_Vol2_MDA_RDTE_PB26_Justification_Book.pdf") == ("rdte", "MDA")
    assert _classify_jbook("FY2026_r1.pdf") is None
    assert _classify_jbook("RDTE_Defense_Human_Resources_Activity_PB_2026.pdf") == ("rdte", "Defense_Human_Resources_Activity")


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


def test_jbook_index_urls_2025():
    from govbudget.cli import jbook_index_urls

    assert jbook_index_urls(2025) == [
        "https://comptroller.war.gov/Budget-Materials/Budget2025/",
        "https://comptroller.war.gov/Budget-Materials/FY2025BudgetJustification/",
    ]


def test_jbook_index_urls_2026_matches_legacy_constants():
    from govbudget.cli import jbook_index_urls

    # regression pin: the exact literals hardcoded before parameterization
    assert jbook_index_urls(2026) == [
        "https://comptroller.war.gov/Budget-Materials/Budget2026/",
        "https://comptroller.war.gov/Budget-Materials/FY2026BudgetJustification/",
    ]


# Budget{fy}/ index page: rollup display links are relative, so their URLs
# derive from the fy-parameterized index URL.
BUDGET_INDEX_HTML = """
<html><body>
<a href="r1_display.xlsx">R-1 Display</a>
<a href="p1_display.xlsx">P-1 Display</a>
</body></html>
"""

JUSTIFICATION_INDEX_HTML = """
<html><body>
<a href="pdfs/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2025.pdf">DARPA</a>
</body></html>
"""


def _run_scrape(monkeypatch, argv):
    """Run `govbudget jbooks scrape` with HTTP + DB boundaries mocked.

    Returns (requested_urls, upserted_docs).
    """
    import types

    import govbudget.jbooks.db
    import govbudget.jbooks.registry
    from govbudget import cli

    requested: list[str] = []

    def handler(request):
        url = str(request.url)
        requested.append(url)
        if "/Budget-Materials/Budget" in url:
            return httpx.Response(200, text=BUDGET_INDEX_HTML)
        return httpx.Response(200, text=JUSTIFICATION_INDEX_HTML)

    real_client = httpx.Client
    monkeypatch.setattr(cli, "httpx", types.SimpleNamespace(
        Client=lambda **kw: real_client(transport=httpx.MockTransport(handler)),
    ))
    monkeypatch.setattr(govbudget.jbooks.db, "migrate", lambda *a, **kw: [])
    upserted: list[dict] = []

    def fake_upsert(dsn, docs):
        upserted.extend(docs)
        return len(docs)

    monkeypatch.setattr(govbudget.jbooks.registry, "upsert_documents", fake_upsert)
    cli.main(argv)
    return requested, upserted


def test_scrape_cli_threads_fiscal_year_to_discovery_and_rollups(monkeypatch):
    requested, docs = _run_scrape(
        monkeypatch, ["jbooks", "scrape", "--fiscal-year", "2025"]
    )
    assert requested == [
        "https://comptroller.war.gov/Budget-Materials/Budget2025/",
        "https://comptroller.war.gov/Budget-Materials/FY2025BudgetJustification/",
    ]
    # every discovered doc is stamped with the requested edition year
    assert docs and all(d["fiscal_year"] == 2025 for d in docs)
    # rollup display-file URLs derive from the fy-parameterized index page
    rollups = {d["title"]: d["source_url"] for d in docs if d["exhibit_family"] == "rollup"}
    assert rollups == {
        "r1_display.xlsx": "https://comptroller.war.gov/Budget-Materials/Budget2025/r1_display.xlsx",
        "p1_display.xlsx": "https://comptroller.war.gov/Budget-Materials/Budget2025/p1_display.xlsx",
    }


def test_scrape_cli_defaults_to_config_jbook_fy(monkeypatch):
    from govbudget import config

    requested, docs = _run_scrape(monkeypatch, ["jbooks", "scrape"])
    # omitting --fiscal-year preserves today's behavior exactly
    assert config.JBOOK_FY == 2026
    assert requested == [
        "https://comptroller.war.gov/Budget-Materials/Budget2026/",
        "https://comptroller.war.gov/Budget-Materials/FY2026BudgetJustification/",
    ]
    assert docs and all(d["fiscal_year"] == config.JBOOK_FY for d in docs)
