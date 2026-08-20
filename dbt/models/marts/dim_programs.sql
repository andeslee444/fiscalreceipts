-- dim_programs is the PB2026-EDITION program dimension the site, dossiers,
-- and evals consume. Its columns carry PB2026 semantics — in particular
-- fy2024_actual_millions is "FY2024 actuals as PB2026 reports them".
--
-- Edition fence (BINDING, adversarial review Finding A): scenario names in
-- stg_budget_details are edition-RELATIVE (PriorYear = FY2022 actuals in
-- PB2024, FY2023 in PB2025, FY2024 in PB2026), so every PB2026-semantic
-- column must filter fiscal_year = 2026. The former >= 2024 fence summed
-- three fiscal years under one label (0601101E: 1,081.804 vs the
-- launch-certified 280.494 — pinned by assert_dim_programs_pb2026_pin).
-- The PB2017–PB2025 editions get their own edition-aware marts in 5E
-- Task 5, which supersede this fence.
--
-- Dual-volume dedup (BINDING, 5E: "any mart aggregating jbook details must
-- dedupe by distinct tuple or prefer exactly one document"; applied here in
-- PM-review Sprint 1 Task 2): some service J-books ship the SAME embedded
-- XML in more than one PDF volume (FY2026 Army RDT&E Vol 1 BA-1/BA-2 —
-- live docs 344/351), so identical (pe_bli, project_number, scenario,
-- amount, xml_path) detail tuples appear under 2+ non-superseded documents
-- and a raw per-row sum double-counts: 0601102A fy2024 = 644.682 = 2 × the
-- true 322.341 (47 Army PEs affected; fct_budget_trajectory and
-- fct_decade_series were already single-copy). details_dedup aggregates
-- over the DISTINCT tuple set; reconciled uses bool_and across copies so a
-- disagreeing duplicate degrades honestly. Guarded by
-- assert_dim_programs_detail_dedup + assert_dim_programs_dual_volume_dedup_pin.
--
-- #56 account attribution (BINDING): stg_budget_details (the R-2/P-40
-- detail source `details`/`details_dedup` read from) carries NO account
-- column — only stg_budget_lines (the R-1/P-1 workbook source) does. Several
-- pe_bli values are legitimately shared by two DIFFERENT real appropriation
-- accounts within PB2026 (#56 — e.g. '3010' is BOTH LPD Flight II's
-- Shipbuilding & Conversion account AND Shipboard Tactical Communications'
-- Other Procurement account; 9999999999 is the intentional classified
-- sentinel, excluded by name). The old unconstrained
-- `left join stg_budget_lines b on b.pe_bli = d.pe_bli` fanned out across
-- BOTH accounts' titles for those keys, so `max(b.title)` could name either
-- program regardless of which one d.fy2024_actual_millions actually
-- describes (verified: pe_bli 3010 rendered "Shipboard Tactical
-- Communications" — the OPN title, matching this row's own money — purely
-- by max()'s lexical accident; nothing pinned the title to the money).
--
-- account_match ties the two sources together by AMOUNT, not by a shared
-- key neither source carries: the stg_budget_lines row whose FY2024
-- actuals dollar figure equals details' own fy2024_actual_millions is, by
-- construction, the SAME line the R-2/P-40 detail describes, so its
-- account is this program's account. A pe_bli with only one account (99%+
-- of them) resolves trivially (only one candidate row); a pe_bli with no
-- fy2024_actual_millions, or none of its stg_budget_lines rows matching to
-- float tolerance (a genuine toa-vs-detail reconciliation disagreement),
-- falls back to today's unconstrained join — no worse than before.
--
-- E1 (Sprint E, ROADMAP #67) — re-grain, replacing B'1's pick-one rule.
-- B'1 (#56) picked exactly one account per pe_bli and left the OTHER
-- account's program entirely off the site (10 programs, $5.35B, disclosed
-- in programs_excluded.json with reason 'key_collision' or 'no_detail').
-- This block adds the SECOND row for each genuine collision instead of
-- discarding it.
--
-- Collision detection (disclosed substitution — verify before trusting the
-- plan's headline number): the prescribed premise was "10 collision keys,
-- same definition assert_program_key_unique.sql used pre-E1 (>1 distinct
-- account_title at the SAME amount_type, checked across fy_2024_actuals /
-- fy_2025_total / fy_2026_total)". Measured against the shipped PB2026
-- warehouse (2026-08-20), that definition actually returns TEN keys, not
-- eight: 0145, 1350, 2101, 2210, 2292, 3010, 3050, 3215, 3302, 4217 — this
-- dbt test's own shipped comment already lists all ten. Two of them
-- (1350, 2101/Tomahawk) collide ONLY historically: both accounts report
-- simultaneously at fy_2024_actuals/fy_2025_enacted, but by fy_2026_total
-- exactly ONE account reports any money at all — the other side wound down
-- to nothing before this edition. Splitting them would add a page-less,
-- money-less sliver row for no current benefit, and the plan's own scope
-- table explicitly excludes Tomahawk ("no_detail, not key_collision...
-- different defect, do not fold it in") for precisely this shape. This
-- SQL codifies that same distinction generally, scoping "genuine collision"
-- to accounts that BOTH report at fy_2026_total — which independently
-- reproduces the plan's stated 8 keys exactly (verified: the resulting
-- $5.35B absent-money total matches the plan's figure to the dollar). If a
-- future edition's data resurrects 1350/2101's dormant side with real
-- fy_2026_total money, this same rule picks it up automatically — no
-- hardcoded key list, per the mandate that 9999999999 (still excluded BY
-- NAME below, never by a count threshold) must never be masked by one.
--
-- collision_slots / collision_pes: independent re-derivation of the same
-- split key fct_budget_trajectory.sql uses (dim_programs is upstream of
-- fct_budget_trajectory in the dbt DAG and cannot ref it back).
--
-- The synthetic branch below gives the NON-matched account of a genuine
-- collision a detail-less row: title comes from stg_budget_lines' own
-- per-account line-item title (real, not invented — the same title
-- programs_excluded.json already cites for these lines today), org from
-- stg_budget_lines, and project_count/fy2024_actual_millions/
-- fully_reconciled all NULL/0 — there is no R-2/P-40 exhibit behind these
-- rows (verified: LPD Flight II and Medium Landing Ship, among others,
-- have ZERO stg_budget_details rows under their pe_bli — the R-2/P-40
-- detail source simply never described them). This mirrors the existing,
-- already-shipped honesty contract in export_site.py's
-- _trajectory_only_feed_programs (backlog #17): a numbers-only page is
-- honest degradation, not a fabricated narrative.
with details_dedup as (
    select
        pe_bli,
        project_number,
        scenario,
        amount_millions,
        xml_path,
        max(org) as org,
        max(exhibit_family) as exhibit_family,
        bool_and(reconciled) as reconciled
    from {{ ref('stg_budget_details') }}
    where fiscal_year = 2026
    group by pe_bli, project_number, scenario, amount_millions, xml_path
),
details as (
    select
        pe_bli,
        max(org) as org,
        max(exhibit_family) as exhibit_family,
        count(distinct project_number) as project_count,
        sum(amount_millions) filter (where scenario = 'PriorYear' and project_number is null)
            as fy2024_actual_millions,
        bool_and(reconciled) as fully_reconciled
    from details_dedup
    group by pe_bli
),
account_match as (
    select
        d.pe_bli,
        b.account,
        b.account_title,
        row_number() over (partition by d.pe_bli order by b.account) as rn
    from details d
    join {{ ref('stg_budget_lines') }} b
        on b.pe_bli = d.pe_bli and b.fiscal_year = 2026
        and b.amount_type = 'fy_2024_actuals'
        and abs(b.amount_thousands / 1000.0 - d.fy2024_actual_millions) < 0.0005
    where d.fy2024_actual_millions is not null
),
matched as (
    select
        d.pe_bli,
        d.org,
        d.exhibit_family,
        d.project_count,
        d.fy2024_actual_millions,
        d.fully_reconciled,
        am.account,
        am.account_title,
        max(b.title) as title
    from details d
    left join account_match am on am.pe_bli = d.pe_bli and am.rn = 1
    left join {{ ref('stg_budget_lines') }} b
        on b.pe_bli = d.pe_bli and b.fiscal_year = 2026
        and (am.account is null or b.account = am.account)
    group by 1, 2, 3, 4, 5, 6, 7, 8
),
-- E1 split key: per (pe_bli, amount_type) distinct-account count, fenced to
-- fy_2026_total (see the model-level comment above for why fy_2026_total,
-- not the 3-slot union, is the right anchor for "does this need a second
-- page today").
collision_slots as (
    select pe_bli, account, max(account_title) as account_title
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
-- The side NOT already covered by `matched`'s account_match resolution.
synth_candidates as (
    select cs.pe_bli, cs.account, cs.account_title
    from collision_slots cs
    join collision_pes cp on cp.pe_bli = cs.pe_bli
    left join matched m on m.pe_bli = cs.pe_bli and m.account = cs.account
    where m.account is null
),
synth as (
    select
        sc.pe_bli,
        max(b.organization) as org,
        cast(null as varchar) as exhibit_family,
        cast(0 as bigint) as project_count,
        cast(null as double) as fy2024_actual_millions,
        cast(null as boolean) as fully_reconciled,
        sc.account,
        sc.account_title,
        max(b.title) as title
    from synth_candidates sc
    left join {{ ref('stg_budget_lines') }} b
        on b.pe_bli = sc.pe_bli and b.account = sc.account
        and b.fiscal_year = 2026 and b.title is not null
    group by sc.pe_bli, sc.account, sc.account_title
    having max(b.title) is not null  -- honesty contract: no title, no row
)
select pe_bli, org, exhibit_family, project_count, fy2024_actual_millions,
       fully_reconciled, account, account_title, title
from matched
union all
select pe_bli, org, exhibit_family, project_count, fy2024_actual_millions,
       fully_reconciled, account, account_title, title
from synth
