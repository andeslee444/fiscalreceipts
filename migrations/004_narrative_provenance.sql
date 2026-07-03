-- Phase 5F (§2b): narrative paragraph provenance.
-- provenance_pages grows a target_kind discriminator:
--   'amount'    — existing rows: page + bbox of a formatted amount string
--   'narrative' — page + bbox of a narrative paragraph's opening text
--                 (first ~12 words, whitespace-normalized; see
--                 govbudget.jbooks.provenance_pages.narrative_opening)
-- Narrative identity is (document_sha256, pe_bli, narrative_kind, xml_path) —
-- the same key fact_id_narrative hashes. scenario / amount_millions are
-- amount-row concepts and become nullable; each target_kind gets its own
-- partial unique index (replacing the old table constraint, which would have
-- collapsed all narrative rows of a PE into one NULLS-NOT-DISTINCT key).

alter table provenance_pages
  add column if not exists target_kind text not null default 'amount';
alter table provenance_pages
  add column if not exists narrative_kind text;
alter table provenance_pages
  add column if not exists xml_path text;
alter table provenance_pages alter column scenario drop not null;
alter table provenance_pages alter column amount_millions drop not null;

alter table provenance_pages
  drop constraint if exists provenance_pages_document_sha256_pe_bli_project_number_scen_key;

create unique index if not exists provenance_pages_amount_key
  on provenance_pages (document_sha256, pe_bli, project_number, scenario, amount_millions)
  nulls not distinct
  where target_kind = 'amount';

create unique index if not exists provenance_pages_narrative_key
  on provenance_pages (document_sha256, pe_bli, narrative_kind, xml_path)
  where target_kind = 'narrative';

-- Shape guard: amount rows keep their identity columns; narrative rows must
-- carry their locator. A row satisfying neither arm is a bug — fail loud.
alter table provenance_pages add constraint provenance_pages_kind_shape check (
  (target_kind = 'amount' and scenario is not null and amount_millions is not null)
  or
  (target_kind = 'narrative' and narrative_kind is not null and xml_path is not null)
);
