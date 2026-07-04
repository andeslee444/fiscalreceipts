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


def test_classify_jbook_pb2017_per_agency_era():
    """PB2017 publishes per-agency books: full-word PROCUREMENT prefixes,
    RDTE prefixes with long org names, and org-first DARPA/MDA names."""
    from govbudget.jbooks.registry import _classify_jbook

    assert _classify_jbook(
        "PROCUREMENT_MasterJustificationBook_Defense_Contract_Audit_Agency_PB_2017.pdf"
    ) == ("procurement", "Defense_Contract_Audit_Agency")
    assert _classify_jbook(
        "RDTE_MasterJustificationBook_Chemical_Biological_Defense_Program_PB_2017.pdf"
    ) == ("rdte", "Chemical_Biological_Defense_Program")
    # org-first names: org tokens BEFORE the exhibit token win
    assert _classify_jbook(
        "DARPA_0400D_RDTE_MasterJustificationBook_Defense_Advanced_Research_Project.pdf"
    ) == ("rdte", "DARPA")
    assert _classify_jbook(
        "MDA_RDTE_MasterJustificationBook_Missile_Defense_Agency_PB_2017_1.pdf"
    ) == ("rdte", "MDA")
    assert _classify_jbook(
        "MDA_PROCUREMENT_MasterJustificationBook_Missile_Defense_Agency_PB_2017_1.pdf"
    ) == ("procurement", "MDA")
    # evidence-classified: no exhibit token in the name; the PDF embeds
    # U_RDTE_MasterJustificationBook_Office_of_the_Secretary_Of_Defense_PB_2017.zzz
    assert _classify_jbook("PB17_OSD_0400D_Master_J-Book_Final.pdf") == ("rdte", "OSD")
    # numeric-index-prefixed consolidated volumes duplicate the per-agency set
    assert _classify_jbook(
        "1_PROCUREMENT_MasterJustificationBook_Defense_Wide_PB_2017_Vol_1.pdf"
    ) is None
    assert _classify_jbook(
        "5_RDTE_MasterJustificationBook_Defense_Wide_PB_2017_Vol_5.pdf"
    ) is None
    # niche fund book with no exhibit evidence stays unclassified
    assert _classify_jbook("JIDO_PB17_2093D_J-Book_SCOMBFinal_Feb16.pdf") is None


def test_classify_jbook_pb2018_consolidated_era():
    """PB2018 publishes U_-prefixed consolidated Defense-Wide MJBs plus a few
    evidence-classified per-agency books not covered by the DW volumes."""
    from govbudget.jbooks.registry import _classify_jbook

    assert _classify_jbook(
        "U_RDTE_MasterJustificationBook_Defense-Wide_PB_2018_20170524.pdf"
    ) == ("rdte", "Defense_Wide")
    assert _classify_jbook(
        "U_PROCUREMENT_MasterJustificationBook_Defense-Wide_PB_2018_v4.pdf"
    ) == ("procurement", "Defense_Wide")
    assert _classify_jbook(
        "U_RDTE_MasterJustificationBook_Missile_Defense_Agency_PB_2018_Vol2a_Vol2b.pdf"
    ) == ("rdte", "Missile_Defense_Agency")
    # evidence-classified (embedded U_RDTE_/U_PROCUREMENT_ .zzz, verified live):
    # DARPA/OSD/CBDP are NOT in the 2018 DW RDTE volume; the misnamed
    # 'JusticificationBook' MDA book embeds the procurement MJB.
    assert _classify_jbook("DARPA_0400D_FY18PB_FINAL.pdf") == ("rdte", "DARPA")
    assert _classify_jbook("OSD_0400_PB_18_Justification_Book_Final.pdf") == ("rdte", "OSD")
    assert _classify_jbook("CBDP_0400D_FY18_PB_FINAL.pdf") == ("rdte", "CBDP")
    assert _classify_jbook(
        "U_MasterJusticificationBook_Missile_Defense_Agency_PB_2018_Vol2a_Vol2b.pdf"
    ) == ("procurement", "Missile_Defense_Agency")
    # the standalone DTRA book duplicates the DW MJB (which includes DTRA)
    assert _classify_jbook(
        "U_RDTE_MasterJustificationBook_Defense_Threat_Reduction_Agency_PB_2018_1.pdf"
    ) is None
    # account-code per-agency books duplicate the DW volumes: unclassified
    assert _classify_jbook("DISA_0400D_FY18_PB_Final.pdf") is None
    assert _classify_jbook("WHS_0300D_FY18_PB_FINAL.pdf") is None
    assert _classify_jbook("DTRA_JIDF_2093D_PB18JBook_Final_18May17.pdf") is None


