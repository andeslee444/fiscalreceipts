-- dim_pe_titles: canonical display title per pe_bli, resolved from TITLED
-- detail rows in fct_budget_lines (title IS NOT NULL — stg_budget_lines
-- carries both detail rows and R-1 rollup rows whose title IS NULL).
--
-- This mart is the single source for program-title resolution wherever a
-- pe_bli needs a human-readable name (the feed exporter consumes it; it
-- covers every trajectory pe_bli, unlike dim_programs which only covers
-- R-2/P-40 programs with parsed J-book details).
--
-- Deterministic rule (BINDING — mirrored nowhere else):
--   1. the title of the detail row with the largest fy_2024_actuals amount
--      (fy_2024_actuals is the most-populated detail amount_type);
--   2. pe_blis with no fy_2024_actuals rows, and exact-amount ties, fall
--      back to the alphabetically-first title.
select pe_bli, title
from (
    select
        pe_bli,
        title,
        row_number() over (
            partition by pe_bli
            order by (case when amount_type = 'fy_2024_actuals'
                           then amount_thousands end) desc nulls last,
                     title asc
        ) as rn
    from {{ ref('fct_budget_lines') }}
    where pe_bli is not null and title is not null
)
where rn = 1
