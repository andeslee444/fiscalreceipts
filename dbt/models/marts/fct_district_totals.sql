-- fct_district_totals: the district HEADLINE grain — one row per district,
-- dollars counted once per award.
--
-- fct_district_programs stays as-is: it is the correct per-(district, program)
-- ATTRIBUTION view, and its rows are individually true. What it is not is
-- summable — an award matched to five program elements appears five times with
-- the same dollars (#51: AK-00 read $1.05B off one $209.3M DARPA award because
-- the exporter summed exactly that). This model is the sum-safe companion
-- (precedent #37: the fix belongs in a purpose-built model, not a re-grained
-- one).
--
-- Grain is (pop_state, pop_district) rather than pop_district alone even
-- though pop_district already carries a state prefix for ordinary districts
-- (e.g. 'AK-00', 'CA-50') — verified against the shipped warehouse that within
-- this high-confidence linked subset no pop_district takes more than one
-- pop_state value, so grouping by the pair never fragments a district into
-- two rows. It is still the safer grain: pop_district alone is NOT globally
-- unique (a bare '90' — MULTI-STATE/unknown-state allocations — appears
-- against more than one raw pop_state label), so a future data change that
-- introduces that ambiguity inside the linked subset fails loudly here
-- instead of silently splitting a district's dollars across two rows.
with linked as (
    select
        t.pop_state,
        t.pop_district,
        t.award_id_piid,
        sum(t.obligation) as obligation
    from {{ ref('fct_award_transactions') }} t
    join (
        select distinct award_piid
        from {{ ref('fct_budget_to_awards') }}
        where confidence = 'high'
    ) b on t.award_id_piid = b.award_piid
    where t.pop_district is not null
    group by 1, 2, 3
)
select
    pop_state,
    pop_district,
    count(distinct award_id_piid) as award_count,
    sum(obligation)               as total_obligation
from linked
group by 1, 2
