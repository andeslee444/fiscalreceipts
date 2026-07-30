"""PM-review Sprint 1 Task 2 — exporter basis threading, summary-card union,
reconciliation payload, canonical-TOA hero, and the WHO-GETS-IT named-primes
fallback (spec docs/superpowers/specs/2026-07-30-pm-review.md §P0-1/§P0-2/§P0-5;
gate 23 site/scripts/gates/basis.mjs defines the acceptance bar).

Fixture shape mirrors the live ATA000 (F-35) page that produced the P0-1
collision: the P-1 workbook (toa basis, USD thousands) carries
fy_2024_actuals 5,565,655 / fy_2025_enacted 4,972,514 / fy_2026_total
4,086,744 while the P-40 J-book detail (jbook-detail basis, USD millions)
carries PriorYear 5,247.070 / CurrentYear 4,489.930 / BudgetYearOne
3,555.503 — and fct_budget_trajectory has NO fy2025 value (the live P0-2
false absence). A second sparse PE covers the absence-reason enum.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import duckdb
import psycopg
import pytest

from govbudget.export_site import (
    export_site,
    fact_id_derived,
    fact_id_jbook,
    fact_id_workbook,
)

FIXTURE_PDF = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"

PE = "ATA000"
SPARSE_PE = "0602SPARSE"
ORG = "F"
ACCT = "3010"
BA = "05"

# toa (P-1 workbook, USD thousands)
WB = {
    "fy_2024_actuals": 5565655.0,
    "fy_2025_enacted": 4972514.0,
    "fy_2026_total": 4086744.0,
}
# jbook-detail (P-40, USD millions)
DET = {
    "PriorYear": "5247.070",
    "CurrentYear": "4489.930",
    "BudgetYearOne": "3555.503",
}


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------


def _seed(pg_dsn: str) -> str:
    """Seed the two-basis F-35-shaped fixture; returns the document sha."""
    sha = hashlib.sha256(FIXTURE_PDF.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " (%s,'procurement',2026,'FY26 AF Aircraft Procurement Vol I.pdf',"
            " 'https://example.mil/af-apf.pdf',%s,%s, now(),'downloaded')",
            (ORG, str(FIXTURE_PDF), sha),
        )
        doc_id = con.execute(
            "select id from jbook_documents where sha256=%s", (sha,)
        ).fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        for scenario, amt in DET.items():
            con.execute(
                "insert into budget_line_details (extraction_run_id, document_id,"
                " pe_bli, scenario, amount_millions, xml_path) values"
                " (%s,%s,%s,%s,%s,'LineItem[1]')",
                (run_id, doc_id, PE, scenario, amt),
            )
        # sparse PE: detail FY24 only (absence enum coverage)
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id,"
            " pe_bli, scenario, amount_millions, xml_path) values"
            " (%s,%s,%s,'PriorYear','100.000','LineItem[2]')",
            (run_id, doc_id, SPARSE_PE),
        )
        for at, amt in WB.items():
            con.execute(
                """
                insert into budget_lines
                  (exhibit, fiscal_year, account, account_title, organization,
                   budget_activity, budget_activity_title, pe_bli, title,
                   amount_type, amount_thousands, source_document_id,
                   source_sheet, source_cells)
                values
                  ('P-1', 2026, %s, 'Aircraft Procurement, Air Force', %s,
                   %s, 'Combat Aircraft', %s, 'F-35',
                   %s, %s, %s, 'Exhibit P-1', ARRAY['O839'])
                """,
                (ACCT, ORG, BA, PE, at, amt, doc_id),
            )
        con.execute(
            """
            insert into budget_lines
              (exhibit, fiscal_year, account, account_title, organization,
               budget_activity, budget_activity_title, pe_bli, title,
               amount_type, amount_thousands, source_document_id,
               source_sheet, source_cells)
            values
              ('P-1', 2026, %s, 'Aircraft Procurement, Air Force', %s,
               %s, 'Combat Aircraft', %s, 'Sparse Line',
               'fy_2024_actuals', 100000, %s, 'Exhibit P-1', ARRAY['O900'])
            """,
            (ACCT, ORG, BA, SPARSE_PE, doc_id),
        )
    # Provenance: the fixture PDF doesn't contain these amounts, so
    # build_provenance_pages leaves them unresolved — force resolution the
    # same way test_export_site_pg's edition-fence test does.
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    build_provenance_pages(pg_dsn)
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "update provenance_pages set resolution='unique', page_number=1,"
            " amount_text=amount_millions::text, x0=10, x1=60, top_pt=100,"
            " bottom_pt=110, page_width=612, page_height=792"
            " where target_kind='amount'"
        )
    return sha


def _wb_fid(sha: str, at: str, pe: str = PE) -> str:
    return fact_id_workbook(sha, "P-1", 2026, ACCT, ORG, BA, pe, at)


def _make_duckdb(db_path: Path, sha: str) -> None:
    """Marts + a jbooks lake (for the decade citation tier) next to the db."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))

    con.execute(
        "create table dim_programs (pe_bli varchar, title varchar, org varchar,"
        " exhibit_family varchar, project_count integer,"
        " fy2024_actual_millions double, fully_reconciled boolean)"
    )
    con.execute(
        f"insert into dim_programs values"
        f" ('{PE}','F-35','{ORG}','procurement',0,5247.070,false),"
        f" ('{SPARSE_PE}','Sparse Line','{ORG}','rdte',0,100.0,false)"
    )

    con.execute(
        "create table fct_budget_to_awards (pe_bli varchar, exhibit varchar,"
        " fiscal_year integer, organization varchar, award_piid varchar,"
        " recipient_name varchar, recipient_uei varchar, method varchar,"
        " confidence varchar, program_title varchar)"
    )

    # The live P0-2 shape: trajectory row exists but fy2025/change are NULL.
    con.execute(
        "create table fct_budget_trajectory (pe_bli varchar, organization varchar,"
        " fy2024_actuals double, fy2025_total double, fy2026_total double,"
        " fy2526_change double, fy2526_pct_change double)"
    )
    con.execute(
        f"insert into fct_budget_trajectory values"
        f" ('{PE}','{ORG}',5565655.0,null,4086744.0,null,null)"
    )

    con.execute(
        "create table dim_entities (family_key varchar, display_name varchar,"
        " uei_count bigint, total_obligation double, worst_confidence varchar)"
    )
    con.execute(
        "insert into dim_entities values"
        " ('LOCKHEED MARTIN','LOCKHEED MARTIN CORPORATION',5,50000000.0,'medium')"
    )

    con.execute(
        "create table fct_influence (family_key varchar, display_name varchar,"
        " filing_year varchar, filings_count integer, lobbying_income_usd double,"
        " lobbying_expense_usd double, lobbying_total_usd double,"
        " family_obligations_usd double)"
    )
    con.execute(
        "create table fct_program_lobbying (filing_uuid varchar, pe_bli varchar,"
        " program_title varchar, matched_term varchar, description_snippet varchar,"
        " filing_url varchar, client_name varchar, family_key varchar,"
        " filing_year varchar)"
    )
    con.execute(
        "create table dim_lobbyists (name varchar, covered_position varchar,"
        " filings_count integer, revolving_door boolean)"
    )
    # No concentration row for PE — the WHO-GETS-IT crosswalk is empty, which
    # is the named_primes precondition.
    con.execute(
        "create table fct_program_concentration (pe_bli varchar, hhi double,"
        " top_family varchar, family_count bigint, program_dollars double)"
    )
    con.execute(
        "create table fct_improper_exposure (agency_code varchar,"
        " program_count bigint, derived_improper_amount_usd double,"
        " weighted_rate_pct double, latest_fiscal_year integer)"
    )
    con.execute(
        "create table dim_geography (pop_state varchar, pop_district varchar,"
        " transaction_count bigint, total_obligation double)"
    )
    con.execute(
        "create table fct_state_per_capita (jurisdiction varchar,"
        " comparable_category varchar, fiscal_year varchar,"
        " total_amount_usd double, population bigint, amount_per_capita double,"
        " pop_year_used integer, spend_source_url varchar, pop_source_url varchar,"
        " coverage_note varchar)"
    )

    # Decade mart: the PB2026-edition grains for PE (single-source →
    # source_fact_id = the workbook fact id).
    con.execute(
        "create table fct_decade_series (pe_bli varchar, fy integer,"
        " edition_year integer, amount_type_kind varchar, amount double,"
        " amount_thousands double, scenario varchar, amount_type varchar,"
        " n_source_rows integer, source_fact_id varchar)"
    )
    for fy, kind, at, scenario in [
        (2024, "actuals", "fy_2024_actuals", "PriorYear"),
        (2025, "enacted", "fy_2025_enacted", "CurrentYear"),
        (2026, "request", "fy_2026_total", "BudgetYearOne"),
    ]:
        amt = WB[at]
        con.execute(
            "insert into fct_decade_series values (?,?,?,?,?,?,?,?,?,?)",
            (PE, fy, 2026, kind, amt, amt, scenario, at, 1, _wb_fid(sha, at)),
        )

    # Feed mart: one yoy_swing card (basis threading assertion).
    con.execute(
        "create table fct_feed_events (event_type varchar, pe_bli varchar,"
        " organization varchar, family_key varchar, headline_value double,"
        " comparison_value double, pct_change double, fiscal_year integer,"
        " units varchar, detail_json varchar)"
    )
    con.execute(
        f"insert into fct_feed_events values"
        f" ('yoy_swing','{PE}','{ORG}',null,4086744.0,4972514.0,-17.8,2026,"
        f"'thousands_usd',null)"
    )
    con.close()

    # jbooks lake next to the duckdb (layout 1 of _stage_parquet_path) — the
    # decade citation tier joins it and cross-checks n_source_rows.
    jb = db_path.parent / "parquet" / "jbooks"
    jb.mkdir(parents=True, exist_ok=True)
    lines = ", ".join(
        f"('P-1','2026','{ACCT}','Aircraft Procurement, Air Force','{ORG}',"
        f"'{BA}','Combat Aircraft','{PE}','F-35','{at}','{amt:.0f}','1',"
        f"'Exhibit P-1','O839')"
        for at, amt in WB.items()
    )
    duckdb.sql(
        f"copy (select * from (values {lines})"
        " t(exhibit, fiscal_year, account, account_title, organization,"
        " budget_activity, budget_activity_title, pe_bli, title, amount_type,"
        " amount_thousands, source_document_id, source_sheet, source_cells))"
        f" to '{jb}/budget_lines.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('1','{ORG}','procurement','2026',"
        f"'FY26 AF Aircraft Procurement Vol I.pdf',"
        f"'https://example.mil/af-apf.pdf','{sha}','1000','2026-06-01',"
        f"'fy2026/af/vol1.pdf'))"
        " t(id, org, exhibit_family, fiscal_year, title, source_url, sha256,"
        " bytes, downloaded_at, rel_path))"
        f" to '{jb}/documents.parquet' (format parquet)"
    )


