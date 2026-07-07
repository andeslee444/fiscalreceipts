-- migrations/008_program_lineage.sql
create table if not exists program_lineage (
    id              bigserial primary key,
    from_pe_bli     text not null,
    to_pe_bli       text not null,
    fiscal_year     int  not null,
    relation        text not null check (relation in
                       ('matured_ba','realigned','split','merged','renamed','appropriation_transfer')),
    portion_amount  numeric,                 -- $thousands moved, when stated; else null
    confidence      text not null check (confidence in ('stated','inferred')),
    evidence_fact_id  text,                  -- stated only: the cited narrative fact_id
    evidence_sentence text,                  -- stated only: the verbatim source sentence
    evidence_page     int,                   -- stated only: PDF page
    inference_basis text check (inference_basis in
                       ('ba_maturation_same_title','funding_handoff','title_continuity')),
    unique (from_pe_bli, to_pe_bli, fiscal_year, relation, confidence)
);
create index if not exists ix_lineage_from on program_lineage(from_pe_bli);
create index if not exists ix_lineage_to   on program_lineage(to_pe_bli);
