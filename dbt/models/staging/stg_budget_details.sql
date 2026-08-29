select
    pe_bli,
    project_number,
    project_title,
    scenario,
    try_cast(amount_millions as double) as amount_millions,
    xml_path,
    lower(reconciled) = 'true' as reconciled,
    -- The appropriation this detail row's money belongs to (P-40
    -- AppropriationNumber; NULL for R-1/RDT&E rows). dim_programs needs it
    -- to keep two programs that share a BLI code from being summed.
    account,
    org,
    exhibit_family,
    cast(fiscal_year as integer) as fiscal_year,
    document_id
from {{ source('lake', 'jbook_details') }}
