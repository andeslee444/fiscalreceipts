-- stg_flow_contracts: contract transactions with the competition columns the
-- flowdown chart needs (Phase 5H). Deliberately a SEPARATE staging model from
-- stg_contracts: that model's column order is load-bearing (positional UNION
-- with stg_assistance in fct_award_transactions), so adding columns there
-- would ripple into existing marts. This model is flow-only.
--
-- competed_class — the 4 honest classes (spec §2). FPDS extent_competed maps:
--   full_and_open   ← FULL AND OPEN COMPETITION
--   set_aside       ← FULL AND OPEN COMPETITION AFTER EXCLUSION OF SOURCES
--                     (set-asides / excluded sources; competed but not open)
--   other_than_full ← COMPETED UNDER SAP, FOLLOW ON TO COMPETED ACTION,
--                     COMPETITIVE DELIVERY ORDER (competed, but not under
--                     full-and-open procedures)
--   not_competed    ← NOT COMPETED, NOT AVAILABLE FOR COMPETITION,
--                     NOT COMPETED UNDER SAP, plus NULL/blank (documented:
--                     the NULL bucket is ~$69K of ~$4.0T total — folding it
--                     into not_competed never flatters competition numbers).
--
-- offers_bucket — number_of_offers_received distribution for hover overlays:
--   '1' | '2' | '3-4' | '5-9' | '10+' | 'unknown' (NULL / non-numeric / <1).
select
    cast(fy as integer) as fiscal_year,
    coalesce(nullif(awarding_sub_agency_name, ''), 'UNKNOWN SUB-AGENCY')
        as sub_agency,
    coalesce(nullif(awarding_office_name, ''), 'UNKNOWN OFFICE') as office,
    nullif(recipient_uei, '') as recipient_uei,
    upper(coalesce(
        nullif(recipient_parent_name, ''),
        nullif(recipient_name, '')
    )) as recipient_fallback_name,
    case
        when extent_competed = 'FULL AND OPEN COMPETITION'
            then 'full_and_open'
        when extent_competed = 'FULL AND OPEN COMPETITION AFTER EXCLUSION OF SOURCES'
            then 'set_aside'
        when extent_competed in (
            'COMPETED UNDER SAP',
            'FOLLOW ON TO COMPETED ACTION',
            'COMPETITIVE DELIVERY ORDER'
        )
            then 'other_than_full'
        else 'not_competed'
    end as competed_class,
    case
        when try_cast(number_of_offers_received as integer) is null
            or try_cast(number_of_offers_received as integer) < 1
            then 'unknown'
        when try_cast(number_of_offers_received as integer) = 1 then '1'
        when try_cast(number_of_offers_received as integer) = 2 then '2'
        when try_cast(number_of_offers_received as integer) <= 4 then '3-4'
        when try_cast(number_of_offers_received as integer) <= 9 then '5-9'
        else '10+'
    end as offers_bucket,
    try_cast(federal_action_obligation as double) as obligation
from {{ source('lake', 'contracts') }}
