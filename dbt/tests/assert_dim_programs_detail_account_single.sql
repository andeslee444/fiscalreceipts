-- No dim_programs row may sum R-2/P-40 detail money from two different
-- appropriation accounts.
--
-- WHY THIS IS A SEPARATE TEST FROM assert_program_key_unique. That test
-- checks the row GRAIN: no duplicate (account, pe_bli, org). It filters
-- `account is not null`, and it has to — a program whose FY2024 detail ties
-- no workbook row legitimately resolves account NULL. The fusion this test
-- catches lands precisely in that blind spot: the fused row carries account
-- NULL (its summed amount matches neither account's workbook line, so
-- account_match resolves nothing), so the grain test cannot see it, and the
-- two real accounts appear beside it as detail-less synth rows that look
-- perfectly well-formed.
--
-- Measured on the build immediately before the fix (2026-08-29), with the
-- Navy procurement books newly parsed and stg_budget_details still carrying
-- no account column, this returned TEN rows — every PB2026 key two Navy
-- appropriations share. The worst was '3010': LPD Flight II's $500.000M of
-- Shipbuilding & Conversion FY2024 actuals summed with Shipboard Tactical
-- Communications' $28.574M of Other Procurement and published as $528.574M
-- under the communications title. dbt reported PASS=133 ERROR=0 on that
-- build; nothing in the suite objected.
--
-- The check is on the DETAIL SIDE on purpose — it re-derives the account set
-- from stg_budget_details rather than reading dim_programs.account, so it
-- cannot be satisfied by the mart relabelling a fused row.
with detail_accounts as (
    select
        pe_bli,
        project_number,
        scenario,
        amount_millions,
        xml_path,
        account
    from {{ ref('stg_budget_details') }}
    where fiscal_year = 2026 and account is not null
    group by 1, 2, 3, 4, 5, 6
),
-- The account set behind each dim_programs row, joined the way the mart
-- itself groups: by pe_bli plus (where the mart split it) the account.
per_row as (
    select
        p.pe_bli,
        p.account,
        count(distinct d.account) as n_detail_accounts,
        min(d.account) as lo,
        max(d.account) as hi,
        sum(d.amount_millions) filter (
            where d.scenario = 'PriorYear' and d.project_number is null
        ) as fused_fy2024_millions
    from {{ ref('dim_programs') }} p
    join detail_accounts d
        on d.pe_bli = p.pe_bli
        and (p.account is null or d.account = p.account)
    where p.pe_bli <> '9999999999'
    group by p.pe_bli, p.account
)
select pe_bli, account, n_detail_accounts, lo, hi, fused_fy2024_millions
from per_row
where n_detail_accounts > 1
