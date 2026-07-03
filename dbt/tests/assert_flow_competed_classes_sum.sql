-- Phase 5H competition overlay honesty: per fiscal year and competed_class,
-- the spend river's mouth (total → sub_agency edges) must equal an
-- INDEPENDENT regroup of the source contracts lake. The class mapping is
-- deliberately duplicated here (independent copy, like the gates' canonical
-- section list) — drift between this mapping and stg_flow_contracts is a
-- real failure.
--
-- This also proves the classes partition the total: every source row lands
-- in exactly one class, so sum-over-classes == river total by construction
-- of the comparison.

with mart as (
    select
        fiscal_year,
        competed_class,
        sum(amount) as amt
    from {{ ref('fct_flow_edges') }}
    where river = 'spend' and level_from = 'total'
    group by 1, 2
),

src as (
    select
        cast(fy as integer) as fiscal_year,
        case
            when extent_competed = 'FULL AND OPEN COMPETITION'
                then 'full_and_open'
            when extent_competed = 'FULL AND OPEN COMPETITION AFTER EXCLUSION OF SOURCES'
                then 'set_aside'
            when extent_competed in (
                'COMPETED UNDER SAP',
                'FOLLOW ON TO COMPETED ACTION',
                'COMPETITIVE DELIVERY ORDER'
            )
                then 'other_than_full'
            else 'not_competed'
        end as competed_class,
        sum(try_cast(federal_action_obligation as double)) as amt
    from {{ source('lake', 'contracts') }}
    group by 1, 2
)

select
    coalesce(m.fiscal_year, s.fiscal_year) as fiscal_year,
    coalesce(m.competed_class, s.competed_class) as competed_class,
    m.amt as mart_amt,
    s.amt as src_amt
from mart m
full outer join src s
    on m.fiscal_year = s.fiscal_year
    and m.competed_class = s.competed_class
where m.competed_class is null
   or s.competed_class is null
   or abs(coalesce(m.amt, 0) - coalesce(s.amt, 0))
      > greatest(1.0, 1e-8 * abs(coalesce(m.amt, s.amt, 0)))
