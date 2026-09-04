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
    "prime_award_transaction_place_of_performance_cd_current, award_id_piid, "
    "usaspending_permalink, contract_award_unique_key, "
    # Phase 5H flowdown columns (stg_flow_contracts)
    "awarding_office_name, extent_competed, number_of_offers_received"
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
    " budget_activity, budget_activity_title, pe_bli, title, amount_type, amount_thousands,"
    " source_document_id"
)

JBOOK_DOCUMENT_COLS = (
    "id, org, exhibit_family, fiscal_year, title, source_url, sha256,"
    " bytes, downloaded_at, rel_path"
)

JBOOK_DETAIL_COLS = (
    "pe_bli, project_number, project_title, scenario, amount_millions,"
    " xml_path, reconciled, org, exhibit_family, fiscal_year, document_id,"
    " account"
)

JBOOK_NARRATIVE_COLS = (
    "pe_bli, project_number, kind, title, body, xml_path, org, fiscal_year"
)

JBOOK_AWARD_COLS = (
    # `account` (migration 014, ROADMAP #70): the ONE program a link belongs
    # to for a pe_bli two programs share; NULL for every key that names one.
    "pe_bli, exhibit, fiscal_year, organization, award_piid,"
    " recipient_name, recipient_uei, matched_obligation, method, confidence, score,"
    " rationale, account"
)


