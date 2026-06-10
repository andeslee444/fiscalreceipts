create table if not exists jbook_documents (
  id bigserial primary key,
  org text not null,
  exhibit_family text not null,
  fiscal_year int not null,
  title text not null,
  source_url text not null unique,
  file_path text,
  sha256 text,
  bytes bigint,
  downloaded_at timestamptz,
  has_embedded_xml boolean,
  status text not null default 'registered'
);

create table if not exists budget_lines (
  id bigserial primary key,
  exhibit text not null,
  fiscal_year int not null,
  account text not null,
  account_title text,
  organization text not null,
  budget_activity text,
  budget_activity_title text,
  line_number text,
  pe_bli text not null,
  title text,
  amount_type text not null,
  amount_thousands numeric,
  source_document_id bigint references jbook_documents(id),
  unique (exhibit, fiscal_year, account, organization, budget_activity, pe_bli, amount_type)
);

create table if not exists extraction_runs (
  id bigserial primary key,
  document_id bigint not null references jbook_documents(id),
  tier int not null,
  tool_versions jsonb not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists budget_line_details (
  id bigserial primary key,
  extraction_run_id bigint not null references extraction_runs(id),
  document_id bigint not null references jbook_documents(id),
  pe_bli text not null,
  project_number text,
  project_title text,
  scenario text not null,
  amount_millions numeric not null,
  xml_path text not null,
  reconciled boolean not null default false,
  superseded boolean not null default false
);

create table if not exists detail_narratives (
  id bigserial primary key,
  extraction_run_id bigint not null references extraction_runs(id),
  document_id bigint not null references jbook_documents(id),
  pe_bli text not null,
  project_number text,
  kind text not null,
  title text,
  body text not null,
  xml_path text not null,
  superseded boolean not null default false
);

create table if not exists reconciliation_checks (
  id bigserial primary key,
  extraction_run_id bigint not null references extraction_runs(id),
  gate text not null,
  pe_bli text not null,
  scenario text not null,
  expected numeric,
  actual numeric,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists review_queue (
  id bigserial primary key,
  check_id bigint not null references reconciliation_checks(id),
  status text not null default 'open',
  resolution text,
  resolved_at timestamptz
);

create table if not exists extraction_gaps (
  id bigserial primary key,
  document_id bigint references jbook_documents(id),
  exhibit text not null,
  pe_bli text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
