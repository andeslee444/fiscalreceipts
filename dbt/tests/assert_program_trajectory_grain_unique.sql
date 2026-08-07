-- fct_program_trajectory grain: pe_bli must be unique — one trajectory per
-- program. A duplicate would mean the model had drifted back toward the
-- component grain (pe_bli, organization) while still being consumed as the
-- program's own row, which is ROADMAP backlog #37 in reverse.
select pe_bli, count(*)
from {{ ref('fct_program_trajectory') }}
group by 1
having count(*) > 1
