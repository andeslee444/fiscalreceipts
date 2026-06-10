from decimal import Decimal
from pathlib import Path

import duckdb
import psycopg

from govbudget.jbooks.crosswalk import crosswalk_org

AWARD_COLS = (
    "contract_transaction_unique_key, award_id_piid, federal_action_obligation,"
    " federal_accounts_funding_this_award, transaction_description,"
    " prime_award_base_transaction_description, recipient_name, recipient_uei,"
    " awarding_sub_agency_name, action_date"
)


def make_award_parquet(tmp_path: Path) -> Path:
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('K1','HR001124C0001','5000000','097-0400','DEFENSE RESEARCH SCIENCES MATHEMATICS PROGRAM',
           'BASIC MATHEMATICS SCIENCES INITIATIVE','ACME RESEARCH LLC','UEIDARPA1',
           'Defense Advanced Research Projects Agency','2024-03-01'),
          ('K2','HR001124C0002','100','021-2040','UNRELATED ARMY THING',
           'TANK PARTS','TANKCO','UEITANK','Dept of the Army','2024-04-01'),
          ('K3','HR001124C0003','750000','021-1319;097-0400','RESEARCH SUPPORT SERVICES',
           'SOMETHING ELSE ENTIRELY','BETA LABS','UEIBETA',
           'Defense Advanced Research Projects Agency','2024-05-01')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    return tmp_path


def make_navy_award_parquet(tmp_path: Path) -> Path:
    """Navy parquet: one award under 017-1319, one under 097-1319 only."""
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('N1','N0001824C0001','2000000','017-1319','NAVAL RESEARCH SCIENCES PROGRAM',
           'OCEAN RESEARCH INITIATIVE','NAVY LABS LLC','UEINAV1',
           'Department of the Navy','2024-06-01'),
          ('N2','N0001824C0002','500000','097-1319','DEFENSE WIDE SCIENCES THING',
           'SOME DEFENSE PROGRAM','DEFENSE CO','UEIDEF1',
           'Under Secretary of Defense','2024-07-01')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    return tmp_path


def seed_budget(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','DEFENSE RESEARCH SCIENCES',"
            " 'fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )


def seed_budget_with_detail(pg_dsn):
    """Seed DARPA budget line with a detail row for project title tokens."""
    with psycopg.connect(pg_dsn) as con:
        # Insert budget line
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','DEFENSE RESEARCH SCIENCES',"
            " 'fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )
        # Insert jbook_documents row (minimal, no real file)
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title, source_url)"
            " values ('DARPA','rdte',2026,'darpa_test.pdf','https://example.test/darpa.pdf')"
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        # Insert extraction_runs row
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions, status)"
            " values (%s,1,'{}','success')",
            (doc_id,),
        )
        run_id = con.execute("select id from extraction_runs").fetchone()[0]
        # Insert budget_line_details row with project_title
        con.execute(
            "insert into budget_line_details"
            " (pe_bli, project_number, project_title, scenario, amount_millions,"
            "  xml_path, extraction_run_id, document_id, superseded)"
            " values ('0601101E','CCS-02','MATHEMATICS AND COMPUTER SCIENCES',"
            "         'PriorYear',1,'ProgramElement[0]',%s,%s,false)",
            (run_id, doc_id),
        )


def seed_navy_budget(pg_dsn):
    """Seed Navy budget line with account '1319N' (service-letter N -> 017)."""
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'1319N','NAVY','0601152N','NAVY RESEARCH SCIENCES',"
            " 'fy_2024_actuals',%s)",
            (Decimal("50000"),),
        )


def test_crosswalk_matches_by_account_and_scores_confidence(pg_dsn, tmp_path):
    seed_budget_with_detail(pg_dsn)
    lake = make_award_parquet(tmp_path)
    n = crosswalk_org(
        pg_dsn, organization="DARPA", treasury_agency="097",
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
    )
    assert n == 2  # K1 and K3 (097-0400 in accounts); K2 excluded
    with psycopg.connect(pg_dsn) as con:
        rows = {
            r[0]: r for r in con.execute(
                "select award_piid, confidence, recipient_name, matched_obligation"
                " from budget_line_awards where pe_bli='0601101E'"
            )
        }
    assert rows["HR001124C0001"][1] == "high"   # account + >=2 title-token overlap
    assert rows["HR001124C0003"][1] == "medium"  # account + DARPA sub-agency only
    assert rows["HR001124C0001"][3] == Decimal("5000000")


def test_crosswalk_is_idempotent(pg_dsn, tmp_path):
    seed_budget_with_detail(pg_dsn)
    lake = make_award_parquet(tmp_path)
    kwargs = dict(organization="DARPA", treasury_agency="097",
                  award_glob=str(lake / "contracts" / "*" / "*.parquet"))
    crosswalk_org(pg_dsn, **kwargs)
    crosswalk_org(pg_dsn, **kwargs)
    with psycopg.connect(pg_dsn) as con:
        n = con.execute("select count(*) from budget_line_awards").fetchone()[0]
    assert n == 2


def test_crosswalk_navy_service_letter_maps_to_017(pg_dsn, tmp_path):
    """Fix C2: account '1319N' must resolve to agency 017, matching 017-1319 awards.

    The award under 097-1319 only must NOT match.
    """
    seed_navy_budget(pg_dsn)
    lake = make_navy_award_parquet(tmp_path)
    n = crosswalk_org(
        pg_dsn, organization="NAVY", treasury_agency="097",
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
    )
    # Only N1 (017-1319) should match; N2 (097-1319) must not
    assert n == 1
    with psycopg.connect(pg_dsn) as con:
        rows = con.execute(
            "select award_piid from budget_line_awards where pe_bli='0601152N'"
        ).fetchall()
    piids = [r[0] for r in rows]
    assert "N0001824C0001" in piids    # 017-1319 award matched
    assert "N0001824C0002" not in piids  # 097-1319 award NOT matched


def test_crosswalk_small_token_not_high_confidence(pg_dsn, tmp_path):
    """Fix I1: 'small' is a stopword; generic-token coincidences must not reach 'high'.

    An award for 'SMALL DIAMETER BOMB INCREMENT II' vs a line titled
    'SMALL BUSINESS INNOVATION RESEARCH' should NOT be high confidence.
    """
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601SBIR','SMALL BUSINESS INNOVATION RESEARCH',"
            " 'fy_2024_actuals',%s)",
            (Decimal("10000"),),
        )
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('SB1','FA860124C0099','999999','097-0400',
           'SMALL DIAMETER BOMB INCREMENT II',
           'SMALL DIAMETER BOMB INCREMENT II','BOMB CO','UEIBOMB',
           'Defense Advanced Research Projects Agency','2024-08-01')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    crosswalk_org(
        pg_dsn, organization="DARPA", treasury_agency="097",
        award_glob=str(tmp_path / "contracts" / "*" / "*.parquet"),
    )
    with psycopg.connect(pg_dsn) as con:
        rows = con.execute(
            "select award_piid, confidence from budget_line_awards where pe_bli='0601SBIR'"
        ).fetchall()
    # The award may or may not match (sub-agency gives medium) but must not be high
    for piid, conf in rows:
        assert conf != "high", f"Expected not-high for stopword-only match, got {conf} for {piid}"
