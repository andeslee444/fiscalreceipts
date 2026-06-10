select recipient_uei, recipient_name, parent_uei, parent_name,
       family_key, method, confidence,
       try_cast(total_obligation as double) as total_obligation
from {{ source('lake', 'entity_xwalk_src') }}
