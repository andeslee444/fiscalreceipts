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
          ('K1','HR001124C0001','5000000','097-0400','DEFENSE RESEARCH SCIENCES SUPPORT',
           'BASIC RESEARCH MATH SCIENCES','ACME RESEARCH LLC','UEIDARPA1',
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


def seed_budget(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " pe_bli, title, amount_type, amount_thousands) values"
            " ('R-1',2026,'0400','DARPA','0601101E','DEFENSE RESEARCH SCIENCES',"
            " 'fy_2024_actuals',%s)",
            (Decimal("280494"),),
        )


def test_crosswalk_matches_by_account_and_scores_confidence(pg_dsn, tmp_path):
    seed_budget(pg_dsn)
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
    assert rows["HR001124C0001"][1] == "high"   # account + title-token overlap
    assert rows["HR001124C0003"][1] == "medium"  # account + DARPA sub-agency only
    assert rows["HR001124C0001"][3] == Decimal("5000000")


def test_crosswalk_is_idempotent(pg_dsn, tmp_path):
    seed_budget(pg_dsn)
    lake = make_award_parquet(tmp_path)
    kwargs = dict(organization="DARPA", treasury_agency="097",
                  award_glob=str(lake / "contracts" / "*" / "*.parquet"))
    crosswalk_org(pg_dsn, **kwargs)
    crosswalk_org(pg_dsn, **kwargs)
    with psycopg.connect(pg_dsn) as con:
        n = con.execute("select count(*) from budget_line_awards").fetchone()[0]
    assert n == 2
