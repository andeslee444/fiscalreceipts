-- fct_program_trajectory grain: (pe_bli, account) must be unique — one
-- trajectory per program. A duplicate would mean the model had drifted back
-- toward the component grain (pe_bli, organization[, account]) while still
-- being consumed as the program's own row, which is ROADMAP backlog #37 in
-- reverse.
--
-- E1 (Sprint E, ROADMAP #67): widened from bare pe_bli to (pe_bli, account)
-- — pe_bli alone is no longer the program grain once a genuine account
-- collision publishes two programs under one pe_bli (8 keys this sprint).
select pe_bli, account, count(*)
from {{ ref('fct_program_trajectory') }}
group by 1, 2
having count(*) > 1
