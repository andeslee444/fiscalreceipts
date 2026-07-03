-- Binding (ii), adversarial review 2026-07-03: era (PB2017–PB2023)
-- procurement pe_bli ('{account}-{org}-L{line}' namespaced keys,
-- era_keys.py) must NEVER appear in fct_book_diff — the underlying
-- (account, org, line) identity is unstable across editions, so both
-- era-to-modern and within-era procurement diffs are an honest gap.
-- The classified-programs display aggregate is likewise not a program
-- identity and must not diff.
select pe_bli, from_edition, to_edition, diff_kind
from {{ ref('fct_book_diff') }}
where regexp_matches(pe_bli, '^[0-9]{4}[A-Z]-[A-Z]+-L')
   or pe_bli = '9999999999'
