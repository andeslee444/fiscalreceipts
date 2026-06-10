with ranked as (
    select *,
           row_number() over (partition by family_key order by total_obligation desc nulls last) as rn
    from {{ ref('entity_xwalk') }}
)
select
    family_key,
    max(coalesce(parent_name, recipient_name)) filter (where rn = 1) as display_name,
    count(*) as uei_count,
    sum(total_obligation) as total_obligation,
    min(confidence) as worst_confidence
from ranked
group by family_key
