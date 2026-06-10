select
    pe_bli,
    project_number,
    project_title,
    scenario,
    try_cast(amount_millions as double) as amount_millions,
    xml_path,
    lower(reconciled) = 'true' as reconciled,
    org,
    exhibit_family,
    cast(fiscal_year as integer) as fiscal_year
from {{ source('lake', 'jbook_details') }}
