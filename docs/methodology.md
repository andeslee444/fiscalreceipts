# Methodology

**Last updated:** 2026-09-01

---

## 1. What this is

GovBudget connects four things that live in separate government silos: what
agencies said money was for (budget documents), what was actually obligated and
to whom (federal and state spending records), who ultimately received it
(contractors, grantees, and their corporate parents), and what auditors said
about it (GAO findings, improper-payment estimates). Every number on this site
carries a citation to the exact source document, page, or API endpoint it came
from. If we cannot cite it, we do not publish it.

---

## 2. Where every number comes from

**Federal awards — USAspending.gov.** The official federal award database
(contracts, grants, loans, and subawards), mandated by the DATA Act. We
download bulk archive ZIP files from `files.usaspending.gov/award_data_archive/`,
convert them to compressed Parquet, and record the exact file name, URL, and
SHA-256 hash of every file. Current scope: Department of Defense agencies,
FY2017 onward. Update cadence: monthly (USAspending publishes new full-archive
files on a monthly cycle).

**DoD budget justification books ("J-books").** The detailed budget submissions
the Pentagon sends to Congress each spring, published at
`comptroller.defense.gov`. These cover every research and development program
(R-2 exhibits) and procurement budget line (P-40 exhibits) with program
narratives, project-level cost tables, and congressional justifications.

The Pentagon's budget system embeds its own database inside these PDFs: the
full structured XML that generated the PDF is attached as a file inside the PDF
itself. We extract that XML directly rather than re-reading numbers from the
printed pages. A FY2026 DARPA justification book, for example, contains a
1.5 MB XML attachment with every program element, project, cost figure, and
narrative. For the rare document that lacks an XML attachment, we use a
deterministic PDF parser as a fallback, with an accuracy gate that requires
≥98% numeric-field agreement against XML-backed ground truth before that path
is trusted.

We also download the comptroller's official R-1 and P-1 Excel rollups, which
list every program element and budget line item with FY dollar figures. The
FY2026 R-1 workbook contains 1,143 PE/BLI rows. These serve as the independent
control totals that every extracted figure is checked against. Update cadence:
annual, with each February President's Budget release.

**Improper-payment estimates — paymentaccuracy.gov.** Agencies are legally
required to estimate and report payment-error rates. The dollar exposure figure
we show per agency — the estimated improper dollar amount — is derived by
multiplying the published rate by the published outlay figure. The federal
government reported approximately $186 billion in improper payments in FY2025.
This is a derived estimate and is labeled as such. Update cadence: annual.

**GAO high-risk list — gao.gov/high-risk-list.** The GAO's biennial list of
federal programs at high risk for fraud, waste, or mismanagement. We collect
each area's title and its link in the current GAO report. Update cadence:
biennial.

**Senate lobbying disclosures — lda.senate.gov.** The Senate Lobbying
Disclosure Act database (`lda.senate.gov/api/v1`) contains filings
for 2025 and prior years, each with a permanent UUID, registrant, client
company, dollar amounts, agencies lobbied, and issue text. We link LDA client
names to our company-family database and match each filing's issue text
against our program titles for keyword co-occurrence — never a claim that the
filing names the program. A mention qualifies only when the exact PE/BLI code
appears, a curated alias appears, or at least two distinct, non-generic title
words co-occur in the same filing; each row of the `fct_program_lobbying`
dataset records which tier it qualified under (`evidence_kind`). The current
mention count is derived from that dataset on every build and published on the
live methodology page rather than restated here as a fixed number: an earlier
revision of this document said "32,780 program mentions across 245 programs",
a count produced by a since-withdrawn method that accepted a single shared
common word as a match (correction 34,538 → 10,560, recorded in the site's
corrections table). As of the 2026-08-31 build, the mart holds 14,016
evidence-tiered mention rows across 499 program elements. Lobbying income and
expenditure by year are shown alongside federal obligations received —
influence is presented side by side with outcomes, never as a causal claim.

**State checkbooks — California and Connecticut (pilot).** California's Open
Fi$Cal and Connecticut's OpenCheckbook publish transaction-level government
spending. We aggregate by department, spending category, and fiscal year, and
use Census Bureau population estimates (NST-EST series) for per-capita
comparisons. The category mappings that bridge both states' classification
systems are published alongside the data.

---

## 3. How we verify

**Reconciliation.** Every figure extracted from a J-book clears two arithmetic
checks. Check A: project-level amounts within an exhibit must sum to the
program-element total in that same exhibit (tolerance: ±$0.001M). Check B:
that program-element total must match the corresponding row in the official R-1
or P-1 Excel rollup for the same program, appropriation, and fiscal year.
Failures do not get published — they go to a human review queue. No
unreconciled figure is served without a visible flag.

