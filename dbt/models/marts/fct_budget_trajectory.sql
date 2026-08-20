-- fct_budget_trajectory: per (pe_bli, organization, account): fy2024 actuals, fy2025 total,
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
-- E1 (Sprint E, ROADMAP #67) — re-grain, replacing B'1's #56 pick-one rule.
--
-- #56's history: 10 pe_bli values are legitimately shared by two DIFFERENT
-- real appropriation accounts within PB2026 (e.g. '3010' is BOTH LPD Flight
-- II's Shipbuilding & Conversion account, $2.6B FY2026, AND Shipboard
-- Tactical Communications' Other Procurement account, $20.9M). The
-- pre-#56 code summed straight across both accounts, fusing two unrelated
-- programs into one row: 3010's fy2026_total was $2,620,900K, neither
-- program's real figure. #56/B'1 fixed the FUSION by pick-one — exactly
-- ONE account per (pe_bli, organization), never summing — which was
-- correct for correctness but wrong for completeness: the account NOT
-- picked dropped off every consumer that reads this mart (10 programs,
-- $5.35B, catalogued in programs_excluded.json).
--
-- E1 removes the pick-one rule for genuine collisions and lets BOTH
-- accounts publish their own row — this mart's grain becomes
-- (pe_bli, organization, account). This is deliberately NOT a blanket
-- "always grain on account": only pe_bli/organization pairs with a GENUINE
-- same-slot collision split; everything else (99%+ of rows) collapses back
-- to exactly one row, byte-for-byte identical to the pre-E1 output, via the
-- SAME stable-preference logic #56 already used to pick a winner (now used
-- only to pick the COLLAPSED label, never to drop the loser's money).
--
-- 1045/COLUMBIA Class Submarine remains the precedent for collapse: one
-- program whose account was RENAMED BETWEEN the fiscal years its own
-- PB2026 book reports (FY2024 actuals under the retired 1612N, FY2025 on
-- under 1611N), never both under the same amount_type slot at once — its
-- slot_collision_3.has_collision_3 is FALSE, so every one of its slots
-- relabels to the one stably-preferred account and it stays ONE row,
-- values unchanged.
--
-- Collision anchor — DISCLOSED SUBSTITUTION (re-verify before trusting
-- "10 collisions" from assert_program_key_unique.sql's own shipped
-- comment): that count is right for "ever collided", but of those 10, TWO
-- (1350, 2101/Tomahawk) collide ONLY at fy_2024_actuals/fy_2025_enacted —
-- by fy_2026_total exactly one account reports any money; the other side
-- wound down to nothing before this edition. The Sprint E plan explicitly
-- scopes Tomahawk OUT ("no_detail, not key_collision... different defect,
-- do not fold it in") for this exact shape, and the plan's own $5.35B
-- headline reproduces exactly when the collision anchor is fy_2026_total
-- specifically (verified: summing the 8 fy_2026_total-anchored keys'
-- previously-dropped money equals $5.35B to the dollar). So
-- slot_collision_2026 below is scoped to fy_2026_total, not the 3-slot
-- union — 1350 and 2101 therefore still collapse (pre-E1 behavior, unchanged) and
-- are NOT part of this sprint's split. If a future edition resurrects
-- their dormant side with real fy_2026_total money, this same rule picks
-- it up automatically.
--
-- 9999999999 is the intentional classified sentinel spanning 12 accounts by
-- design — excluded BY NAME below (never by a count threshold, which would
-- also mask a real collision) and always collapses to its pre-E1 stable
-- pick, values unchanged.
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
slot_collision_2026 as (
    -- true iff, AT fy_2026_total specifically, >1 distinct account reports
    -- for this (pe_bli, organization) — see the model-level comment for why
    -- fy_2026_total (not the 3-slot union) is the right anchor, and why
    -- 9999999999 is excluded by name here rather than relying on the
    -- has_collision=false branch to neutralise it (a 12-account sentinel
    -- must never even be a candidate for the split path).
    select pe_bli, organization, count(distinct account) > 1 as has_collision_2026
    from per_slot
    where amount_type = 'fy_2026_total' and pe_bli <> '9999999999'
    group by pe_bli, organization
),
slot_collision_3 as (
    -- the PRE-E1 (B'1/#56) definition: true iff ANY of the 3 checked
    -- amount_types has >1 distinct account reporting simultaneously — not
    -- only fy_2026_total. This is what governs HOW a non-split pe_bli
    -- collapses, below: 1045 never trips this (its two accounts are never
    -- simultaneous, so every slot passes through unmodified and a stable
    -- relabel is safe); 1350/2101/9999999999 DO trip this (they collide at
    -- fy_2024_actuals/fy_2025_total even though not at fy_2026_total) and
    -- must therefore be FILTERED to the one stably-preferred account's own
    -- rows — never relabelled-then-summed, which would silently sum two
    -- different accounts' money at the same slot (the exact #56 fusion bug,
    -- reintroduced by a naive relabel for any pe_bli with a real historical
    -- overlap). This reproduces #56/B'1's pick-one output byte-for-byte for
    -- every pe_bli this sprint does not split.
    select pe_bli, organization, bool_or(n_accounts > 1) as has_collision_3
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
    left join {{ ref('dim_programs') }} dp
        on dp.pe_bli = tot.pe_bli and dp.account = tot.account
        -- E1: matched on (pe_bli, account) now that dim_programs can carry
        -- more than one row per pe_bli — matching by account too keeps this
        -- preference scoped to the SAME account dim_programs resolved,
        -- instead of fanning across every dim_programs row sharing the key.
),
stable_pick as (
    select pe_bli, organization, account
    from account_rank
    where rn = 1
),
budget as (
    -- Three cases, checked in priority order (see slot_collision_3's
    -- comment for why a 4th case — "collides somewhere, but not at
    -- fy_2026_total" — needs FILTERING rather than relabelling):
    --   1. genuine fy_2026_total collision (8 keys): every account's own
    --      slot survives AS-IS, unrelabelled — this IS the split.
    --   2. collides elsewhere but not at fy_2026_total (1350, 2101,
    --      9999999999): keep ONLY the stably-preferred account's own rows
    --      (WHERE ps.account = sp.account) — discards the other account's
    --      rows entirely, exactly #56/B'1's pre-E1 pick-one output.
    --   3. no collision anywhere (1045 and the ~1,729 ordinary
    --      single-account pe_blis): every slot passes through, relabelled
    --      to ONE stable account — safe because no slot ever has >1 row,
    --      so relabel-then-sum never sums two different accounts together.
    select
        ps.pe_bli,
        ps.organization,
        ps.amount_type,
        ps.amount_thousands,
        case
            when coalesce(s26.has_collision_2026, false) then ps.account
            when coalesce(s3.has_collision_3, false) then ps.account
            else coalesce(sp.account, ps.account)
        end as account
    from per_slot ps
    left join slot_collision_2026 s26
        on s26.pe_bli = ps.pe_bli and s26.organization = ps.organization
    left join slot_collision_3 s3
        on s3.pe_bli = ps.pe_bli and s3.organization = ps.organization
    left join stable_pick sp
        on sp.pe_bli = ps.pe_bli and sp.organization = ps.organization
    where coalesce(s26.has_collision_2026, false)
       or not coalesce(s3.has_collision_3, false)
       or ps.account = sp.account
),
account_titles as (
    select account, max(account_title) as account_title
    from {{ ref('stg_budget_lines') }}
    where account is not null
    group by account
),
pivoted as (
    select
        pe_bli,
        organization,
        account,
        sum(case when amount_type = 'fy_2024_actuals' then amount_thousands end) as fy2024_actuals,
        sum(case when amount_type = 'fy_2025_total'   then amount_thousands end) as fy2025_total,
        sum(case when amount_type = 'fy_2026_total'   then amount_thousands end) as fy2026_total
    from budget
    group by pe_bli, organization, account
)
select
    p.pe_bli,
    p.organization,
    p.account,
    atl.account_title,
    p.fy2024_actuals,
    p.fy2025_total,
    p.fy2026_total,
    (p.fy2026_total - p.fy2025_total) as fy2526_change,
    case
        when p.fy2025_total is null or p.fy2025_total = 0 then null
        else round(100.0 * (p.fy2026_total - p.fy2025_total) / p.fy2025_total, 2)
    end as fy2526_pct_change
from pivoted p
left join account_titles atl on atl.account = p.account
