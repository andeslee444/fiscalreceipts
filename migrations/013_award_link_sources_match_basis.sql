-- 013: award_link_sources.match_basis for databases that recorded 012 first
-- (2026-09-04, ROADMAP #71 round-2 minor).
--
-- schema_migrations records the FILE NAME, so a database that already applied
-- an earlier revision of 012_award_link_sources.sql (before match_basis was
-- added to that file's CREATE) never re-runs it — the column would silently
-- never exist there. This migration is the idempotent alter those databases
-- need; it is a no-op everywhere else (fresh DBs already get match_basis from
-- 012's CREATE).
alter table award_link_sources add column if not exists match_basis text;
