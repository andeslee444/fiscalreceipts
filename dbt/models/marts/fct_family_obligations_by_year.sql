-- fct_family_obligations_by_year: total obligations per (family_key, fiscal_year).
-- entity_xwalk is UNIQUE on recipient_uei (129,375 rows) — no fan-out (recon §B).
-- Expected row count: ~457,243 (all (family_key, fiscal_year) combinations with awards).
-- Covers 100.0% of total award dollars: the crosswalk is built over the same
-- contracts+assistance union this model reads, so every recipient_uei resolves.
-- (Was 87,579 rows / 94.2% while the crosswalk was stale at FY2017-FY2019 and
-- contracts-only — PM Sprint 3 Task 5b.)
select
    x.family_key,
    t.fiscal_year,
    sum(t.obligation)              as total_obligation,
    count(*)                       as transaction_count,
    count(distinct t.recipient_uei) as uei_count
from {{ ref('fct_award_transactions') }} t
join {{ ref('entity_xwalk') }} x on t.recipient_uei = x.recipient_uei
group by 1, 2
