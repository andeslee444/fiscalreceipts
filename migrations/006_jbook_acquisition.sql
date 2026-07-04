-- Phase 5G: record how each J-book document was acquired.
--
-- Comptroller (defense-wide) books are fetched over plain HTTPS; the service
-- books require a real browser (Navy, behind a bot-WAF) or a human download
-- (Army/Air Force, behind Akamai/CAC). Recording the acquisition method makes
-- provenance auditable and lets the manual drop-dir path (ingest-local) carry
-- an operator-supplied source URL distinct from an automated fetch.
--
--   'http'       — httpx fetch from comptroller.war.gov (default; existing rows)
--   'playwright'  — headless-browser fetch through the Navy WAF
--   'manual'      — operator drop-dir (Army/Air Force); source_url is operator-supplied
alter table jbook_documents
  add column if not exists acquisition text not null default 'http';
