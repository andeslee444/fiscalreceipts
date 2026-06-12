-- fct_family_obligations_by_year: total obligations per (family_key, fiscal_year).
-- entity_xwalk is UNIQUE on recipient_uei (87,579 rows) — no fan-out (recon §B).
-- Expected row count: ~365,457 (all (family_key, fiscal_year) combinations with awards).
-- Covers 94.2% of total award dollars (those matched to a family via entity_xwalk).
select
    x.family_key,
    t.fiscal_year,
    sum(t.obligation)              as total_obligation,
    count(*)                       as transaction_count,
    count(distinct t.recipient_uei) as uei_count
from {{ ref('fct_award_transactions') }} t
join {{ ref('entity_xwalk') }} x on t.recipient_uei = x.recipient_uei
group by 1, 2
