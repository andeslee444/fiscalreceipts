-- Phase 5B-1: PDF page/bbox resolution per J-book fact, and workbook
-- cell provenance for R-1/P-1 rollup facts.
-- Identity INCLUDES the amount: live data has duplicate
-- (sha, pe_bli, project, scenario) keys with different amounts.

create table if not exists provenance_pages (
  id bigserial primary key,
  document_sha256 text not null,
  pe_bli text not null,
  project_number text,
  scenario text not null,
  amount_millions numeric not null,
  amount_text text not null,          -- formatted string searched, e.g. '280.494'
  page_number int,                    -- 1-based PDF page; null when unresolved
  x0 numeric, x1 numeric,             -- pdfplumber coords, points
  top_pt numeric, bottom_pt numeric,  -- y from PAGE TOP (pdfplumber convention)
  page_width numeric, page_height numeric,
  resolution text not null,           -- 'unique' | 'ambiguous_first' | 'zero_amount' | 'unresolved'
  candidate_pages int not null default 0,
  built_at timestamptz not null default now(),
  unique nulls not distinct
    (document_sha256, pe_bli, project_number, scenario, amount_millions)
);

-- R-1: one cell per fact; P-1/P-1R: list of contributing 'Add' sub-row cells.
alter table budget_lines add column if not exists source_sheet text;
alter table budget_lines add column if not exists source_cells text[];
