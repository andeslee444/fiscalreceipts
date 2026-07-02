-- fct_budget_trajectory: per (pe_bli, organization): fy2024 actuals, fy2025 total,
-- fy2026 total (sum amount_thousands per amount_type), absolute + pct change columns.
--
-- Detail rows only (title IS NOT NULL). stg_budget_lines carries BOTH detail
-- rows (title IS NOT NULL) and R-1 rollup rows (title IS NULL); summing both
-- double-counts. fy_2024_actuals had 147 rollup rows inflating 146 of 1982
-- (pe_bli, organization) pairs 1.09x-2.0x (e.g. 0601101E: 560,988 vs the true
-- 280,494). fy_2025_total / fy_2026_total currently have zero rollup rows, but
-- the filter applies to all three amount_types so the same latent hazard can't
-- recur if rollups appear in a future load. No (pe_bli, organization) is
-- rollup-only, so the filter drops no rows.
with budget as (
    select
        pe_bli,
        organization,
        amount_type,
        sum(amount_thousands) as amount_thousands
    from {{ ref('stg_budget_lines') }}
    where amount_type in ('fy_2024_actuals', 'fy_2025_total', 'fy_2026_total')
      and title is not null
    group by pe_bli, organization, amount_type
),
pivoted as (
    select
        pe_bli,
        organization,
        sum(case when amount_type = 'fy_2024_actuals' then amount_thousands end) as fy2024_actuals,
        sum(case when amount_type = 'fy_2025_total'   then amount_thousands end) as fy2025_total,
        sum(case when amount_type = 'fy_2026_total'   then amount_thousands end) as fy2026_total
    from budget
    group by pe_bli, organization
)
select
    pe_bli,
    organization,
    fy2024_actuals,
    fy2025_total,
    fy2026_total,
    (fy2026_total - fy2025_total) as fy2526_change,
    case
        when fy2025_total is null or fy2025_total = 0 then null
        else round(100.0 * (fy2026_total - fy2025_total) / fy2025_total, 2)
    end as fy2526_pct_change
from pivoted
