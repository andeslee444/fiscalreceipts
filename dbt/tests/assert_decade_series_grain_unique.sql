-- fct_decade_series grain: (pe_bli, fy, edition_year) must be unique
-- (verify-phase5e leg d duplicate-grain check).
select pe_bli, fy, edition_year, count(*)
from {{ ref('fct_decade_series') }}
group by 1, 2, 3
having count(*) > 1