def _seed_dossier(site_dir: Path, cited_fid: str) -> None:
    """Pre-seed a gated dossier whose players claims name a prime (the live
    dossier CLI writes these before export_site runs)."""
    dossiers = site_dir / "json" / "dossiers"
    dossiers.mkdir(parents=True, exist_ok=True)
    (dossiers / f"{PE}.json").write_text(json.dumps({
        "pe_bli": PE,
        "dossier": {
            "players": {
                "claims": [
                    {
                        "text": "Prime contractor Lockheed Martin Aeronautics"
                                " performs assembly and flight test.",
                        "citation": {"fact_id": cited_fid},
                    },
                    {
                        "text": "The line is run by the U.S. Air Force.",
                        "citation": {"fact_id": cited_fid},
                    },
                ]
            }
        },
    }))


@pytest.fixture()
def basis_site(pg_dsn, tmp_path):
    sha = _seed(pg_dsn)
    db = tmp_path / "wh.duckdb"
    _make_duckdb(db, sha)
    site = tmp_path / "site"
    _seed_dossier(site, _wb_fid(sha, "fy_2024_actuals"))
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")
    return {"site": site, "sha": sha}


def _sidecar(site: Path, pe: str) -> dict:
    return json.loads((site / "json" / "program_details" / f"{pe}.json").read_text())


