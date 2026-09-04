"""Account-qualified link targets for shared BLI codes (ROADMAP #70, Task 7).

Ten pe_bli values in the PB2026 corpus are shared by TWO real programs that
differ only by appropriation ACCOUNT — '3010' is LPD Flight II in
Shipbuilding & Conversion, Navy (1611N) AND Shipboard Tactical Communications
in Other Procurement, Navy (1810N). Sprint E Task E3 already gives each member
its own page (`3010-SCN` / `3010-OPN`) and turns the bare `/program/3010/`
into a disambiguation stub, but BOTH link scripts excluded every shared key
outright (`display -= collisions`), so neither member page ever showed an
award.

This module pins the two halves of the fix:

  (a) the derivation emits DISTINCT link rows, each carrying the `account` of
      the one member the award's funding accounts identify — 097-1611 money
      lands on 1611N, 097-1810 money on 1810N, and money that names both (or
      neither) links nothing;
  (b) the exporter files those rows onto the two members' own
      `program_details/{slug}.json` sidecars and NEVER onto the bare-key stub.

Organization-split keys ('20', '30', '500' — same account 0300D, different
organization) stay excluded: account evidence cannot tell their members apart,
so there is nothing to resolve.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import duckdb
import psycopg
import pytest

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test_collision"

# The real PB2026 shape this module models (see docs and dim_programs.sql).
SCN, OPN = "1611N", "1810N"
SCN_TITLE = "Shipbuilding and Conversion, Navy"
OPN_TITLE = "Other Procurement, Navy"
SCN_FED, OPN_FED = "017-1611", "017-1810"


# ---------------------------------------------------------------------------
# (0) Pure key partitioning — which shared keys can be resolved at all
# ---------------------------------------------------------------------------


def test_account_split_keys_are_separated_from_org_split_keys():
    from collision_keys import partition_split_keys

    rows = [
        ("0601101E", "0400"),          # ordinary key — one row, never split
        ("3010", SCN), ("3010", OPN),  # account-split (ROADMAP #67)
        ("20", "0300D"), ("20", "0300D"),  # org-split (ROADMAP #45)
    ]
    account_split, org_split = partition_split_keys(rows)
    assert account_split == {"3010": {SCN, OPN}}
    assert org_split == {"20"}
    assert "0601101E" not in account_split and "0601101E" not in org_split


def test_a_key_whose_account_does_not_identify_one_row_is_not_account_split():
    """Three rows over two accounts: the account names a member ambiguously,
    so the key is NOT resolvable and must stay excluded."""
    from collision_keys import partition_split_keys

    account_split, org_split = partition_split_keys(
        [("30", "0300D"), ("30", "0300D"), ("30", "0301D")]
    )
    assert account_split == {}
    assert org_split == {"30"}


def test_member_for_award_needs_exactly_one_hit():
    from collision_keys import member_for_award

    members = {SCN: {SCN_FED}, OPN: {OPN_FED}}
    assert member_for_award(members, {SCN_FED}) == SCN
    assert member_for_award(members, {OPN_FED, "097-3400"}) == OPN
    # named by BOTH members' money → not attributable
    assert member_for_award(members, {SCN_FED, OPN_FED}) is None
    # named by neither → not attributable
    assert member_for_award(members, {"097-3400"}) is None
    assert member_for_award(members, set()) is None


def test_member_for_document_needs_exactly_one_hit():
    from collision_keys import member_for_document

    members = {SCN, OPN}
    assert member_for_document({SCN}, members) == SCN
    assert member_for_document({SCN, OPN}, members) is None
    assert member_for_document(set(), members) is None
    assert member_for_document({"1507N"}, members) is None


# ---------------------------------------------------------------------------
# (a) derive_ap_links emits distinct, account-keyed rows for 3010's members
# ---------------------------------------------------------------------------

_ACCOUNT_IDX = 12  # out_row[12] is the new `account` column


def _line_meta():
    return {
        ("3010", SCN): {"fed_accounts": {SCN_FED}, "org": "N", "exhibit": "P-1"},
        ("3010", OPN): {"fed_accounts": {OPN_FED}, "org": "N", "exhibit": "P-1"},
        ("0601101E", None): {
            "fed_accounts": {"097-0400"}, "org": "DARPA", "exhibit": "R-1",
        },
    }


def _award_rows(award_accounts, candidates):
    from derive_ap_links import link_rows_for_award

    return link_rows_for_award(
        ap_code="542",
        piid="N0002420C0001",
        recipient_name="Huntington Ingalls",
        recipient_uei="UEI1",
        award_accounts=award_accounts,
        obligation=1_000_000.0,
        candidates=candidates,
        line_meta=_line_meta(),
        account_split={"3010": {SCN, OPN}},
    )


def test_scn_money_links_only_the_scn_member():
    rows = _award_rows({SCN_FED}, [{"pe_bli": "3010", "match_kind": "title-variant"}])
    assert len(rows) == 1
    assert rows[0][0] == "3010"
    assert rows[0][_ACCOUNT_IDX] == SCN
    assert rows[0][9] == "medium"          # confidence
    assert rows[0][8] == "fpds-ap"         # method


def test_opn_money_links_only_the_opn_member():
    rows = _award_rows({OPN_FED}, [{"pe_bli": "3010", "match_kind": "title-variant"}])
    assert len(rows) == 1
    assert rows[0][_ACCOUNT_IDX] == OPN


def test_the_two_members_get_distinct_rows_from_distinct_awards():
    """The whole point: two awards, two accounts, two DIFFERENT link rows."""
    scn = _award_rows({SCN_FED}, [{"pe_bli": "3010", "match_kind": "title-variant"}])
    opn = _award_rows({OPN_FED}, [{"pe_bli": "3010", "match_kind": "title-variant"}])
    assert {r[_ACCOUNT_IDX] for r in scn + opn} == {SCN, OPN}


def test_money_naming_both_members_links_nothing():
    rows = _award_rows(
        {SCN_FED, OPN_FED}, [{"pe_bli": "3010", "match_kind": "title-variant"}]
    )
    assert rows == []


def test_money_naming_neither_member_links_nothing():
    rows = _award_rows(
        {"097-3400"}, [{"pe_bli": "3010", "match_kind": "title-variant"}]
    )
    assert rows == []


def test_ordinary_keys_are_untouched_and_carry_a_null_account():
    rows = _award_rows(
        {"097-0400"}, [{"pe_bli": "0601101E", "match_kind": "title-exact"}]
    )
    assert len(rows) == 1
    assert rows[0][0] == "0601101E"
    assert rows[0][_ACCOUNT_IDX] is None
    assert rows[0][9] == "medium"


def test_an_unresolvable_collision_line_never_starves_its_co_candidates():
    """An award whose accounts name both 3010 members still links the
    ordinary line mapped to the same AP code."""
    rows = _award_rows(
        {SCN_FED, OPN_FED, "097-0400"},
        [
            {"pe_bli": "3010", "match_kind": "title-variant"},
            {"pe_bli": "0601101E", "match_kind": "title-exact"},
        ],
    )
    assert [r[0] for r in rows] == ["0601101E"]
    assert rows[0][_ACCOUNT_IDX] is None


# ---------------------------------------------------------------------------
# (a2) the announcement loader resolves a shared key from its lexicon document
# ---------------------------------------------------------------------------


def test_announcement_collision_account_comes_from_the_lexicon_document():
    from load_announcement_links import collision_account_for

    # doc 341 is SCN_Book.pdf; its 3010 detail rows are stamped 1611N.
    doc_accounts = {("3010", "341"): {SCN}, ("3010", "333"): {OPN}}
    members = {SCN, OPN}
    assert collision_account_for(
        "3010", {"lexicon_doc": "341"}, doc_accounts, members) == SCN
    assert collision_account_for(
        "3010", {"lexicon_doc": "333"}, doc_accounts, members) == OPN


def test_announcement_collision_without_a_usable_document_is_not_resolved():
    from load_announcement_links import collision_account_for

    doc_accounts = {("3010", "341"): {SCN}}
    members = {SCN, OPN}
    assert collision_account_for("3010", {}, doc_accounts, members) is None
    assert collision_account_for(
        "3010", {"lexicon_doc": "None"}, doc_accounts, members) is None
    # a book that carries BOTH members' lines names neither
    assert collision_account_for(
        "3010", {"lexicon_doc": "999"}, {("3010", "999"): {SCN, OPN}}, members
    ) is None


# ---------------------------------------------------------------------------
# (b) the exporter files the rows on the members' pages, not the stub
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def collision_pg_dsn():
    """A throwaway migrated database of this module's own, so seeding two
    3010 budget lines cannot leak into any other suite's fixtures."""
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres unavailable ({e}); start local postgres to run this suite")
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()

    parts = urlsplit(ADMIN_DSN)
    dsn = urlunsplit(parts._replace(path="/" + TEST_DB))

    from govbudget.jbooks.db import migrate

    migrate(dsn)
    yield dsn

    admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.close()


