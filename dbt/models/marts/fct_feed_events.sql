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
-- NULL-safety (Sprint 3 Task 1b sibling audit): both sides are stated as
-- NOT NULL rather than coalesced to 0. This is a no-op on the live corpus —
-- 0 of the 99 rows had a NULL on either side, because fy2526_pct_change is
-- itself NULL whenever either side is missing, so the existing
-- `pct_change is not null` filter already excluded them. The coalesces were
-- unreachable, but they were the SAME trap that made zeroed_fy2026 publish
-- 87 false claims: a NULL silently becoming a $0 that a sentence then
-- describes. Absence is filtered out here, never relabelled as zero.
with yoy_swing as (
    select
        'yoy_swing'                              as event_type,
        pe_bli,
        organization,
        cast(null as varchar)                    as family_key,
        fy2026_total                             as headline_value,
        fy2025_total                             as comparison_value,
        fy2526_pct_change                        as pct_change,
        cast(2026 as integer)                    as fiscal_year,
        'thousands_usd'                          as units,
        cast(null as varchar)                    as detail_json
    from {{ ref('fct_budget_trajectory') }}
    where pe_bli <> '9999999999'
      and organization <> ''
      and fy2025_total is not null
      and fy2025_total >= 50000
      and fy2026_total is not null
      and fy2526_pct_change is not null
      and abs(fy2526_pct_change) >= 50
),

-- ── 2. zeroed_fy2026 ──────────────────────────────────────────────────────────
-- Programs the corpus records as LITERALLY ZERO in FY2026 after carrying
-- positive FY2025 money. headline_value = fy2025_total (the newsworthy
-- magnitude), comparison_value = 0 (the FY2026 figure).
--
-- BINDING: `fy2026_total is not null` is the whole point of this CTE.
-- It shipped as `coalesce(fy2026_total, 0) = 0`, which conflated ABSENT with
-- ZERO and published 87 false "zeroed out in FY2026" cards — every one of them
-- a NULL, not one a genuine zero (PM-review Sprint 3 Task 1b).
--
-- Why absence is not zero. fy2026_total is NULL when a (pe_bli, organization)
-- carries no fy_2026_total row at all, which happens when the FY2026 cells in
-- the source workbook are BLANK. DoD distinguishes blank from zero inside a
-- single file, and rollup_loader.py preserves that distinction: it skips
-- None/'' cells and stores literal 0s (the corpus holds 64,719 explicit zero
-- rows). From data/raw_docs/fy2026/dod/, the official FY2026 display books:
--   0601101E "Defense Research Sciences" (R-1) — FY2025 Total 293145,
--     FY 2026 Disc Request '', FY 2026 Total ''            <- BLANK
--   E00700 "E-7" (P-1) — FY2025 Total 200000, FY2026 Total 0   <- LITERAL 0
-- Blank means "this line is not carried in the FY2026 columns" — commonly a
-- program-element restructuring, not a termination. DARPA is the clearest
-- case: PB2026 retired 14 thematic PEs and introduced 8 new mission PEs
-- ("Emerging Opportunities", "Effects", ...) while its FY2026 total ROSE to
-- $4.92B from $4.15B in FY2025. Calling those retired codes "zeroed out"
-- describes a renumbering as a cancellation.
--
-- On the live corpus this predicate emits ZERO rows, and that is the correct
-- result: the two literal fy_2026_total = 0 rows (E00700, MGBSD0) both lack a
-- fy_2025_total, so neither can support a "had $X in FY25" claim. An empty
-- event class is the honest outcome — do NOT relax this back toward coalesce
-- to keep the card count up.
zeroed as (
    select
        'zeroed_fy2026'                          as event_type,
        pe_bli,
        organization,
        cast(null as varchar)                    as family_key,
        fy2025_total                             as headline_value,
        cast(0 as double)                        as comparison_value,
        cast(null as double)                     as pct_change,
        cast(2026 as integer)                    as fiscal_year,
        'thousands_usd'                          as units,
        cast(null as varchar)                    as detail_json
    from {{ ref('fct_budget_trajectory') }}
    where pe_bli <> '9999999999'
      and fy2025_total is not null
      and fy2025_total > 0
      -- positive evidence of a zero, never inferred from absence
      and fy2026_total is not null
      and fy2026_total = 0
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
--
-- RANK-CAPPED at the 25 largest (Task 5b). The $1M floor alone yielded ~20 rows
-- only because the entity crosswalk was stale at FY2017-FY2019 and structurally
-- could not contain a family whose first award year was >= 2024. With the
-- crosswalk rebuilt over FY2017-FY2026 the same floor yields 1,667 — 90% of the
-- whole feed, and a /feed/ page of 9.2 MB against a 1.7 MB ceiling. The floor is
-- the DEFINITION of the signal and is left alone; the cap is presentation, and
-- matches how the feed already treats request-vs-actuals gaps (_FEED_RVA_TOP=15
-- in export_site.py). Ranked by dollars, tie-broken by family_key so the set is
-- deterministic.
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
    from (
        select *, row_number() over (order by total_obl desc, family_key) as rn
        from fam_year
        where first_fy >= 2024
          and total_obl >= 1000000
    )
    where rn <= 25
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
