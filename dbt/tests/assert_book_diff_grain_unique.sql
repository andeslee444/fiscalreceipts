-- fct_book_diff grain: (pe_bli, from_edition, to_edition, diff_kind) unique.
select pe_bli, from_edition, to_edition, diff_kind, count(*)
from {{ ref('fct_book_diff') }}
group by 1, 2, 3, 4
having count(*) > 1