def test_classify_jbook_pb2019_to_pb2023_consolidated_volumes():
    from govbudget.jbooks.registry import _classify_jbook

    # PB2019: RDTE_DAs_Vol_* naming + U_ procurement volumes
    assert _classify_jbook(
        "RDTE_DAs_Vol_3A_of_5_OSD_FY19PB-RDTE_Exhibits_BA1-3.pdf"
    ) == ("rdte", "OSD")
    assert _classify_jbook(
        "RDTE_DAs_Vol_4_of_5_CBDP_FY19PB-RDTE_Exhibits.pdf"
    ) == ("rdte", "CBDP")
    assert _classify_jbook(
        "RDTE_DAs_Vol_5_of_5_RDTE_MasterJustificationBook_Defense-Wide_PB_2019.pdf"
    ) == ("rdte", "Defense_Wide")
    assert _classify_jbook(
        "DARPA_RDTE_MasterJustificationBook_Defense_Advanced_Research_Projects_Agency_PB_2019.pdf"
    ) == ("rdte", "DARPA")
    assert _classify_jbook(
        "U_PROCUREMENT_MasterJustificationBook_Missile_Defense_Agency_PB_2019_1.pdf"
    ) == ("procurement", "Missile_Defense_Agency")
    # numeric-index per-agency books duplicate the consolidated volumes
    assert _classify_jbook("01_DCAA_RDTE_MasterJustificationBook_PB_2019_FINAL.pdf") is None
    assert _classify_jbook("10_DTRA_PROCUREMENT_MasterJustificationBook_PB_2019.pdf") is None

    # PB2020/PB2021: RDTE_Vol1..5 + PROC_Vol1/2 (URL-encoded space in Vol2)
    assert _classify_jbook(
        "RDTE_Vol2_MDA%20RDTE_PB20_Justification_Book.pdf"
    ) == ("rdte", "MDA")
    assert _classify_jbook(
        "PROC_Vol1_DW_PROC_PB21_Justification_Book_Final.pdf"
    ) == ("procurement", "DW")
    assert _classify_jbook(
        "PROC_Vol2_MDA_PROC_OM_MILCON_PB20_Justification_Book_Final.pdf"
    ) == ("procurement", "MDA")
    assert _classify_jbook("RDTE_Vol5_DW_RDTE_PB21_Justification_Book.pdf") == ("rdte", "DW")
    assert _classify_jbook("01_0300_CBDP_PB_2020.pdf") is None
    assert _classify_jbook("DCAA_PB2021.pdf") is None  # ambiguous per-agency name

    # PB2022: truncated-PROC 'ROC_Vol*' misnames on the comptroller site
    assert _classify_jbook(
        "ROC_Vol1_DW_PROC_PB22_Justification_Book_Final.pdf"
    ) == ("procurement", "DW")
    assert _classify_jbook(
        "ROC_Vol2_MDA_PROC_OM_MILCON_PB22_Justification_Book_Final.pdf"
    ) == ("procurement", "MDA")
    assert _classify_jbook(
        "RDTE_Vol5_DW_RDTE_PB22_Justification_Book_v2.pdf"
    ) == ("rdte", "DW")

    # PB2023: MJB_DW volume naming
    assert _classify_jbook("RDTE_MJB_DW_Vol5_PB_2023.pdf") == ("rdte", "DW")
    assert _classify_jbook("PROC_MJB_DW_Vol1_PB_2023.pdf") == ("procurement", "DW")
    assert _classify_jbook("PROC_MDA_VOL2B_PB_2023.pdf") == ("procurement", "MDA")
    assert _classify_jbook("OSD_PB2023.pdf") is None  # same filename in both dirs


