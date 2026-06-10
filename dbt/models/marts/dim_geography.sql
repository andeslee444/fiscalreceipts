select
    pop_state,
    pop_district,
    count(*) as transaction_count,
    sum(obligation) as total_obligation
from {{ ref('fct_award_transactions') }}
where pop_state is not null and pop_state <> ''
group by 1, 2
