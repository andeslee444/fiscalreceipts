/*
  Singular data test — WARN (not ERROR) severity.
  Returns rows from the raw subaward lake where subaward_amount > $50 B.

  A non-empty result means absurd outliers are present in the source data.
  These are reporting artefacts (e.g. CPI SATCOM $39.16 T row in FY2024).
  We WARN rather than ERROR so the pipeline is not blocked by upstream data
  quality issues outside our control; stg_subawards quarantines them via the
  is_amount_suspect flag.

  Severity is set in sources.yml / schema.yml via `config(severity='warn')`.
  This file returning rows will surface as a dbt WARN in CI, not a failure.
*/
{{ config(severity='warn') }}

select
    prime_award_unique_key,
    subawardee_name,
    try_cast(subaward_amount as double)    as subaward_amount,
    try_cast(prime_award_amount as double) as prime_award_ceiling,
    subaward_action_date,
    fy
from {{ source('lake', 'subawards') }}
where try_cast(subaward_amount as double) > 50000000000  -- $50 B
