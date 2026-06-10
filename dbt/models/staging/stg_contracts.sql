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
    primary_place_of_performance_state_code as pop_state
from {{ source('lake', 'contracts') }}
