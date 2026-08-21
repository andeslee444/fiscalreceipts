-- fct_program_trajectory grain: (pe_bli, account, organization) must be
-- unique — one trajectory per program. A duplicate would mean the model had
-- drifted back toward the component grain while still being consumed as
-- the program's own row, which is ROADMAP backlog #37 in reverse.
--
-- E1 (Sprint E, ROADMAP #67): widened from bare pe_bli to (pe_bli, account)
-- — pe_bli alone is no longer the program grain once a genuine account
-- collision publishes two programs under one pe_bli (8 keys this sprint).
--
-- ROADMAP #45 (2026-08-21): widened again to include organization — '20',
-- '30', '500' now each publish one row PER ORGANIZATION (never summed;
-- see fct_program_trajectory.sql's own correction comment), so
-- (pe_bli, account) alone no longer distinguishes them. organization is
-- NULL for every other pe_bli (unchanged), so this reproduces the pre-#45
-- check byte-for-byte there.
select pe_bli, account, organization, count(*)
from {{ ref('fct_program_trajectory') }}
group by 1, 2, 3
having count(*) > 1
