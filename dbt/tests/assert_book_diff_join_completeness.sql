-- fct_book_diff join completeness: every diff row's two inputs exist in
-- fct_decade_series with exactly the values the diff carries.
with sides as (
    select pe_bli, from_edition as edition_year, 'request' as kind,
           from_value as value, diff_kind, from_edition, to_edition
    from {{ ref('fct_book_diff') }}
    union all
    select pe_bli, to_edition,
           case diff_kind when 'request_vs_request' then 'request'
                          else 'actuals' end,
           to_value, diff_kind, from_edition, to_edition
    from {{ ref('fct_book_diff') }}
)
select s.*
from sides s
left join {{ ref('fct_decade_series') }} d
  on d.pe_bli = s.pe_bli
 and d.edition_year = s.edition_year
 and d.amount_type_kind = s.kind
where d.pe_bli is null
   or abs(d.amount - s.value) > 0.001
