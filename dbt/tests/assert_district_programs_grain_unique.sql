-- Singular test: fct_district_programs must be unique on (pop_district, pe_bli).
-- Returns rows that violate uniqueness (test passes when zero rows returned).
select pop_district, pe_bli, count(*)
from {{ ref('fct_district_programs') }}
group by 1, 2
having count(*) > 1
