-- dim_programs PB2026-semantics pin (adversarial review Finding A, 5E).
--
-- fy2024_actual_millions means "FY2024 actuals as PB2026 reports them"
-- (scenario names are edition-RELATIVE: PriorYear = FY2022 actuals in
-- PB2024, FY2023 in PB2025, FY2024 in PB2026). The launch-certified value
-- for PE 0601101E is 280.494; a fence that merges editions (the former
-- fiscal_year >= 2024) sums three different fiscal years to 1,081.804.
-- The fixture lake seeds the same PE at 280.494 in fy2026 plus a decoy
-- PB2024 PriorYear row, so this pin fails under any edition-merging fence
-- in both the live and fixture builds.
select pe_bli, fy2024_actual_millions
from {{ ref('dim_programs') }}
where pe_bli = '0601101E'
  and abs(coalesce(fy2024_actual_millions, -1) - 280.494) > 0.001
