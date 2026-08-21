-- fct_decade_series: edition-aware decade series (Phase 5E Task 5).
--
-- Grain: (pe_bli, fy, edition_year) — one row per program line, fiscal year,
-- and PB edition that reports it. Scenario semantics are edition-RELATIVE
-- (the year-shift rule): for edition N, PriorYear = FY(N-2) actuals,
-- CurrentYear = FY(N-1) enacted, BudgetYearOne = FY(N) request.
-- amount / amount_thousands are USD THOUSANDS, matching the lake's
-- budget_lines.amount_thousands (the verify-phase5e leg-d unit contract).
--
-- Detail-row rule (the 5C rollup+detail double-count lesson, re-verified
-- against THIS lake across all ten editions 2026-07-03):
--   * Era editions (PB2017–PB2023) carry NO rollup rows — every R-1/P-1 row
--     is line-grain (era procurement keys are namespaced '{acct}-{org}-L{n}',
--     era_keys.py).
--   * "title IS NOT NULL" is NOT a reliable detail marker in this lake: the
--     PB2024 P-1 display workbook names its title column differently, so its
--     line-grain rows carry NULL titles. The reliable invariant is
--     provenance: detail rows always trace to a source document
--     (source_document_id IS NOT NULL — enforced at lake export).
--   * The P-1R exhibit is EXCLUDED: it is the informational reserve-component
--     breakout of P-1 lines (never reconciled against XML details); its
--     modern-edition rows share (pe_bli, amount_type) with P-1 lines and
--     summing both would double-count the reserve share. P-1R is a SUBSET
--     of P-1 — P-1 is the inclusive total (workbook ground truth: Aircraft
--     Procurement Army FY2024 = $3.321B from P-1 alone).
--   * pe_bli '9999999999' (the Classified Programs display aggregate) is
--     EXCLUDED: it is not a program identity, and in modern editions it
--     appears in BOTH R-1 and P-1 under shared amount_type slugs.
--
-- Slug selection mirrors govbudget.jbooks.reconcile.scenario_map(edition):
-- per (pe_bli, edition, scenario) the first candidate slug (priority order)
-- with detail rows is picked; amount = sum of its detail rows.
--
-- Lake-verifiability filter (verify-phase5e leg d recomputes every sampled
-- amount from raw budget_lines with NO title filter, any-candidate rule):
-- a grain is emitted only when its honest detail sum equals the raw
-- lake sum for at least one candidate slug. Both sides of that recompute
-- exclude P-1R rows (Task 5 improvements — P-1R recompute correction):
-- P-1 already includes the reserve share, so summing the P-1R sibling in
-- would double-count it, and the 993 modern P-1 grains the naive
-- (P-1 + P-1R) recompute used to withhold now publish their P-1-only
-- detail sums (assert_decade_series_p1r_published_grains.sql pins one;
-- assert_decade_series_no_p1r_contamination.sql still proves no P-1R
-- dollar reaches a published amount). Provenance-less rollup twins remain
-- withheld — they still poison the lake sum by construction.
--
-- PB2019 OSD dual-volume dedup (Task 5 binding (i)): this mart reads
-- budget_lines ONLY. budget_lines is loaded from the per-edition R-1/P-1
-- display workbooks, which are single-copy per edition — the dual-volume
-- duplication lives in jbook DETAILS (documents 278/279 each embed the full
-- OSD MJB XML), which this mart never touches. Binding (i) is satisfied by
-- construction; assert_decade_series_pb2019_osd_single_volume.sql guards it
-- belt-and-braces against future detail-sourced changes.
--
-- Fact-minting handoff (Task 6): single-source grains carry source_fact_id
-- (= export_site.fact_id_workbook of the one source row, derivation
-- validated against the typed site export). Multi-source grains carry the
-- (pe_bli, edition_year, amount_type) join keys + n_source_rows so the
-- exporter can mint derived sum facts with per-row breakdown inputs.
--
-- E2 (Sprint E, ROADMAP #67) — account-aware grain for genuine PB2026
-- account collisions. Pre-E2 this mart grouped `detail` by (pe_bli,
-- edition_year, scenario) alone, so a pe_bli coincidentally shared by two
-- DIFFERENT real appropriation accounts (#56 — e.g. '3010' is BOTH LPD
-- Flight II's Shipbuilding & Conversion account, $2.6B FY2026, AND
-- Shipboard Tactical Communications' Other Procurement account, $20.9M)
-- summed straight across both, fusing two unrelated programs into one
-- point — exactly the #56 defect dim_programs.sql/fct_budget_trajectory.sql
-- fixed at the E1 grain, one layer up. B'1 could not fix it here: this
-- mart spans all ten PB editions, and its own estimate assumed there was
-- "no dim_programs-equivalent anchor for older editions" to split on — so
-- it excluded the colliding keys from the exporter entirely instead (an
-- honest gap in place of a fusion). Measured 2026-08-14/2026-08-20: the
-- colliding keys do not exist before PB2024 (era procurement keys are
-- namespaced '{account}-{org}-L{n}', so a bare numeric key is absent by
-- construction), so the "no anchor" problem does not apply to the 3
-- editions (2024-2026) where these keys DO appear — PB2026's dim_programs
-- collision anchor is a perfectly good anchor for all of them.
--
-- collision_pes below: >1 distinct account reporting at the SAME
-- amount_type, checked across EVERY amount_type PB2026's own workbook
-- carries (title not null, excluding the 9999999999 classified sentinel).
--
-- E2.1 CORRECTION (2026-08-21, gate 23 leg h2 caught this in the wild on
-- '1350'/'2101' after E3 shipped page splits): the FIRST cut of this
-- anchor (2026-08-20) checked ONLY fy_2026_total, on the premise
-- ("Tomahawk... different defect, do not fold it in") that a key colliding
-- at historical amount_types but not at fy_2026_total had no CURRENT
-- money to split and could be left collapsed. That premise conflated two
-- separate questions: "does this key need a PAGE split" (no — 1350/2101
-- have no dim_programs row at all, so E3 correctly never split their
-- pages) and "does this key's DECADE SERIES still fuse two accounts into
-- one point" (yes — 1350 and 2101 both collide at ten historical
-- amount_types: fy_2022_actuals, fy_2023_actuals,
-- fy_2023_less_supplementals_enacted, fy_2023_supplementals_enacted,
-- fy_2023_total_enacted, fy_2024_actuals,
-- fy_2024_pb_request_with_cr_adjustments, fy_2024_request, fy_2025_enacted,
-- fy_2025_request — the identical #56 fusion, just not at fy_2026_total).
-- The anchor now checks every amount_type PB2026 carries, independently
-- re-derived (this mart reads stg_budget_lines directly and is not
-- downstream of dim_programs in the dbt DAG) — this reproduces exactly 10
-- keys: 0145, 1350, 2101, 2210, 2292, 3010, 3050, 3215, 3302, 4217 (the
-- original 8 plus 1350/2101) — the SAME 10 keys assert_program_key_unique
-- .sql's own pre-E1 comment already listed as "the pre-E1 (>1 distinct
-- account_title at the SAME amount_type, checked across fy_2024_actuals /
-- fy_2025_total / fy_2026_total)" definition, now generalized from those 3
-- slots to every slot PB2026 carries. Never a hardcoded list, so a future
-- edition's data can only widen or narrow the split as its own facts
-- change.
--
-- 1045/COLUMBIA remains correctly UNSPLIT under this wider anchor,
-- verified directly (2026-08-21): it has ZERO amount_types with >1
-- distinct account at fiscal_year=2026 — its account rename happens
-- BETWEEN amount_types (FY2024 actuals under the retired 1612N, FY2025
-- onward under 1611N), never two accounts at the SAME amount_type
-- simultaneously, which is the genuine distinction the plan's own
-- precedent language was reaching for. 9999999999 remains excluded BY
-- NAME (never by a count threshold, which would also mask a real
-- collision) regardless of its own 12-account spread.
--
-- account is NULL for every row of every OTHER pe_bli (the ~1,700+
-- ordinary single-account keys, plus '000999'/'FY2024CR', two non-program
-- placeholder/reserve keys that collide but are not appropriation-account
-- identities at all) — not because they are ambiguous, but because
-- populating it there would require a second, independent
-- account-attribution mechanism (parallel to collision_pes) with no
-- payoff this sprint needs; NULL simply means "this mart does not attempt
-- to attribute this row's account," never "this row spans >1 account
-- honestly" for the 10 keys, where account is always populated.
--
-- ROADMAP #45 (2026-08-21) adds `organization`, the parallel split key for
-- the ORG shape of the same defect class: three BLI codes ('20', '30',
-- '500') are shared by different organizations within the SAME account
-- ('0300D' Procurement, Defense-Wide) across every PB2026 amount_type, so
-- the account-only collision_pes above never sees them (account never
-- varies for these keys). org_collision_pes below is collision_pes'
-- organization mirror: >1 distinct ORGANIZATION reporting at the SAME
-- amount_type, checked across every amount_type PB2026 carries — verified
-- (2026-08-21) to reproduce exactly {'20', '30', '500'}, independently of
-- dim_programs (this mart is not downstream of it). Unlike dim_programs.sql
-- (which excludes '30's 4th organization, DODEA, from the PAGE split
-- because it has no fy_2026_total money — the Tomahawk-shaped precedent),
-- this mart's wide any-amount_type anchor is exactly what E2.1 already
-- established is correct for a MULTI-EDITION series: DODEA's historical
-- FY2024/FY2025 money under '30' gets its own `organization`-attributed
-- row here rather than being fused into OSD's, DTRA's, or DMACT's — a
-- program with no current page can still have an honest historical series.
-- organization is NULL for every other pe_bli, including the 10 genuine
-- account-collision keys (verified mutually exclusive: no pe_bli collides
-- on both dimensions in the shipped PB2026 warehouse) and every ordinary
-- single-account/single-organization key — unchanged, byte-for-byte.
-- Part of the grain: (pe_bli, account, organization, fy, edition_year) is
-- now the uniqueness key (assert_decade_series_grain_unique.sql).

{{ config(materialized='table') }}

with lake as (
    select
        exhibit,
        pe_bli,
        fiscal_year as edition_year,
        amount_type,
        amount_thousands,
        account,
        organization
    from {{ ref('stg_budget_lines') }}
),

detail as (
    select
        b.pe_bli,
        b.fiscal_year as edition_year,
        b.amount_type,
        b.account,
        b.organization,
        b.amount_thousands,
        substr(sha256(
            d.sha256 || '|' || b.exhibit || '|' || cast(b.fiscal_year as varchar)
            || '|' || b.account || '|' || b.organization || '|'
            || coalesce(b.budget_activity, '') || '|' || b.pe_bli || '|' || b.amount_type
        ), 1, 16) as row_fact_id
    from {{ ref('stg_budget_lines') }} b
    left join {{ source('lake', 'jbook_documents') }} d
      on d.id = b.source_document_id
    where b.exhibit in ('R-1', 'P-1')
      and b.source_document_id is not null
      and b.pe_bli <> '9999999999'
),

-- Collision anchor (E2.1 correction, 2026-08-21 — see the model-level
-- comment above): >1 distinct account reporting at the SAME amount_type,
-- checked across EVERY amount_type PB2026's own workbook carries (not
-- only fy_2026_total). Independently re-derived (this mart reads
-- stg_budget_lines directly and is not downstream of dim_programs in the
-- dbt DAG).
collision_slots as (
    select pe_bli, amount_type, account
    from {{ ref('stg_budget_lines') }}
    where fiscal_year = 2026
      and title is not null
      and pe_bli <> '9999999999'
    group by pe_bli, amount_type, account
),
collision_pes as (
    select distinct pe_bli
    from (
        select pe_bli
        from collision_slots
        group by pe_bli, amount_type
        having count(distinct account) > 1
    )
),

