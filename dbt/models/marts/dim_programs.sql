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
-- column — only stg_budget_lines (the R-1/P-1 workbook source) does. 10
-- pe_bli values are legitimately shared by two DIFFERENT real
-- appropriation accounts within PB2026 (#56 — e.g. '3010' is BOTH LPD
-- Flight II's Shipbuilding & Conversion account AND Shipboard Tactical
-- Communications' Other Procurement account; 9999999999 is the intentional
-- classified sentinel, excluded by name). The old unconstrained
-- `left join stg_budget_lines b on b.pe_bli = d.pe_bli` fanned out across
-- BOTH accounts' titles for those 10 keys, so `max(b.title)` could name
-- either program regardless of which one d.fy2024_actual_millions actually
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
-- falls back to today's unconstrained join — no worse than before, and not
-- one of the 10 known collision keys (verified against the shipped
-- warehouse, 2026-08-11: all 10 that have a dim_programs row resolve
-- exactly).
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
)
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
