import os
import subprocess
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]

CONTRACT_COLS = (
    "contract_transaction_unique_key, action_date, federal_action_obligation, "
    "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name, "
    "awarding_agency_name, awarding_sub_agency_name, naics_code, "
    "product_or_service_code, primary_place_of_performance_state_code, "
    "prime_award_transaction_place_of_performance_cd_current, award_id_piid"
)

ENTITY_XWALK_COLS = (
    "recipient_uei, recipient_name, parent_uei, parent_name, "
    "family_key, method, confidence, total_obligation"
)


def write_parquet(dir_path: Path, sql: str):
    dir_path.mkdir(parents=True, exist_ok=True)
    duckdb.sql(f"copy ({sql}) to '{dir_path}/part.parquet' (format parquet)")


JBOOK_BUDGET_LINE_COLS = (
    "exhibit, fiscal_year, account, account_title, organization,"
    " budget_activity, budget_activity_title, pe_bli, title, amount_type, amount_thousands"
)

JBOOK_DETAIL_COLS = (
    "pe_bli, project_number, project_title, scenario, amount_millions,"
    " xml_path, reconciled, org, exhibit_family, fiscal_year, document_id"
)

JBOOK_NARRATIVE_COLS = (
    "pe_bli, project_number, kind, title, body, xml_path, org, fiscal_year"
)

JBOOK_AWARD_COLS = (
    "pe_bli, exhibit, fiscal_year, organization, award_piid,"
    " recipient_name, recipient_uei, matched_obligation, method, confidence, score, rationale"
)