-- ROADMAP #45 organization collision anchor — collision_pes' mirror on
-- organization instead of account (see the model-level comment above).
org_collision_slots as (
    select pe_bli, amount_type, organization
    from {{ ref('stg_budget_lines') }}
    where fiscal_year = 2026
      and title is not null
      and pe_bli <> '9999999999'
    group by pe_bli, amount_type, organization
),
org_collision_pes as (
    select distinct pe_bli
    from (
        select pe_bli
        from org_collision_slots
        group by pe_bli, amount_type
        having count(distinct organization) > 1
    )
),

editions as (
    select distinct edition_year from detail
),

-- Candidate slug patterns: a 1:1 transcription of reconcile.scenario_map
-- (PriorYear / CurrentYear / BudgetYearOne; BudgetYearOneBase is not a
-- series kind). priority = list order = the any-candidate pick order.
cand_patterns (scenario, priority, slug_template, fy_offset) as (
    values
        ('PriorYear', 1, 'fy_%d_actuals', 2),
        ('PriorYear', 2, 'fy_%d_base_oco', 2),
        ('PriorYear', 3, 'fy_%d_actual', 2),
        ('CurrentYear', 1, 'fy_%d_total', 1),
        ('CurrentYear', 2, 'fy_%d_enacted', 1),
        ('CurrentYear', 3, 'fy_%d_total_enacted', 1),
        ('CurrentYear', 4, 'fy_%d_less_supplementals_enacted', 1),
        ('CurrentYear', 5, 'fy_%d_pb_request_with_cr_amounts', 1),
        ('CurrentYear', 6, 'fy_%d_pb_request_with_cr_adjustments', 1),
        ('CurrentYear', 7, 'fy_%d_enactment', 1),
        ('CurrentYear', 8, 'fy_%d_total_enacted_base_emerg_oco', 1),
        ('CurrentYear', 9, 'fy_%d_total_pb_requests_with_cr_adj_base_oco', 1),
        ('CurrentYear', 10, 'fy_%d_total_pb_requests_with_cr_adj_base_oco_saa', 1),
        ('CurrentYear', 11, 'fy_%d_total_pb_requests_with_cr_adj_base_oco_emergency', 1),
        ('BudgetYearOne', 1, 'fy_%d_total', 0),
        ('BudgetYearOne', 2, 'fy_%d_disc_request', 0),
        ('BudgetYearOne', 3, 'fy_%d_request', 0),
        ('BudgetYearOne', 4, 'fy_%d_total_base_oco', 0)
),

