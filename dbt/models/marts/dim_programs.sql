with details as (
    select
        pe_bli,
        max(org) as org,
        max(exhibit_family) as exhibit_family,
        count(distinct project_number) as project_count,
        sum(amount_millions) filter (where scenario = 'PriorYear' and project_number is null)
            as fy2024_actual_millions,
        bool_and(reconciled) as fully_reconciled
    from {{ ref('stg_budget_details') }}
    group by pe_bli
)
select
    d.pe_bli,
    d.org,
    d.exhibit_family,
    d.project_count,
    d.fy2024_actual_millions,
    d.fully_reconciled,
    max(b.title) as title
from details d
left join {{ ref('stg_budget_lines') }} b on b.pe_bli = d.pe_bli
group by 1, 2, 3, 4, 5, 6
