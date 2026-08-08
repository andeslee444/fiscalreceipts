-- fct_program_lobbying: program-mention rows linking LDA filings to dim_programs.
-- Grain: one row per (filing_uuid, pe_bli) — at most one row per pair since
-- the #52 evidence-tier fix (mentions.py find_mentions) collects every
-- matching term for a (filing, pe_bli) pair before emitting once. matched_term
-- remains part of the declared key for backward compatibility with existing
-- ORDER BY / dedup logic downstream, but it is no longer possible for the
-- same (filing_uuid, pe_bli) to appear twice with different matched_term.
-- Source: lda_program_mentions parquet (written by the influence pull/rematch
-- pipeline).
-- Every row is citation-ready: filing_uuid resolves to a filing URL via
-- lda_filings (filing_uuid → url column).
--
-- evidence_kind (#52 — docs/superpowers/ROADMAP.md item 52): one of
-- 'pe_literal' | 'alias' | 'multi_token'. A row's presence is evidence-tiered
-- keyword co-occurrence with the filing's activity description, never a
-- claim that the filing "names" the program — enforced by
-- dbt/tests/assert_program_mentions_evidence.sql.
--
-- Neutral language: matched_term is a disclosed term from the statutory filing;
-- no inference of intent or causation is made here.
with mentions as (
    select
        filing_uuid,
        pe_bli,
        matched_term,
        evidence_kind,
        description_snippet
    from {{ source('influence', 'lda_program_mentions') }}
),
filings as (
    -- Deduplicate lda_filings to one row per filing_uuid before joining.
    -- The declared mart grain is (filing_uuid, pe_bli, matched_term); any
    -- duplicate filing_uuid rows in lda_filings (e.g. from a re-pull that
    -- leaves an extra row) would fan-out mentions and violate that grain.
    -- Strategy: row_number() ordered by filing_year desc, url to pick
    -- deterministically — same URL is stable across re-pulls so the chosen
    -- row is reproducible even if the table temporarily holds duplicates.
    select
        filing_uuid,
        url                     as filing_url,
        client_name,
        -- family_key attribution requires a verified match; 'none' rows carry only
        -- the queried family name, not an established link.  The program mention
        -- itself (filing_uuid ↔ pe_bli) is valid regardless of match_method;
        -- only the family_key attribution is gated on a confirmed match.
        case
            when match_method is not null and match_method <> 'none'
                then family_key_guess
            else null
        end                     as family_key,
        filing_year
    from (
        select *,
               row_number() over (
                   partition by filing_uuid
                   order by filing_year desc, url
               ) as _rn
        from {{ source('influence', 'lda_filings') }}
    ) t
    where _rn = 1
),
programs as (
    select
        pe_bli,
        title as program_title
    from {{ ref('dim_programs') }}
)
select
    m.filing_uuid,
    m.pe_bli,
    p.program_title,
    m.matched_term,
    m.evidence_kind,
    m.description_snippet,
    f.filing_url,
    f.client_name,
    f.family_key,
    f.filing_year
from mentions m
left join filings f
    on f.filing_uuid = m.filing_uuid
left join programs p
    on p.pe_bli = m.pe_bli