candidates as (
    select
        e.edition_year,
        c.scenario,
        c.priority,
        c.fy_offset,
        printf(c.slug_template, e.edition_year - c.fy_offset) as amount_type
    from editions e
    cross join cand_patterns c
),

detail_sums as (
    select
        d.pe_bli,
        d.edition_year,
        c.scenario,
        c.priority,
        c.fy_offset,
        c.amount_type,
        -- E2 split key: real account for the 10 collision_pes keys (every
        -- one of their rows, colliding or not — a non-colliding slot has
        -- exactly one account present, so this is a no-op split there);
        -- NULL for every other pe_bli, collapsing them to the SAME
        -- cross-account sum this mart has always produced (unchanged).
        case when cp.pe_bli is not null then d.account end as account,
        -- ROADMAP #45 split key: real organization for the 3
        -- org_collision_pes keys (mutually exclusive with cp above — see
        -- the model-level comment); NULL for every other pe_bli, including
        -- the 10 account-collision keys.
        case when ocp.pe_bli is not null then d.organization end as organization,
        sum(d.amount_thousands) as amount,
        count(*) as n_source_rows,
        case when count(*) = 1 then min(d.row_fact_id) end as source_fact_id
    from detail d
    join candidates c
      on c.edition_year = d.edition_year
     and c.amount_type = d.amount_type
    left join collision_pes cp
      on cp.pe_bli = d.pe_bli
    left join org_collision_pes ocp
      on ocp.pe_bli = d.pe_bli
    group by all
),

