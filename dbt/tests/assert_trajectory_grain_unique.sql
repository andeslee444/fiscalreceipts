-- fct_budget_trajectory grain: (pe_bli, organization, account) must be
-- unique.
--
-- E1 (Sprint E, ROADMAP #67): widened from (pe_bli, organization) — that
-- pair is no longer unique once a genuine account collision publishes two
-- component rows under the same pe_bli/organization (8 keys this sprint,
-- one row per account). Duplicate (pe_bli, organization, account) would
-- mean the SAME account was double-counted, which is the actual hazard
-- this test exists to catch.
select pe_bli, organization, account, count(*)
from {{ ref('fct_budget_trajectory') }}
group by 1, 2, 3
having count(*) > 1
