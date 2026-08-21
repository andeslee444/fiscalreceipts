-- #67 (Sprint E, ROADMAP): tightened from "no key spans two accounts within
-- an edition" (the #56/B'1 assertion below, which forbade a program's
-- money and title being blended across two accounts into one summed row)
-- to the E1 grain: the program row itself must be unique on
-- (account, pe_bli). Two DIFFERENT accounts sharing a pe_bli is no longer
-- forbidden — that IS the E1 fix: the 8 verified PB2026 collisions each
-- get two rows now, one per account, in both dim_programs and
-- fct_budget_trajectory. What's forbidden is a DUPLICATE (account, pe_bli)
-- pair, which would mean the same program-account was counted twice.
--
-- ROADMAP #45 (2026-08-21) widened dim_programs_dupes's grain again, to
-- (account, pe_bli, org): three BLI codes ('20', '30', '500') are shared by
-- DIFFERENT organizations within the SAME account ('0300D' Procurement,
-- Defense-Wide) — the account axis alone cannot tell DCSA's "Major
-- Equipment" apart from DTRA's "Vehicles" under pe_bli '20', both real,
-- both now their own dim_programs row. Verified this genuinely widens the
-- grain rather than masking anything: re-run at the OLD (account, pe_bli)
-- grain against the post-#45 warehouse (2026-08-21) FAILS with exactly 3
-- results — ('30', '0300D', 3), ('500', '0300D', 2), ('20', '0300D', 2) —
-- recorded here as the proof this tightening was load-bearing, not
-- cosmetic:
--   Failure in test assert_program_key_unique (pre-#45 grain)
--     Got 3 results, configured to fail if != 0
--     ('dim_programs', '30', '0300D', None, 3)
--     ('dim_programs', '500', '0300D', None, 2)
--     ('dim_programs', '20', '0300D', None, 2)
-- fct_budget_trajectory_dupes already checked (account, pe_bli,
-- organization) — its grain has included organization since it was first
-- introduced (this mart's own grain has always been the COMPONENT, one row
-- per organization funding a program), so it required no change here; only
-- dim_programs (the PROGRAM/page-identity grain, org-blind until #45) did.
--
-- fiscal_year: the prescribed grain was "(account, pe_bli, fiscal_year)".
-- DISCLOSED SUBSTITUTION — neither mart carries an explicit fiscal_year/
-- edition column; both are PB2026-edition-fenced by construction (see each
-- model's own doc comment) so every row already IS fiscal_year=2026, and
-- "(account, pe_bli, fiscal_year)" collapses to "(account, pe_bli, org)"
-- today. If a future edition-aware program grain (5E-style, see
-- fct_decade_series) is added to either mart, this test's target should
-- gain the same column and the check should widen to match it.
--
-- 9999999999 excluded BY NAME (never a count threshold, which could also
-- mask a real collision) — it is the intentional 12-account classified
-- sentinel and is never split; both marts always collapse it to one
-- stably-picked row.
--
-- Pre-E1 (for reference — this is what this file's SUBSTITUTION #1/#2 used
-- to check): a program key (pe_bli) spanning >1 appropriation account
-- within one edition must never be rendered as ONE row that sums both
-- accounts' money under a title naming only one of them — that is two
-- unrelated programs fused into a single row (the original #56 defect:
-- '3010' rendered LPD Flight II's $2.6B Shipbuilding & Conversion
-- reconciliation funding under Shipboard Tactical Communications' $20.9M
-- Other Procurement title). That defect is now structurally impossible to
-- reintroduce here: a duplicate (account, pe_bli, org) row would mean the
-- SAME account-organization was double-counted, not that two
-- accounts/organizations were summed together (dim_programs.sql and
-- fct_budget_trajectory.sql no longer have a code path that sums across a
-- genuine collision, on EITHER axis, at all).
with dim_programs_dupes as (
    select account, pe_bli, org, count(*) as n
    from {{ ref('dim_programs') }}
    where pe_bli <> '9999999999' and account is not null
    group by account, pe_bli, org
    having count(*) > 1
),
fct_budget_trajectory_dupes as (
    select account, pe_bli, organization, count(*) as n
    from {{ ref('fct_budget_trajectory') }}
    where pe_bli <> '9999999999' and account is not null
    group by account, pe_bli, organization
    having count(*) > 1
)
select 'dim_programs' as mart, pe_bli, account, org as organization, n
from dim_programs_dupes
union all
select 'fct_budget_trajectory' as mart, pe_bli, account, organization, n
from fct_budget_trajectory_dupes
