-- fct_district_programs: high-confidence dollar grain per (pop_district, pe_bli).
-- Only confidence='high' awards are used to avoid the 14.7x multi-count fanout
-- seen with medium-confidence rows (recon §B: 267 rows, 106 districts, 17 programs).
-- Breadth grain (all-confidence, mapped_via_account flag, NO dollar column) is
-- deferred — the join cost was acceptable but adds complexity; note that a second
-- model fct_district_programs_breadth could be added cheaply using the same joins
-- without the dollar column if needed by Task 5.
--
-- ROADMAP #70 (2026-09-04): grouped by (pop_state, pop_district, pe_bli) only,
-- with the two LABEL columns aggregated. fct_budget_to_awards now resolves
-- program_title per (pe_bli, account) for the pe_bli values two programs share,
-- so a shared code whose two members both carry high-confidence links would
-- carry two titles — and grouping BY the title would split one district-program
-- into two rows, breaking this model's own declared (district, pe_bli) grain
-- (pinned by test_dbt_build's uniqueness assertion and read by the district
-- sidecars, which key on that pair). Every pe_bli that names one program has
-- exactly one title and one organization here, so min() returns that value and
-- the output is byte-identical to the pre-#70 model for all of them.
select
    t.pop_state,
    t.pop_district,
    b.pe_bli,
    min(b.program_title)               as program_title,
    min(b.organization)                as organization,
    count(distinct t.transaction_key)  as transaction_count,
    count(distinct t.award_id_piid)    as award_count,
    count(distinct t.recipient_uei)    as recipient_count,
    sum(t.obligation)                  as total_obligation
from {{ ref('fct_award_transactions') }} t
join (
    select distinct award_piid, pe_bli, program_title, organization
    from {{ ref('fct_budget_to_awards') }}
    where confidence = 'high'
) b on t.award_id_piid = b.award_piid
where t.pop_district is not null
group by 1, 2, 3