**Zero-absent rule.** When a program has no funding for a given fiscal year,
the official rollup workbook simply omits the row (an absent row means zero).
Our reconciliation code recognizes this so zero-funded programs are not
incorrectly flagged as failures.

**Coverage gate.** At least 99% of R-1 program elements must have either
extracted detail or an explicit gap record. Silent holes — program elements
with no record of any kind — are a build failure.

**Provenance spot-check.** Each build randomly samples 50 served facts and
mechanically verifies that the cited source document exists on disk, its
SHA-256 matches the download manifest, and the XML element path resolves to a
real node in that document. A number whose citation chain breaks does not
render.

**Per-build automated checks.** A Python test suite and a browser test suite
both run green before any build ships, alongside the site verification gates
and the dbt data-model assertions. The counts of gates, assertions, and
evaluation questions are derived on every build from the artifacts that
define them — dbt's compiled manifest, the `verify.mjs` gate registry, and
the eval set with the gate's own threshold constant — and published in §3 of
the live methodology page; this document does not pin them (an earlier
revision's "197 test functions, 21 dbt assertions, 45 eval pairs, ≥41
correct" had all drifted). As of the 2026-08-31 build: 24 site verification
gates, 99 dbt data-model assertions, and a 48-question analyst-agent
evaluation set requiring at least 44 correct answers and 100% citation
resolution before shipping.

---

## 4. How confident to be

**Company families — registry fact vs. name inference.** When we say a company
received a total figure across its subsidiaries, we rely on one of two methods.
*High confidence* (registry fact): SAM.gov records a common registered parent
name for the subsidiaries. *Medium confidence* (name inference): slightly
different legal-name variants normalize to the same string (e.g., "THE BOEING
COMPANY" and "BOEING COMPANY, THE (INC)"). Both tiers appear on screen; the
method is always disclosed.

**Budget-to-contract links.** Connecting a budget program element to the
contracts that funded it is an inference, not a direct database join. We use
three tiers. *High*: the award's federal account code matches the budget line's
appropriation, and program-title keywords overlap substantially between the
budget document and the contract description. *Medium*: account matches and the
contracting sub-agency matches the budget organization. *Low*: only the account
matches. Low-tier links are useful for exploring which contracts drew from a
given appropriation but are not evidence of a program-to-program connection.

**Derived figures are labeled derived.** Any figure computed from published
rates or published subtotals — rather than directly reported in a source
document — is labeled as derived wherever it appears.

---

## 5. Known limitations

**FY attribution is approximate.** Contracts execute across multiple fiscal
years; our current method assigns links based on which fiscal years' award
transactions share the same federal account code. A multi-year contract may be
partially attributed to a budget line it does not fully correspond to.

**Losing bidders are not in federal data.** FPDS records how many offers were
received for a competed contract but does not name unsuccessful bidders. We
show offer counts and competition type; we do not name losing bidders.

**Company family grouping by name inference can err.** Acquired, divested, or
renamed subsidiaries may be grouped incorrectly. Method and confidence are
always exposed. Corrections create superseding records; the original is
retained, not deleted.

**Improper-payment dollar figures are derived.** They are computed from
OMB-published rates times published outlays and carry the same uncertainty as
the underlying rate estimates.

**State comparables depend on category mappings.** Mapping two states'
accounting codes to shared categories involves judgment. We publish the mapping
tables; treat cross-state comparisons as directional.

**Classified programs are absent.** DoD classified budget lines are not in
public J-books or USAspending. Our figures do not cover classified spending.

**Data-as-of dates vary by source.** USAspending updates monthly; GAO
high-risk is biennial; J-books are annual. Every table shows a "data as of"
date. Numbers on the same page may reflect different time periods.

---

## 6. Corrections

If you find a number that appears wrong, send us the citation that contradicts
it and we will investigate. We follow a supersede-not-delete policy: a
corrected record is marked superseded and a new record takes its place. The old
record is retained and accessible. Permalinks continue to resolve permanently;
they show the current best value alongside the correction history if one exists.

---

## 7. Cite us / bulk data

When citing a specific figure, include the source citation displayed alongside
it: document title, fiscal year, page or XML element path, and the date we
retrieved the file. USAspending-derived figures cite the archive file name and
SHA-256 hash; J-book figures cite the PDF title, page number, and XML element
path.

Bulk data exports (Parquet files with data dictionaries) are available for
researchers and include the same provenance metadata that backs every on-screen
figure. Contact us for access or consult the project repository for the export
schema.
