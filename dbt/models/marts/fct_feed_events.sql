-- fct_feed_events: anomaly feed for the /feed page.
-- Four event types unioned into one table.
-- Thresholds and junk filter are BINDING per recon §A.
--
-- Columns: event_type, pe_bli (nullable), organization (nullable),
--          family_key (nullable), headline_value, comparison_value,
--          pct_change (nullable), fiscal_year (nullable), units, detail_json.
-- headline_value and comparison_value semantics vary by event_type (see below).

-- ── 1. yoy_swing ──────────────────────────────────────────────────────────────
-- headline_value = fy2026_total ($ thousands), comparison_value = fy2025_total,
-- pct_change = fy2526_pct_change.
-- Filters: pe_bli != '9999999999', organization != '',
--          fy2025_total >= 50000 ($50M floor — amounts are THOUSANDS),
--          |pct_change| >= 50.
-- COALESCE(fy2025_total, fy2025_enacted) is the intended base; this mart uses
-- fy2025_total directly because fct_budget_trajectory already surfaces it.
-- Document: "fy2025_total column only; fy_2025_enacted fallback not applied at
-- mart layer — pipeline chooses fy_2025_total at stg level."
with yoy_swing as (
    select
        'yoy_swing'                              as event_type,
        pe_bli,
        organization,
        cast(null as varchar)                    as family_key,
        coalesce(fy2026_total, 0)                as headline_value,
        coalesce(fy2025_total, 0)                as comparison_value,
        fy2526_pct_change                        as pct_change,
        cast(2026 as integer)                    as fiscal_year,
        'thousands_usd'                          as units,
        cast(null as varchar)                    as detail_json
    from {{ ref('fct_budget_trajectory') }}
    where pe_bli <> '9999999999'
      and organization <> ''
      and coalesce(fy2025_total, 0) >= 50000
      and fy2526_pct_change is not null
      and abs(fy2526_pct_change) >= 50
),

-- ── 2. zeroed_fy2026 ──────────────────────────────────────────────────────────
-- Programs that had budget in FY2025 but show NULL or 0 in FY2026.
-- headline_value = fy2025_total (last known), comparison_value = 0.
zeroed as (
    select
        'zeroed_fy2026'                          as event_type,
        pe_bli,
        organization,
        cast(null as varchar)                    as family_key,
        coalesce(fy2025_total, 0)                as headline_value,
        cast(0 as double)                        as comparison_value,
        cast(null as double)                     as pct_change,
        cast(2026 as integer)                    as fiscal_year,
        'thousands_usd'                          as units,
        cast(null as varchar)                    as detail_json
    from {{ ref('fct_budget_trajectory') }}
    where pe_bli <> '9999999999'
      and coalesce(fy2025_total, 0) > 0
      and coalesce(fy2026_total, 0) = 0
),

-- ── 3. concentration_shift ────────────────────────────────────────────────────
-- Per (pe_bli, fiscal_year) HHI computed over high-confidence award transactions.
-- Window-in-aggregate is a DuckDB BinderException — shares materialized in CTE first.
-- $5M floor on matched dollars. headline_value = HHI, comparison_value = matched_dollars.
prog_family_year as (
    select
        b.pe_bli,
        t.fiscal_year,
        coalesce(x.family_key, t.recipient_uei) as family_key,
        sum(t.obligation)                        as dollars
    from {{ ref('fct_award_transactions') }} t
    join (
        select distinct award_piid, pe_bli
        from {{ ref('fct_budget_to_awards') }}
        where confidence = 'high'
    ) b on t.award_id_piid = b.award_piid
    left join {{ ref('entity_xwalk') }} x on t.recipient_uei = x.recipient_uei
    where t.obligation > 0
    group by 1, 2, 3
),
shares as (
    select
        pe_bli,
        fiscal_year,
        dollars,
        100.0 * dollars / sum(dollars) over (partition by pe_bli, fiscal_year) as share_pct
    from prog_family_year
),
hhi_by_prog_year as (
    select
        pe_bli,
        fiscal_year,
        sum(share_pct * share_pct) as hhi,
        sum(dollars)               as matched_dollars
    from shares
    group by 1, 2
    having sum(dollars) >= 5000000
),
concentration_shift as (
    select
        'concentration_shift'                    as event_type,
        pe_bli,
        cast(null as varchar)                    as organization,
        cast(null as varchar)                    as family_key,
        hhi                                      as headline_value,
        matched_dollars                          as comparison_value,
        cast(null as double)                     as pct_change,
        fiscal_year,
        'hhi_dollars'                            as units,
        cast(null as varchar)                    as detail_json
    from hhi_by_prog_year
),

-- ── 4. new_entrant ────────────────────────────────────────────────────────────
-- Weak signal: families whose first award year is >= 2024, with $1M+ total obligations.
-- headline_value = total_obligation, comparison_value = first_fy.
fam_year as (
    select
        x.family_key,
        min(t.fiscal_year) as first_fy,
        sum(t.obligation)  as total_obl
    from {{ ref('fct_award_transactions') }} t
    join {{ ref('entity_xwalk') }} x on t.recipient_uei = x.recipient_uei
    where t.obligation > 0
    group by 1
),
new_entrant as (
    select
        'new_entrant'                            as event_type,
        cast(null as varchar)                    as pe_bli,
        cast(null as varchar)                    as organization,
        family_key,
        total_obl                                as headline_value,
        cast(first_fy as double)                 as comparison_value,
        cast(null as double)                     as pct_change,
        first_fy                                 as fiscal_year,
        'dollars'                                as units,
        cast(null as varchar)                    as detail_json
    from fam_year
    where first_fy >= 2024
      and total_obl >= 1000000
)

-- ── UNION ALL ─────────────────────────────────────────────────────────────────
select event_type, pe_bli, organization, family_key,
       headline_value, comparison_value, pct_change,
       fiscal_year, units, detail_json
from yoy_swing

union all

select event_type, pe_bli, organization, family_key,
       headline_value, comparison_value, pct_change,
       fiscal_year, units, detail_json
from zeroed

union all

select event_type, pe_bli, organization, family_key,
       headline_value, comparison_value, pct_change,
       fiscal_year, units, detail_json
from concentration_shift

union all

select event_type, pe_bli, organization, family_key,
       headline_value, comparison_value, pct_change,
       fiscal_year, units, detail_json
from new_entrant