def _citations(site: Path) -> dict:
    return json.loads((site / "json" / "citations.json").read_text())


def _cards_by_key(summary: dict) -> dict:
    return {c["key"]: c for c in summary["cards"]}


# ---------------------------------------------------------------------------
# Summary union (P0-2) — cards prefer toa, false absence resolved
# ---------------------------------------------------------------------------


def test_summary_cards_prefer_toa(basis_site):
    """FY24 card = 5,565,655 k$ toa (workbook fact), NOT 5,247.070 M$ detail."""
    side = _sidecar(basis_site["site"], PE)
    cards = _cards_by_key(side["summary"])
    fy24 = cards["fy2024"]
    assert fy24["value"] == pytest.approx(5565655.0)
    assert fy24["units"] == "USD thousands"
    assert fy24["basis"] == "toa"
    assert fy24["fy"] == 2024
    assert fy24["measure"] == "actuals"
    assert fy24["edition"] == 2026
    assert fy24["fid"] == _wb_fid(basis_site["sha"], "fy_2024_actuals")
    assert fy24["public_id"] == fy24["fid"][:8]
    assert fy24["absence_reason"] is None


def test_summary_false_absence_resolved(basis_site):
    """The live P0-2: trajectory fy2025 is NULL but the workbook publishes
    FY25 enacted — the card must carry the value, not an absence."""
    side = _sidecar(basis_site["site"], PE)
    cards = _cards_by_key(side["summary"])
    fy25 = cards["fy2025"]
    assert fy25["value"] == pytest.approx(4972514.0)
    assert fy25["basis"] == "toa"
    assert fy25["measure"] == "enacted"
    assert fy25["absence_reason"] is None
    fy26 = cards["fy2026"]
    assert fy26["value"] == pytest.approx(4086744.0)
    assert fy26["measure"] == "request"


