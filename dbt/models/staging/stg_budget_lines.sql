select
    exhibit,
    cast(fiscal_year as integer) as fiscal_year,
    account,
    account_title,
    organization,
    budget_activity,
    budget_activity_title,
    pe_bli,
    title,
    amount_type,
    try_cast(amount_thousands as double) as amount_thousands,
    source_document_id
from {{ source('lake', 'jbook_budget_lines') }}
