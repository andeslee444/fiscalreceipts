-- fct_flow_edges: both rivers of the Phase 5H flowdown chart, at FULL grain.
-- Top-N + "Other (N)" aggregation happens at EXPORT time, never here.
--
-- Grain: one row per (river, fiscal_year, level_from, node_from, level_to,
--         node_to, competed_class, offers_bucket). Labels are max()-aggregated
--         so a stray label variant can never fan the grain out.
--
-- Budget river (intent — FY2026 PB, R-1 + P-1):
--   detail rows only (title IS NOT NULL — the dedup rule; title-NULL rows are
--   R-1 rollups of the same dollars), amount_type = 'fy_2026_total'.
--   Hierarchy: TOTAL → component (organization; '' → CLASSIFIED, the
--   Classified Programs lines that carry no org) → appropriation (account,
--   keyed component|account since accounts repeat across defense-wide orgs)
--   → budget_activity (keyed component|account|ba; P-1 rows sometimes carry a
--   BA code with no title — label falls back to 'BA <code>') → program
--   (keyed component|account|ba|pe_bli). Amounts in USD thousands (native
--   J-book units; the spend river is dollars — the two rivers are separate
--   labeled systems, never mixed).
--   competed_class / offers_bucket are NULL: budget intent has no
--   competition dimension.
--
-- Spend river (obligations — DoD prime CONTRACT transactions only; the lake
-- is DoD-scoped and assistance carries no competition fields):
--   TOTAL → awarding sub-agency → contracting office (keyed
--   sub_agency|office; office names repeat across sub-agencies) → recipient
--   family (entity_xwalk family_key; unmatched UEIs fall back to
--   upper(parent-or-recipient name), then UEI, then 'UNKNOWN RECIPIENT').
--   Per fiscal year, split by competed_class and offers_bucket at every
--   level. Amounts in USD (dollars).
--
-- Conservation contract (dbt tests): for every intermediate node, inflow ==
-- outflow; per-class sums at the river mouth match an independent regroup of
-- the source lake. See tests/assert_flow_*.sql.

with budget_detail as (
    select
        case
            when organization is null or organization = '' then 'CLASSIFIED'
            else organization
        end as component,
        account,
        coalesce(account_title, account) as account_title,
        coalesce(budget_activity, '?') as ba,
        case
            when budget_activity_title is not null
                and budget_activity_title <> '' then budget_activity_title
            else 'BA ' || coalesce(budget_activity, '?')
        end as ba_title,
        pe_bli,
        title,
        fiscal_year,
        amount_thousands as amount
    from {{ ref('stg_budget_lines') }}
    where title is not null
      and amount_type = 'fy_2026_total'
),

component_labeled as (
    select
        *,
        case component
            when 'A' then 'Army'
            when 'N' then 'Navy / Marine Corps'
            when 'F' then 'Air Force / Space Force'
            when 'CLASSIFIED' then 'Classified Programs'
            else component
        end as component_label
    from budget_detail
),

budget_edges as (
    -- TOTAL → component
    select
        'budget' as river,
        fiscal_year,
        'total' as level_from,
        'TOTAL' as node_from,
        'FY2026 President''s Budget (R-1 + P-1)' as node_from_label,
        'component' as level_to,
        component as node_to,
        max(component_label) as node_to_label,
        cast(null as varchar) as competed_class,
        cast(null as varchar) as offers_bucket,
        sum(amount) as amount,
        count(*) as line_count,
        'USD_thousands' as units
    from component_labeled
    group by fiscal_year, component

    union all

    -- component → appropriation
    select
        'budget', fiscal_year,
        'component', component, max(component_label),
        'appropriation',
        component || '|' || account,
        max(account_title),
        null, null,
        sum(amount), count(*), 'USD_thousands'
    from component_labeled
    group by fiscal_year, component, account

    union all

    -- appropriation → budget_activity
    select
        'budget', fiscal_year,
        'appropriation', component || '|' || account, max(account_title),
        'budget_activity',
        component || '|' || account || '|' || ba,
        max(ba_title),
        null, null,
        sum(amount), count(*), 'USD_thousands'
    from component_labeled
    group by fiscal_year, component, account, ba

    union all

    -- budget_activity → program
    select
        'budget', fiscal_year,
        'budget_activity', component || '|' || account || '|' || ba,
        max(ba_title),
        'program',
        component || '|' || account || '|' || ba || '|' || pe_bli,
        max(title),
        null, null,
        sum(amount), count(*), 'USD_thousands'
    from component_labeled
    group by fiscal_year, component, account, ba, pe_bli
),

spend_base as (
    select
        c.fiscal_year,
        c.sub_agency,
        c.office,
        coalesce(
            x.family_key,
            c.recipient_fallback_name,
            c.recipient_uei,
            'UNKNOWN RECIPIENT'
        ) as family,
        c.competed_class,
        c.offers_bucket,
        c.obligation
    from {{ ref('stg_flow_contracts') }} c
    left join {{ ref('entity_xwalk') }} x
        on x.recipient_uei = c.recipient_uei
),

spend_edges as (
    -- TOTAL → sub-agency
    select
        'spend' as river,
        fiscal_year,
        'total' as level_from,
        'TOTAL' as node_from,
        'DoD contract obligations' as node_from_label,
        'sub_agency' as level_to,
        sub_agency as node_to,
        sub_agency as node_to_label,
        competed_class,
        offers_bucket,
        sum(obligation) as amount,
        count(*) as line_count,
        'USD' as units
    from spend_base
    group by fiscal_year, sub_agency, competed_class, offers_bucket

    union all

    -- sub-agency → contracting office
    select
        'spend', fiscal_year,
        'sub_agency', sub_agency, sub_agency,
        'office',
        sub_agency || '|' || office,
        max(office),
        competed_class, offers_bucket,
        sum(obligation), count(*), 'USD'
    from spend_base
    group by fiscal_year, sub_agency, office, competed_class, offers_bucket

    union all

    -- contracting office → recipient family
    select
        'spend', fiscal_year,
        'office', sub_agency || '|' || office, max(office),
        'family',
        family,
        family,
        competed_class, offers_bucket,
        sum(obligation), count(*), 'USD'
    from spend_base
    group by fiscal_year, sub_agency, office, family,
             competed_class, offers_bucket
)

select * from budget_edges
union all
select * from spend_edges