def test_summary_union_change_minted(basis_site):
    """fy2526 change is computable from the toa union (request − enacted) even
    though the trajectory mart has no change row — and the minted derived
    fact resolves in citations.json with a recomputable ' - ' formula."""
    side = _sidecar(basis_site["site"], PE)
    cards = _cards_by_key(side["summary"])
    chg = cards["change"]
    assert chg["value"] == pytest.approx(4086744.0 - 4972514.0)
    assert chg["basis"] == "toa"
    assert chg["measure"] == "change"
    assert chg["fy"] == 2026
    assert chg["absence_reason"] is None
    cit = _citations(basis_site["site"])
    assert chg["fid"] in cit
    c = cit[chg["fid"]]
    assert c["kind"] == "derived"
    assert " - " in c["formula"]
    inputs = json.loads(c["inputs"]) if isinstance(c["inputs"], str) else c["inputs"]
    assert inputs == [cards["fy2026"]["fid"], cards["fy2025"]["fid"]]


def test_absence_reason_enum(basis_site):
    """Sparse PE: no FY25/FY26 anywhere → not-published; change → no-comparison.
    Never a bare null-without-reason."""
    side = _sidecar(basis_site["site"], SPARSE_PE)
    cards = _cards_by_key(side["summary"])
    assert cards["fy2025"]["value"] is None
    assert cards["fy2025"]["absence_reason"] == "not-published"
    assert cards["fy2026"]["absence_reason"] == "not-published"
    assert cards["change"]["value"] is None
    assert cards["change"]["absence_reason"] == "no-comparison"
    # fy24 exists (toa preferred over the detail row)
    assert cards["fy2024"]["value"] == pytest.approx(100000.0)
    assert cards["fy2024"]["basis"] == "toa"