def _seed_split_key_budget_lines(dsn: str) -> None:
    """One P-1 workbook row per 3010 member, in its own appropriation."""
    with psycopg.connect(dsn, autocommit=True) as con:
        doc_id = con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year,"
            " title, source_url, status) values ('N','procurement',2026,"
            " 'SCN_Book.pdf','https://example.test/scn.pdf','downloaded')"
            " returning id"
        ).fetchone()[0]
        for account, account_title, title in (
            (SCN, SCN_TITLE, "LPD Flight II"),
            (OPN, OPN_TITLE, "Shipboard Tactical Communications"),
        ):
            con.execute(
                "insert into budget_lines (exhibit, fiscal_year, account,"
                " account_title, organization, budget_activity,"
                " budget_activity_title, pe_bli, title, amount_type,"
                " amount_thousands, source_document_id, source_sheet,"
                " source_cells) values ('P-1',2026,%s,%s,'N','01','Ships',"
                " '3010',%s,'fy_2026_total',100000,%s,'Exhibit P-1',"
                " ARRAY['B7'])",
                (account, account_title, title, doc_id),
            )


def _make_collision_duckdb(db_path: Path) -> None:
    """The shared 1-row mart fixture, widened to the E1 (account, pe_bli)
    grain and given 3010's two members plus one account-keyed link each."""
    from jbooks.test_export_site_pg import _make_test_duckdb

    _make_test_duckdb(db_path)
    con = duckdb.connect(str(db_path))
    con.execute("alter table dim_programs add column account varchar")
    con.execute("alter table dim_programs add column account_title varchar")
    con.execute(
        "insert into dim_programs (pe_bli, title, org, exhibit_family,"
        " project_count, fy2024_actual_millions, fully_reconciled, account,"
        " account_title) values"
        f" ('3010','LPD Flight II','N','procurement',0,10.0,true,'{SCN}','{SCN_TITLE}'),"
        f" ('3010','Shipboard Tactical Communications','N','procurement',0,"
        f"  5.0,true,'{OPN}','{OPN_TITLE}')"
    )
    con.execute("alter table fct_budget_to_awards add column account varchar")
    con.execute(
        "insert into fct_budget_to_awards (pe_bli, exhibit, fiscal_year,"
        " organization, award_piid, recipient_name, recipient_uei, method,"
        " confidence, program_title, account) values"
        f" ('3010','P-1',2026,'N','N0002420C0001','Huntington Ingalls','UEI1',"
        f"  'fpds-ap','medium','LPD Flight II','{SCN}'),"
        f" ('3010','P-1',2026,'N','N0003917D0006','Serco','UEI2',"
        f"  'fpds-ap','medium','Shipboard Tactical Communications','{OPN}')"
    )
    con.close()


