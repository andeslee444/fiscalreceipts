-- link table: dollars live at award grain; account-level 'low' links stay in postgres for audit
--
-- E1 (Sprint E, ROADMAP #67): dim_programs is no longer unique on pe_bli
-- alone (a genuine account collision, 8 keys, now publishes two rows). This
-- join used to be a trivial 1:1 lookup; joining it unconstrained today
-- would fan out every award row for those 8 pe_bli values into two
-- (duplicating awards dollars, not just the title). `programs` dedupes to
-- (at most) one row per pe_bli first — award-to-account attribution is a
-- separate, not-yet-built feature (E3/owner call), not something this
-- table can silently half-implement by picking whichever dim_programs row
-- wins an unstated tiebreak.
-- Hand-adjudication overlay (2026-09-01): every published (pe, award) pair was
-- hand-adjudicated (award-level evidence investigation + two adversarial
-- refuter lenses; see docs/superpowers/reviews/ and migration 010). The
-- published confidence is the adjudicated one when present; the mechanical
-- crosswalk tag is retained as crosswalk_confidence, never rewritten.
-- Pairs adjudicated low/reject drop out of the mart (and the site) here.
with programs as (
    select pe_bli, min(title) as title
    from {{ ref('dim_programs') }}
    group by pe_bli
),
adjudications as (
    select award_piid, pe_bli, adjudicated_confidence, award_verdict,
           pair_reason, basis as adjudication_basis
    from {{ source('lake', 'jbook_award_adjudications') }}
)
select
    a.pe_bli,
    a.exhibit,
    cast(a.fiscal_year as integer) as fiscal_year,
    a.organization,
    a.award_piid,
    a.recipient_name,
    a.recipient_uei,
    a.method,
    -- 2026-09-04 (#75 addendum, ruling 3): demotion, not a drop. A mechanical
    -- account+tokens/high pair that no human has adjudicated must never
    -- publish as 'high' -- the crosswalk's token-overlap 'high' tier alone
    -- is not evidence-graded. Demote the PUBLISHED confidence to 'medium';
    -- crosswalk_confidence below keeps the raw mechanical tag untouched so
    -- the demotion is auditable, not a silent loss of information ("publish
    -- the smaller true number").
    case
        when adj.award_piid is null
         and a.method = 'account+tokens'
         and a.confidence = 'high'
        then 'medium'
        else coalesce(adj.adjudicated_confidence, a.confidence)
    end as confidence,
    a.confidence as crosswalk_confidence,
    case when adj.award_piid is not null then 'adjudicated' else 'mechanical' end
        as confidence_source,
    adj.award_verdict,
    adj.pair_reason,
    adj.adjudication_basis,
    p.title as program_title
from {{ source('lake', 'jbook_awards') }} a
left join adjudications adj
  on adj.award_piid = a.award_piid and adj.pe_bli = a.pe_bli
left join programs p
  on p.pe_bli = a.pe_bli
where coalesce(adj.adjudicated_confidence, a.confidence) in ('high', 'medium')
