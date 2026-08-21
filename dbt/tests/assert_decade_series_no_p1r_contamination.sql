-- No P-1R / rollup contamination in fct_decade_series (Phase 5E Task 5).
--
-- Belt-and-braces recompute: every published amount must equal the sum of
-- provenance-carrying R-1/P-1 rows for its (pe_bli, edition_year,
-- amount_type) — recomputed here independently from staging. P-1R rows
-- (the reserve-component SUBSET of P-1 lines, which shares pe_bli and
-- amount_type slugs with P-1 in modern editions; P-1 is the inclusive
-- total), provenance-less rollup twins, and the classified aggregate must
-- never contribute a dollar to a published series value. Since the P-1R
-- recompute correction (Task 5 improvements), the mart's lake-verifiability
-- filter itself excludes P-1R from candidate sums — grains with a nonzero
-- P-1R sibling are now published — but their AMOUNT must always be the
-- P-1R-free detail sum this test recomputes.
--
-- E2 (Sprint E, #67): this recompute must honor the SAME account split the
-- mart applies. Grouping by (pe_bli, edition_year, amount_type) alone would
-- recompute the pre-E2 FUSED two-account total for the 8 genuine
-- collisions, and every one of their now-correct per-account rows would
-- look like contamination. collision_pes is the identical fy_2026_total
-- anchor fct_decade_series.sql itself uses (re-derived, not ref'd — this
-- test independently checks the mart "from staging").
with collision_slots as (
    select pe_bli, account
    from {{ ref('stg_budget_lines') }}
    where fiscal_year = 2026
      and amount_type = 'fy_2026_total'
      and title is not null
      and pe_bli <> '9999999999'
    group by pe_bli, account
),
collision_pes as (
    select pe_bli
    from collision_slots
    group by pe_bli
    having count(distinct account) > 1
),
honest as (
    select
        b.pe_bli,
        b.fiscal_year as edition_year,
        b.amount_type,
        case when cp.pe_bli is not null then b.account end as account,
        sum(b.amount_thousands) as detail_sum
    from {{ ref('stg_budget_lines') }} b
    left join collision_pes cp
      on cp.pe_bli = b.pe_bli
    where b.exhibit in ('R-1', 'P-1')
      and b.source_document_id is not null
      and b.pe_bli <> '9999999999'
    group by 1, 2, 3, 4
)
select
    m.pe_bli,
    m.edition_year,
    m.amount_type,
    m.account,
    m.amount,
    h.detail_sum
from {{ ref('fct_decade_series') }} m
left join honest h
  on h.pe_bli = m.pe_bli
 and h.edition_year = m.edition_year
 and h.amount_type = m.amount_type
 and h.account is not distinct from m.account
where h.detail_sum is null
   or abs(m.amount - h.detail_sum) > 0.5
