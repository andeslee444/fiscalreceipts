-- 014: which member of a shared BLI code a link belongs to (ROADMAP #70).
--
-- Ten pe_bli values in the PB2026 corpus are shared by TWO real programs that
-- differ only by appropriation ACCOUNT ('3010' is LPD Flight II in 1611N AND
-- Shipboard Tactical Communications in 1810N — see dim_programs.sql). Sprint E
-- Task E3 already publishes one page per member (`3010-SCN` / `3010-OPN`) and
-- makes the bare `/program/3010/` a disambiguation stub, but budget_line_awards
-- keyed a link by pe_bli alone, which names both members at once. Both link
-- scripts therefore excluded every shared key outright and those pages showed
-- no awards at all.
--
-- `account` records the ONE member a link's own evidence identifies — the
-- award's funding accounts for the FPDS path, the appropriation book the
-- lexicon narrative lives in for the announcement path. NULL means "this
-- pe_bli names exactly one program", which is true of ~1,930 of the 1,938
-- published programs: those rows behave byte-for-byte as they did before.
--
-- Deliberately NOT part of the unique constraint. A link is admitted only when
-- the evidence names exactly ONE member, so (pe_bli, exhibit, fiscal_year,
-- award_piid) still identifies at most one row; widening the key would let a
-- future loader publish the same award against both members of a shared code,
-- which is the ambiguity this column exists to remove.
alter table budget_line_awards add column if not exists account text;

comment on column budget_line_awards.account is
  'Appropriation account of the ONE program this link belongs to, for the '
  'pe_bli values shared by two programs (ROADMAP #70). NULL for every key '
  'that names a single program.';

create index if not exists budget_line_awards_pe_account_idx
  on budget_line_awards (pe_bli, account);
