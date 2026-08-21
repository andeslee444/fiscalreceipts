-- fct_book_diff join completeness: every diff row's two inputs exist in
-- fct_decade_series with exactly the values the diff carries.
--
-- E2 (Sprint E, ROADMAP #67): the join is scoped by account too (`is not
-- distinct from` — NOT `=`, since account is NULL for the ~1,700+
-- ordinary single-account pe_bli and a plain `=` would drop every
-- NULL=NULL pair). Without this, a genuine PB2026 collision's diff row
-- (now correctly account-scoped by fct_book_diff.sql's own E2 fix) would
-- join against BOTH of fct_decade_series' per-account rows for that
-- (pe_bli, edition, kind) — matching whichever one happens to equal
-- s.value and silently accepting a coincidental match instead of proving
-- the diff actually came from ITS OWN account's series row.
with sides as (
    select pe_bli, account, from_edition as edition_year, 'request' as kind,
           from_value as value, diff_kind, from_edition, to_edition
    from {{ ref('fct_book_diff') }}
    union all
    select pe_bli, account, to_edition,
           case diff_kind when 'request_vs_request' then 'request'
                          else 'actuals' end,
           to_value, diff_kind, from_edition, to_edition
    from {{ ref('fct_book_diff') }}
)
select s.*
from sides s
left join {{ ref('fct_decade_series') }} d
  on d.pe_bli = s.pe_bli
 and d.account is not distinct from s.account
 and d.edition_year = s.edition_year
 and d.amount_type_kind = s.kind
where d.pe_bli is null
   or abs(d.amount - s.value) > 0.001
