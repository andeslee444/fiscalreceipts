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
with programs as (
    select pe_bli, min(title) as title
    from {{ ref('dim_programs') }}
    group by pe_bli
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
    a.confidence,
    p.title as program_title
from {{ source('lake', 'jbook_awards') }} a
left join programs p
  on p.pe_bli = a.pe_bli
where a.confidence in ('high', 'medium')