# ---------------------------------------------------------------------------
# Reconciliation payload (P0-1)
# ---------------------------------------------------------------------------


def test_reconciliation_entries(basis_site):
    side = _sidecar(basis_site["site"], PE)
    recon = {(r["fy"], r["measure"]): r for r in side["summary"]["reconciliation"]}
    assert set(recon) == {(2024, "actuals"), (2025, "enacted"), (2026, "request")}

    r24 = recon[(2024, "actuals")]
    assert r24["toa"]["v"] == pytest.approx(5565655.0)
    assert r24["toa"]["units"] == "USD thousands"
    assert r24["toa"]["fid"] == _wb_fid(basis_site["sha"], "fy_2024_actuals")
    assert r24["detail"]["v"] == pytest.approx(5247.070)
    assert r24["detail"]["units"] == "USD millions"
    assert r24["detail"]["fid"] == fact_id_jbook(
        basis_site["sha"], PE, None, "PriorYear", "5247.070"
    )
    assert r24["delta_thousands"] == pytest.approx(318585.0)
    assert r24["toa"]["public_id"] == r24["toa"]["fid"][:8]
    assert r24["detail"]["public_id"] == r24["detail"]["fid"][:8]
    # both sides resolve in citations.json (ONE public id namespace)
    cit = _citations(basis_site["site"])
    assert r24["toa"]["fid"] in cit and r24["detail"]["fid"] in cit


# ---------------------------------------------------------------------------
# Basis threading on the table/series payloads (leg a1 preconditions)
# ---------------------------------------------------------------------------


def test_budget_lines_carry_basis(basis_site):
    side = _sidecar(basis_site["site"], PE)
    assert side["budget_lines"], "fixture must emit P-1 rows"
    for bl in side["budget_lines"]:
        assert bl["basis"] == "toa"
        assert bl["edition"] == 2026
        assert isinstance(bl["fy"], int)
        assert bl["measure"] in {"actuals", "enacted", "request"}
        assert bl["entity"] == PE  # single row per (pe, amount_type) here
    by_at = {bl["amount_type"]: bl for bl in side["budget_lines"]}
    assert by_at["fy_2024_actuals"]["measure"] == "actuals"
    assert by_at["fy_2024_actuals"]["fy"] == 2024
    assert by_at["fy_2025_enacted"]["measure"] == "enacted"
    assert by_at["fy_2026_total"]["measure"] == "request"


def test_details_carry_basis(basis_site):
    side = _sidecar(basis_site["site"], PE)
    assert side["details"], "fixture must emit detail rows"
    by_scenario = {d["scenario"]: d for d in side["details"]}
    for d in side["details"]:
        assert d["basis"] == "jbook-detail"
        assert d["edition"] == 2026
        assert d["entity"] == PE  # root rows
    assert by_scenario["PriorYear"]["fy"] == 2024
    assert by_scenario["PriorYear"]["measure"] == "actuals"
    assert by_scenario["CurrentYear"]["fy"] == 2025
    assert by_scenario["CurrentYear"]["measure"] == "enacted"
    assert by_scenario["BudgetYearOne"]["fy"] == 2026
    assert by_scenario["BudgetYearOne"]["measure"] == "request"


