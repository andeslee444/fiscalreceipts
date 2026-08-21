-- fct_decade_series grain: (pe_bli, account, fy, edition_year) must be
-- unique (verify-phase5e leg d duplicate-grain check).
--
-- E2 (Sprint E, ROADMAP #67), widened E2.1 (2026-08-21): widened from
-- (pe_bli, fy, edition_year) to include account. Before E2 the mart never
-- carried two rows sharing (pe_bli, fy, edition_year) because a colliding
-- pe_bli was always summed into ONE fused row. After E2 the 10 genuine
-- PB2026 collisions legitimately publish two rows for a slot where both
-- accounts report — one per real account — so (pe_bli, fy, edition_year)
-- alone is no longer the grain; (pe_bli, account, fy, edition_year) is.
-- account is NULL for every other pe_bli (unchanged, still exactly one
-- row per (pe_bli, fy, edition_year)), so this widened grain reproduces
-- the pre-E2 check byte-for-byte there.
select pe_bli, account, fy, edition_year, count(*)
from {{ ref('fct_decade_series') }}
group by 1, 2, 3, 4
having count(*) > 1
