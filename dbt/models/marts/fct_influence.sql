-- fct_influence: lobbying disclosure amounts per (family_key, filing_year)
-- joined with total obligations from dim_entities.
--
-- lobbying_income_usd: sum of income_usd from filings where registrant is an
--   outside lobbying firm (income is set; expenses null).
-- lobbying_expense_usd: sum of expenses_usd from filings where registrant IS
--   the client/in-house filer (expenses set; income null).
-- These are mutually exclusive per filing (LDA design); summing both gives
-- total lobbying outlay without double-counting.
--
-- Neutral language: no column name implies causation between lobbying and awards.
with filings as (
    select
        family_key_guess                             as family_key,
        filing_year,
        count(*)                                     as filings_count,
        sum(try_cast(nullif(income_usd,  '') as double)) as lobbying_income_usd,
        sum(try_cast(nullif(expenses_usd,'') as double)) as lobbying_expense_usd
    from {{ source('influence', 'lda_filings') }}
    where family_key_guess is not null
      and family_key_guess <> ''
    group by family_key_guess, filing_year
),
entities as (
    select
        family_key,
        display_name,
        total_obligation as obligations_usd
    from {{ ref('dim_entities') }}
)
select
    f.family_key,
    e.display_name,
    f.filing_year,
    f.filings_count,
    coalesce(f.lobbying_income_usd,  0) as lobbying_income_usd,
    coalesce(f.lobbying_expense_usd, 0) as lobbying_expense_usd,
    coalesce(f.lobbying_income_usd, 0)
        + coalesce(f.lobbying_expense_usd, 0)  as lobbying_total_usd,
    e.obligations_usd
from filings f
left join entities e
    on e.family_key = f.family_key
