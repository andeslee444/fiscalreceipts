-- fct_decade_series grain: (pe_bli, account, organization, fy, edition_year)
-- must be unique (verify-phase5e leg d duplicate-grain check).
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
--
-- ROADMAP #45 (2026-08-21) widened again, to include organization: '20',
-- '30', '500' legitimately publish one row per organization sharing that
-- key (up to 4 for '30', across editions where DODEA still reports) —
-- (pe_bli, account, fy, edition_year) alone collapsed them onto one grain
-- cell. Re-run at the pre-#45 grain against the post-#45 mart FAILS with
-- 27 results (every fy/edition_year slot where >1 of '20'/'30'/'500's
-- organizations report) — recorded here as the proof this tightening was
-- load-bearing:
--   Failure in test assert_decade_series_grain_unique (pre-#45 grain)
--     Got 27 results, configured to fail if != 0
-- organization is NULL for every other pe_bli (unchanged, including the 10
-- account-collision keys — verified mutually exclusive), so this widened
-- grain reproduces the pre-#45 check byte-for-byte there.
select pe_bli, account, organization, fy, edition_year, count(*)
from {{ ref('fct_decade_series') }}
group by 1, 2, 3, 4, 5
having count(*) > 1
