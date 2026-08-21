-- E2 (Sprint E, ROADMAP #67): the account split's own uniqueness signature.
--
-- Before E2, a genuine collision's colliding slot always summed BOTH
-- accounts into one row with n_source_rows=2 — this IS the fusion bug
-- ('3010' rendering LPD Flight II's $2.6B under Shipboard Tactical
-- Communications' title, the defect this sprint exists to close).
--
-- After E2, every row where this mart has attributed a specific account
-- (account IS NOT NULL — the 8 genuine PB2026 collisions) must aggregate
-- exactly ONE account's detail rows for its slot: n_source_rows > 1 there
-- would mean two accounts are STILL being summed under one attributed
-- account label, i.e. the leak has not actually closed, just been
-- relabelled. Rows where account IS NULL are the deliberately
-- out-of-scope collapse case (ordinary single-account pe_bli, plus the
-- disclosed non-8-key multi-account pe_bli this sprint does not split —
-- see fct_decade_series.sql's own header comment) and may still
-- legitimately carry n_source_rows > 1; this assertion does not touch
-- them.
select pe_bli, account, fy, edition_year, amount_type, n_source_rows
from {{ ref('fct_decade_series') }}
where account is not null
  and n_source_rows > 1
