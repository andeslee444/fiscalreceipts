-- Column order is load-bearing: fct_award_transactions UNION ALLs this model
-- positionally with its sibling staging model. Keep both lists identical.
-- New columns (recon §D, added 2026-06-12):
--   col 17: usaspending_permalink  — raw permalink from USAspending bulk download
--   col 18: award_unique_key       — alias of contract_award_unique_key (contracts)
--                                    or assistance_award_unique_key (assistance)
select
    contract_transaction_unique_key as transaction_key,
    'contract' as award_type,
    try_cast(action_date as date) as action_date,
    cast(fy as integer) as fiscal_year,
    try_cast(federal_action_obligation as double) as obligation,
    nullif(recipient_uei, '') as recipient_uei,
    upper(recipient_name) as recipient_name,
    nullif(recipient_parent_uei, '') as recipient_parent_uei,
    upper(recipient_parent_name) as recipient_parent_name,
    awarding_agency_name,
    awarding_sub_agency_name,
    naics_code,
    product_or_service_code,
    primary_place_of_performance_state_code as pop_state,
    prime_award_transaction_place_of_performance_cd_current as pop_district,
    -- award_id_piid: real column in contracts; null-cast in assistance (SAME position both files)
    nullif(award_id_piid, '') as award_id_piid,
    -- usaspending_permalink: real column in contracts; null-cast in assistance (SAME position both files)
    usaspending_permalink,
    -- award_unique_key: contract_award_unique_key here; assistance_award_unique_key in sibling (SAME position both files)
    contract_award_unique_key as award_unique_key
from {{ source('lake', 'contracts') }}
