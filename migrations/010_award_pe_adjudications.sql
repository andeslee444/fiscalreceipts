-- migrations/010_award_pe_adjudications.sql
--
-- Hand-adjudication overlay for the budget->award crosswalk (2026-09-01).
-- The mechanical crosswalk rows in budget_line_awards are never rewritten
-- (supersede-not-delete); this table records the human/agent adjudication
-- per (award, PE) pair, and the mart takes coalesce(adjudicated, mechanical).
--
-- award_verdict is the award-level finding the pair tag derives from:
--   pinned         evidence affirmatively places the award under specific PE(s)
--   darpa_unpinned DARPA work; no specific PE supportable
--   not_darpa      nothing beyond the shared appropriation account
--   contradicted   affirmative evidence the work is another org's program
--   insufficient   descriptions empty or contentless
create table if not exists award_pe_adjudications (
    id              bigserial primary key,
    award_piid      text not null,
    pe_bli          text not null,
    adjudicated_confidence text not null check (adjudicated_confidence in
                       ('high','medium','low','reject')),
    award_verdict   text not null check (award_verdict in
                       ('pinned','darpa_unpinned','not_darpa','contradicted','insufficient')),
    pair_reason     text not null,           -- e.g. 'pinned-here','unpinned-pool','pinned-elsewhere:0602303E'
    basis           text,                    -- narrative-grep | project-title | description-explicit
    evidence        text,                    -- decisive quote, when pinned
    note            text,
    refuter_lenses_passed int,               -- 2 = survived both adversarial lenses
    method          text not null default 'hand-adjudication-v1',
    adjudicated_at  timestamptz not null default now(),
    unique (award_piid, pe_bli)
);
create index if not exists ix_adjudications_pe on award_pe_adjudications(pe_bli);
