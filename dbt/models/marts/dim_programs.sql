-- dim_programs is the MODERN-ERA (PB2024+) program dimension the site,
-- dossiers, and evals consume. The Phase 5E decade backfill grew the lake
-- with PB2017–PB2023 editions whose consolidated Defense-Wide documents and
-- long-form org names would otherwise shadow the per-agency org codes here
-- (max(org) picked 'Defense_Wide' over 'DTRA'); the decade series gets its
-- own edition-aware marts in 5E Task 5. The >= 2024 fence reproduces the
-- pre-backfill input relation exactly (the lake then held only 2024–2026).
with details as (
    select
        pe_bli,
        max(org) as org,
        max(exhibit_family) as exhibit_family,
        count(distinct project_number) as project_count,
        sum(amount_millions) filter (where scenario = 'PriorYear' and project_number is null)
            as fy2024_actual_millions,
        bool_and(reconciled) as fully_reconciled
    from {{ ref('stg_budget_details') }}
    where fiscal_year >= 2024
    group by pe_bli
)
select
    d.pe_bli,
    d.org,
    d.exhibit_family,
    d.project_count,
    d.fy2024_actual_millions,
    d.fully_reconciled,
    max(b.title) as title
from details d
left join {{ ref('stg_budget_lines') }} b
    on b.pe_bli = d.pe_bli and b.fiscal_year >= 2024
group by 1, 2, 3, 4, 5, 6
