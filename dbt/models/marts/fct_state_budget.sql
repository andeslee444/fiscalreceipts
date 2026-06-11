-- fct_state_budget: typed California budget lines from Open Fi$Cal per-department transactions.
-- Source: ca_budget.parquet (aggregated from DepartmentSpendingTransactionPointer.csv downloads).
-- All raw columns are varchar; this mart casts amounts and adds a recomputed_dept_total column
-- for pipeline-integrity reconciliation (line-item sum recomputed per department).
-- Grain: one row per (department, category, fund, fiscal_year) budget line.
with raw as (
    select
        department,
        agency,
        category,
        fund,
        fiscal_year,
        try_cast(amount_usd as double) as amount_usd,
        is_total,
        source_url
    from {{ source('states', 'ca_budget') }}
    where is_total = 'False' or is_total is null
),
dept_sums as (
    select
        department,
        fiscal_year,
        sum(amount_usd) as recomputed_dept_total_usd
    from raw
    group by department, fiscal_year
)
select
    r.department,
    r.agency,
    r.category,
    r.fund,
    r.fiscal_year,
    r.amount_usd,
    r.source_url,
    d.recomputed_dept_total_usd
from raw r
join dept_sums d
    on d.department = r.department
    and d.fiscal_year = r.fiscal_year