def make_lake(data_dir: Path):
    jbooks = data_dir / "parquet/jbooks"
    jbooks.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values ('R-1','2026','0400','Research','DARPA','1','Basic Research',"
        f"'0601101E','DEFENSE RESEARCH','fy_2024_actuals','280494','1'),"
        # Phase 5H: fy_2026_total detail rows feed the budget flow river —
        # two programs under one BA so the flow tree has real fan-out,
        # plus a title-NULL, provenance-less rollup row that the dedup rules
        # MUST exclude (flow: title IS NOT NULL; decade series:
        # source_document_id IS NOT NULL + lake-verifiability withhold).
        f"('R-1','2026','0400','Research','DARPA','1','Basic Research',"
        f"'0601101E','DEFENSE RESEARCH','fy_2026_total','300000','1'),"
        f"('R-1','2026','0400','Research','DARPA','1','Basic Research',"
        f"'0601102E','APPLIED RESEARCH','fy_2026_total','100000','1'),"
        f"('R-1','2026','0400','Research','DARPA','1','Basic Research',"
        f"'0601101E',null,'fy_2026_total','400000',null),"
        # Decoy PB2024-edition titled row: dim_pe_titles' PB2026 fence
        # (fiscal_year = 2026) must keep it out of the alphabetical
        # fallback pool, or 'AAA ANCIENT NAME' would shadow the PB2026
        # title for 0601102E (adversarial review Finding A).
        f"('R-1','2024','0400','Research','DARPA','1','Basic Research',"
        f"'0601102E','AAA ANCIENT NAME','fy_2022_actuals','90000','2'),"
        # Phase 5E: PB2024 request row → fct_book_diff request_vs_actuals
        # pair with the PB2026 fy_2024_actuals row (FY2024 asked vs spent).
        f"('R-1','2024','0400','Research','DARPA','1','Basic Research',"
        f"'0601101E','DEFENSE RESEARCH','fy_2024_request','250000','2'),"
        # Phase 5E: PB2019 OSD row — its jbook details ship in TWO volumes
        # (docs 278/279 below); fct_decade_series must carry the
        # single-volume value 7,940, never the both-volumes sum 15,880
        # (assert_decade_series_pb2019_osd_single_volume).
        f"('R-1','2019','0400D','Research','OSD','3','Advanced Technology',"
        f"'0303140D8Z','Information Systems Security Program','fy_2019_total','7940','278'),"
        # Phase 5E Task 5 improvements (P-1R recompute correction): a modern
        # P-1 line with a nonzero P-1R reserve-component sibling sharing the
        # (pe_bli, amount_type) slug. P-1R is a SUBSET of P-1 (P-1 is the
        # inclusive total), so fct_decade_series must publish the P-1-only
        # value 1,775,293 — the naive P-1 + P-1R recompute (3,475,293) used
        # to withhold this grain (assert_decade_series_p1r_published_grains).
        f"('P-1','2025','3010F','Aircraft Procurement, Air Force','F','01','Combat Aircraft',"
        f"'C130J0','C-130J','fy_2023_actuals','1775293','300'),"
        f"('P-1R','2025','3010F','Aircraft Procurement, Air Force','F','01','Combat Aircraft',"
        f"'C130J0','C-130J','fy_2023_actuals','1700000','300'),"
        # Wave 5: ONE budget-line code, TWO unrelated Navy programs in two
        # appropriations — the live '3010' shape (LPD Flight II in
        # Shipbuilding & Conversion, Shipboard Tactical Communications in
        # Other Procurement). Both sides report fy_2026_total, so this is a
        # genuine collision on dim_programs' own anchor, and both carry
        # R-2/P-40 detail below. Before Wave 5 the detail source had no
        # account and the mart summed them into ONE row of $528.574M under
        # the communications title; assert_dim_programs_detail_account_single
        # fails on exactly that.
        f"('P-1','2026','1611N','Shipbuilding and Conversion, Navy','N','02','Other Warships',"
        f"'3010','LPD Flight II','fy_2024_actuals','500000','400'),"
        f"('P-1','2026','1611N','Shipbuilding and Conversion, Navy','N','02','Other Warships',"
        f"'3010','LPD Flight II','fy_2026_total','1000000','400'),"
        f"('P-1','2026','1810N','Other Procurement, Navy','N','01','Ship Propulsion',"
        f"'3010','Shipboard Tactical Communications','fy_2024_actuals','28574','401'),"
        f"('P-1','2026','1810N','Other Procurement, Navy','N','01','Ship Propulsion',"
        f"'3010','Shipboard Tactical Communications','fy_2026_total','50000','401'))"
        f" t({JBOOK_BUDGET_LINE_COLS})) to '{jbooks}/budget_lines.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('1','DARPA','rdte','2026','vol1.pdf',"
        f"'https://example.test/vol1.pdf','sha-darpa-2026','1000','2026-06-01','fy2026/darpa/vol1.pdf'),"
        f"('2','DARPA','rdte','2024','vol1.pdf',"
        f"'https://example.test/2024/vol1.pdf','sha-darpa-2024','1000','2026-06-01','fy2024/darpa/vol1.pdf'),"
        f"('278','OSD','rdte','2019','vol3a.pdf',"
        f"'https://example.test/2019/vol3a.pdf','sha-osd-2019-a','1000','2026-06-01','fy2019/osd/vol3a.pdf'),"
        f"('279','OSD','rdte','2019','vol3b.pdf',"
        f"'https://example.test/2019/vol3b.pdf','sha-osd-2019-b','1000','2026-06-01','fy2019/osd/vol3b.pdf'),"
        f"('300','AF','rollup','2025','p1_display.xlsx',"
        f"'https://example.test/2025/p1_display.xlsx','sha-af-2025','1000','2026-06-01','fy2025/af/p1_display.xlsx'),"
        # PM-review Sprint 1: FY2026 Army dual-volume pair — docs 344/351
        # EACH embed the same RDT&E XML (live: Vol 1 BA-1 / BA-2 PDFs), so
        # identical fy2026 detail tuples appear under both. dim_programs
        # must dedupe (assert_dim_programs_dual_volume_dedup_pin).
        f"('344','A','rdte','2026','RDTE - Vol 1 - Budget Activity 1.pdf',"
        f"'https://example.test/2026/army-vol1-ba1.pdf','sha-army-2026-ba1','1000','2026-06-01','fy2026/army/vol1ba1.pdf'),"
        f"('351','A','rdte','2026','RDTE - Vol 1 - Budget Activity 2.pdf',"
        f"'https://example.test/2026/army-vol1-ba2.pdf','sha-army-2026-ba2','1000','2026-06-01','fy2026/army/vol1ba2.pdf'),"
        # Wave 5: the two Navy procurement books behind the shared '3010'
        # key — different appropriations, different programs, one BLI code.
        f"('400','N','procurement','2026','SCN_Book.pdf',"
        f"'https://example.test/2026/scn.pdf','sha-navy-2026-scn','1000','2026-06-01','fy2026/n/SCN_Book.pdf'),"
        f"('401','N','procurement','2026','OPN_BA1_Book.pdf',"
        f"'https://example.test/2026/opn.pdf','sha-navy-2026-opn','1000','2026-06-01','fy2026/n/OPN_BA1_Book.pdf'))"
        f" t({JBOOK_DOCUMENT_COLS})) to '{jbooks}/documents.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('0601101E',null,'Defense Research','PriorYear','280.494',"
        f"'ProgramElement[0]','True','DARPA','rdte','2026','1',null),"
        # Decoy PB2024-edition row: scenario names are edition-RELATIVE
        # (PriorYear = FY2022 actuals in PB2024), so the dim_programs
        # PB2026 fence (fiscal_year = 2026) must exclude it — the
        # assert_dim_programs_pb2026_pin dbt test fails if it ever sums in.
        f"('0601101E',null,'Defense Research','PriorYear','424.332',"
        f"'ProgramElement[0]','True','DARPA','rdte','2024','2',null),"
        # Phase 5E PB2019 OSD dual-volume pair: docs 278 and 279 EACH embed
        # the complete OSD XML — identical (pe_bli, scenario, amount)
        # tuples under both documents (Task 5 binding (i)).
        f"('0303140D8Z',null,'Information Systems Security Program','BudgetYearOne','7.940',"
        f"'ProgramElement[0]','True','OSD','rdte','2019','278',null),"
        f"('0303140D8Z',null,'Information Systems Security Program','BudgetYearOne','7.940',"
        f"'ProgramElement[0]','True','OSD','rdte','2019','279',null),"
        # PM-review Sprint 1: FY2026 dual-volume duplication INSIDE the
        # PB2026 fence — docs 344/351 each carry the identical PriorYear
        # root tuple for 0601102A (live: 47 Army PEs doubled to 2× in
        # dim_programs). The distinct-tuple dedup must report 322.341,
        # never the raw both-volumes sum 644.682.
        f"('0601102A',null,'University Research Initiatives','PriorYear','322.341',"
        f"'ProgramElement[1]','True','A','rdte','2026','344',null),"
        f"('0601102A',null,'University Research Initiatives','PriorYear','322.341',"
        f"'ProgramElement[1]','True','A','rdte','2026','351',null),"
        # Wave 5: the shared-'3010' detail pair. Same pe_bli, different
        # appropriation on each row — the account column is the ONLY thing
        # that tells them apart, and dim_programs must not add 500.000 to
        # 28.574.
        f"('3010',null,'LPD Flight II','PriorYear','500.000',"
        f"'LineItem[0]','True','N','procurement','2026','400','1611N'),"
        f"('3010',null,'Shipboard Tactical Communications','PriorYear','28.574',"
        f"'LineItem[7]','True','N','procurement','2026','401','1810N'))"
        f" t({JBOOK_DETAIL_COLS})) to '{jbooks}/details.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('0601101E',null,'accomplishment','Defense Research',"
        f"'Some body text','ProgramElement[0]','DARPA','2026'),"
        # Wave 5: 0601102A has R-2 detail (docs 344/351) and NO budget_lines
        # row, so stg_budget_lines can give dim_programs no name for it —
        # exactly the live shape of Navy 3039/3043. Its title has to come from
        # the J-book's own narrative, or the program ships nameless and takes
        # the client search index down with it (not_null_dim_programs_title).
        f"('0601102A',null,'mission','University Research Initiatives',"
        f"'Basic research grants to universities.','ProgramElement[1]','A','2026'))"
        f" t({JBOOK_NARRATIVE_COLS})) to '{jbooks}/detail_narratives.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values ('0601101E','R-1','2026','DARPA','HR001124C0001',"
        f"'ACME RESEARCH','UEI1','5000000','account+tokens','high','4','test account','0400'),"
        # 2026-09-04 (#75 fix round 1, finding 1): HR001124C0002 is
        # account+tokens/high with NO matching adjudication row below — the
        # mart's demotion `case` (fct_budget_to_awards.sql) must publish it
        # as 'medium' while crosswalk_confidence keeps the raw 'high' tag.
        # The pre-existing HR001124C0001 fixture always had an adjudication
        # row, so it could never exercise this branch.
        f"('0601101E','R-1','2026','DARPA','HR001124C0002',"
        f"'WIDGET CORP','UEI2','3000000','account+tokens','high','4','test account, unadjudicated','0400'),"
        # HR001124C0003 is adjudicated 'reject' below (mechanical tag is
        # irrelevant) — must drop out of the mart entirely, not just get a
        # low confidence.
        f"('0601101E','R-1','2026','DARPA','HR001124C0003',"
        f"'GAMMA INC','UEI3','2000000','account+tokens','high','4','test account, rejected','0400'),"
        # ROADMAP #70: the shared '3010' code (LPD Flight II in 1611N,
        # Shipboard Tactical Communications in 1810N — the budget_lines rows
        # above) with ONE link per member. The mart must resolve each link's
        # program_title through (pe_bli, account) and must NOT fan either row
        # out across both dim_programs rows.
        f"('3010','P-1','2026','N','N0002420C0001',"
        f"'HUNTINGTON INGALLS','UEI4','9000000','fpds-ap','medium','1',"
        f"'FPDS account narrowing; shared BLI code resolved to account 1611N','1611N'),"
        f"('3010','P-1','2026','N','N0003917D0006',"
        f"'SERCO','UEI5','1000000','fpds-ap','medium','1',"
        f"'FPDS account narrowing; shared BLI code resolved to account 1810N','1810N'))"
        f" t({JBOOK_AWARD_COLS})) to '{jbooks}/budget_line_awards.parquet' (format parquet)"
    )
    # Hand-adjudication overlay (migration 010): the mart coalesces this over
    # the mechanical confidence — the fixture row exercises exactly that path
    # (mechanical 'high' confirmed as adjudicated 'high'). HR001124C0002 is
    # deliberately absent here (see comment above); HR001124C0003 is
    # adjudicated 'reject' so the mart's coalesce()/filter must drop it.
    duckdb.sql(
        f"copy (select * from (values ('HR001124C0001','0601101E','high','pinned',"
        f"'pinned-here','narrative-grep','fixture evidence','2','hand-adjudication-v1',"
        f"'2026-09-01T00:00:00Z'),"
        f"('HR001124C0003','0601101E','reject','contradicted',"
        f"'pinned-elsewhere:other','narrative-grep','fixture evidence','2','hand-adjudication-v1',"
        f"'2026-09-01T00:00:00Z'))"
        f" t(award_piid, pe_bli, adjudicated_confidence, award_verdict, pair_reason,"
        f" basis, evidence, refuter_lenses_passed, method, adjudicated_at))"
        f" to '{jbooks}/award_adjudications.parquet' (format parquet)"
    )
    write_parquet(
        data_dir / "parquet/contracts/fy=2017",
        f"select * from (values "
        f"('K1','2017-01-15','1000.5','UEI1','ACME','PUEI1','ACME PARENT','DoD','Army','336411','1510','CA','CA-52','HR001124C0001','https://www.usaspending.gov/award/CONT_AWD_HR001124C0001','CAUK1','ACC-APG','FULL AND OPEN COMPETITION','3'),"
        f"('K2','2017-03-02','-50.25','UEI2','BETA','','','DoD','Navy','541330','R425','VA','VA-08',null,'https://www.usaspending.gov/award/CONT_AWD_K2',null,'NAVSEA HQ','NOT COMPETED',null)"
        f") t({CONTRACT_COLS})",
    )
    write_parquet(
        data_dir / "parquet/assistance/fy=2017",
        "select * from (values "
        "('A1','2017-02-01','5000','UEI1','ACME','PUEI1','ACME PARENT','DoD','Army','MARYLAND','MD-04','https://www.usaspending.gov/award/ASST_NON_A1','ASUK1')"
        ") t(assistance_transaction_unique_key, action_date, federal_action_obligation, "
        "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name, "
        "awarding_agency_name, awarding_sub_agency_name, primary_place_of_performance_state_name, "
        "prime_award_transaction_place_of_performance_cd_current, "
        "usaspending_permalink, assistance_award_unique_key)",
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
        "select * from (values ('K1','250.0','1000.0','2017-05-01','SUEI1','GAMMA SUB')) "
        "t(prime_award_unique_key, subaward_amount, prime_award_amount, subaward_action_date, subawardee_uei, subawardee_name)",
    )
    write_parquet(
        data_dir / "parquet/mts_outlays",
        "select * from (values ('2017-10-31','Department of Defense','1000')) "
        "t(record_date, classification_desc, current_month_gross_outly_amt)",
    )
    # oversight fixtures for new efficiency marts — typed schema (backlog #11):
    # fiscal_year INTEGER, rate/amount columns DOUBLE, mapped BOOLEAN
    oversight = data_dir / "parquet/oversight"
    oversight.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values "
        f"('Medicare Fee-for-Service','Department of Health and Human Services','HHS',2023,7.66,31700000000.0,0.0,413900000000.0,'https://paymentaccuracy.gov/program/hhs-medicare-ffs'),"
        f"('Medicare Fee-for-Service','Department of Health and Human Services','HHS',2022,6.26,25740000000.0,0.0,411300000000.0,'https://paymentaccuracy.gov/program/hhs-medicare-ffs'),"
        f"('SNAP','Department of Agriculture','USDA',2023,5.74,5060000000.0,0.0,88100000000.0,'https://paymentaccuracy.gov/program/usda-snap'),"
        f"('SNAP','Department of Agriculture','USDA',2022,4.71,3970000000.0,0.0,84300000000.0,'https://paymentaccuracy.gov/program/usda-snap'),"
        f"('Earned Income Tax Credit','Department of the Treasury','TREASURY',2023,34.02,21900000000.0,0.0,64400000000.0,'https://paymentaccuracy.gov/program/treasury-eitc')"
        f") t(program, agency_name, agency_code, fiscal_year, rate_pct, derived_improper_amount_usd, unknown_rate_pct, outlays_usd, source_url))"
        f" to '{oversight}/improper_payments.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('DOD Contract Management','https://files.gao.gov/reports/GAO-25-107743/index.html#dod-contract','DOD',true,'DoD contract management','https://www.gao.gov/high-risk-list'),"
        f"('DOD Weapon Systems Acquisition','https://files.gao.gov/reports/GAO-25-107743/index.html#dod-weapons','DOD',true,'DoD weapons programs','https://www.gao.gov/high-risk-list'),"
        f"('Medicare/Medicaid','https://files.gao.gov/reports/GAO-25-107743/index.html#medicare','HHS',true,'CMS programs','https://www.gao.gov/high-risk-list'),"
        f"('Enforcement of Tax Laws','https://files.gao.gov/reports/GAO-25-107743/index.html#tax','TREASURY',true,'IRS enforcement','https://www.gao.gov/high-risk-list'),"
        f"('Unmapped Area','https://files.gao.gov/reports/GAO-25-107743/index.html#unmapped','',false,'no clear agency','https://www.gao.gov/high-risk-list')"
        f") t(area_title, area_url, agency_code, mapped, notes, source_url))"
        f" to '{oversight}/high_risk.parquet' (format parquet)"
    )
    # states fixtures for phase 4 marts
    states = data_dir / "parquet/states"
    states.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values "
        f"('Dept A','Agency','Travel','General Fund','2025','1000.0','False','https://open.fiscal.ca.gov/dept'),"
        f"('Dept A','Agency','Salaries & Wages','General Fund','2025','5000.0','False','https://open.fiscal.ca.gov/dept'),"
        f"('Dept B','Agency','Travel','General Fund','2025','2000.0','False','https://open.fiscal.ca.gov/dept'),"
        f"('Dept B','Agency','Grants and Subventions','General Fund','2025','50000.0','False','https://open.fiscal.ca.gov/dept')"
        f") t(department, agency, category, fund, fiscal_year, amount_usd, is_total, source_url))"
        f" to '{states}/ca_budget.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('CA','Dept A','Travel','2025','1000.0','https://open.fiscal.ca.gov/dept'),"
        f"('CA','Dept A','Salaries & Wages','2025','5000.0','https://open.fiscal.ca.gov/dept'),"
        f"('CA','Dept B','Travel','2025','2000.0','https://open.fiscal.ca.gov/dept'),"
        f"('CA','Dept B','Grants and Subventions','2025','50000.0','https://open.fiscal.ca.gov/dept')"
        f") t(jurisdiction, department, category, fiscal_year, amount_usd, source_url))"
        f" to '{states}/ca_checkbook_agg.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('CT','CT Dept 1','Out-Of-State Travel','2025','3000.0','https://data.ct.gov/q'),"
        f"('CT','CT Dept 1','In-State Travel','2025','500.0','https://data.ct.gov/q'),"
        f"('CT','CT Dept 1','State Aid Grants','2025','200000.0','https://data.ct.gov/q')"
        f") t(jurisdiction, department, category, fiscal_year, amount_usd, source_url))"
        f" to '{states}/ct_checkbook_agg.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('CA','2024','39000000','https://census.gov/pop'),"
        f"('CT','2024','3600000','https://census.gov/pop')"
        f") t(state, year, population, source_url))"
        f" to '{states}/state_population.parquet' (format parquet)"
    )
    # influence fixtures for phase 5A marts
    influence = data_dir / "parquet/influence"
    influence.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values "
        f"('uuid-lda-001','https://lda.gov/filings/public/filing/uuid-lda-001/print/','ACME PARENT INC','OUTSIDE FIRM LLC','2024','first_quarter','Q1','150000','','ACME PARENT','exact_family'),"
        f"('uuid-lda-002','https://lda.gov/filings/public/filing/uuid-lda-002/print/','ACME PARENT INC','ACME PARENT INC','2024','second_quarter','Q2','','50000','ACME PARENT','exact_family')"
        f") t(filing_uuid, url, client_name, registrant_name, filing_year, filing_period, filing_type,"
        f" income_usd, expenses_usd, family_key_guess, match_method))"
        f" to '{influence}/lda_filings.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('uuid-lda-001','DEF','Defense','FY26 NDAA issues related to JADC2 and acquisition.','[\"SENATE\"]'),"
        f"('uuid-lda-002','GOV','Government Issues','Issues related to C-130J aircraft and appropriations.','[]')"
        f") t(filing_uuid, issue_code, issue_display, description, agencies_json))"
        f" to '{influence}/lda_activities.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('uuid-lda-001','JANE DOE','Deputy Secretary of Defense (Smith Administration)'),"
        f"('uuid-lda-002','JOHN SMITH','')"
        f") t(filing_uuid, name, covered_position))"
        f" to '{influence}/lda_lobbyists.parquet' (format parquet)"
    )
    duckdb.sql(
        f"copy (select * from (values "
        f"('uuid-lda-001','0604122D8Z','JADC2','alias','FY26 NDAA issues related to JADC2 and acquisition.'),"
        f"('uuid-lda-002','2012C130J','C-130J','alias','Issues related to C-130J aircraft and appropriations.')"
        f") t(filing_uuid, pe_bli, matched_term, evidence_kind, description_snippet))"
        f" to '{influence}/lda_program_mentions.parquet' (format parquet)"
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
    # Phase 5A influence mart assertions
    assert con.sql("select count(*) from fct_influence").fetchone()[0] >= 1
    assert con.sql(
        "select lobbying_total_usd from fct_influence"
        " where family_key='ACME PARENT' and filing_year='2024'"
    ).fetchone()[0] == 200000.0  # 150000 income + 50000 expenses
    assert con.sql("select count(*) from fct_program_lobbying").fetchone()[0] == 2
    assert con.sql("select count(*) from dim_lobbyists").fetchone()[0] == 2
    # revolving_door true for JANE DOE (has covered_position), false for JOHN SMITH
    assert con.sql(
        "select revolving_door from dim_lobbyists where name='JANE DOE'"
    ).fetchone()[0] is True
    assert con.sql(
        "select revolving_door from dim_lobbyists where name='JOHN SMITH'"
    ).fetchone()[0] is False
    # Phase 5B-3 new mart assertions
    # fct_feed_events: the fixture has no yoy_swing or new_entrant thresholds met
    # (only 1 budget row at 280494 thousands, no |pct_change|>=50 since only 1 FY).
    # The model must exist and be queryable; row count >= 0.
    assert con.sql("select count(*) from fct_feed_events").fetchone()[0] >= 0
    # dim_pe_titles (backlog #14): canonical title per pe_bli from titled
    # detail rows — the fixture's single titled budget_lines row must resolve.
    assert con.sql(
        "select title from dim_pe_titles where pe_bli='0601101E'"
    ).fetchone()[0] == 'DEFENSE RESEARCH'
    # PB2026 fences (Finding A): dim_programs' fy2024_actual_millions is a
    # PB2026-semantic column — the fixture's PB2024 PriorYear decoy row
    # (FY2022 actuals!) must NOT sum in (280.494, never 704.826)…
    assert con.sql(
        "select fy2024_actual_millions from dim_programs where pe_bli='0601101E'"
    ).fetchone()[0] == 280.494
    # …and dim_pe_titles' fallback pool is PB2026-only: the PB2024 decoy
    # title must not shadow the PB2026 title alphabetically.
    assert con.sql(
        "select title from dim_pe_titles where pe_bli='0601102E'"
    ).fetchone()[0] == 'APPLIED RESEARCH'
    # fct_budget_to_awards (#75 fix round 1, finding 1): mart demotion
    # coverage. HR001124C0001 is the adjudicated control — adjudicated
    # 'high' publishes as 'high', confidence_source='adjudicated'.
    control = con.sql(
        "select confidence, crosswalk_confidence, confidence_source"
        " from fct_budget_to_awards where award_piid='HR001124C0001'"
    ).fetchone()
    assert control == ('high', 'high', 'adjudicated')
    # HR001124C0002 is account+tokens/high with NO adjudication row — the
    # demotion `case` in fct_budget_to_awards.sql must publish 'medium'
    # while crosswalk_confidence keeps the raw mechanical 'high' tag.
    demoted = con.sql(
        "select confidence, crosswalk_confidence, confidence_source"
        " from fct_budget_to_awards where award_piid='HR001124C0002'"
    ).fetchone()
    assert demoted == ('medium', 'high', 'mechanical')
    # HR001124C0003 is adjudicated 'reject' — it must drop out of the mart
    # entirely (not merely demoted), regardless of its mechanical tag.
    assert con.sql(
        "select count(*) from fct_budget_to_awards where award_piid='HR001124C0003'"
    ).fetchone()[0] == 0
    # ROADMAP #70: the two links on the shared '3010' code each resolve to
    # their OWN member's title through (pe_bli, account), and neither fans out
    # across both dim_programs rows (the pre-#70 `programs` CTE deduped to one
    # row per pe_bli precisely to stop that, and still does for account-NULL
    # rows — this asserts the account-qualified join is a strict refinement).
    split = con.sql(
        "select award_piid, account, program_title, count(*) over () as n_rows"
        " from fct_budget_to_awards where pe_bli='3010' order by award_piid"
    ).fetchall()
    assert split == [
        ('N0002420C0001', '1611N', 'LPD Flight II', 2),
        ('N0003917D0006', '1810N', 'Shipboard Tactical Communications', 2),
    ], split
    # An ordinary (single-program) pe_bli keeps its own title either way — the
    # account-qualified join resolves it when dim_programs carries the account,
    # the bare-key CTE when it does not.
    assert con.sql(
        "select account, program_title from fct_budget_to_awards"
        " where award_piid='HR001124C0002'"
    ).fetchone() == ('0400', 'DEFENSE RESEARCH')
    # fct_district_programs: the fixture contracts have CA-52 district + award HR001124C0001
    # which matches the high-confidence jbook_award. Expect >= 1 row.
    assert con.sql("select count(*) from fct_district_programs").fetchone()[0] >= 1
    # uniqueness on (pop_district, pe_bli) — no duplicates allowed
    assert con.sql(
        "select count(*) from ("
        "  select pop_district, pe_bli from fct_district_programs"
        "  group by 1,2 having count(*) > 1"
        ")"
    ).fetchone()[0] == 0
    # fct_family_obligations_by_year: UEI1 → ACME PARENT family; 3 transactions across fiscal years
    assert con.sql("select count(*) from fct_family_obligations_by_year").fetchone()[0] >= 1
    # stg_contracts / stg_assistance now carry usaspending_permalink + award_unique_key
    assert con.sql(
        "select usaspending_permalink from fct_award_transactions"
        " where transaction_key='K1'"
    ).fetchone()[0] == 'https://www.usaspending.gov/award/CONT_AWD_HR001124C0001'
    assert con.sql(
        "select award_unique_key from fct_award_transactions"
        " where transaction_key='A1'"
    ).fetchone()[0] == 'ASUK1'
    # Subaward outlier guard: stg_subawards must expose is_amount_suspect flag.
    # The fixture has 1 clean row (subaward 250 <= prime 1000), so is_amount_suspect=False.
    suspect_count = con.sql(
        "select count(*) from stg_subawards where is_amount_suspect = true"
    ).fetchone()[0]
    assert suspect_count == 0, (
        f"fixture has no suspect rows but got {suspect_count} — guard is misfiring"
    )
    clean_count = con.sql(
        "select count(*) from stg_subawards where is_amount_suspect = false"
    ).fetchone()[0]
    assert clean_count == 1, f"expected 1 clean subaward row, got {clean_count}"

    # Phase 5H fct_flow_edges — budget river (dedup rule: title IS NOT NULL,
    # amount_type='fy_2026_total'; the 400000 rollup row must NOT count)
    assert con.sql(
        "select amount from fct_flow_edges where river='budget'"
        " and level_from='total' and node_to='DARPA'"
    ).fetchone()[0] == 400000.0  # 300000 + 100000 detail rows only
    # 4 since Wave 5 added the shared-'3010' pair: DARPA's two PEs plus the
    # two Navy programs that share one budget-line code. Their being TWO
    # edges rather than one fused edge is the point.
    assert con.sql(
        "select count(*) from fct_flow_edges where river='budget'"
        " and level_to='program'"
    ).fetchone()[0] == 4
    assert con.sql(
        "select amount from fct_flow_edges where river='budget'"
        " and node_to='DARPA|0400|1|0601101E'"
    ).fetchone()[0] == 300000.0
    # Spend river: competed_class mapping + offers buckets from the fixture
    # contracts (K1 full-and-open/3 offers, K2 not-competed/null offers);
    # the assistance row must NOT appear (contracts only).
    assert con.sql(
        "select competed_class, offers_bucket, amount from fct_flow_edges"
        " where river='spend' and level_from='total' and competed_class='full_and_open'"
    ).fetchall() == [("full_and_open", "3-4", 1000.5)]
    assert con.sql(
        "select competed_class, offers_bucket, amount from fct_flow_edges"
        " where river='spend' and level_from='total' and competed_class='not_competed'"
    ).fetchall() == [("not_competed", "unknown", -50.25)]
    # office → family edge resolves the entity_xwalk family for UEI1
    assert con.sql(
        "select node_to from fct_flow_edges where river='spend'"
        " and level_from='office' and node_from='Army|ACC-APG'"
    ).fetchone()[0] == "ACME PARENT"
    # UEI2 has no xwalk row — family falls back to upper(recipient_name)
    assert con.sql(
        "select node_to from fct_flow_edges where river='spend'"
        " and level_from='office' and node_from='Navy|NAVSEA HQ'"
    ).fetchone()[0] == "BETA"

    # Phase 5E Task 5: fct_decade_series + fct_book_diff
    # PB2026 PriorYear pin row at the edition-aware grain (280,494 $K)
    assert con.sql(
        "select amount from fct_decade_series where pe_bli='0601101E'"
        " and fy=2024 and edition_year=2026"
    ).fetchone()[0] == 280494.0
    # the poisoned fy_2026_total grain (provenance-less 400000 twin in the
    # raw lake) is WITHHELD by the lake-verifiability filter — the series
    # never publishes a value the verify-phase5e gate cannot recompute
    assert con.sql(
        "select count(*) from fct_decade_series where pe_bli='0601101E'"
        " and edition_year=2026 and amount_type_kind='request'"
    ).fetchone()[0] == 0
    # PB2019 OSD dual-volume (binding (i)): the single-volume value 7,940,
    # never the both-volumes sum 15,880
    assert con.sql(
        "select amount from fct_decade_series where pe_bli='0303140D8Z'"
        " and edition_year=2019 and amount_type_kind='request'"
    ).fetchone()[0] == 7940.0
    # P-1R recompute correction (Task 5 improvements): the C130J0 grain has
    # a nonzero P-1R sibling under the same slug — it must be PUBLISHED with
    # the P-1-only value (P-1 ⊇ P-1R; the reserve share must never sum in),
    # not withheld by a naive P-1 + P-1R lake recompute.
    assert con.sql(
        "select amount from fct_decade_series where pe_bli='C130J0'"
        " and fy=2023 and edition_year=2025"
    ).fetchone()[0] == 1775293.0
    # single-source grains carry a workbook fact_id (Task 6 minting handoff)
    assert con.sql(
        "select source_fact_id from fct_decade_series where pe_bli='0303140D8Z'"
        " and edition_year=2019 and amount_type_kind='request'"
    ).fetchone()[0] is not None
    # book diff: FY2024 asked (PB2024 request) vs FY2024 spent (PB2026 actuals)
    assert con.sql(
        "select from_value, to_value, delta from fct_book_diff"
        " where pe_bli='0601101E' and diff_kind='request_vs_actuals'"
    ).fetchall() == [(250000.0, 280494.0, 30494.0)]

    # Finding 4: entity_xwalk.recipient_uei uniqueness guard
    # The dbt unique test in schema.yml gates the build. To prove that a duplicate
    # UEI would double-count obligation totals (motivating the guard), verify the
    # fixture has exactly 1 row for UEI1 in entity_xwalk — no fan-out.
    assert con.sql(
        "select count(*) from entity_xwalk where recipient_uei='UEI1'"
    ).fetchone()[0] == 1, "entity_xwalk must have exactly 1 row per UEI (duplicate would double-count)"


def test_entity_xwalk_duplicate_uei_would_double_count(tmp_path):
    """Prove that a duplicate recipient_uei in entity_xwalk fans-out obligation totals.

    This test documents WHY the dbt unique test matters: without the guard a
    single award joins twice, doubling the reported obligation.
    The test does NOT run dbt — it directly verifies the SQL fan-out behaviour.
    """
    import duckdb

    # Single award transaction: UEI1 → $1000
    con = duckdb.connect()
    con.execute(
        "create table awards as "
        "select 'UEI1' as recipient_uei, 1000.0 as obligation"
    )
    # Duplicate UEI in xwalk (two rows for same UEI1)
    con.execute(
        "create table xwalk_with_dup as "
        "select 'UEI1' as recipient_uei, 'FAM_A' as family_key union all "
        "select 'UEI1' as recipient_uei, 'FAM_A' as family_key"
    )
    # This join fans-out: 1 award × 2 xwalk rows = doubled total
    doubled = con.execute(
        "select sum(a.obligation) from awards a join xwalk_with_dup x "
        "on a.recipient_uei = x.recipient_uei"
    ).fetchone()[0]
    assert doubled == 2000.0, f"duplicate UEI causes double-count: got {doubled}"

    # With unique UEI (correct state): total is 1000
    con.execute(
        "create table xwalk_unique as "
        "select 'UEI1' as recipient_uei, 'FAM_A' as family_key"
    )
    correct = con.execute(
        "select sum(a.obligation) from awards a join xwalk_unique x "
        "on a.recipient_uei = x.recipient_uei"
    ).fetchone()[0]
    assert correct == 1000.0, f"unique UEI gives correct total: got {correct}"
    con.close()


def _singular_test_sql(name: str, **refs: str) -> str:
    """The committed dbt singular test's own SQL, with its {{ ref(...) }}
    macros replaced by plain table names so it can run against a throwaway
    DuckDB. Reading the real file (rather than restating the query here) is
    the point: the assertion this test exercises is the one dbt runs."""
    sql = (ROOT / "dbt" / "tests" / f"{name}.sql").read_text()
    for model, table in refs.items():
        sql = sql.replace("{{ ref('%s') }}" % model, table)
    assert "{{" not in sql, f"unsubstituted macro left in {name}.sql"
    return sql


def test_high_links_under_two_accounts_are_caught_before_they_fuse():
    """ROADMAP #70 fix round 1, finding 4.

    fct_district_programs groups on (state, district, pe_bli) and takes
    min() of program_title/organization. That is deliberate — grouping BY the
    title would break the model's declared grain — but it means a shared BLI
    code carrying HIGH-confidence links on BOTH members would sum two
    programs' money into one district card under whichever title sorts first.
    Latent today (one member of '0145' and one of '3050' carry high links);
    assert_district_programs_single_member_high_links is what makes the day it
    stops being latent loud instead of silent.

    Like test_entity_xwalk_duplicate_uei_would_double_count, this does not run
    dbt: it runs the committed assertion against both configurations.
    """
    import duckdb

    con = duckdb.connect()
    con.execute(
        "create table links (pe_bli varchar, account varchar,"
        " confidence varchar, award_piid varchar)"
    )
    sql = _singular_test_sql(
        "assert_district_programs_single_member_high_links",
        fct_budget_to_awards="links",
    )

    # The shape the model can fuse: '3010' high on BOTH members.
    con.execute(
        "insert into links values"
        " ('3010','1611N','high','N0002420C0001'),"
        " ('3010','1810N','high','N0003917D0006')"
    )
    fused = con.execute(sql).fetchall()
    assert fused == [("3010", 2, "1611N", "1810N", 2)], fused

    # The live shape (verified 2026-09-04 against budget_line_awards): high
    # links on ONE member of a shared code, the sibling's links medium or
    # absent, and ordinary account-NULL keys everywhere else. min() has one
    # value to choose from, so nothing fuses and the assertion is silent.
    con.execute("delete from links")
    con.execute(
        "insert into links values"
        " ('0145','1508N','high','SPE30124D0001'),"
        " ('3050','1810N','high','N0002419C0003'),"
        " ('3050','1810N','high','N0002419C0004'),"
        " ('3010','1611N','medium','N0002420C0001'),"
        " ('3010','1810N','medium','N0003917D0006'),"
        " ('0601101E',null,'high','HR001124C0001')"
    )
    assert con.execute(sql).fetchall() == []
    con.close()