def test_decade_series_points_carry_basis(basis_site):
    side = _sidecar(basis_site["site"], PE)
    series = side["decade_series"]
    for kind, points in series.items():
        for p in points:
            assert p["basis"] == "toa"
            assert p["measure"] == kind


def test_feed_cards_carry_basis(basis_site):
    feed = json.loads((basis_site["site"] / "json" / "feed.json").read_text())
    assert "scope_qualifier" in feed
    assert "excludes personnel, O&M" in feed["scope_qualifier"]
    yoy = [c for c in feed["cards"] if c["event_type"] == "yoy_swing"]
    assert yoy, "fixture seeds one yoy_swing card"
    card = yoy[0]
    assert card["basis"] == "toa"
    assert card["fy"] == 2026
    assert card["measure"] == "change"
    assert card["edition"] == 2026


# ---------------------------------------------------------------------------
# Canonical-TOA hero + scope qualifier (P0-5)
# ---------------------------------------------------------------------------


def test_hero_is_toa_with_workbook_fact(basis_site):
    meta = json.loads((basis_site["site"] / "json" / "site_meta.json").read_text())
    hero = meta["hero"]
    assert hero["pe_bli"] == PE
    assert hero["value"] == pytest.approx(5565655.0)
    assert hero["units"] == "USD thousands"
    assert hero["basis"] == "toa"
    assert hero["fy"] == 2024
    assert hero["measure"] == "actuals"
    assert hero["fid"] == _wb_fid(basis_site["sha"], "fy_2024_actuals")
    assert hero["public_id"] == hero["fid"][:8]
    assert "scope_qualifier" in hero
    q = meta["scope_qualifier"]
    assert "largest single R&D or procurement program element" in q
    assert "excludes personnel, O&M" in q
    # dynamic corpus count, not a hardcoded live literal
    assert "2 lines" in q


# ---------------------------------------------------------------------------
# WHO-GETS-IT named-primes fallback (P0-2.3)
# ---------------------------------------------------------------------------


def test_named_primes_from_dossier(basis_site):
    """Crosswalk empty + dossier players claim naming a dim_entities family →
    named_primes with the claim's fact_id. Deterministic word-boundary
    lexicon match — no NLP."""
    side = _sidecar(basis_site["site"], PE)
    primes = side["summary"]["named_primes"]
    assert primes == [
        {
            "name": "LOCKHEED MARTIN CORPORATION",
            "family_key": "LOCKHEED MARTIN",
            "fact_id": _wb_fid(basis_site["sha"], "fy_2024_actuals"),
            "public_id": _wb_fid(basis_site["sha"], "fy_2024_actuals")[:8],
        }
    ]


def test_named_primes_absent_without_dossier_names(basis_site):
    """No dossier (sparse PE) → no named_primes key content (honest absence)."""
    side = _sidecar(basis_site["site"], SPARSE_PE)
    assert side["summary"]["named_primes"] == []


# ---------------------------------------------------------------------------
# PM Sprint 1 Task 3 — exporter honesty fixes that gate 23 leg a2 forced:
# dual-volume display dedupe, per-line entities for ambiguous roots,
# (fy, measure)-scoped budget-line entities, kind-qualified decade tokens,
# and reconciliation entries whose detail side is an uncited (xml-path) root.
# ---------------------------------------------------------------------------

ZERO_PE = "ZRO000"   # toa card + single zero root → recon entry, fid-less side
AMB_PE = "AMB000"    # two DISTINCT roots per scenario → per-line entities
POTS_PE = "POT000"   # two slugs mapping to the same (fy, measure) → demoted