def test_discover_evidence_paths_pb2023_osd_cbdp():
    """PB2023 publishes tokenless '{ORG}_PB2023.pdf' twins under BOTH
    02_Procurement/ and 03_RDT_and_E/ — the filename alone is ambiguous.
    EVIDENCE_PATHS classifies the 03_RDT_and_E OSD/CBDP books by URL path
    (their embedded XML is U_RDTE_MJB_*_{OSD,CBDP}_PB_2023, verified live —
    Finding B: they are NOT duplicates; the loaded edition had zero OSD/CBDP
    detail rows). The 02_Procurement twins (duplicates of PROC_MJB_DW_Vol1)
    and other tokenless twins stay unregistered."""
    base = "/Portals/45/Documents/defbudget/fy2023/budget_justification/pdfs"
    html = "<html><body>" + "".join(
        f'<a href="{base}/{d}/{n}_PB2023.pdf">{n}</a>'
        for d in ("02_Procurement", "03_RDT_and_E")
        for n in ("OSD", "CBDP", "DISA", "DTRA")
    ) + "</body></html>"

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        docs = discover_documents(
            client, BASE + "/Budget-Materials/Budget2023/", fiscal_year=2023
        )
    got = {
        (d["org"], d["exhibit_family"]): d["source_url"] for d in docs
    }
    assert set(got) == {("OSD", "rdte"), ("CBDP", "rdte")}
    assert "03_RDT_and_E/OSD_PB2023.pdf" in got[("OSD", "rdte")]
    assert "03_RDT_and_E/CBDP_PB2023.pdf" in got[("CBDP", "rdte")]


def test_discover_unquotes_percent_encoded_titles():
    """PB2020's MDA volume is linked with an encoded space; the stored title
    is the decoded filename, and classification sees the decoded tokens."""
    html = (
        '<html><body><a href="/Portals/45/Documents/defbudget/fy2020/'
        "budget_justification/pdfs/03_RDT_and_E/"
        'RDTE_Vol2_MDA%20RDTE_PB20_Justification_Book.pdf">MDA</a></body></html>'
    )

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        docs = discover_documents(
            client, BASE + "/Budget-Materials/Budget2020/", fiscal_year=2020
        )
    assert len(docs) == 1
    assert docs[0]["title"] == "RDTE_Vol2_MDA RDTE_PB20_Justification_Book.pdf"
    assert docs[0]["org"] == "MDA"
    assert docs[0]["exhibit_family"] == "rdte"
    assert "%20" in docs[0]["source_url"]  # the URL itself stays as published


def test_classify_jbook_excludes_non_jbook_token_bearers():
    """Names that carry an exhibit token but are NOT master J-books."""
    from govbudget.jbooks.registry import _classify_jbook

    # Defense Health Program O&M volume sections
    assert _classify_jbook("Vol_II_Sec_7_R-2_RDTE_Budget_Item_Justification_DHP_PB17.pdf") is None
    assert _classify_jbook("Vol_II_Sec_8-RDTE_Project_Justification_DHP_PB18.pdf") is None
    assert _classify_jbook("Vol_II_Sec_4_P-1_Procurement_Program_DHP_PB21.pdf") is None
    assert _classify_jbook("25-Vol_II_Sec_7-RDTE_Budget_Item_Justification_DHP_PB23.pdf") is None
    # multiyear-procurement exhibit summaries
    assert _classify_jbook("FY18_PB_Multiyear_Procurement_Exhibits.pdf") is None
    # consolidated-era duplicates on the modern pages stay unclassified
    assert _classify_jbook("PB_2026_RDTE_VOL_5.pdf") is None
    assert _classify_jbook("PB_2026_PDW_VOL_1.pdf") is None


def test_classification_regression_fy2025_fy2026_full_inventories():
    """Byte-identity pin: the classifier's verdict over the complete FY2025 and
    FY2026 comptroller index inventories (fetched live 2026-07-03) must match
    the pre-extension classifier exactly — the legacy-naming extension may not
    move a single modern name."""
    import json
    from pathlib import Path

    from govbudget.jbooks.registry import _classify_jbook

    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks"
    for fy in (2025, 2026):
        names = (fixtures / f"index_names_fy{fy}.txt").read_text().splitlines()
        expected = {
            name: tuple(v)
            for name, v in json.loads(
                (fixtures / f"index_classified_fy{fy}.json").read_text()
            ).items()
        }
        got = {}
        for name in names:
            verdict = _classify_jbook(name)
            if verdict is not None:
                got[name] = verdict
        assert got == expected
        assert len(got) == 34  # + 3 rollup workbooks = 37 discovered


# --------------------------------------------------------------------------
# Phase 5G — Navy FY2026 service J-books (appropriation-code naming)
# --------------------------------------------------------------------------


