-- Previously-withheld P-1R-sibling grain is published with the P-1-only
-- value (Phase 5E Task 5 improvements — P-1R recompute correction).
--
-- Ground truth (adversarial review, verified against workbook rows): the
-- P-1R exhibit is a reserve-component SUBSET of P-1 — P-1 is the inclusive
-- total (e.g. Aircraft Procurement Army FY2024 = $3.321B from P-1 alone).
-- The lake-verifiability filter therefore recomputes candidate lake sums
-- with P-1R rows excluded, so modern P-1 grains with a nonzero P-1R
-- sibling row publish the P-1-only detail sum instead of being withheld.
--
-- Pinned grain the naive (P-1 + P-1R) recompute used to withhold:
-- C-130J (BLI C130J0) PB2025 FY2023 actuals = 1,775,293 $K — the P-1 row
-- alone. Its P-1R sibling carries 1,700,000 which must NOT sum in: a
-- missing row means the withhold returned; 3,475,293 means P-1R leaked
-- into the recompute (or worse, the published amount).
with expected(pe_bli, fy, edition_year, amount) as (
    select 'C130J0', 2023, 2025, 1775293.0
)
select
    e.pe_bli,
    e.fy,
    e.edition_year,
    e.amount as expected_amount,
    m.amount as actual_amount
from expected e
left join {{ ref('fct_decade_series') }} m
  on m.pe_bli = e.pe_bli
 and m.fy = e.fy
 and m.edition_year = e.edition_year
where m.pe_bli is null
   or abs(m.amount - e.amount) > 0.5
