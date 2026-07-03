-- Phase 5H budget-river honesty: the budget river's mouth (total → component
-- edges) must equal an INDEPENDENT regroup of the source jbook_budget_lines
-- lake under the same dedup rule (title IS NOT NULL detail rows,
-- amount_type = 'fy_2026_total'). Catches a mart that silently drops or
-- double-counts detail rows.

with mart as (
    select
        fiscal_year,
        sum(amount) as amt
    from {{ ref('fct_flow_edges') }}
    where river = 'budget' and level_from = 'total'
    group by 1
),

src as (
    select
        cast(fiscal_year as integer) as fiscal_year,
        sum(try_cast(amount_thousands as double)) as amt
    from {{ source('lake', 'jbook_budget_lines') }}
    where title is not null
      and amount_type = 'fy_2026_total'
    group by 1
)

select
    coalesce(m.fiscal_year, s.fiscal_year) as fiscal_year,
    m.amt as mart_amt,
    s.amt as src_amt
from mart m
full outer join src s on m.fiscal_year = s.fiscal_year
where m.fiscal_year is null
   or s.fiscal_year is null
   or abs(coalesce(m.amt, 0) - coalesce(s.amt, 0))
      > greatest(0.005, 1e-9 * abs(coalesce(m.amt, s.amt, 0)))
