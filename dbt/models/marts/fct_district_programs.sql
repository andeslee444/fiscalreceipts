-- fct_district_programs: high-confidence dollar grain per (pop_district, pe_bli).
-- Only confidence='high' awards are used to avoid the 14.7x multi-count fanout
-- seen with medium-confidence rows (recon §B: 267 rows, 106 districts, 17 programs).
-- Breadth grain (all-confidence, mapped_via_account flag, NO dollar column) is
-- deferred — the join cost was acceptable but adds complexity; note that a second
-- model fct_district_programs_breadth could be added cheaply using the same joins
-- without the dollar column if needed by Task 5.
select
    t.pop_state,
    t.pop_district,
    b.pe_bli,
    b.program_title,
    b.organization,
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
group by 1, 2, 3, 4, 5
