-- Phase 5H conservation: for every intermediate flow node, the dollars
-- flowing IN (edges where it is node_to) equal the dollars flowing OUT
-- (edges where it is node_from) — child sums equal parents at every level,
-- in both rivers, per fiscal year. A node present on only one side is a
-- structural failure (every base row contributes to every level).
--
-- Tolerance is float-accumulation only: greatest(0.005, 1e-8 * |value|).
-- Budget amounts are USD thousands, spend amounts are USD; the relative term
-- covers both without masking real leaks.

with inflow as (
    select
        river,
        fiscal_year,
        level_to as level,
        node_to as node,
        sum(amount) as amt_in
    from {{ ref('fct_flow_edges') }}
    where level_to in
        ('component', 'appropriation', 'budget_activity', 'sub_agency', 'office')
    group by 1, 2, 3, 4
),

outflow as (
    select
        river,
        fiscal_year,
        level_from as level,
        node_from as node,
        sum(amount) as amt_out
    from {{ ref('fct_flow_edges') }}
    where level_from in
        ('component', 'appropriation', 'budget_activity', 'sub_agency', 'office')
    group by 1, 2, 3, 4
)

select
    coalesce(i.river, o.river) as river,
    coalesce(i.fiscal_year, o.fiscal_year) as fiscal_year,
    coalesce(i.level, o.level) as level,
    coalesce(i.node, o.node) as node,
    i.amt_in,
    o.amt_out
from inflow i
full outer join outflow o
    on i.river = o.river
    and i.fiscal_year = o.fiscal_year
    and i.level = o.level
    and i.node = o.node
where i.node is null
   or o.node is null
   or abs(coalesce(i.amt_in, 0) - coalesce(o.amt_out, 0))
      > greatest(0.005, 1e-8 * abs(coalesce(i.amt_in, o.amt_out, 0)))
