-- E2 (Sprint E, ROADMAP #67): the account split's own uniqueness signature.
--
-- Before E2, a genuine collision's colliding slot always summed BOTH
-- accounts into one row with n_source_rows=2 — this IS the fusion bug
-- ('3010' rendering LPD Flight II's $2.6B under Shipboard Tactical
-- Communications' title, the defect this sprint exists to close).
--
-- After E2 (widened E2.1, 2026-08-21 — the fy_2026_total-only anchor
-- undercounted 1350/2101, caught by gate 23 leg h2), every row where this
-- mart has attributed a specific account (account IS NOT NULL — the 10
-- genuine PB2026 collisions) must aggregate exactly ONE account's detail
-- rows for its slot: n_source_rows > 1 there would mean two accounts are
-- STILL being summed under one attributed account label, i.e. the leak
-- has not actually closed, just been relabelled. Rows where account IS
-- NULL are the deliberately out-of-scope collapse case (ordinary
-- single-account pe_bli, 1045/COLUMBIA which correctly never collides at
-- one amount_type, plus two disclosed non-program placeholder keys this
-- sprint does not split — see fct_decade_series.sql's own header comment)
-- and may still legitimately carry n_source_rows > 1; this assertion does
-- not touch them.
--
-- ROADMAP #45 (2026-08-21): the identical check for the organization split
-- key — every row where this mart has attributed a specific organization
-- (organization IS NOT NULL — the 3 genuine ROADMAP #45 collisions, '20',
-- '30', '500') must aggregate exactly ONE organization's detail rows for
-- its slot. account and organization are never both non-NULL on the same
-- row (verified mutually exclusive), so the two `where` clauses below
-- never overlap.
select pe_bli, account, organization, fy, edition_year, amount_type, n_source_rows
from {{ ref('fct_decade_series') }}
where (account is not null or organization is not null)
  and n_source_rows > 1
