-- fct_book_diff grain: (pe_bli, account, from_edition, to_edition, diff_kind)
-- unique.
--
-- E2 (Sprint E, ROADMAP #67): widened from (pe_bli, from_edition,
-- to_edition, diff_kind) to include account, mirroring
-- fct_decade_series' own E2 grain widening — a genuine PB2026 collision's
-- two accounts are two different programs' diffs, not two rows of one
-- diff. account is NULL for every other pe_bli (unchanged), so this
-- reproduces the pre-E2 check byte-for-byte there.
select pe_bli, account, from_edition, to_edition, diff_kind, count(*)
from {{ ref('fct_book_diff') }}
group by 1, 2, 3, 4, 5
having count(*) > 1
