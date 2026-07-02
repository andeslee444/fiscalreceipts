/*
  Staging model for USAspending subaward bulk-download data.

  SANITY GUARD — is_amount_suspect flag
  ──────────────────────────────────────
  The raw lake contains known data-entry outliers where the reported subaward
  amount far exceeds the prime award ceiling (e.g. a CPI SATCOM subaward filed
  as $39.16 T against a $23 M prime in FY2024, and two ~$500 B BAE/Universal
  Avionics rows in FY2020/2024).  These are reporting artefacts, not real spend.

  Rather than silently dropping them, we QUARANTINE them with a boolean flag so
  downstream consumers can filter or surface them explicitly:

    • is_amount_suspect = TRUE when EITHER:
        (a) subaward_amount > prime_award_amount  (subaward exceeds its own prime), OR
        (b) subaward_amount > 50,000,000,000      ($50 B hard cap — no single
            US federal subaward has legitimately crossed this threshold)

  Rows where is_amount_suspect = TRUE should be EXCLUDED from aggregate marts
  (spend totals, entity roll-ups, etc.) and can be surfaced in a separate audit
  view if needed.  The flag is preserved in this model so the reason is auditable.
*/
select
    prime_award_unique_key,
    try_cast(subaward_amount as double)     as subaward_amount,
    try_cast(prime_award_amount as double)  as prime_award_ceiling,
    try_cast(subaward_action_date as date)  as subaward_action_date,
    cast(fy as integer)                     as fiscal_year,
    nullif(subawardee_uei, '')              as subawardee_uei,
    upper(subawardee_name)                  as subawardee_name,

    -- Quarantine flag: TRUE means this row is a suspected data-entry error and
    -- must NOT be included in spend aggregations.  See model comment for rationale.
    (
        try_cast(subaward_amount as double) > 50000000000  -- $50 B hard cap
        or (
            try_cast(subaward_amount  as double) is not null
            and try_cast(prime_award_amount as double) is not null
            and try_cast(subaward_amount as double) > try_cast(prime_award_amount as double)
        )
    ) as is_amount_suspect

from {{ source('lake', 'subawards') }}
