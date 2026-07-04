# Phase 5G Task 4 — Navy procurement Gate B account-scoping fix

**Date:** 2026-07-04
**Trigger:** live Navy FY2026 ingestion surfaced 17 failed Gate B checks per
procurement document (204 total across the 12 procurement books).

## Root cause — a real display-data keying collision, not a reconcile bug

The Navy P-1 **line number** is unique only *within an appropriation account*,
not across org N. Two distinct weapons share line number `2210`:

- account `1507N` — "Joint Advance Tactical Missile (JATM)", FY2026 = 301,858K
- account `1810N` — "Submarine Acoustic Warfare System", FY2026 = 56,482K

Gate B (`reconcile.py`) summed **all** `budget_lines` rows sharing `pe_bli`
regardless of account → 358.34M, then compared against a single XML detail
item's 56.482M → false FAIL. Exactly 11 P-1 line numbers collide across
accounts in org N FY2026 (6 land in the loaded P-40 detail set): 0145, 1045,
1350, 2101, 2210, 2292, 3010, 3050, 3215, 3302, 4217. PriorYear/CurrentYear
mostly passed because the colliding sibling item was new in FY2026 (no
FY2024/2025 rows); BudgetYearOne/Base failed where both siblings carry a
FY2026 request.

The defense-wide FY2024–FY2026 corpus never hit this because those books use
globally-unique BLI codes; Navy's appropriation-code naming reuses P-1 line
numbers across accounts.

## Fix — account-scoped Gate B lookup (NOT re-keying)

Chosen over extending the legacy `era_procurement_key` namespacing to modern
editions, which would have re-keyed ~8,900 modern procurement detail rows
across every defense-wide org, breaking byte-identity regressions and
cascading through crosswalk/marts/exports/`/program/{pe_bli}/` URLs.

The account is the genuine disambiguator and is already available:
`p40_parser.ProcurementLineRecord.appropriation_number` equals
`budget_lines.account` byte-for-byte (verified live: XML `1810N` == account
`1810N`). So `(pe_bli, account)` disambiguates without touching stored keys.

Changes (TDD):
- **migration `007_budget_line_details_account.sql`** — add nullable `account`
  to `budget_line_details`.
- **`load_details.load_procurement_details`** — write `li.appropriation_number`
  into `account`. R-1/RDT&E (`load_document_details`) leaves it NULL.
- **`reconcile.reconcile_document` Gate B** — when the detail row carries an
  account, add `and account=%s` to both the consolidated and per-org
  `budget_lines` control lookups. When `account IS NULL` (R-1, era rows), the
  prior cross-account sum stands — split-BA R-1 rows still sum.

## Proof-can-fail (TDD red → green)

`tests/jbooks/test_reconcile.py::test_gate_b_procurement_scopes_control_lookup_by_account`
seeds the exact collision (two P-1 rows, pe_bli 2210, accounts 1507N/1810N;
one 1810N detail at 56.482M). BEFORE the reconcile change it FAILED with the
production signature:

    AssertionError: account-scoping should match 1810N alone:
      (False, Decimal('358.34'), 'P-1 fy_2026_disc_request=358.34M vs XML BudgetYearOne=56.482M')

AFTER the change it PASSES (expected == 56.482M, the 1810N control alone).
Guard `test_gate_b_procurement_account_mismatch_still_fails` proves scoping
does not rubber-stamp (a genuinely divergent account control still FAILS).
Back-compat `test_gate_b_null_account_keeps_cross_account_sum` proves R-1
details (account NULL) keep the split-BA cross-account sum.

## Live result

Re-extract of all 13 Navy docs after migration 007:
- every procurement doc: **540 passed / 0 failed / 0 queued** (was 523/17/17)
- RDTE doc 340: 2268 passed / 0 failed (unchanged — no R-1 collision)
- global `accuracy_gate.silent_unreconciled = 0`; **0 failed Navy checks**
- procurement detail rows carry `account`; RDTE rows correctly NULL

---

# Second finding — procurement BA-splits ALSO embed one master (12× dup)

Task 3's dedup (`dedup_rdte_ba_splits`) assumed only RDTE BA-split PDFs share
a master and passed procurement through untouched. Live evidence disproves it:
ALL 12 Navy procurement PDFs (APN×3, OPN×5, WPN, SCN, PMC, PANMC) embed the
IDENTICAL full procurement master XML (single sha `916f4283…`, 135 line items).
So the procurement master was loaded **12×** → 8,100 detail rows / 3,156
narratives for only 675 / 263 real facts (12.0× warehouse + lake pollution).

**Fix:** generalized `dedup_rdte_ba_splits` → `dedup_ba_splits`, which dedups
BOTH families (`_MASTER_DUP_FAMILIES = ('rdte','procurement')`) to one book per
family. Winner = lowest starting BA (RDTEN_BA1-3, APN_BA1-4). Manifest rule
renamed `rdte-ba-split-duplicate` → `ba-split-duplicate`; the old label stays
accepted in `record_service_exclusions` for the on-disk manifest. TDD:
`test_dedup_ba_splits_keeps_lowest_ba_per_family`.

**Live cleanup:** the 12× rows were already loaded before the fix. The
duplicate detail/narrative rows on the 11 non-winner procurement docs were
marked `superseded` (the pipeline's native dedup flag — NON-destructive), so
the lake/citation exports (all `where not superseded`) now carry the correct
675 procurement facts. **Pending:** the 11 non-winner `jbook_documents` rows
still exist (`status='downloaded'`) — they appear in `documents.parquet` and
would be re-loaded by a future `jbooks extract`. Removing them needs a
targeted DELETE, which the destructive-write guardrail blocked in this run;
recorded as a follow-up requiring authorization (or a clean re-`backfill`
after the 11 are deleted).

# Third finding — page provenance is per-BA-PDF; deduped BAs have no page

Each BA-split PDF renders R-2/R-2A/P-40 exhibit pages ONLY for its own budget
activities. Deduping to one PDF per family (correct for detail loading, since
the embedded XML carries every fact) means facts whose exhibit page lives in a
deduped-away sibling PDF cannot resolve to a page → `resolution='unresolved'`
(honest, no faked location). Live: amount 28 unique + 380 ambiguous of 5,810
(zero_amount 1,398, unresolved 4,004); narrative 339 unique + 122 ambiguous of
2,066 (unresolved 1,605). Every fact still carries full document+xml_path
provenance; only the page highlight is absent for deduped-away BAs.

Adjacent fix (kept regardless): `amount_strings` now also emits the
THOUSANDS-integer rendering (`15,218` for 15.218M) because Navy comptroller
pages render dollars in thousands while defense-wide renders millions.
Additive — millions tried first, so DW resolution is byte-identical. TDD:
`test_amount_strings`.

Cross-sibling page resolution (attributing a fact to whichever sibling PDF
renders its page) is a citation-model re-architecture — four consumers
(`export_site.py` details↔provenance join, citation fid filter, hosted-sha
URL; `verify_phase5b1` orphan gate) require
`provenance.document_sha256 == detail.sha256`. Out of scope; recorded as an
honest coverage gap (mirrors the existing RDTE model).
