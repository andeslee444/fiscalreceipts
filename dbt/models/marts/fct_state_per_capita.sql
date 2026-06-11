-- fct_state_per_capita: cross-jurisdiction cost-per-capita comparable (CA vs CT).
-- Grain: one row per (jurisdiction, comparable_category, fiscal_year).
-- comparable_category comes from dbt seed state_category_map.csv which maps
-- jurisdiction-specific category vocabulary to a shared canonical label.
-- Only rows where both CA and CT have mapped spend for the same (comparable_category, year)
-- are included (inner join logic via the seed mapping).
-- amount_per_capita = total_amount_usd / population.
-- Provenance: source_url from spend rows; census source_url from population rows.
-- Population join: uses the most recent available Census year at-or-before the spend fiscal_year
-- (Census NST-EST2024 covers through 2024; FY2025 spend uses 2024 population estimate as proxy).
with category_map as (
    select
        jurisdiction,
        raw_category,
        comparable_category
    from {{ ref('state_category_map') }}
),
spend_mapped as (
    select
        s.jurisdiction,
        m.comparable_category,
        s.fiscal_year,
        sum(s.amount_usd) as total_amount_usd,
        -- provenance: take any non-null source_url per group (all rows same query)
        max(s.source_url) as spend_source_url
    from {{ ref('fct_state_spend') }} s
    join category_map m
        on m.jurisdiction = s.jurisdiction
        and m.raw_category = s.category
    group by s.jurisdiction, m.comparable_category, s.fiscal_year
),
population_all as (
    select
        state,
        try_cast(year as integer) as pop_year,
        try_cast(population as bigint) as population,
        source_url as pop_source_url
    from {{ source('states', 'state_population') }}
    where state in ('CA', 'CT')
      and try_cast(population as bigint) > 0
),
-- For each (jurisdiction, fiscal_year) in spend, pick the most recent population year
-- that is <= fiscal_year (or the minimum available if fiscal_year < all pop years)
pop_for_spend as (
    select
        sm.jurisdiction,
        sm.fiscal_year,
        p.population,
        p.pop_source_url,
        p.pop_year
    from (select distinct jurisdiction, fiscal_year from spend_mapped) sm
    join population_all p
        on p.state = sm.jurisdiction
        and p.pop_year = (
            select max(pop_year) from population_all p2
            where p2.state = sm.jurisdiction
              and p2.pop_year <= try_cast(sm.fiscal_year as integer)
        )
),
-- jurisdiction_state maps the 2-letter jurisdiction tag to 2-letter state code
-- (both happen to be the same: CA->CA, CT->CT)
with_pop as (
    select
        sm.jurisdiction,
        sm.comparable_category,
        sm.fiscal_year,
        sm.total_amount_usd,
        sm.spend_source_url,
        p.population,
        p.pop_source_url,
        p.pop_year as pop_year_used,
        round(sm.total_amount_usd / p.population, 4) as amount_per_capita
    from spend_mapped sm
    join pop_for_spend p
        on p.jurisdiction = sm.jurisdiction
        and p.fiscal_year = sm.fiscal_year
    where p.population > 0
),
-- Keep only (comparable_category, fiscal_year) combos present for BOTH jurisdictions
both_present as (
    select comparable_category, fiscal_year
    from with_pop
    group by comparable_category, fiscal_year
    having count(distinct jurisdiction) = 2
)
select
    wp.jurisdiction,
    wp.comparable_category,
    wp.fiscal_year,
    wp.total_amount_usd,
    wp.population,
    wp.amount_per_capita,
    wp.pop_year_used,
    wp.spend_source_url,
    wp.pop_source_url
from with_pop wp
join both_present bp
    on bp.comparable_category = wp.comparable_category
    and bp.fiscal_year = wp.fiscal_year
