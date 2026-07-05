"""FIX 1 — data-derived ingested-service-org set (site_meta.ingested_service_orgs).

export_site._ingested_service_orgs is the single source of truth the site reads
to decide the rollup-note wording. It must:

  * include every FY2026 status='downloaded' org, TRANSLATED into the
    budget_lines.organization (workbook) code space via workbook_org — because
    the site keys the note off details.service_org (a workbook org), NOT the
    jbook_documents document org (CYBERCOM→CYBER, CHIPS/DPAP→OSD);
  * exclude orgs with no loaded FY2026 book (DHA, DEFW, IG) so those rollup
    pages keep the honest "not yet ingested" wording;
  * exclude non-2026 / non-downloaded rows.
"""
import psycopg

from govbudget.export_site import _ingested_service_orgs

# pg_dsn / _clean_tables come from tests/jbooks/conftest.py (this module lives
# under tests/jbooks/ so they apply automatically).


def _insert_doc(dsn: str, org: str, *, fiscal_year: int = 2026,
                status: str = "downloaded") -> None:
    # source_url has a UNIQUE constraint — make it distinct per fixture row.
    url = f"https://example.test/{org}-{fiscal_year}-{status}.xlsx"
    with psycopg.connect(dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year,"
            " title, source_url, status) values (%s, 'rollup', %s,"
            " 'fixture.xlsx', %s, %s)",
            (org, fiscal_year, url, status),
        )


def test_ingested_set_includes_agency_books_in_workbook_code_space(pg_dsn):
    # A real slice of the live FY2026 loaded-book org set, spanning the three
    # aliasing cases and the defense-wide agencies that the old hardcoded A/N/F
    # set wrongly excluded.
    for org in ["A", "N", "F", "OSD", "DCSA", "MDA", "DISA", "DARPA",
                "CYBERCOM", "CHIPS", "DPAP", "DoD"]:
        _insert_doc(pg_dsn, org)

    with psycopg.connect(pg_dsn) as con:
        got = _ingested_service_orgs(con)

    # Defense-wide agencies must be present (these are the pages that used to lie).
    for org in ["OSD", "DCSA", "MDA", "DISA", "DARPA"]:
        assert org in got, f"{org} book is loaded — its rollup pages must not say 'not yet ingested'"
    # Services still present.
    for org in ["A", "N", "F"]:
        assert org in got
    # Code-space aliasing: the DOCUMENT orgs CYBERCOM/CHIPS/DPAP land under their
    # WORKBOOK org codes (CYBER / OSD), matching details.service_org.
    assert "CYBER" in got, "CYBERCOM book must map to workbook org CYBER (service_org space)"
    assert "CYBERCOM" not in got, "the document-org spelling must not leak into the set"
    # CHIPS + DPAP both alias to OSD (already asserted present); confirm no stray leak.
    assert "CHIPS" not in got and "DPAP" not in got


def test_ingested_set_excludes_orgs_with_no_loaded_book(pg_dsn):
    # Only these three orgs have a loaded book; DHA/DEFW/IG never get one here.
    for org in ["OSD", "DCSA", "MDA"]:
        _insert_doc(pg_dsn, org)

    with psycopg.connect(pg_dsn) as con:
        got = _ingested_service_orgs(con)

    for org in ["DHA", "DEFW", "IG"]:
        assert org not in got, f"{org} has no FY2026 book — its rollup pages MUST stay 'not yet ingested'"


def test_ingested_set_excludes_wrong_year_and_pending_status(pg_dsn):
    _insert_doc(pg_dsn, "OSD")                              # counts
    _insert_doc(pg_dsn, "DHA", fiscal_year=2025)            # wrong year
    _insert_doc(pg_dsn, "IG", status="pending")            # not downloaded

    with psycopg.connect(pg_dsn) as con:
        got = _ingested_service_orgs(con)

    assert got == ["OSD"]
