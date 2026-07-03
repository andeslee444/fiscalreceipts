-- PB2019 OSD dual-volume no-doubling guard (Phase 5E Task 5, binding (i)).
--
-- The PB2019 OSD RDT&E book ships as two BA-split volumes (Vol_3A BA1-3,
-- Vol_3B BA4-7) that EACH embed the complete OSD MJB XML: the edition's
-- jbook DETAILS carry identical (pe_bli, scenario, amount) tuples under
-- BOTH documents (ids 278/279). fct_decade_series reads budget_lines only
-- (single-copy display workbooks), so binding (i) holds by construction —
-- this test is the belt-and-braces guard: for every reconciled PB2019 OSD
-- PE, the mart request must equal the SINGLE-volume XML value (the
-- per-document amount), never the both-volumes sum (2x).
with single_volume as (
    -- one PE-level BudgetYearOne value per document; volumes are identical,
    -- so min == max == the single-volume truth. summing across documents
    -- (the dual-volume trap) would yield 2x this value.
    select
        pe_bli,
        max(doc_total) as single_value_thousands,
        count(*) as n_volumes
    from (
        select pe_bli, document_id, sum(amount_millions) * 1000 as doc_total
        from {{ ref('stg_budget_details') }}
        where fiscal_year = 2019
          and org = 'OSD'
          and project_number is null
          and scenario = 'BudgetYearOne'
          and reconciled
        group by pe_bli, document_id
    )
    group by pe_bli
)
select
    s.pe_bli,
    s.n_volumes,
    s.single_value_thousands,
    m.amount as mart_amount
from single_volume s
join {{ ref('fct_decade_series') }} m
  on m.pe_bli = s.pe_bli
 and m.edition_year = 2019
 and m.amount_type_kind = 'request'
where abs(m.amount - s.single_value_thousands) > 1.0
