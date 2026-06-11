-- fct_agency_concentration: HHI of vendor-family concentration per awarding_sub_agency_name.
-- All transactions (contracts + assistance) included; family via entity_xwalk (fallback = recipient_name).
-- HHI uses positive-obligation share only: families with net negative obligations are excluded
-- from the share calculation to keep HHI ∈ (0, 10000].
-- positive-only shares: families with net deobligations keep full positive share (documented bias).
with txn_families as (
    select
        t.awarding_sub_agency_name,
        t.obligation,
        coalesce(x.family_key, t.recipient_uei, t.recipient_name) as family_key
    from {{ ref('fct_award_transactions') }} t
    left join {{ ref('entity_xwalk') }} x
        on x.recipient_uei = t.recipient_uei
    where t.awarding_sub_agency_name is not null
      and t.awarding_sub_agency_name <> ''
),
agency_totals as (
    select
        awarding_sub_agency_name,
        sum(obligation) as total_obligation,
        -- positive-only total for share denominator (avoids share > 100%)
        sum(case when obligation > 0 then obligation else 0 end) as pos_obligation
    from txn_families
    group by awarding_sub_agency_name
),
family_totals as (
    select
        awarding_sub_agency_name,
        family_key,
        sum(obligation) as family_obligation,
        sum(case when obligation > 0 then obligation else 0 end) as family_pos_obligation
    from txn_families
    group by awarding_sub_agency_name, family_key
),
family_shares as (
    select
        ft.awarding_sub_agency_name,
        ft.family_key,
        ft.family_obligation,
        ag.total_obligation,
        -- share computed on positive-only basis to keep HHI ∈ [0, 10000]
        case
            when ag.pos_obligation > 0 and ft.family_pos_obligation > 0
            then 100.0 * ft.family_pos_obligation / ag.pos_obligation
            else 0
        end as share_pct
    from family_totals ft
    join agency_totals ag on ag.awarding_sub_agency_name = ft.awarding_sub_agency_name
)
select
    awarding_sub_agency_name,
    sum(share_pct * share_pct) as hhi,
    max(total_obligation) as total_obligation,
    count(distinct family_key) as family_count
from family_shares
group by awarding_sub_agency_name
