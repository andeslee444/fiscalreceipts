-- migrations/011_link_precision_samples.sql
--
-- Hand-adjudicated held-out precision study for the published link tiers
-- (ROADMAP #72). The old automated tier (account match + keyword overlap)
-- measured 9.1% precise under full hand-adjudication and was corrected
-- 2026-09-01; the new tiers (FPDS acquisition-program mapping, defense.gov
-- announcement matching, FSRS subaward matching) rely on an adversarial
-- refute pass at CREATION time as their precision control, but that number
-- had never been independently MEASURED. scripts/precision_study.py draws a
-- stratified random sample per method from budget_line_awards, an
-- adjudicator judges each sampled link with the same two-lens rubric the
-- waves use, and the verdict lands here — one row per (sample_id,
-- award_piid, pe_bli) so a study can be re-run (a new sample_id) without
-- overwriting the last one's record.
create table if not exists link_precision_samples (
    id              bigserial primary key,
    sample_id       text not null,           -- one study run, e.g. '2026-09-10'
    award_piid      text not null,
    pe_bli          text not null,
    method          text not null,           -- budget_line_awards.method at draw time
    verdict         text check (verdict in ('confirmed','refuted')),
    reason          text,
    adjudicated_at  timestamptz,
    unique (sample_id, award_piid, pe_bli)
);
