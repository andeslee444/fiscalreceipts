-- fct_state_spend: union of CA and CT checkbook aggregates, jurisdiction-tagged.
-- Grain: one row per (jurisdiction, department, category, fiscal_year).
-- CA comes from Open Fi$Cal per-department transaction aggregates.
-- CT comes from data.ct.gov OpenCheckbook SoQL aggregate query.
-- All amounts cast from varchar; rows with unparseable amounts excluded.
with ca as (
    select
        jurisdiction,
        department,
        category,
        fiscal_year,
        try_cast(amount_usd as double) as amount_usd,
        source_url
    from {{ source('states', 'ca_checkbook') }}
    where try_cast(amount_usd as double) is not null
),
ct as (
    select
        jurisdiction,
        department,
        category,
        fiscal_year,
        try_cast(amount_usd as double) as amount_usd,
        source_url
    from {{ source('states', 'ct_checkbook') }}
    where try_cast(amount_usd as double) is not null
)
select * from ca
union all
select * from ct
