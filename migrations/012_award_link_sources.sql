-- migrations/012_award_link_sources.sql
--
-- The source document behind a published (award, PE) link (ROADMAP #71).
--
-- budget_line_awards.rationale already NAMES the evidence in prose ("defense.gov
-- contract announcement 1006508 (2016-11-14) … url=…"), but prose is not a
-- citation: the site could only mint a generic derived crosswalk row for these
-- links, so a reader clicking the receipt never reached the article itself.
-- This table holds the same evidence STRUCTURALLY, one row per (award, PE,
-- source), so export_site can mint a first-class kind='announcement' citation.
--
-- source_kind:
--   announcement  a defense.gov daily Contracts article names the contract
--                 number, and names the program on the basis recorded in
--                 match_basis (method 'announcement+lexicon').
--                 source_id = article_id; source_url = the article URL;
--                 archive_url/archived_at/sha256 describe the archived copy in
--                 data/raw/announcements (manifest.jsonl) that the wave
--                 verification actually read — the article the site cites is
--                 the one that was hashed, not whatever defense.gov serves now.
--   subaward      an FSRS subaward description names the program
--                 (method 'subaward+lexicon'). source_id = subaward_number.
--                 Recorded for provenance parity; these links keep the generic
--                 derived citation row — a card saying "official DoD contract
--                 announcement" would be false for a sub's description.
--
-- match_basis (added in the #71 fix round) — HOW the announcement's program
-- text was matched to this PE. The published corpus carries:
--   exact-name                 the announcement names the program verbatim
--   designator-normalized      matched after normalising a designator
--   llm-alias                  an LLM judged an alias to be the same program
--   llm-designator-variant     an LLM judged a designator variant to match
--   llm-description            an LLM judged a description to name the program
--   subaward-description-exact (subaward rows) the sub's description verbatim
--   NULL                       the wave packet recorded no basis
-- The card must state this in words. "The announcement names this program" is
-- true only for exact-name — 190 of the 701 published announcement links. The
-- other 511 (194 designator/alias/description, 317 with no recorded basis) did
-- not have the program named as written, so collapsing every basis into that
-- one sentence overclaims for most of the corpus.
--
-- Archive columns are nullable on purpose: an article with no manifest line has
-- no archived copy, and a null is the honest answer (never a fabricated URL).
create table if not exists award_link_sources (
    award_piid   text not null,
    pe_bli       text not null,
    source_kind  text not null check (source_kind in ('announcement','subaward')),
    source_id    text not null,      -- article_id or subaward_number
    source_url   text,
    archive_url  text,
    archived_at  timestamptz,
    sha256       text,
    match_basis  text,
    primary key (award_piid, pe_bli, source_kind, source_id)
);

-- schema_migrations records the FILE NAME, so a database that already applied
-- an earlier revision of this file will never re-run it: the alter below is
-- what those databases need, and it is a no-op everywhere else.
alter table award_link_sources add column if not exists match_basis text;
