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
--
-- E1 (Sprint E, ROADMAP #67): dim_programs may now carry a SECOND,
-- synthesized row for a genuine account collision (8 keys) — that row has
-- NO R-2/P-40 detail behind it by construction (fy2024_actual_millions is
-- NULL; see the model's own E1 comment) and so has nothing to dedup-check
-- against `dedup`, which is keyed by pe_bli alone and knows nothing about
-- accounts. Scoped to `d.fy2024_actual_millions is not null` so only the
-- detail-carrying row of a collision is compared — the synthesized sibling
-- is correctly exempt, not silently passed: a synthesized row that
-- WRONGLY carried a non-null fy2024_actual_millions would still fail
-- elsewhere (it would fail to be NULL, which nothing here checks, but
-- dim_programs.sql's own `synth` CTE has no code path that could populate
-- it), and this test still catches any drift on the one row per pe_bli
-- that legitimately claims real detail.
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
where d.fy2024_actual_millions is not null
  and (
    abs(coalesce(d.fy2024_actual_millions, 0) - coalesce(x.expected_fy2024, 0)) > 0.0005
    or (d.fy2024_actual_millions is null) != (x.expected_fy2024 is null)
  )
