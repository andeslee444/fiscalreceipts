select pe_bli, organization, count(*) from {{ ref('fct_budget_trajectory') }}
group by 1, 2 having count(*) > 1
