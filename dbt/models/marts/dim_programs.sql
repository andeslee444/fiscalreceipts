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
-- detail source `details`/`details_dedup` read from) carried NO account
-- column when #56 was fixed — only stg_budget_lines (the R-1/P-1 workbook
-- source) did. IT DOES NOW (Wave 5, tri-persona remediation): the column was
-- always on budget_line_details, populated by the P-40 loader and joined
-- byte-for-byte by reconcile.py's Gate B; it simply was not in the export.
-- See detail_account_collisions below, which uses it to keep two programs
-- sharing a BLI code from being summed on the detail side — the half of #56
-- the amount heuristic could only approximate. Several pe_bli values are
-- legitimately shared by two DIFFERENT real appropriation accounts within
-- PB2026 (#56 — e.g. '3010' is BOTH LPD Flight II's Shipbuilding &
-- Conversion account AND Shipboard Tactical Communications' Other
-- Procurement account; 9999999999 is the intentional classified sentinel,
-- excluded by name). The old unconstrained
-- `left join stg_budget_lines b on b.pe_bli = d.pe_bli` fanned out across
-- BOTH accounts' titles for those keys, so `max(b.title)` could name either
-- program regardless of which one d.fy2024_actual_millions actually
-- describes (verified: pe_bli 3010 rendered "Shipboard Tactical
-- Communications" — the OPN title, matching this row's own money — purely
-- by max()'s lexical accident; nothing pinned the title to the money).
--
-- account_match ties the two sources together by AMOUNT where the detail
-- states no account of its own (every R-1/RDT&E row, and every era-keyed
-- row): the stg_budget_lines row whose FY2024 actuals dollar figure equals
-- details' own fy2024_actual_millions is, by construction, the SAME line the
-- R-2/P-40 detail describes, so its account is this program's account. A
-- pe_bli with only one account (99%+ of them) resolves trivially (only one
-- candidate row); a pe_bli with no fy2024_actual_millions, or none of its
-- stg_budget_lines rows matching to float tolerance (a genuine
-- toa-vs-detail reconciliation disagreement), falls back to today's
-- unconstrained join — no worse than before. Where the detail DOES state an
-- account (procurement rows on a shared key), that statement wins and
-- account_match is scoped to it; the heuristic never gets to disagree with
-- the source.
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
--
-- ROADMAP #45 (the ORG shape of the shared-key defect, filed alongside #56
-- and closed after it): three BLI codes — '20', '30', '500' — are shared by
-- genuinely different programs from DIFFERENT ORGANIZATIONS within the SAME
-- appropriation account ('0300D' Procurement, Defense-Wide), so #56's
-- account-keyed collision detection (collision_slots/collision_pes below)
-- never saw them: account never varies for these three keys, only
-- organization does. Verified against the shipped PB2026 warehouse
-- (2026-08-21): '20' is DCSA "Major Equipment" ($2,230K) and DTRA
-- "Vehicles" ($911K); '30' is OSD "Major Equipment, OSD" ($212,900K), DTRA
-- "Other Major Equipment" ($12,023K), and DMACT "Major Equipment"
-- ($7,258K); '500' is DLA "Major Equipment" ($79,251K) and DHRA "Personnel
-- Administration" ($3,797K) — titles that name unrelated equipment/
-- personnel categories, not one program's organizational components. Before
-- this fix, `details` (below) grouped stg_budget_details by pe_bli ALONE,
-- fusing every organization's PriorYear actuals into one
-- fy2024_actual_millions and letting `matched`'s title join fan across every
-- organization's stg_budget_lines rows (max() picking whichever title sorts
-- last) — the identical #56 fusion shape, one dimension over: pe_bli 500
-- rendered org='DLA' (from the fused stg_budget_details org) titled
-- "Personnel Administration" (DHRA's own line, alphabetically last),
-- attributing DHRA's money to a page identified by DLA's organization.
-- programs_excluded.json already carried all 7 of these org-lines under
-- reason='key_collision' — independent confirmation from the site's own
-- coverage recompute that NONE of them was honestly represented pre-fix.
--
-- A 4th organization, DODEA, also shares '30' in stg_budget_details/
-- stg_budget_lines historically (FY2024/FY2025 money, title "Automation/
-- Educational Support & Logistics") but reports NO fy_2026_total row at
-- all — the identical "wound down before this edition" shape as 1350/2101
-- (Tomahawk) on the account axis. org_collision_slots below is anchored to
-- fy_2026_total for exactly the same reason collision_slots already is
-- (see the model-level comment above): a page-less, money-less 4th row
-- would add nothing today. DODEA is therefore excluded from the per-org
-- split by construction (its (pe_bli, org) pair is absent from
-- org_collision_slots) — its historical money is never given a
-- dim_programs row, matching the Tomahawk precedent exactly. It is NOT
-- dropped from the corpus, though: fct_decade_series.sql's own org
-- collision anchor is intentionally wider (every amount_type, not only
-- fy_2026_total — mirroring that mart's E2.1 account correction) so
-- DODEA's historical series is preserved under its own organization there
-- instead of being fused into OSD's, DTRA's, or DMACT's.
--
-- org_collision_slots / org_collision_pes are independently re-derived
-- (never a hardcoded key list) using the SAME fy_2026_total anchor
-- collision_slots/collision_pes already use, substituting organization for
-- account. Verified mutually exclusive with the 8 account-collision keys
-- (no pe_bli collides on both dimensions in the shipped PB2026 warehouse) —
-- the two split mechanisms below are therefore independent and never layer
-- on the same pe_bli.
with details_dedup as (
    select
        pe_bli,
        project_number,
        scenario,
        amount_millions,
        xml_path,
        -- Wave 5: the detail row's OWN appropriation. Part of the row's
        -- identity, so adding it to the group-by cannot merge or split a
        -- dual-volume duplicate pair (both copies come from the same
        -- appropriation by construction) — it only carries the column
        -- through to detail_account_collisions and `details` below.
        account,
        max(org) as org,
        max(exhibit_family) as exhibit_family,
        bool_and(reconciled) as reconciled
    from {{ ref('stg_budget_details') }}
    where fiscal_year = 2026
    group by pe_bli, project_number, scenario, amount_millions, xml_path, account
),
-- Wave 5 (tri-persona remediation) — THE DETAIL-SIDE ACCOUNT COLLISION.
--
-- #45/#56/E1 fixed this on the stg_budget_lines side and could not fix it
-- here, for the reason the model comment above still records: the exported
-- detail rows carried no account, so `details` had nothing to group on but
-- pe_bli and summed every account's money for a shared BLI code. That was
-- invisible while only ONE Navy procurement appropriation was loaded — the
-- pipeline had collapsed twelve Navy procurement books to one, so no shared
-- key ever had two accounts' detail at once. Parsing the other five
-- appropriations made it visible immediately: ten PB2026 keys arrived with
-- detail from two accounts each, and the pre-fix build fused all ten — most
-- starkly '3010', where LPD Flight II's $500M of Shipbuilding & Conversion
-- FY2024 actuals was summed with Shipboard Tactical Communications' $28.574M
-- of Other Procurement and published as $528.574M under the communications
-- title. That is the original #56 defect exactly, arriving from the source
-- the #56 fix could not reach.
--
-- The set is DERIVED FROM THE DETAIL ROWS THEMSELVES, never from a key list
-- and never from stg_budget_lines: two distinct non-null accounts under one
-- pe_bli in the detail source IS two programs' money, whatever the workbook
-- side happens to say about which of them still reports this edition.
--
-- Deliberately NOT reusing collision_pes (below): that set is anchored to
-- fy_2026_total because its question is "does this need a second PAGE
-- today". This one's question is "may these two amounts be added together",
-- and the answer is no even when one side has wound down — 1350 and 2101
-- (Tomahawk) both carry real FY2024 detail on both accounts while only one
-- account still reports fy_2026_total, and summing them would be wrong for
-- the same reason summing 3010 is.
detail_account_collisions as (
    select pe_bli
    from details_dedup
    where account is not null
    group by pe_bli
    having count(distinct account) > 1
),
-- account_title for an account the DETAIL states. account_match supplies it
-- whenever the amount ties a workbook row; this covers the rest, so a row
-- never carries an account with no name beside it.
detail_account_titles as (
    select pe_bli, account, max(account_title) as account_title
    from {{ ref('stg_budget_lines') }}
    where fiscal_year = 2026 and account is not null
    group by pe_bli, account
),
-- Wave 5 — THE TITLE OF LAST RESORT, and why a program needs one.
--
-- `title` below is resolved entirely from stg_budget_lines: the R-1/P-1
-- workbook is the naming authority. That holds for every program whose line
-- appears in the workbook, which was all of them until Wave 5 parsed the Navy
-- shipbuilding book. Two of its line items — 3039 Expeditionary Sea Base
-- (ESB) and 3043 Expeditionary Fast Transport (EPF) — are published in the
-- P-40 exhibit and are absent from the FY2026 P-1 display, so they arrived
-- with real R-2/P-40 detail and NO workbook row to take a name from, and
-- dim_programs.title came out NULL for both.
--
-- That is not a cosmetic gap. Their program pages rendered "<title>null</title>",
-- and search_quick.json shipped two docs with a null title, which threw
-- inside the client index build and left the WHOLE SITE's tier-1 search
-- dead — every query fell through to pagefind, and gate 5 dropped from
-- passing to 49%. One missing string, sitewide blast radius.
--
-- The fallback is the title the Navy prints on the exhibit itself
-- (LineItemTitle, carried into detail_narratives.title by the P-40 loader) —
-- real and sourced, never invented, and it is the string the program page's
-- own narrative already displays. Used ONLY where the workbook supplies
-- nothing, so no page's name changes.
jbook_detail_titles as (
    select pe_bli, max(title) as title
    from {{ source('lake', 'jbook_narratives') }}
    where cast(fiscal_year as integer) = 2026 and title is not null
    group by pe_bli
),
-- ROADMAP #45: the fy_2026_total-anchored organization-collision set, same
-- shape as collision_slots/collision_pes below but on organization instead
-- of account. Defined here (ahead of `details`) because `details` needs it
-- to decide whether to keep stg_budget_details grouped by pe_bli alone
-- (every ordinary program, and DODEA's excluded '30' rows) or split it by
-- organization (the 3 genuine collisions' real, currently-reporting sides).
org_collision_slots as (
    select pe_bli, organization
    from {{ ref('stg_budget_lines') }}
    where fiscal_year = 2026
      and amount_type = 'fy_2026_total'
      and title is not null
      and pe_bli <> '9999999999'
    group by pe_bli, organization
),
-- ROADMAP #69 — the title a page is NAMED by must be the line its money is
-- mostly made of. `matched`/`synth` below both resolved `title` with
-- max(b.title): a LEXICAL pick among however many line-item titles this
-- (pe_bli, account, organization) slot carries. That is harmless for the
-- ~1,751 slots whose lines all share one title, and for the eleven PB2026
-- keys whose FY2026 money spans several BUDGET ACTIVITIES under an
-- identical title (F-15EX files in BA-01 "Combat aircraft", BA-05
-- "Modification of inservice aircraft" and BA-07 "Aircraft support
-- equipment and facilities", all titled "F-15EX" — one program, three
-- sub-lines, and summing them IS its FY2026 procurement). It is not
-- harmless for the two keys whose sub-line labels differ:
--   HCMC00 — "HC/MC-130 Modifications" (BA-05, $365,086K) and "HC/MC-130
--     Post Prod" (BA-07, $17,986K). max() sorts 'P' after 'M', so the page
--     carrying $383,072K was named after its $17,986K sub-line.
--   JSE000 — "Joint Simulation Environment" (BA-01, $17,985K) and "Joint
--     Simulation Environment Post Production Support" (BA-07, $28,524K).
--     max() picked the longer string, which here happens to be the larger
--     line — the same accident, landing right by luck.
-- These are NOT two programs colliding on a key (#45/#56/#67's shape, where
-- the titles name unrelated things — DLA "Major Equipment" vs DHRA
-- "Personnel Administration"). They are one program's sub-lines: same
-- account, same organization, same BLI code, same aircraft, and in the
-- PB2024 and PB2025 editions the very same HCMC00 BA-07 line is titled
-- "HC/MC-130 Modifications" too — identical to its BA-05 sibling. Only the
-- PB2026 label changed. A title-keyed page split would therefore make the
-- program's identity flip with a relabelling and would have no way to
-- attribute the earlier editions' BA-07 money, so the fix is to name the
-- page correctly and disclose the constituents (export_site.py's
-- fy26_split.lines), not to fragment it.
--
-- Deterministic by construction: largest FY2026 money first, title
-- ascending as the tiebreak — never row order, never a hardcoded key list.
-- A slot with no fy_2026_total row at all is absent here and both call
-- sites fall back to max(b.title), byte-for-byte the pre-#69 behavior.
line_fy26_by_title as (
    select pe_bli, account, organization, title,
           sum(amount_thousands) as fy26_k
    from {{ ref('stg_budget_lines') }}
    where fiscal_year = 2026
      and amount_type = 'fy_2026_total'
      and title is not null
      and pe_bli <> '9999999999'
    group by pe_bli, account, organization, title
),
dominant_title as (
    select pe_bli, account, organization, title
    from (
        select pe_bli, account, organization, title,
               row_number() over (
                   partition by pe_bli, account, organization
                   order by fy26_k desc, title asc
               ) as rn
        from line_fy26_by_title
    )
    where rn = 1
),
org_collision_pes as (
    select pe_bli
    from org_collision_slots
    group by pe_bli
    having count(distinct organization) > 1
),
details as (
    -- ROADMAP #45: grouped by (pe_bli, org) instead of pe_bli alone
    -- whenever this pe_bli is a genuine organization collision AND this
    -- row's own org is one of the currently-reporting sides
    -- (org_collision_slots) — max(dd.org) then simply returns that one real
    -- value per group instead of collapsing across organizations. Every
    -- other pe_bli (ocp.pe_bli is null) groups by pe_bli alone, byte-for-
    -- byte the pre-#45 behavior. DODEA's '30' rows (ocp matches but ocs
    -- does not — no fy_2026_total money) are filtered out of `details`
    -- entirely by the where clause below, exactly like Tomahawk's dormant
    -- side never enters `collision_slots`/`collision_pes` for the account
    -- axis: a page-less, money-less 4th row would add nothing today, and
    -- its historical money is preserved in fct_decade_series instead (see
    -- the model-level comment above).
    select
        dd.pe_bli,
        case when dac.pe_bli is not null then dd.account end as detail_account,
        max(dd.org) as org,
        max(dd.exhibit_family) as exhibit_family,
        count(distinct dd.project_number) as project_count,
        sum(dd.amount_millions) filter (where dd.scenario = 'PriorYear' and dd.project_number is null)
            as fy2024_actual_millions,
        bool_and(dd.reconciled) as fully_reconciled,
        -- Tri-persona review Wave 2 — the badge predicate.
        --
        -- fully_reconciled above is bool_and over EVERY scenario, including
        -- the two the reconciler never checks. Gate A/B only ever run for a
        -- scenario `govbudget.jbooks.reconcile.scenario_map()` has candidate
        -- amount_type slugs for (PriorYear / CurrentYear / BudgetYearOne /
        -- BudgetYearOneBase); every other scenario hits `continue` and its
        -- rows keep budget_line_details.reconciled's false default forever.
        -- reconcile.py names that complement DESIGN_EXCLUDED_SCENARIOS
        -- ("no R-1 display analog... not-served-by-design, distinct from
        -- pending-review") and jbooks/verify.py's accuracy_gate excludes it
        -- from Gate 2's scope for the same reason.
        --
        -- Measured against the shipped PB2026 warehouse (2026-08-29):
        -- AllPriorYears is 3,267 detail rows of which 0 are reconciled — it
        -- cannot be otherwise — so bool_and over all scenarios is false for
        -- every program that HAS an AllPriorYears row and true only for the
        -- 344 pe_blis that happen to have none. Of the 1,398 dim_programs
        -- rows reading false, 1,310 have zero in-scope failures and 87 have
        -- a real one; the site rendered one undifferentiated "Partial
        -- Reconciliation" badge over all of them.
        --
        -- BudgetYearOneOOC never appears in the shipped corpus but is in
        -- scenario_map's complement, so it is excluded here too — the list
        -- below is DESIGN_EXCLUDED_SCENARIOS verbatim and
        -- tests/test_dim_programs_inscope_scope.py fails the build if this
        -- SQL literal and that Python frozenset ever drift apart.
        --
        -- NULL (not false) when a group has no in-scope row at all: one
        -- pe_bli in the shipped corpus carries AllPriorYears detail and
        -- nothing else, and "we checked nothing" is not "we found a
        -- failure". The synth branch below is NULL for the same reason.
        bool_and(dd.reconciled) filter (
            where dd.scenario not in ('AllPriorYears', 'BudgetYearOneOOC')
        ) as reconciled_in_scope
    from details_dedup dd
    left join org_collision_pes ocp on ocp.pe_bli = dd.pe_bli
    left join org_collision_slots ocs
        on ocs.pe_bli = dd.pe_bli and ocs.organization = dd.org
    left join detail_account_collisions dac on dac.pe_bli = dd.pe_bli
    where ocp.pe_bli is null or ocs.pe_bli is not null
    -- Wave 5: split by the detail's own appropriation for the keys two
    -- programs share, and by nothing extra for every other key (the case
    -- expression is NULL there, so the group-by is byte-for-byte what it
    -- was). No row is dropped on either branch.
    group by dd.pe_bli, ocs.organization,
             case when dac.pe_bli is not null then dd.account end
),
account_match as (
    -- ROADMAP #45: partitioned by (pe_bli, org) instead of pe_bli alone, and
    -- the amount-tolerance join is additionally scoped to THIS row's own
    -- organization for the 3 org-collision pe_bli values — without it, each
    -- org's own fy2024_actual_millions (now un-fused) would still fan out
    -- across every organization's stg_budget_lines rows at this pe_bli
    -- (they all share account '0300D'), and coincidentally-close amounts
    -- across organizations could cross-match. Scoped narrowly to the 3
    -- verified keys (org_collision_pes), never applied universally — the
    -- two sources' org vocabularies are not asserted to agree everywhere
    -- (see the model-level comment: "account_match ties the two sources by
    -- AMOUNT, not by a shared key neither source carries").
    --
    -- Wave 5: when the detail row STATES its appropriation (detail_account,
    -- non-null only for the shared keys), the amount heuristic is not what
    -- resolves the account — the source is. The join is scoped to that
    -- account so a near-equal amount under the sibling account can never
    -- cross-match, and the partition widens with it.
    select
        d.pe_bli,
        d.org,
        d.detail_account,
        b.account,
        b.account_title,
        row_number() over (
            partition by d.pe_bli, d.org, d.detail_account order by b.account
        ) as rn
    from details d
    left join org_collision_pes ocp on ocp.pe_bli = d.pe_bli
    join {{ ref('stg_budget_lines') }} b
        on b.pe_bli = d.pe_bli and b.fiscal_year = 2026
        and b.amount_type = 'fy_2024_actuals'
        and abs(b.amount_thousands / 1000.0 - d.fy2024_actual_millions) < 0.0005
        and (ocp.pe_bli is null or b.organization = d.org)
        and (d.detail_account is null or b.account = d.detail_account)
    where d.fy2024_actual_millions is not null
),
matched as (
    -- ROADMAP #45: am joined by (pe_bli, org) instead of pe_bli alone (a
    -- no-op for every non-split pe_bli, where org is constant within the
    -- group), and the title join additionally scoped to this row's own org
    -- for the 3 org-collision keys — without it, `max(b.title)` would fan
    -- across every organization's line-item titles sharing account '0300D'
    -- and pick whichever sorts last, exactly the pre-fix defect.
    --
    -- ROADMAP #69: dt (dominant_title) is joined on exactly the same
    -- predicates as b, so it always names a line this very slot carries.
    -- coalesce falls back to max(b.title) only when the slot has no
    -- fy_2026_total row for dominant_title to rank (a historical-money-only
    -- program) — unchanged behavior there.
    select
        d.pe_bli,
        d.org,
        d.exhibit_family,
        d.project_count,
        d.fy2024_actual_millions,
        d.fully_reconciled,
        d.reconciled_in_scope,
        -- Wave 5: the stated account wins over the amount-matched one. They
        -- agree wherever both exist (account_match is now scoped to it);
        -- coalesce matters when the amount does NOT tie any workbook row —
        -- a genuine reconciliation disagreement, which must not also cost
        -- the row its (independently known) account and its title scope.
        coalesce(d.detail_account, am.account) as account,
        coalesce(am.account_title, dat.account_title) as account_title,
        coalesce(max(dt.title), max(b.title), max(jt.title)) as title
    from details d
    left join org_collision_pes ocp on ocp.pe_bli = d.pe_bli
    left join jbook_detail_titles jt on jt.pe_bli = d.pe_bli
    left join account_match am
        on am.pe_bli = d.pe_bli and am.org is not distinct from d.org
        and am.detail_account is not distinct from d.detail_account and am.rn = 1
    left join {{ ref('stg_budget_lines') }} b
        on b.pe_bli = d.pe_bli and b.fiscal_year = 2026
        and (coalesce(d.detail_account, am.account) is null
             or b.account = coalesce(d.detail_account, am.account))
        and (ocp.pe_bli is null or b.organization = d.org)
    -- account_title for a row whose account came from the detail rather than
    -- from account_match: read it off the workbook rows for that account.
    left join detail_account_titles dat
        on dat.pe_bli = d.pe_bli and dat.account = d.detail_account
    left join dominant_title dt
        on dt.pe_bli = d.pe_bli
        and (coalesce(d.detail_account, am.account) is null
             or dt.account = coalesce(d.detail_account, am.account))
        and (ocp.pe_bli is null or dt.organization = d.org)
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9
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
        -- no R-2/P-40 detail behind this row at all, so no scenario was
        -- checked: NULL, never false (see the details CTE's note above).
        cast(null as boolean) as reconciled_in_scope,
        sc.account,
        sc.account_title,
        -- ROADMAP #69: same money-anchored pick as `matched` above. No
        -- account-collision key carries two line titles within one account
        -- today, so this changes nothing in the shipped PB2026 warehouse —
        -- it is here so a future key that collides on account AND spans
        -- several budget activities does not silently revert to the lexical
        -- max() this fix exists to remove.
        coalesce(max(dt.title), max(b.title)) as title
    from synth_candidates sc
    left join {{ ref('stg_budget_lines') }} b
        on b.pe_bli = sc.pe_bli and b.account = sc.account
        and b.fiscal_year = 2026 and b.title is not null
    left join dominant_title dt
        on dt.pe_bli = sc.pe_bli and dt.account = sc.account
    group by sc.pe_bli, sc.account, sc.account_title
    -- honesty contract: no title, no row (either source supplying one is
    -- enough; coalesce above picks dt first)
    having coalesce(max(dt.title), max(b.title)) is not null
)
select pe_bli, org, exhibit_family, project_count, fy2024_actual_millions,
       fully_reconciled, reconciled_in_scope, account, account_title, title
from matched
union all
select pe_bli, org, exhibit_family, project_count, fy2024_actual_millions,
       fully_reconciled, reconciled_in_scope, account, account_title, title
from synth
