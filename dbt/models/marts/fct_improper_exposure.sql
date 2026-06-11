-- fct_improper_exposure: per agency_code from improper_payments oversight data.
-- Uses the latest fiscal_year row-set per program, then aggregates to agency level.
-- Joins agency spending from fct_award_transactions where sub-agency names match.
with ip_parsed as (
    select
        agency_code,
        program,
        try_cast(fiscal_year as integer) as fiscal_year,
        try_cast(rate_pct as double) as rate_pct,
        try_cast(amount_usd as double) as amount_usd,
        try_cast(outlays_usd as double) as outlays_usd,
        source_url
    from {{ source('oversight', 'improper_payments') }}
    where agency_code is not null and agency_code <> ''
),
latest_fy_per_program as (
    select
        agency_code,
        program,
        max(fiscal_year) as latest_fy
    from ip_parsed
    group by agency_code, program
),
latest_rows as (
    select ip.*
    from ip_parsed ip
    join latest_fy_per_program l
        on l.agency_code = ip.agency_code
        and l.program = ip.program
        and l.latest_fy = ip.fiscal_year
)
select
    agency_code,
    count(distinct program) as program_count,
    sum(amount_usd) as total_improper_amount_usd,
    case
        when sum(outlays_usd) > 0
        then round(100.0 * sum(amount_usd) / sum(outlays_usd), 4)
        else null
    end as weighted_rate_pct,
    max(fiscal_year) as latest_fiscal_year
from latest_rows
group by agency_code
