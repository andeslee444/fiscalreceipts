create table if not exists budget_line_awards (
  id bigserial primary key,
  pe_bli text not null,
  exhibit text not null,
  fiscal_year int not null,
  organization text not null,
  award_piid text not null,
  recipient_name text,
  recipient_uei text,
  matched_obligation numeric,
  method text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  score numeric,
  rationale text,
  created_at timestamptz not null default now(),
  unique (pe_bli, exhibit, fiscal_year, award_piid)
);
