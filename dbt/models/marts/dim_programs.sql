select
    pe_bli,
    org,
    exhibit_family,
    max(project_title) filter (where project_number is null) as title,
    count(distinct project_number) as project_count,
    sum(amount_millions) filter (where scenario = 'PriorYear' and project_number is null)
        as fy2024_actual_millions,
    bool_and(reconciled) as fully_reconciled
from {{ ref('stg_budget_details') }}
group by 1, 2, 3