def _seed_task3_extras(pg_dsn: str, sha: str, tmp_path) -> str:
    """Second (dual-volume) document duplicating ATA000's rows byte-for-byte,
    plus the three edge-case PEs. Returns the second document's sha."""
    vol2 = tmp_path / "vol2.pdf"
    vol2.write_bytes(FIXTURE_PDF.read_bytes() + b"\n")
    sha2 = hashlib.sha256(vol2.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " (%s,'procurement',2026,'FY26 AF Aircraft Procurement Vol II.pdf',"
            " 'https://example.mil/af-apf-vol2.pdf',%s,%s, now(),'downloaded')",
            (ORG, str(vol2), sha2),
        )
        doc2 = con.execute(
            "select id from jbook_documents where sha256=%s", (sha2,)
        ).fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc2,),
        )
        run2 = con.execute("select max(id) from extraction_runs").fetchone()[0]
        # Dual-volume rule: identical (project, scenario, amount, xml_path)
        # rows under a second document — display duplicates of ONE fact.
        for scenario, amt in DET.items():
            con.execute(
                "insert into budget_line_details (extraction_run_id, document_id,"
                " pe_bli, scenario, amount_millions, xml_path) values"
                " (%s,%s,%s,%s,%s,'LineItem[1]')",
                (run2, doc2, PE, scenario, amt),
            )
        # ZERO_PE: single zero root (fid-less side of a reconciliation).
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id,"
            " pe_bli, scenario, amount_millions, xml_path) values"
            " (%s,%s,%s,'PriorYear','0','LineItem[9]')",
            (run2, doc2, ZERO_PE),
        )
        # AMB_PE: two DISTINCT roots for PriorYear + two for CurrentYear.
        for scenario, amounts in (
            ("PriorYear", ("0", "200.000")),
            ("CurrentYear", ("0", "150.000")),
        ):
            for i, amt in enumerate(amounts):
                con.execute(
                    "insert into budget_line_details (extraction_run_id,"
                    " document_id, pe_bli, scenario, amount_millions, xml_path)"
                    " values (%s,%s,%s,%s,%s,%s)",
                    (run2, doc2, AMB_PE, scenario, amt, f"LineItem[{20 + i}]"),
                )
        # Workbook rows: ZERO_PE + AMB_PE FY24 actuals (toa side / card);
        # POTS_PE: fy_2026_total AND fy_2026_request — BOTH map to measure
        # 'request', so neither row may claim the program-level entity.
        for pe, at, amt in (
            (ZERO_PE, "fy_2024_actuals", 500000),
            (AMB_PE, "fy_2024_actuals", 300000),
            (POTS_PE, "fy_2026_total", 100000),
            (POTS_PE, "fy_2026_request", 40000),
        ):
            con.execute(
                """
                insert into budget_lines
                  (exhibit, fiscal_year, account, account_title, organization,
                   budget_activity, budget_activity_title, pe_bli, title,
                   amount_type, amount_thousands, source_document_id,
                   source_sheet, source_cells)
                values
                  ('P-1', 2026, %s, 'Aircraft Procurement, Air Force', %s,
                   %s, 'Combat Aircraft', %s, %s,
                   %s, %s, %s, 'Exhibit P-1', ARRAY['O901'])
                """,
                (ACCT, ORG, BA, pe, pe, at, amt, doc2),
            )
    from govbudget.jbooks.provenance_pages import build_provenance_pages

    build_provenance_pages(pg_dsn)
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        # Force-resolve NONZERO amounts only — zero rows must keep their
        # honest zero_amount/unresolved resolution (fid-less state B).
        con.execute(
            "update provenance_pages set resolution='unique', page_number=1,"
            " amount_text=amount_millions::text, x0=10, x1=60, top_pt=100,"
            " bottom_pt=110, page_width=612, page_height=792"
            " where target_kind='amount' and amount_millions <> 0"
        )
    return sha2


@pytest.fixture()
def task3_site(pg_dsn, tmp_path):
    sha = _seed(pg_dsn)
    sha2 = _seed_task3_extras(pg_dsn, sha, tmp_path)
    db = tmp_path / "wh.duckdb"
    _make_duckdb(db, sha)
    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")
    return {"site": site, "sha": sha, "sha2": sha2}


