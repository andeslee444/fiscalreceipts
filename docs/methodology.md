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
*High confidence* (registry fact): the subsidiaries share one registered parent
UEI in SAM.gov, so the *grouping* is a registry fact rather than a guess.
*Medium confidence* (name inference): slightly different legal-name variants
normalize to the same string (e.g., "THE BOEING COMPANY" and "BOEING COMPANY,
THE (INC)"). Both tiers appear on screen; the method is always disclosed.

**The tier grades the grouping, never the name.** A family's label is the
registered parent name of whichever member holds the most money — an argmax
that knows nothing about how close the runner-up was, or about which
registration the registrant still uses. 15 of the 200 families we publish carry
a label that beat its runner-up by under 15%. The largest is a family that is
97% Raytheon Company obligations and was titled "ROCKWELL COLLINS AUSTRALIA PTY
LIMITED": a common registered parent name, recorded in SAM.gov, at high
confidence, and wrong — RTX had already reverted that registration. Every
family inside that margin now carries a reviewed label from a hand-curated seed
(`data-seeds/entity_display_aliases.csv`), each row recording whether it
corrects the name or merely pins the argmax winner, and the build fails if a
new one appears unreviewed. The registered name stays visible on every company
page beneath the heading, because that is the string USAspending answers to.

**Budget-to-contract links.** Connecting a budget program element to the
contracts that funded it is an inference, not a direct database join. As of
September 2026 every published link was individually hand-adjudicated: each
award's contract descriptions were investigated against the program's J-book
narratives and project titles, and every proposed program-level link was then
challenged by two independent adversarial reviewers — a link publishes as
high only if neither could refute it. *High*: affirmative program-level
evidence — the contract names a program the budget line's own J-book pages
also name, adversarially verified. *Medium*: the award drew from the same
appropriation account and was awarded by the program's agency; an
agency-and-account association, not evidence this specific program paid for
the contract. *Low*: only the account matches — never published. The earlier
automated high tier (account match plus keyword overlap) measured 9.1%
precise under this adjudication (37 of 408 confirmed) and was corrected on
2026-09-01; superseded links are retained in the correction record.

A second evidence path covers major acquisition programs. Some DoD contract
records carry an FPDS "Program, System, or Equipment" tag naming the
acquisition program (F-35, Virginia class, Sentinel). We hand-mapped every
such program (746 in our corpus; 449 mappable) to its J-book budget lines,
each mapping challenged by the same two-reviewer adversarial process, then
linked a tagged award to a specific line only when the award's own funding
accounts match that line's appropriation. FPDS-tagged awards publish at
*medium* — the tag plus a verified program mapping establish the program,
and the award's funding accounts confirm the money color, but which of a
program's several lines (production vs. modification vs. research) paid is
not provable from account data alone. A held-out study measured the earlier
"unique line" *high* tier at 34 of 60 and it was withdrawn on 2026-09-04.
Tagged awards whose funding is entirely outside the program's J-book
accounts (e.g. O&M sustainment) are not linked. The FPDS tag is DoD-entered
and sparse (well under 1% of awards, concentrated in the largest programs),
so absence of a link never means absence of spending.

A third evidence path reads the Department of Defense's own daily contract
announcements (defense.gov, archived with snapshot timestamps and SHA-256
hashes): each announcement names the contract number and describes the work,
often by program. Where an announcement's program name is one a program
element's J-book narrative itself owns (a lexicon entry carrying the verbatim
narrative quote), the pair is a candidate; every candidate is judged by an
agent reviewer and challenged by an independent adversarial reviewer, and only
links surviving both publish — at *high*, because the government named the
program and the contract in the same sentence. Announcement links
additionally require the award's funding accounts to match the line's
appropriation; awards funded only from operations and maintenance money are
not linked to research or procurement lines. Platform-support mentions,
generic services, and weak generic names are rejected by design. Each link
cites its announcement (article id, date, URL).

Scope of the announcement path, stated plainly: deterministic name matching
covered every archived announcement; an additional LLM-assisted alias pass
(decoding designators and aliases such as PATRIOT backronyms → PAC-3 or
Global Hawk → RQ-4B) covered the top 3,840 unmatched records by announced
value ($1.96T of the $2.23T residue) — 12,811 smaller records ($278B) were
not attempted. Each published link records which basis produced it.

Where the only evidence is a subaward: FSRS subaward reports describe the
work a subcontractor performs under a prime contract, and when that
description names a program the PE's own narrative owns, the prime is linked
at *medium* — the evidence is one hop removed, so it never publishes as high
and its rationale names the subaward it rests on.

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
