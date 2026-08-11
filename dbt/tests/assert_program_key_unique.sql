-- #56: a program key (pe_bli) spanning >1 appropriation account within one
-- edition must never be rendered as ONE row that sums both accounts' money
-- under a title naming only one of them — that is two unrelated programs
-- fused into a single row (the live defect: '3010' rendered LPD Flight
-- II's $2.6B Shipbuilding & Conversion reconciliation funding under
-- Shipboard Tactical Communications' $20.9M Other Procurement title).
--
-- SUBSTITUTION #1 (disclosed) — collision grain. The originally prescribed
-- version of this test grouped by (pe_bli, fiscal_year) alone. fiscal_year
-- on fct_budget_lines is the EDITION (PB2026's own single document reports
-- FY2024 actuals, FY2025 enacted, and FY2026 request together, all
-- fiscal_year = 2026), so grouping by edition alone cannot distinguish a
-- same-moment collision (two accounts both reporting a number for the SAME
-- amount_type — two programs live at once) from 1045/COLUMBIA Class
-- Submarine — ONE program whose account was renamed BETWEEN the fiscal
-- years its own PB2026 book reports (FY2024 actuals under the retired
-- account 1612N "National Sea-Based Det Fd", FY2025 on under account 1611N
-- "Shipbuilding and Conversion, Navy" — never both under the same
-- amount_type). That is a grain-mismatched fail-proof: it flags 1045 as a
-- false positive, exactly the trap this ticket calls out. Verified against
-- the shipped PB2026 warehouse (2026-08-11): adding amount_type to the
-- grouping key removes 1045 and leaves the other 10 real collisions
-- untouched (0145, 1350, 2101, 2210, 2292, 3010, 3050, 3215, 3302, 4217).
--
-- SUBSTITUTION #2 (disclosed) — what "PASS" means. fct_budget_lines is raw,
-- unmodified source data: two real government appropriation accounts
-- coincidentally sharing a 4-digit code is a permanent fact about the
-- FY2026 budget, not something any downstream re-key can make disappear —
-- a test that requires collisions-in-the-raw-data to hit zero could never
-- pass. What the #56 fix actually changes is downstream, in
-- fct_budget_trajectory (re-keyed to pick exactly one account per
-- (pe_bli, organization) — see fct_budget_trajectory.sql — instead of
-- summing across accounts). So this test's real assertion is: for every
-- known collision (pe_bli, amount_type), fct_budget_trajectory's published
-- figure must equal ONE account's own contribution, never their sum. Pre-
-- fix, fct_budget_trajectory summed both accounts (3010's fy2024_actuals
-- was 528,574 — neither the OPN $28,574 nor the SCN $500,000 figure).
-- Post-fix it equals exactly one of them.
--
-- 9999999999 is the intentional classified sentinel spanning 12 accounts by
-- design — excluded by name, never by a count threshold that would also
-- mask a real collision.

with per_account as (
    select
        pe_bli,
        amount_type,
        account_title,
        sum(amount_thousands) as account_amount
    from {{ ref('fct_budget_lines') }}
    where account_title is not null
      and pe_bli <> '9999999999'
      and fiscal_year = 2026
      and amount_type in ('fy_2024_actuals', 'fy_2025_total', 'fy_2026_total')
    group by pe_bli, amount_type, account_title
),

collisions as (
    select pe_bli, amount_type
    from per_account
    group by pe_bli, amount_type
    having count(distinct account_title) > 1
),

mart_long as (
    select pe_bli, 'fy_2024_actuals' as amount_type, fy2024_actuals as mart_amount
    from {{ ref('fct_budget_trajectory') }}
    union all
    select pe_bli, 'fy_2025_total', fy2025_total
    from {{ ref('fct_budget_trajectory') }}
    union all
    select pe_bli, 'fy_2026_total', fy2026_total
    from {{ ref('fct_budget_trajectory') }}
)

select
    c.pe_bli,
    c.amount_type,
    ml.mart_amount as fct_budget_trajectory_amount
from collisions c
join mart_long ml
    on ml.pe_bli = c.pe_bli and ml.amount_type = c.amount_type
where ml.mart_amount is not null
  and not exists (
      select 1
      from per_account pa
      where pa.pe_bli = c.pe_bli
        and pa.amount_type = c.amount_type
        and abs(pa.account_amount - ml.mart_amount) < 0.0005
  )
