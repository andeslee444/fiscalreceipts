-- fct_program_trajectory: the PROGRAM-grain trajectory (ROADMAP backlog #37).
--
-- Grain: pe_bli — one row per program element, whatever number of
-- organisations fund it. fct_budget_trajectory's grain is (pe_bli,
-- organization): a COMPONENT of a program, not the program.
--
-- Why this model exists. `programs.json` carries one row per pe_bli — pe_bli
-- is the row identity, the /program/{pe_bli}/ URL, and the dead-link
-- contract — but its `trajectory` object was read out of
-- fct_budget_trajectory at (pe_bli, dim_programs.org), i.e. the declared
-- org's SLICE published under the program's name. For 1,738 of 1,741
-- programs the declared org is the only org, so the slice IS the program and
-- nothing showed. Three BLI codes are shared across organisations and there
-- it published a component as the whole (FY2024 actuals, USD thousands):
--
--   BLI 30  Other Major Equipment      408,006 (OSD)  of 435,163
--                                      = OSD 408,006 + DMACT 13,012
--                                        + DTRA 12,787 + DoDEA 1,358
--   BLI 20  Vehicles                       356 (DTRA) of   2,491
--   BLI 500 Personnel Administration   105,943 (DLA)  of 110,388
--
-- A row here is therefore the program: every component summed. NULL-summing
-- follows the component mart's own pivot semantics (sum() ignores NULLs, and
-- an all-NULL metric stays NULL) so a program is never credited with a
-- figure no book published — BLI 30's FY2026 request is the sum of the
-- three orgs that have one, with DoDEA (no FY2026 row) absent rather than
-- zero, exactly as fct_decade_series reports it (232,181, n_source_rows=3).
--
-- The change columns are recomputed from the SUMMED endpoints, never summed
-- themselves: summing per-org deltas would silently publish a total for
-- programs where one component has an FY2025 figure and another does not.
--
-- Guarded by assert_program_trajectory_component_sum.sql (every metric equals
-- the sum of its component rows — the assertion that fails the moment this is
-- reimplemented as a pick rather than a sum) and
-- assert_program_trajectory_grain_unique.sql.
--
-- NOT a shipped parquet: the org grain is the one readers query (an agency's
-- share is an agency-grain question), and a second public "trajectory" table
-- differing on 3 of 1,741 rows would be a fresh footgun. This is the site's
-- program-grain projection, materialised where it can be asserted.

with components as (
    select
        pe_bli,
        count(*) as n_org_components,
        sum(fy2024_actuals) as fy2024_actuals,
        sum(fy2025_total)   as fy2025_total,
        sum(fy2026_total)   as fy2026_total
    from {{ ref('fct_budget_trajectory') }}
    group by pe_bli
)
select
    pe_bli,
    n_org_components,
    fy2024_actuals,
    fy2025_total,
    fy2026_total,
    (fy2026_total - fy2025_total) as fy2526_change,
    case
        when fy2025_total is null or fy2025_total = 0 then null
        else round(100.0 * (fy2026_total - fy2025_total) / fy2025_total, 2)
    end as fy2526_pct_change
from components
