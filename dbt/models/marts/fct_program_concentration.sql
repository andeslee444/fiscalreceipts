-- fct_program_concentration: HHI of vendor-family concentration per pe_bli.
-- Award dollars enter ONCE per award (not per transaction) to avoid double-count.
-- Only high+medium confidence links (from fct_budget_to_awards by construction).
with award_dollars as (
    -- sum obligation at award grain across all transactions
    select
        award_id_piid,
        sum(obligation) as award_obligation
    from {{ ref('fct_award_transactions') }}
    where award_id_piid is not null
    group by award_id_piid
),
linked_awards as (
    -- join the crosswalk link table (high+medium only by construction)
    select
        l.pe_bli,
        l.award_piid,
        coalesce(a.award_obligation, 0) as award_obligation,
        coalesce(x.family_key, l.recipient_uei, upper(l.recipient_name)) as family_key
    from {{ ref('fct_budget_to_awards') }} l
    left join award_dollars a
        on a.award_id_piid = l.award_piid
    left join {{ ref('entity_xwalk') }} x
        on x.recipient_uei = l.recipient_uei
),
program_totals as (
    select
        pe_bli,
        sum(award_obligation) as program_dollars
    from linked_awards
    group by pe_bli
),
family_totals as (
    select
        la.pe_bli,
        la.family_key,
        sum(la.award_obligation) as family_dollars
    from linked_awards la
    group by la.pe_bli, la.family_key
),
family_shares as (
    select
        ft.pe_bli,
        ft.family_key,
        ft.family_dollars,
        pt.program_dollars,
        case
            when pt.program_dollars > 0
            then 100.0 * ft.family_dollars / pt.program_dollars
            else 0
        end as share_pct
    from family_totals ft
    join program_totals pt on pt.pe_bli = ft.pe_bli
),
hhi_calc as (
    select
        pe_bli,
        sum(share_pct * share_pct) as hhi,
        count(distinct family_key) as family_count,
        max(program_dollars) as program_dollars
    from family_shares
    group by pe_bli
),
top_family as (
    select distinct on (pe_bli)
        pe_bli,
        family_key as top_family
    from family_shares
    order by pe_bli, family_dollars desc
)
select
    h.pe_bli,
    h.hhi,
    t.top_family,
    h.family_count,
    h.program_dollars
from hhi_calc h
left join top_family t on t.pe_bli = h.pe_bli
