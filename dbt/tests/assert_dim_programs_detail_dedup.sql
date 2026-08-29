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
--
-- ROADMAP #45 (2026-08-21): `dedup` grouped by pe_bli ALONE, which fuses
-- '20'/'30'/'500's now-un-fused per-organization detail back together —
-- dim_programs.sql's own `details` CTE dedupes per (pe_bli, org) for these
-- 3 keys (see that model's header), so a bare pe_bli recompute here no
-- longer agrees with the mart's real, correctly-un-fused per-org values.
-- org_collision_pes below is the identical anchor dim_programs.sql uses.
-- The join condition `x.org is null or x.org = d.org` preserves the
-- original `using (pe_bli)` behavior for every non-collision pe_bli (x.org
-- is NULL there, matching regardless of d.org's real fused value) while
-- requiring an exact org match for the 3 collision keys.
--
-- Wave 5 (tri-persona remediation): the same treatment on the ACCOUNT axis,
-- for the same reason. Parsing the five previously-unparsed Navy
-- procurement appropriations put two programs' detail under ten shared BLI
-- codes, and dim_programs.sql's `details` now splits those by the detail
-- row's own account — so a bare pe_bli recompute here re-fuses exactly what
-- the mart correctly un-fused, and this test failed on all ten keys (18
-- rows) before the axis was added. The anchor is RE-DERIVED from
-- stg_budget_details here, never ref'd off dim_programs: a test that read
-- the mart's own split back would agree with any split at all, including a
-- wrong one.
with detail_account_collisions as (
    select pe_bli
    from (
        select distinct pe_bli, account
        from {{ ref('stg_budget_details') }}
        where fiscal_year = 2026 and account is not null
    )
    group by pe_bli
    having count(distinct account) > 1
),
org_collision_pes as (
    select pe_bli
    from (
        select pe_bli, organization
        from {{ ref('stg_budget_lines') }}
        where fiscal_year = 2026
          and amount_type = 'fy_2026_total'
          and title is not null
          and pe_bli <> '9999999999'
        group by pe_bli, organization
    )
    group by pe_bli
    having count(distinct organization) > 1
),
dedup as (
    select
        dd.pe_bli,
        case when ocp.pe_bli is not null then dd.org end as org,
        case when dac.pe_bli is not null then dd.account end as account,
        sum(dd.amount_millions)
            filter (where dd.scenario = 'PriorYear' and dd.project_number is null)
            as expected_fy2024
    from (
        select distinct
            pe_bli, project_number, scenario, amount_millions, xml_path, org,
            account
        from {{ ref('stg_budget_details') }}
        where fiscal_year = 2026
    ) dd
    left join org_collision_pes ocp on ocp.pe_bli = dd.pe_bli
    left join detail_account_collisions dac on dac.pe_bli = dd.pe_bli
    group by dd.pe_bli,
             case when ocp.pe_bli is not null then dd.org end,
             case when dac.pe_bli is not null then dd.account end
)
select
    d.pe_bli,
    d.org,
    d.fy2024_actual_millions as mart_value,
    x.expected_fy2024 as dedup_recompute
from {{ ref('dim_programs') }} d
join dedup x
    on x.pe_bli = d.pe_bli
   and (x.org is null or x.org = d.org)
   and (x.account is null or x.account = d.account)
where d.fy2024_actual_millions is not null
  and (
    abs(coalesce(d.fy2024_actual_millions, 0) - coalesce(x.expected_fy2024, 0)) > 0.0005
    or (d.fy2024_actual_millions is null) != (x.expected_fy2024 is null)
  )
