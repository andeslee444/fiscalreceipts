-- No district total may exceed the sum of its DISTINCT awards.
-- fct_district_programs is per (district, pe_bli); one award matched to N
-- program elements produces N rows carrying the same dollars, so any sum over
-- that model double-counts. This asserts the headline model does not (#51).
with truth as (
    select t.pop_district, t.award_id_piid, sum(t.obligation) as obl
    from {{ ref('fct_award_transactions') }} t
    join (
        select distinct award_piid
        from {{ ref('fct_budget_to_awards') }}
        where confidence = 'high'
    ) b on t.award_id_piid = b.award_piid
    where t.pop_district is not null
    group by 1, 2
),
distinct_by_district as (
    select pop_district, sum(obl) as distinct_obl from truth group by 1
)
select
    h.pop_district,
    h.total_obligation as published,
    d.distinct_obl     as distinct_awards,
    h.total_obligation - d.distinct_obl as overstatement
from {{ ref('fct_district_totals') }} h
join distinct_by_district d using (pop_district)
where h.total_obligation > d.distinct_obl + 0.01
