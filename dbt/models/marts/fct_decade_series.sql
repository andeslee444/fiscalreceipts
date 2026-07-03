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

{{ config(materialized='table') }}

with lake as (
    select
        exhibit,
        pe_bli,
        fiscal_year as edition_year,
        amount_type,
        amount_thousands
    from {{ ref('stg_budget_lines') }}
),

detail as (
    select
        b.pe_bli,
        b.fiscal_year as edition_year,
        b.amount_type,
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
        sum(d.amount_thousands) as amount,
        count(*) as n_source_rows,
        case when count(*) = 1 then min(d.row_fact_id) end as source_fact_id
    from detail d
    join candidates c
      on c.edition_year = d.edition_year
     and c.amount_type = d.amount_type
    group by all
),

chosen as (
    select * from (
        select
            *,
            row_number() over (
                partition by pe_bli, edition_year, scenario
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
lake_sums as (
    select
        l.pe_bli,
        l.edition_year,
        c.scenario,
        sum(l.amount_thousands) as lake_amount
    from lake l
    join candidates c
      on c.edition_year = l.edition_year
     and c.amount_type = l.amount_type
    where l.exhibit <> 'P-1R'
    group by l.pe_bli, l.edition_year, c.scenario, c.amount_type
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
    ch.n_source_rows,
    ch.source_fact_id
from chosen ch
where exists (
    select 1
    from lake_sums ls
    where ls.pe_bli = ch.pe_bli
      and ls.edition_year = ch.edition_year
      and ls.scenario = ch.scenario
      and abs(ls.lake_amount - ch.amount) <= 0.5
)
