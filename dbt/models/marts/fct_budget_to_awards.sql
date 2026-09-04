-- link table: dollars live at award grain; account-level 'low' links stay in postgres for audit
--
-- E1 (Sprint E, ROADMAP #67): dim_programs is no longer unique on pe_bli
-- alone (a genuine account collision, 10 keys, now publishes two rows). This
-- join used to be a trivial 1:1 lookup; joining it unconstrained today
-- would fan out every award row for those pe_bli values into two
-- (duplicating awards dollars, not just the title). `programs` dedupes to
-- (at most) one row per pe_bli first.
--
-- ROADMAP #70 (2026-09-04): award-to-account attribution now EXISTS for the
-- account-split keys. budget_line_awards.account (migration 014) carries the
-- one member a link's own evidence identifies, so `programs_by_account`
-- resolves those rows to that member's title. It is a strict refinement: the
-- join is on (pe_bli, account) and dim_programs is unique on that pair, so it
-- can never fan a row out; a link with account NULL — every ordinary key, and
-- every organization-split key, which stays unlinked — matches nothing there
-- (SQL null equality) and falls back to `programs` exactly as before.
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
programs_by_account as (
    -- One row per (pe_bli, account). group by rather than a bare select so a
    -- future third row under one account degrades to a deterministic title
    -- instead of fanning the award row out.
    select pe_bli, account, min(title) as title
    from {{ ref('dim_programs') }}
    where account is not null
    group by pe_bli, account
),
adjudications as (
    select award_piid, pe_bli, adjudicated_confidence, award_verdict,
           pair_reason, basis as adjudication_basis
    from {{ source('lake', 'jbook_award_adjudications') }}
),
-- 2026-09-04 (#75 fix round 1, finding 3): the published confidence is
-- computed ONCE here, in `linked`, and reused by both the select list and
-- the where filter below -- previously the where clause re-derived
-- coalesce(adj.adjudicated_confidence, a.confidence) directly, which
-- mirrors the PRE-demotion value. That happened to be harmless today
-- (demotion only ever moves high->medium, and both tiers pass the filter),
-- but it meant a future demotion target of 'low' could publish a row the
-- filter believed it was excluding. Filtering on the same column the
-- select emits closes that gap structurally, not by convention.
linked as (
    select
        a.pe_bli,
        a.exhibit,
        cast(a.fiscal_year as integer) as fiscal_year,
        a.organization,
        a.award_piid,
        a.recipient_name,
        a.recipient_uei,
        a.method,
        a.account,
        -- 2026-09-04 (#75 addendum, ruling 3): demotion, not a drop. A
        -- mechanical account+tokens/high pair that no human has adjudicated
        -- must never publish as 'high' -- the crosswalk's token-overlap
        -- 'high' tier alone is not evidence-graded. Demote the PUBLISHED
        -- confidence to 'medium'; crosswalk_confidence below keeps the raw
        -- mechanical tag untouched so the demotion is auditable, not a
        -- silent loss of information ("publish the smaller true number").
        case
            when adj.award_piid is null
             and a.method = 'account+tokens'
             and a.confidence = 'high'
            then 'medium'
            else coalesce(adj.adjudicated_confidence, a.confidence)
        end as published_confidence,
        a.confidence as crosswalk_confidence,
        case when adj.award_piid is not null then 'adjudicated' else 'mechanical' end
            as confidence_source,
        adj.award_verdict,
        adj.pair_reason,
        adj.adjudication_basis
    from {{ source('lake', 'jbook_awards') }} a
    left join adjudications adj
      on adj.award_piid = a.award_piid and adj.pe_bli = a.pe_bli
)
select
    l.pe_bli,
    l.exhibit,
    l.fiscal_year,
    l.organization,
    l.award_piid,
    l.recipient_name,
    l.recipient_uei,
    l.method,
    l.account,
    l.published_confidence as confidence,
    l.crosswalk_confidence,
    l.confidence_source,
    l.award_verdict,
    l.pair_reason,
    l.adjudication_basis,
    coalesce(pa.title, p.title) as program_title
from linked l
left join programs_by_account pa
  on pa.pe_bli = l.pe_bli and pa.account = l.account
left join programs p
  on p.pe_bli = l.pe_bli
where l.published_confidence in ('high', 'medium')
