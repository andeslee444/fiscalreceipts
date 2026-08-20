-- ROADMAP backlog #37: a program's trajectory must EQUAL THE SUM of its
-- component (pe_bli, organization) rows within the SAME account — never one
-- component of it, and never summed across a different, coincidentally
-- same-keyed account (that would be the #56 fusion bug one layer up — see
-- fct_program_trajectory.sql's E1 comment).
--
-- This is the assertion the shipped defect would have failed. `programs.json`
-- published fct_budget_trajectory at (pe_bli, dim_programs.org): the declared
-- org's slice, under the program's name. Re-point fct_program_trajectory at a
-- pick instead of a sum — arg_max by fy2026_total, the first org, a join to
-- dim_programs.org, anything — and BLI 30 / 20 / 500 fail here immediately.
--
-- E1 (Sprint E, ROADMAP #67): grouped by (pe_bli, account) instead of pe_bli
-- alone, matching fct_program_trajectory's widened grain — a component sum
-- across accounts would silently re-fuse a genuine collision (8 keys this
-- sprint) into one row, exactly what this test exists to catch.
--
-- Every metric is checked, in both directions:
--   * a program present on one side only is a failure (a missing rollup row
--     is exactly as wrong as a wrong one);
--   * NULL is checked as NULL — a component sum that is NULL must stay NULL,
--     never become 0, or an unpublished figure would be published as zero;
--   * the change columns are checked against the SUMMED endpoints, so a
--     rollup that summed per-org deltas instead fails here too.
--
-- Tolerance is float accumulation only: 0.0005 USD thousands = half a cent.

with components as (
    select
        pe_bli,
        account,
        count(*) as n_org_components,
        sum(fy2024_actuals) as fy2024_actuals,
        sum(fy2025_total)   as fy2025_total,
        sum(fy2026_total)   as fy2026_total
    from {{ ref('fct_budget_trajectory') }}
    group by pe_bli, account
),

expected as (
    select
        pe_bli,
        account,
        n_org_components,
        fy2024_actuals,
        fy2025_total,
        fy2026_total,
        (fy2026_total - fy2025_total) as fy2526_change,
        case
            when fy2025_total is null or fy2025_total = 0 then null
            else round(100.0 * (fy2026_total - fy2025_total) / fy2025_total, 2)
        end as fy2526_pct_change
    from components
),

joined as (
    select
        coalesce(p.pe_bli, e.pe_bli)     as pe_bli,
        coalesce(p.account, e.account)   as account,
        p.pe_bli is null             as missing_from_program_mart,
        e.pe_bli is null             as missing_from_components,
        p.n_org_components           as got_n_components,
        e.n_org_components           as want_n_components,
        p.fy2024_actuals             as got_fy2024,
        e.fy2024_actuals             as want_fy2024,
        p.fy2025_total               as got_fy2025,
        e.fy2025_total               as want_fy2025,
        p.fy2026_total               as got_fy2026,
        e.fy2026_total               as want_fy2026,
        p.fy2526_change              as got_change,
        e.fy2526_change              as want_change,
        p.fy2526_pct_change          as got_pct,
        e.fy2526_pct_change          as want_pct
    from {{ ref('fct_program_trajectory') }} p
    full outer join expected e on e.pe_bli = p.pe_bli and e.account is not distinct from p.account
)

select *
from joined
where missing_from_program_mart
   or missing_from_components
   or got_n_components is distinct from want_n_components
   or (got_fy2024 is null) <> (want_fy2024 is null)
   or (got_fy2025 is null) <> (want_fy2025 is null)
   or (got_fy2026 is null) <> (want_fy2026 is null)
   or (got_change is null) <> (want_change is null)
   or (got_pct    is null) <> (want_pct    is null)
   or coalesce(abs(got_fy2024 - want_fy2024), 0) > 0.0005
   or coalesce(abs(got_fy2025 - want_fy2025), 0) > 0.0005
   or coalesce(abs(got_fy2026 - want_fy2026), 0) > 0.0005
   or coalesce(abs(got_change - want_change), 0) > 0.0005
   or coalesce(abs(got_pct    - want_pct),    0) > 0.0005
