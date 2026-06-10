with details as (
    select
        pe_bli,
        org,
        exhibit_family,
        count(distinct project_number) as project_count,
        sum(amount_millions) filter (where scenario = 'PriorYear' and project_number is null)
            as fy2024_actual_millions,
        bool_and(reconciled) as fully_reconciled
    from {{ ref('stg_budget_details') }}
    group by 1, 2, 3
)
select
    d.*,
    max(b.title) as title
from details d
left join {{ ref('stg_budget_lines') }} b on b.pe_bli = d.pe_bli
group by all