def test_dual_volume_details_deduped(task3_site):
    """Identical (project, scenario, amount) rows across the two volumes are
    ONE display row each — and the surviving root rows keep entity == PE."""
    side = _sidecar(task3_site["site"], PE)
    tuples = [
        (d["project_number"], d["scenario"], d["amount_millions"])
        for d in side["details"]
    ]
    assert len(tuples) == len(set(tuples)), f"duplicate display rows: {tuples}"
    assert len(tuples) == 3  # PriorYear / CurrentYear / BudgetYearOne, once each
    assert all(d["entity"] == PE for d in side["details"])


def test_zero_root_reconciliation_entry(task3_site):
    """A single fid-less zero root that contradicts the toa card gets a
    reconciliation entry with an xml_path detail side (never silence)."""
    side = _sidecar(task3_site["site"], ZERO_PE)
    cards = _cards_by_key(side["summary"])
    assert cards["fy2024"]["value"] == pytest.approx(500000.0)
    assert cards["fy2024"]["basis"] == "toa"
    recon = {(r["fy"], r["measure"]): r for r in side["summary"]["reconciliation"]}
    assert (2024, "actuals") in recon
    r = recon[(2024, "actuals")]
    assert r["toa"]["v"] == pytest.approx(500000.0)
    assert r["detail"]["v"] == pytest.approx(0.0)
    assert r["detail"]["fid"] is None
    assert r["detail"]["xml_path"] == "LineItem[9]"


def test_ambiguous_roots_get_per_line_entities(task3_site):
    """Two DISTINCT roots for one scenario: neither may claim the program
    entity (they would mint an unreconcilable same-label collision) — and the
    unfilled card slot states the honest 'no-rollup' reason, not
    'not-published' (rows exist below)."""
    side = _sidecar(task3_site["site"], AMB_PE)
    prior = [
        d for d in side["details"]
        if d["scenario"] == "PriorYear" and d["project_number"] is None
    ]
    assert len(prior) == 2
    entities = {d["entity"] for d in prior}
    assert AMB_PE not in entities
    assert len(entities) == 2
    # fy2025: no toa source, roots ambiguous → honest no-rollup absence
    cards = _cards_by_key(side["summary"])
    assert cards["fy2025"]["value"] is None
    assert cards["fy2025"]["absence_reason"] == "no-rollup"
    # ambiguous roots never fabricate a reconciliation side
    assert (2025, "enacted") not in {
        (r["fy"], r["measure"]) for r in side["summary"]["reconciliation"]
    }


def test_same_measure_bl_rows_demoted(task3_site):
    """fy_2026_total and fy_2026_request both map to (2026, request): with two
    rows in the group, NEITHER row may claim entity == PE."""
    side = _sidecar(task3_site["site"], POTS_PE)
    rows = side["budget_lines"]
    assert len(rows) == 2
    assert all(r["measure"] == "request" and r["fy"] == 2026 for r in rows)
    entities = {r["entity"] for r in rows}
    assert POTS_PE not in entities
    assert len(entities) == 2
    # the card still resolves from the single fy_2026_total row (slot slug
    # priority) — program-level value with a workbook fact
    cards = _cards_by_key(side["summary"])
    assert cards["fy2026"]["value"] == pytest.approx(100000.0)
    assert cards["fy2026"]["basis"] == "toa"


def test_decade_measure_token_kind_qualified():
    """Decade cells render under their KIND row label; a chosen slug whose
    mapped measure diverges from the kind gets a kind-qualified token so two
    visually-distinct rows never share one (fy, measure) group."""
    from govbudget.export_site import _decade_measure_token

    assert _decade_measure_token("actuals", "actuals") == "actuals"
    assert _decade_measure_token("enacted", "request") == "enacted-request"
    assert _decade_measure_token("request", "total-base-oco") == "request-total-base-oco"
    assert _decade_measure_token("enacted", None) == "enacted"
