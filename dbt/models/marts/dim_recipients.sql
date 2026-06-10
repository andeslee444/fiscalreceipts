select
    recipient_uei,
    max(recipient_name) as recipient_name,
    max(recipient_parent_uei) as recipient_parent_uei,
    max(recipient_parent_name) as recipient_parent_name,
    sum(obligation) as total_obligation,
    count(*) as transaction_count,
    min(fiscal_year) as first_fiscal_year,
    max(fiscal_year) as last_fiscal_year
from {{ ref('fct_award_transactions') }}
where recipient_uei is not null
group by recipient_uei
