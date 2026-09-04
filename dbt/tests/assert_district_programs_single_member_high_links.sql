-- No pe_bli may carry HIGH-confidence links under two different accounts.
-- Returns the offending keys (test passes when zero rows returned).
--
-- WHAT THIS GUARDS. fct_district_programs is grained on
-- (pop_state, pop_district, pe_bli) and joins the HIGH-confidence rows of
-- fct_budget_to_awards. Since ROADMAP #70 those rows resolve program_title
-- per (pe_bli, account), so one of the ten codes two Navy programs share can
-- present TWO titles for one pe_bli. The model groups on the pe_bli and takes
-- min() of the label columns — chosen deliberately over grouping BY the title,
-- which would split one district-program into two rows and break the model's
-- own declared grain (assert_district_programs_grain_unique). The cost of that
-- choice is that if both members of a shared code ever carried high links, the
-- district card would sum BOTH programs' money and file it under whichever
-- title sorts first: the #56 fusion shape, in a figure a reader is likely to
-- quote, with every number<->citation gate still green because each underlying
-- link is individually true.
--
-- Latent as of 2026-09-04: exactly one member of '0145' (1508N, 3 links) and
-- one of '3050' (1810N, 4 links) carries high-confidence links, so min() has
-- one value to choose from and the output is byte-identical to the pre-#70
-- model. This test exists so the day that stops being true, someone is told
-- loudly instead of the fusion appearing silently in a district card.
--
-- If this fires, the fix is NOT to relax the test: it is to give
-- fct_district_programs an account-qualified grain (and the district sidecars
-- slug-addressed program links to match), so each member's dollars stay under
-- its own name.
select
    pe_bli,
    count(distinct account) as n_accounts,
    min(account)            as lo_account,
    max(account)            as hi_account,
    count(*)                as n_high_links
from {{ ref('fct_budget_to_awards') }}
where confidence = 'high'
  and account is not null
group by pe_bli
having count(distinct account) > 1
