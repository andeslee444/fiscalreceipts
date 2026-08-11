-- fct_budget_trajectory: per (pe_bli, organization): fy2024 actuals, fy2025 total,
-- fy2026 total (sum amount_thousands per amount_type), absolute + pct change columns.
--
-- Detail rows only (title IS NOT NULL). stg_budget_lines carries BOTH detail
-- rows (title IS NOT NULL) and R-1 rollup rows (title IS NULL); summing both
-- double-counts. fy_2024_actuals had 147 rollup rows inflating 146 of 1982
-- (pe_bli, organization) pairs 1.09x-2.0x (e.g. 0601101E: 560,988 vs the true
-- 280,494). fy_2025_total / fy_2026_total currently have zero rollup rows, but
-- the filter applies to all three amount_types so the same latent hazard can't
-- recur if rollups appear in a future load. No (pe_bli, organization) is
-- rollup-only, so the filter drops no rows.
--
-- #56 account disambiguation (BINDING). Grain stays (pe_bli, organization) —
-- every existing consumer depends on it (export_site.py's traj_index /
-- traj_orgs_by_pe / _trajectory_citation_key; fct_program_trajectory's
-- component sum; the agency fy2024 aggregation) and this fix does not touch
-- it. But 10 pe_bli values are legitimately shared by two DIFFERENT real
-- appropriation accounts within PB2026 (#56 — e.g. '3010' is BOTH LPD
-- Flight II's Shipbuilding & Conversion account, $2.6B FY2026, AND
-- Shipboard Tactical Communications' Other Procurement account, $20.9M).
-- The old `sum(amount_thousands) group by pe_bli, organization, amount_type`
-- summed straight across both accounts, fusing two unrelated programs into
-- one row: 3010's fy2026_total was $2,620,900K, neither program's real
-- figure (measured on the shipped PB2026 warehouse, 2026-08-08).
--
-- Fixed by picking exactly ONE account per (pe_bli, organization) — never
-- summing across accounts — but ONLY when a genuine SAME-SLOT collision
-- exists (>1 account reporting under the SAME amount_type at once, e.g.
-- both OPN and SCN report a fy_2026_total for '3010'). This is deliberately
-- a per-(pe_bli, organization) pick, not a per-slot one: an earlier version
-- of this fix picked independently per amount_type and produced a
-- Frankenstein row for pe_bli '0145' (no dim_programs anchor to break the
-- tie) — FY2024 actuals from the Ammunition account (larger that slot) but
-- FY2026 total from the Aircraft account (larger that slot), splicing two
-- different programs' numbers into one row, which is worse than the
-- original sum. The slot_collision gate keeps that stable pick scoped to
-- ONLY the (pe_bli, organization) pairs that actually have a same-slot
-- collision: 1045/COLUMBIA Class Submarine (one program whose account was
-- renamed BETWEEN the fiscal years its own PB2026 book reports — FY2024
-- actuals under the retired 1612N, FY2025 on under 1611N, never both under
-- the same amount_type) never trips it, so its rows pass through
-- unmodified regardless of which account "wins" the tiebreak ranking.
--
-- Preference for the stable pick is the account dim_programs ALSO resolved
-- to for this pe_bli — so this row's money always matches the SAME account
-- as the page's own title (dim_programs.sql carries its own #56 fix) —
-- tiebreaking on the larger total amount (summed across this account's own
-- slots), account ascending, when dim_programs has no row or its account
-- isn't a candidate here. The account NOT picked is never silently dropped
-- from the site: its own figures are already correctly per-row cited in
-- budget_lines (account_title per row) and export_site.py surfaces them as
-- the page's own "shares this budget line" disclosure (#56) — this mart is
-- deliberately not the place that does that, since widening its grain to
-- (pe_bli, organization, account) would fan out every consumer above
-- (traj_index / traj_orgs_by_pe / fct_program_trajectory's component sum /
-- the agency fy2024 aggregation) into believing a component org gained a
-- sibling.
with per_slot as (
    select
        pe_bli,
        organization,
        amount_type,
        account,
        sum(amount_thousands) as amount_thousands
    from {{ ref('stg_budget_lines') }}
    where amount_type in ('fy_2024_actuals', 'fy_2025_total', 'fy_2026_total')
      and title is not null
    group by pe_bli, organization, amount_type, account
),
slot_collision as (
    -- true iff ANY single amount_type slot for this (pe_bli, organization)
    -- has >1 distinct account reporting — a same-moment collision, as
    -- opposed to 1045's never-simultaneous account change.
    select pe_bli, organization, bool_or(n_accounts > 1) as has_collision
    from (
        select pe_bli, organization, amount_type, count(distinct account) as n_accounts
        from per_slot
        group by pe_bli, organization, amount_type
    )
    group by pe_bli, organization
),
account_totals as (
    select pe_bli, organization, account, sum(amount_thousands) as total_amount
    from per_slot
    group by pe_bli, organization, account
),
account_rank as (
    select
        tot.pe_bli,
        tot.organization,
        tot.account,
        row_number() over (
            partition by tot.pe_bli, tot.organization
            order by
                (dp.account is not null and dp.account = tot.account) desc,
                tot.total_amount desc,
                tot.account asc
        ) as rn
    from account_totals tot
    left join {{ ref('dim_programs') }} dp on dp.pe_bli = tot.pe_bli
),
budget as (
    select ps.pe_bli, ps.organization, ps.amount_type, ps.amount_thousands
    from per_slot ps
    join slot_collision sc
        on sc.pe_bli = ps.pe_bli and sc.organization = ps.organization
    left join account_rank ar
        on ar.pe_bli = ps.pe_bli and ar.organization = ps.organization
        and ar.account = ps.account
    where not sc.has_collision  -- no collision anywhere for this PE/org: keep every account's own slot as-is
       or ar.rn = 1             -- genuine collision: keep only the stably-preferred account, across ALL its slots
),
pivoted as (
    select
        pe_bli,
        organization,
        sum(case when amount_type = 'fy_2024_actuals' then amount_thousands end) as fy2024_actuals,
        sum(case when amount_type = 'fy_2025_total'   then amount_thousands end) as fy2025_total,
        sum(case when amount_type = 'fy_2026_total'   then amount_thousands end) as fy2026_total
    from budget
    group by pe_bli, organization
)
select
    pe_bli,
    organization,
    fy2024_actuals,
    fy2025_total,
    fy2026_total,
    (fy2026_total - fy2025_total) as fy2526_change,
    case
        when fy2025_total is null or fy2025_total = 0 then null
        else round(100.0 * (fy2026_total - fy2025_total) / fy2025_total, 2)
    end as fy2526_pct_change
from pivoted
