-- fct_decade_series PB2026 regression pin (Phase 5E Task 5).
--
-- PE 0601101E FY2024 actuals AS PB2026 REPORTS THEM = 280,494 $K — the
-- launch-certified value (same figure the dim_programs pin carries in
-- millions). The row must EXIST and carry exactly this amount: a missing
-- row means the detail rule or the lake-verifiability filter over-excluded
-- (e.g. a provenance-less rollup twin leaked back into the lake); a
-- doubled 560,988 means rollup+detail double-counting returned.
with expected(pe_bli, fy, edition_year, amount) as (
    select '0601101E', 2024, 2026, 280494.0
)
select
    e.pe_bli,
    e.fy,
    e.edition_year,
    e.amount as expected_amount,
    m.amount as actual_amount
from expected e
left join {{ ref('fct_decade_series') }} m
  on m.pe_bli = e.pe_bli
 and m.fy = e.fy
 and m.edition_year = e.edition_year
where m.pe_bli is null
   or abs(m.amount - e.amount) > 1.0
