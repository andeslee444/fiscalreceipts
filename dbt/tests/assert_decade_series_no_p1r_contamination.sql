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
with honest as (
    select
        pe_bli,
        fiscal_year as edition_year,
        amount_type,
        sum(amount_thousands) as detail_sum
    from {{ ref('stg_budget_lines') }}
    where exhibit in ('R-1', 'P-1')
      and source_document_id is not null
      and pe_bli <> '9999999999'
    group by 1, 2, 3
)
select
    m.pe_bli,
    m.edition_year,
    m.amount_type,
    m.amount,
    h.detail_sum
from {{ ref('fct_decade_series') }} m
left join honest h
  on h.pe_bli = m.pe_bli
 and h.edition_year = m.edition_year
 and h.amount_type = m.amount_type
where h.detail_sum is null
   or abs(m.amount - h.detail_sum) > 0.5
