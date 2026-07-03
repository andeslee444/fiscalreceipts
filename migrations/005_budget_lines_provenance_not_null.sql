-- Phase 5E Task 5 improvements: budget_lines provenance structural invariant.
--
-- Every budget_lines row must trace to a source document — the same
-- contract the lake export (export_facts.py) and the fct_decade_series
-- detail rule already enforce downstream. The live warehouse carried
-- exactly one legacy orphan (id 13541, a title-NULL duplicate of live row
-- 3724, the PB2026 0601101E fy_2024_actuals row from an early 5C load;
-- nothing references budget_lines.id by FK), which verify-phase5e gate b
-- reported as unjoined=1 (informational). Delete it and make the column
-- NOT NULL so a provenance-less row can never be inserted again; the
-- loaders now require source_document_id as a mandatory kwarg to match.
delete from budget_lines where source_document_id is null;

alter table budget_lines alter column source_document_id set not null;
