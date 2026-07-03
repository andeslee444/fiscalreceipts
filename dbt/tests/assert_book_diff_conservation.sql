-- fct_book_diff conservation: delta == to_value - from_value, both sides
-- non-null (verify-phase5e leg c contract; tolerance $1k = the gate's _TOL).
select *
from {{ ref('fct_book_diff') }}
where from_value is null
   or to_value is null
   or delta is null
   or abs(delta - (to_value - from_value)) > 1.0
