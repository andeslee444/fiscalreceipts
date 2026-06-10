select
    a.pe_bli,
    a.exhibit,
    cast(a.fiscal_year as integer) as fiscal_year,
    a.organization,
    a.award_piid,
    a.recipient_name,
    a.recipient_uei,
    try_cast(a.matched_obligation as double) as matched_obligation,
    a.method,
    a.confidence,
    p.title as program_title
from {{ source('lake', 'jbook_awards') }} a
left join {{ ref('dim_programs') }} p
  on p.pe_bli = a.pe_bli
