-- fct_book_diff: same pe_bli compared across PB editions (Phase 5E Task 5).
--
-- Grain: (pe_bli, from_edition, to_edition, diff_kind). Values are USD
-- THOUSANDS. delta = to_value - from_value (the verify-phase5e leg-c
-- conservation contract; both sides recompute from the parquet lake via
-- reconcile.scenario_map candidates because they are fct_decade_series
-- amounts, which are lake-verified by construction).
--
-- diff_kind (spec §1):
--   * request_vs_request — PB(N) BudgetYearOne vs PB(N+1) BudgetYearOne,
--     consecutive editions only (what changed between asks; the two sides
--     are different fiscal years by design: FY N vs FY N+1).
--   * request_vs_actuals — PB(N) BudgetYearOne request for FY N vs PB(N+2)
--     PriorYear actuals for the SAME FY N (the accountability diff;
--     to_edition - from_edition == 2 always).
--
-- Coverage (Task 5 binding (ii), adversarial review 2026-07-03):
-- era (PB2017–PB2023) procurement is excluded from this mart ENTIRELY.
-- Era procurement pe_bli are within-edition namespaced keys
-- ('{account}-{org}-L{line}', era_keys.py); the underlying (account, org,
-- line) identity is unstable across editions (line renumbering), so
-- era-to-modern AND within-era procurement diffs are an honest gap, never a
-- join. Boundaries touching era editions therefore carry RDT&E R-1 program
-- elements only (PE numbers are stable identities across all ten editions).
-- Procurement diffs exist only where modern P-1 BLI codes are the identity:
-- PB2024→PB2025, PB2025→PB2026 (request_vs_request) and PB2024→PB2026
-- (request_vs_actuals). P-1R and the '9999999999' classified aggregate are
-- excluded upstream in fct_decade_series.
--
-- Rows are emitted only when BOTH sides exist in fct_decade_series
-- (join-completeness by construction; delta is never null).
--
-- Fact-minting handoff (Task 6): each side carries its source amount_type
-- slug and, for single-source grains, the workbook fact_id — the exporter
-- joins (pe_bli, edition, amount_type) back to its typed budget_lines rows
-- to mint the two side facts and the derived diff fact with breakdown
-- inputs (_verify_derived difference-formula contract).
--
-- E2 (Sprint E, ROADMAP #67): fct_decade_series now carries an `account`
-- column, non-NULL for the 8 genuine PB2026 collisions (see that model's
-- header). Both self-joins below matched on pe_bli alone; once a pe_bli's
-- request/actuals rows can legitimately span two accounts in one edition,
-- an account-blind join fans out — f and t each contributing up to 2 rows
-- per edition, so the join produces up to 4 combinations per (pe_bli,
-- from_edition, to_edition, diff_kind) instead of at most 2 (one per
-- account, matched to ITSELF across editions), 2 of the 4 being
-- cross-account nonsense (account A's "from" paired with account B's
-- "to"). `is not distinct from` (not `=`) so the ~1,700+ ordinary
-- single-account pe_bli, whose account is NULL on both sides, still match
-- (a plain `=` would drop every NULL=NULL pair and silently empty this
-- mart for everything except the 8 keys). account is part of the grain
-- below for the same reason it is part of fct_decade_series' own grain:
-- a genuine collision's two accounts are two different programs' diffs,
-- not two rows of one diff.

{{ config(materialized='table') }}

with series as (
    select *
    from {{ ref('fct_decade_series') }}
    -- Binding (ii): no era procurement keys ever cross editions.
    where not regexp_matches(pe_bli, '^[0-9]{4}[A-Z]-[A-Z]+-L')
),

requests as (
    select * from series where amount_type_kind = 'request'
),

actuals as (
    select * from series where amount_type_kind = 'actuals'
),

request_vs_request as (
    select
        f.pe_bli,
        f.account,
        f.edition_year as from_edition,
        t.edition_year as to_edition,
        'request_vs_request' as diff_kind,
        f.fy as from_fy,
        t.fy as to_fy,
        f.amount as from_value,
        t.amount as to_value,
        t.amount - f.amount as delta,
        f.amount_type as from_amount_type,
        t.amount_type as to_amount_type,
        f.source_fact_id as from_source_fact_id,
        t.source_fact_id as to_source_fact_id
    from requests f
    join requests t
      on t.pe_bli = f.pe_bli
     and t.account is not distinct from f.account
     and t.edition_year = f.edition_year + 1
),

request_vs_actuals as (
    select
        f.pe_bli,
        f.account,
        f.edition_year as from_edition,
        t.edition_year as to_edition,
        'request_vs_actuals' as diff_kind,
        f.fy as from_fy,
        t.fy as to_fy,
        f.amount as from_value,
        t.amount as to_value,
        t.amount - f.amount as delta,
        f.amount_type as from_amount_type,
        t.amount_type as to_amount_type,
        f.source_fact_id as from_source_fact_id,
        t.source_fact_id as to_source_fact_id
    from requests f
    join actuals t
      on t.pe_bli = f.pe_bli
     and t.account is not distinct from f.account
     and t.edition_year = f.edition_year + 2
     -- same fiscal year on both sides: f.fy = from_edition = N,
     -- t.fy = to_edition - 2 = N (belt for the year-shift rule)
     and t.fy = f.fy
)

select * from request_vs_request
union all
select * from request_vs_actuals
