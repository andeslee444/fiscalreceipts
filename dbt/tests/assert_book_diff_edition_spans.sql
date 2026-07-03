-- fct_book_diff edition spans: request_vs_request compares consecutive
-- editions (span 1, sides are FY N vs FY N+1); request_vs_actuals compares
-- PB(N) with PB(N+2) for the SAME fiscal year N (span 2, from_fy == to_fy
-- == from_edition — the year-shift rule the verify-phase5e gate enforces).
select *
from {{ ref('fct_book_diff') }}
where (
        diff_kind = 'request_vs_request'
        and (to_edition - from_edition <> 1
             or from_fy <> from_edition
             or to_fy <> to_edition)
      )
   or (
        diff_kind = 'request_vs_actuals'
        and (to_edition - from_edition <> 2
             or from_fy <> from_edition
             or to_fy <> from_fy)
      )
