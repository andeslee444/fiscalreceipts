-- dim_programs dual-volume dedup pin (PM-review Sprint 1 Task 2, 2026-07-30).
--
-- The FY2026 Army RDT&E "Vol 1" PDFs ship the SAME embedded XML in two
-- documents (Budget Activity 1 and Budget Activity 2 volumes — live docs
-- 344/sha 24765a25… and 351/sha ad24f807…), so 47 Army PEs carry identical
-- (pe_bli, project_number, scenario, amount, xml_path) detail tuples under
-- BOTH documents, neither superseded. The 5E binding ("any mart aggregating
-- jbook details must dedupe by distinct tuple or prefer exactly one
-- document") was never applied to dim_programs, which summed both copies:
-- 0601102A fy2024_actual_millions = 644.682 = 2 × the true 322.341 (the
-- value fct_budget_trajectory and fct_decade_series both report, and the
-- value each individual cited detail row carries — the mart's figure was
-- cited to a fact of half its size).
--
-- The fixture lake seeds the same dual-volume pair (0601102A at 322.341 in
-- two fy2026 documents), so this pin fails under any raw-sum regression in
-- both the live and fixture builds.
select pe_bli, fy2024_actual_millions
from {{ ref('dim_programs') }}
where pe_bli = '0601102A'
  and abs(coalesce(fy2024_actual_millions, -1) - 322.341) > 0.001