chosen as (
    select * from (
        select
            *,
            row_number() over (
                -- account/organization in the partition: each side of a
                -- genuine collision (account OR organization, whichever
                -- axis this pe_bli actually splits on) picks its OWN
                -- top-priority candidate slug independently. Without this,
                -- row_number() would rank every side's rows together and
                -- could arbitrarily discard one side's only row as a
                -- tie-broken rn=2 (DuckDB does not guarantee priority ties
                -- resolve by account/organization) — this pins the fix.
                partition by pe_bli, account, organization, edition_year, scenario
                order by priority
            ) as rn
        from detail_sums
    )
    where rn = 1
),

-- Raw lake sums per candidate slug: exactly what the verify-phase5e gate
-- recomputes (no title filter, all rows EXCEPT the P-1R exhibit — the
-- reserve-component subset of P-1 whose modern rows share the P-1 slugs;
-- verify_phase5e._lake_candidate_match applies the same exclusion).
-- account mirrors detail_sums' own split key exactly (collision_pes
-- membership, not raw account presence) so a genuine collision's
-- per-account amount is verified against that SAME account's own lake
-- total, never the two-account fused total that account would no longer
-- equal.
lake_sums as (
    select
        l.pe_bli,
        l.edition_year,
        c.scenario,
        case when cp.pe_bli is not null then l.account end as account,
        case when ocp.pe_bli is not null then l.organization end as organization,
        sum(l.amount_thousands) as lake_amount
    from lake l
    join candidates c
      on c.edition_year = l.edition_year
     and c.amount_type = l.amount_type
    left join collision_pes cp
      on cp.pe_bli = l.pe_bli
    left join org_collision_pes ocp
      on ocp.pe_bli = l.pe_bli
    where l.exhibit <> 'P-1R'
    group by l.pe_bli, l.edition_year, c.scenario, c.amount_type,
             case when cp.pe_bli is not null then l.account end,
             case when ocp.pe_bli is not null then l.organization end
)

select
    ch.pe_bli,
    ch.edition_year - ch.fy_offset as fy,
    ch.edition_year,
    case ch.scenario
        when 'PriorYear' then 'actuals'
        when 'CurrentYear' then 'enacted'
        when 'BudgetYearOne' then 'request'
    end as amount_type_kind,
    ch.amount,
    ch.amount as amount_thousands,
    ch.scenario,
    ch.amount_type,
    ch.account,
    ch.organization,
    ch.n_source_rows,
    ch.source_fact_id
from chosen ch
where exists (
    select 1
    from lake_sums ls
    where ls.pe_bli = ch.pe_bli
      and ls.edition_year = ch.edition_year
      and ls.scenario = ch.scenario
      and ls.account is not distinct from ch.account
      and ls.organization is not distinct from ch.organization
      and abs(ls.lake_amount - ch.amount) <= 0.5
)