def test_classify_jbook_navy_rdte_and_procurement():
    """Navy publishes by appropriation code (RDTEN / APN / OPN / …), which the
    word-bounded RDTE/PROC token rule returns None for. The NAVY_NAMES allowlist
    (Task 2, mirroring EVIDENCE_NAMES) maps each justification book to (family,
    org='N'). Org 'N' is the display-workbook code — no ORG_ALIASES entry."""
    from govbudget.jbooks.registry import _classify_jbook

    # RDT&E, Navy — five BA-split PDFs, each embeds the full 252-PE master.
    for ba in ("BA1-3", "BA4", "BA5", "BA6", "BA7-8"):
        assert _classify_jbook(f"RDTEN_{ba}_Book.pdf") == ("rdte", "N")
    # Procurement appropriations (Navy + Marine Corps).
    for name in (
        "APN_BA1-4_Book.pdf", "APN_BA5_Book.pdf", "APN_BA6-7_Book.pdf",   # Aircraft
        "WPN_Book.pdf",                                                    # Weapons
        "SCN_Book.pdf",                                                    # Shipbuilding
        "OPN_BA1_Book.pdf", "OPN_BA2_Book.pdf", "OPN_BA3_Book.pdf",        # Other
        "OPN_BA4_Book.pdf", "OPN_BA5-8_Book.pdf",
        "PMC_Book.pdf",                                                    # Marine Corps
        "PANMC_Book.pdf",                                                  # Ammunition N&MC
    ):
        assert _classify_jbook(name) == ("procurement", "N"), name


def test_classify_jbook_navy_excludes_non_justification_books():
    """O&M, MilPers, MilCon, BRAC, working-capital, and overview/summary
    volumes are NOT R/D or procurement justification books. They are pinned to
    NAVY_EXCLUSIONS so the token rule never accidentally registers them."""
    from govbudget.jbooks.registry import _classify_jbook

    for name in (
        # O&M
        "OMN_Book.pdf", "OMN_Vol2_Book.pdf", "OMNR_Book.pdf",
        "OMMC_Book.pdf", "OMMC_Vol2_Book.pdf", "OMMCR_Book.pdf",
        # Military / Reserve Personnel
        "MPN_Book.pdf", "MPMC_Book.pdf", "MCNR_Book.pdf",
        "RPN_Book.pdf", "RPMC_Book.pdf",
        # MilCon / BRAC / working capital
        "MCON_Book.pdf", "BRAC_Book.pdf", "NWCF_Book.pdf",
        # overview / summary / supplemental
        "Highlights_Book.pdf", "DON_Budget_Card.pdf", "DON_Press_Brief.pdf",
        "The_Bottom_Line.pdf", "Supp_Book.pdf",
    ):
        assert _classify_jbook(name) is None, name


def test_classify_navy_full_inventory_partitions_cleanly():
    """Every one of the 36 real Navy FY2026 filenames (navy-inventory.txt)
    either classifies to a justification (family, 'N') or is an explicit
    exclusion — no filename falls through unhandled."""
    from pathlib import Path

    from govbudget.jbooks.registry import (
        NAVY_EXCLUSIONS,
        NAVY_NAMES,
        _classify_jbook,
    )

    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks"
    names = [
        n for n in (fixtures / "navy_inventory_fy2026.txt").read_text().splitlines()
        if n.strip()
    ]
    assert len(names) == 36
    classified, excluded = {}, []
    for name in names:
        verdict = _classify_jbook(name)
        if verdict is not None:
            classified[name] = verdict
        else:
            excluded.append(name)
    # 5 RDTE + 12 procurement books classify; the remaining 19 are excluded.
    assert len(classified) == 17
    assert sum(1 for v in classified.values() if v == ("rdte", "N")) == 5
    assert sum(1 for v in classified.values() if v == ("procurement", "N")) == 12
    assert len(excluded) == 19
    # allowlist / exclusion sets exactly cover the inventory, nothing extra.
    assert set(NAVY_NAMES) == set(classified)
    assert set(NAVY_EXCLUSIONS) == set(excluded)


def test_navy_allowlist_does_not_touch_defense_wide_names():
    """The Navy allowlist keys are appropriation-code names unique to the
    service inventory; none collide with a defense-wide filename, so the
    regression pin above stays byte-identical (guard against accidental reuse)."""
    from govbudget.jbooks.registry import NAVY_EXCLUSIONS, NAVY_NAMES

    for name in list(NAVY_NAMES) + list(NAVY_EXCLUSIONS):
        assert "RDTE_" not in name and "PROC" not in name.upper()[:4], name


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
