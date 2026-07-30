-- dim_programs generic dual-volume dedup invariant (PM-review Sprint 1
-- Task 2; companion to assert_dim_programs_dual_volume_dedup_pin).
--
-- INVARIANT: dim_programs.fy2024_actual_millions equals the PriorYear
-- root-row sum recomputed over DISTINCT detail tuples
-- (pe_bli, project_number, scenario, amount_millions, xml_path) within the
-- PB2026 fence. When a service J-book ships the same embedded XML in more
-- than one volume (identical tuples under 2+ non-superseded documents), the
-- raw per-row sum double-counts; the mart must aggregate the distinct-tuple
-- set (the 5E binding: "dedupe by distinct tuple or prefer exactly one
-- document"). Any drift between the mart column and this recompute is a
-- regression to the raw sum (or a new aggregation bug) — fail loudly.
with dedup as (
    select
        pe_bli,
        sum(amount_millions)
            filter (where scenario = 'PriorYear' and project_number is null)
            as expected_fy2024
    from (
        select distinct
            pe_bli, project_number, scenario, amount_millions, xml_path
        from {{ ref('stg_budget_details') }}
        where fiscal_year = 2026
    )
    group by pe_bli
)
select
    d.pe_bli,
    d.fy2024_actual_millions as mart_value,
    x.expected_fy2024 as dedup_recompute
from {{ ref('dim_programs') }} d
join dedup x using (pe_bli)
where abs(coalesce(d.fy2024_actual_millions, 0) - coalesce(x.expected_fy2024, 0)) > 0.0005
   or (d.fy2024_actual_millions is null) != (x.expected_fy2024 is null)
