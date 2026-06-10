select
    family_key,
    max(parent_name) as display_name,
    count(*) as uei_count,
    sum(total_obligation) as total_obligation,
    min(confidence) as worst_confidence
from {{ ref('entity_xwalk') }}
group by family_key