def make_lake(data_dir: Path):
    jbooks = data_dir / "parquet/jbooks"
    jbooks.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values ('R-1','2026','0400','Research','DARPA','1','Basic Research',"
        f"'0601101E','DEFENSE RESEARCH','fy_2024_actuals','280494'))"
        f" t({JBOOK_BUDGET_LINE_COLS})) to '{jbooks}/budget_lines.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('0601101E',null,'Defense Research','PriorYear','280.494',"
        f"'ProgramElement[0]','True','DARPA','rdte','2026','1'))"
        f" t({JBOOK_DETAIL_COLS})) to '{jbooks}/details.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('0601101E',null,'accomplishment','Defense Research',"
        f"'Some body text','ProgramElement[0]','DARPA','2026'))"
        f" t({JBOOK_NARRATIVE_COLS})) to '{jbooks}/detail_narratives.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('0601101E','R-1','2026','DARPA','HR001124C0001',"
        f"'ACME RESEARCH','UEI1','5000000','account+tokens','high','4','test account'))"
        f" t({JBOOK_AWARD_COLS})) to '{jbooks}/budget_line_awards.parquet' (format parquet)"
    )
    write_parquet(
        data_dir / "parquet/contracts/fy=2017",
        f"select * from (values "
        f"('K1','2017-01-15','1000.5','UEI1','ACME','PUEI1','ACME PARENT','DoD','Army','336411','1510','CA','CA-52','HR001124C0001'),"
        f"('K2','2017-03-02','-50.25','UEI2','BETA','','','DoD','Navy','541330','R425','VA','VA-08',null)"
        f") t({CONTRACT_COLS})",
    )
    write_parquet(
        data_dir / "parquet/assistance/fy=2017",
        "select * from (values "
        "('A1','2017-02-01','5000','UEI1','ACME','PUEI1','ACME PARENT','DoD','Army','MARYLAND','MD-04')"
        ") t(assistance_transaction_unique_key, action_date, federal_action_obligation, "
        "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name, "
        "awarding_agency_name, awarding_sub_agency_name, primary_place_of_performance_state_name, "
        "prime_award_transaction_place_of_performance_cd_current)",
    )
    # entity_xwalk fixture — one row, all 8 columns
    entities = data_dir / "parquet/entities"
    entities.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values "
        f"('UEI1','ACME','PUEI1','ACME PARENT INC','ACME PARENT','parent_name','high',6000.5))"
        f" t({ENTITY_XWALK_COLS})) to '{entities}/entity_xwalk.parquet' (format parquet)"
    )
    write_parquet(
        data_dir / "parquet/subawards/fy=2017",
        "select * from (values ('K1','250.0','2017-05-01','SUEI1','GAMMA SUB')) "
        "t(prime_award_unique_key, subaward_amount, subaward_action_date, subawardee_uei, subawardee_name)",
    )
    write_parquet(
        data_dir / "parquet/mts_outlays",
        "select * from (values ('2017-10-31','Department of Defense','1000')) "
        "t(record_date, classification_desc, current_month_gross_outly_amt)",
    )
    # oversight fixtures for new efficiency marts
    oversight = data_dir / "parquet/oversight"
    oversight.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values "
        f"('Medicare Fee-for-Service','Department of Health and Human Services','hhs','2023','7.66','31700000000','413900000000','https://paymentaccuracy.gov/program/hhs-medicare-ffs'),"
        f"('Medicare Fee-for-Service','Department of Health and Human Services','hhs','2022','6.26','25740000000','411300000000','https://paymentaccuracy.gov/program/hhs-medicare-ffs'),"
        f"('SNAP','Department of Agriculture','usda','2023','5.74','5060000000','88100000000','https://paymentaccuracy.gov/program/usda-snap'),"
        f"('SNAP','Department of Agriculture','usda','2022','4.71','3970000000','84300000000','https://paymentaccuracy.gov/program/usda-snap'),"
        f"('Earned Income Tax Credit','Department of the Treasury','treasury','2023','34.02','21900000000','64400000000','https://paymentaccuracy.gov/program/treasury-eitc')"
        f") t(program, agency_name, agency_code, fiscal_year, rate_pct, amount_usd, outlays_usd, source_url))"
        f" to '{oversight}/improper_payments.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('DOD Contract Management','https://files.gao.gov/reports/GAO-25-107743/index.html#dod-contract','DOD','true','DoD contract management','https://www.gao.gov/high-risk-list'),"
        f"('DOD Weapon Systems Acquisition','https://files.gao.gov/reports/GAO-25-107743/index.html#dod-weapons','DOD','true','DoD weapons programs','https://www.gao.gov/high-risk-list'),"
        f"('Medicare/Medicaid','https://files.gao.gov/reports/GAO-25-107743/index.html#medicare','HHS','true','CMS programs','https://www.gao.gov/high-risk-list'),"
        f"('Enforcement of Tax Laws','https://files.gao.gov/reports/GAO-25-107743/index.html#tax','TREASURY','true','IRS enforcement','https://www.gao.gov/high-risk-list'),"
        f"('Unmapped Area','https://files.gao.gov/reports/GAO-25-107743/index.html#unmapped','','false','no clear agency','https://www.gao.gov/high-risk-list')"
        f") t(area_title, area_url, agency_code, mapped, notes, source_url))"
        f" to '{oversight}/high_risk.parquet' (format parquet)"
    )


def test_dbt_build_succeeds_on_fixture_lake(tmp_path):
    make_lake(tmp_path)
    (tmp_path / "duckdb").mkdir()
    env = {
        **os.environ,
        "GOVBUDGET_DATA": str(tmp_path),
        "GOVBUDGET_DUCKDB": str(tmp_path / "duckdb" / "test.duckdb"),
    }
    result = subprocess.run(
        ["uv", "run", "dbt", "build", "--project-dir", "dbt", "--profiles-dir", "dbt"],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    con = duckdb.connect(str(tmp_path / "duckdb" / "test.duckdb"))
    assert con.sql("select count(*) from fct_award_transactions").fetchone()[0] == 3
    assert con.sql("select count(*) from dim_recipients").fetchone()[0] == 2
    assert con.sql(
        "select total_obligation from dim_recipients where recipient_uei='UEI1'"
    ).fetchone()[0] == 6000.5
