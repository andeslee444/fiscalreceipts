select
    prime_award_unique_key,
    try_cast(subaward_amount as double) as subaward_amount,
    try_cast(subaward_action_date as date) as subaward_action_date,
    cast(fy as integer) as fiscal_year,
    nullif(subawardee_uei, '') as subawardee_uei,
    upper(subawardee_name) as subawardee_name
from {{ source('lake', 'subawards') }}
