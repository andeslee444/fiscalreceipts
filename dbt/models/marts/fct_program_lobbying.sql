-- fct_program_lobbying: program-mention rows linking LDA filings to dim_programs.
-- Grain: one row per (filing_uuid, pe_bli, matched_term).
-- Source: lda_program_mentions parquet (written by the influence pull pipeline).
-- Every row is citation-ready: filing_uuid resolves to a filing URL via
-- lda_filings (filing_uuid → url column).
--
-- Neutral language: matched_term is a disclosed term from the statutory filing;
-- no inference of intent or causation is made here.
with mentions as (
    select
        filing_uuid,
        pe_bli,
        matched_term,
        description_snippet
    from {{ source('influence', 'lda_program_mentions') }}
),
filings as (
    select
        filing_uuid,
        url                     as filing_url,
        client_name,
        family_key_guess        as family_key,
        filing_year
    from {{ source('influence', 'lda_filings') }}
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