@pytest.fixture(scope="module")
def collision_export(collision_pg_dsn, tmp_path_factory):
    from govbudget.export_site import export_site

    tmp_path = tmp_path_factory.mktemp("collision")
    _seed_split_key_budget_lines(collision_pg_dsn)
    db = tmp_path / "wh.duckdb"
    _make_collision_duckdb(db)
    site = tmp_path / "site"
    export_site(
        collision_pg_dsn, db, out_dir=site,
        pdf_base_url="https://cdn.example/pdfs",
    )
    return site


def _sidecar(site: Path, slug: str) -> dict:
    return json.loads((site / "json" / "program_details" / f"{slug}.json").read_text())


def test_each_member_page_carries_only_its_own_award(collision_export):
    scn = _sidecar(collision_export, "3010-SCN")
    opn = _sidecar(collision_export, "3010-OPN")
    assert [a["award_piid"] for a in scn["awards"]] == ["N0002420C0001"]
    assert [a["award_piid"] for a in opn["awards"]] == ["N0003917D0006"]


def test_the_two_member_pages_share_no_award(collision_export):
    scn = {a["award_piid"] for a in _sidecar(collision_export, "3010-SCN")["awards"]}
    opn = {a["award_piid"] for a in _sidecar(collision_export, "3010-OPN")["awards"]}
    assert scn and opn and not (scn & opn)


def test_no_bare_key_sidecar_is_written_for_a_split_key(collision_export):
    bare = collision_export / "json" / "program_details" / "3010.json"
    assert not bare.exists(), "the bare key is a disambiguation stub — it owns no links"


def test_programs_json_award_counts_are_per_member(collision_export):
    programs = json.loads(
        (collision_export / "json" / "programs.json").read_text()
    )
    by_slug = {p["slug"]: p for p in programs if p["pe_bli"] == "3010"}
    assert set(by_slug) == {"3010-SCN", "3010-OPN"}
    assert by_slug["3010-SCN"]["award_count"] == 1
    assert by_slug["3010-OPN"]["award_count"] == 1


def test_ordinary_program_award_attachment_is_unchanged(collision_export):
    """The 1-row fixture's ordinary PE keeps its own link — an account-NULL
    mart row must behave exactly as it did before this task."""
    d = _sidecar(collision_export, "0601101E")
    assert [a["award_piid"] for a in d["awards"]] == ["W911QX-24-C-0001"]


def test_link_citation_row_names_the_account_for_a_split_key(collision_export):
    """The link's provenance sentence must say WHICH member it links, or the
    citation is ambiguous between two programs sharing one code."""
    from govbudget.export_site import fact_id_derived

    by_fid = json.loads(
        (collision_export / "json" / "citations.json").read_text()
    )
    scn_fid = fact_id_derived(
        "budget_to_awards", "3010|N0002420C0001", "link")
    assert scn_fid in by_fid
    assert SCN in (by_fid[scn_fid].get("formula") or "")
