-- Singular test: fct_district_totals must be unique on (pop_state, pop_district).
-- Returns rows that violate uniqueness (test passes when zero rows returned).
--
-- Grain is the PAIR, not pop_district alone: verified against the shipped
-- warehouse that pop_district is not globally unique (a bare '90' —
-- MULTI-STATE/unknown-state allocations — appears against more than one raw
-- pop_state label), so a single-column unique test on pop_district would be
-- looser than the true grain. See fct_district_totals.sql's header comment.
select pop_state, pop_district, count(*)
from {{ ref('fct_district_totals') }}
group by 1, 2
having count(*) > 1
