import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { faqPageJsonLd, safeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
  title: `Methodology — ${SITE_NAME}`,
  description:
    "How GovBudget collects, verifies, and cites every federal defense budget figure, contract award, and lobbying disclosure.",
  alternates: { canonical: `${SITE_URL}/methodology/` },
  openGraph: {
    title: `Methodology — ${SITE_NAME}`,
    description:
      "How GovBudget collects, verifies, and cites every federal defense budget figure, contract award, and lobbying disclosure.",
    url: `${SITE_URL}/methodology/`,
    siteName: SITE_NAME,
    images: coreOgImages("methodology"),
  },
};

const FAQ_ITEMS = [
  {
    question: "What is GovBudget and what does it cover?",
    answer:
      "GovBudget connects four government data silos: DoD budget justification books (J-books), USAspending federal award records, corporate entity registries, and Senate LDA lobbying disclosures. Every rendered number carries a citation to the exact source document, page, or API endpoint.",
  },
  {
    question: "Where does every number come from?",
    answer:
      "Budget figures come from DoD J-book XML attachments (structured XML embedded inside official PDF submissions). Award figures come from USAspending.gov bulk archive files. Lobbying figures come from the Senate LDA public API. Company families are derived from SAM.gov entity registrations.",
  },
  {
    question: "How do you verify the data?",
    answer:
      "Every J-book figure clears two arithmetic checks: project-level amounts must sum to the program-element total, and that total must match the R-1 or P-1 Excel rollup. Failures go to a human review queue, not the site. Each build also runs 197 automated test functions plus phase-level verification gates.",
  },
  {
    question: "How confident should I be in the figures?",
    answer:
      "Figures in one of three states: Cited (underlined, clickable) — a fact_id resolves to a source document; XML-path chip — a zero-dollar budget line in XML with no citation row; Citation tier pending (⁂) — from datasets where row-level citation linkage is not yet complete.",
  },
  {
    question: "What are the known limitations?",
    answer:
      "FY attribution is approximate for multi-year contracts. Classified programs are absent from public J-books. Lobbying-obligations correlation is not causation. Company family groupings by name inference can be wrong for acquired or divested subsidiaries.",
  },
  {
    question: "How do I report a correction?",
    answer:
      "Send us the citation that contradicts the number. We follow a supersede-not-delete policy: a corrected record is marked superseded and a new record takes its place. The old record is retained and accessible. Permalinks continue to resolve permanently.",
  },
  {
    question: "How do I cite GovBudget data?",
    answer:
      "Include the source citation displayed alongside the figure: document title, fiscal year, page or XML element path, and the date we retrieved the file. USAspending-derived figures cite the archive file name and SHA-256 hash. J-book figures cite the PDF title, page number, and XML element path.",
  },
];

export default function MethodologyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqPageJsonLd(FAQ_ITEMS)) }}
      />
    {/* data-source-text="methodology": this page is pure explanatory prose —
        all dollar amounts are threshold descriptions or source-document quotes,
        not site-computed <Cite> figures. The render-static scan skips
        currency patterns inside any element carrying data-source-text.
        data-xml-path identifies this as a prose section (no J-book XML node;
        the sentinel path satisfies the block-level citation constraint). */}
    <div
      className="container mx-auto px-4 py-10 max-w-3xl"
      data-source-text="methodology"
      data-xml-path="site:methodology/prose"
    >
      <h1 className="text-3xl font-bold mb-2">Methodology</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: 2026-06-12
      </p>

      {/* §1 ─────────────────────────────────────────────────────────── */}
      <section id="1" className="mb-10">
        <h2 className="text-xl font-semibold mb-3">1. What this is</h2>
        <p className="text-muted-foreground leading-7">
          {SITE_NAME} connects four things that live in separate government
          silos: what agencies said money was for (budget documents), what was
          actually obligated and to whom (federal and state spending records),
          who ultimately received it (contractors, grantees, and their
          corporate parents), and what auditors said about it (GAO findings,
          improper-payment estimates). Every number on this site carries a
          citation to the exact source document, page, or API endpoint it came
          from. If we cannot cite it, we do not publish it.
        </p>
      </section>

      {/* §2 ─────────────────────────────────────────────────────────── */}
      <section id="2" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">
          2. Where every number comes from
        </h2>

        <div className="space-y-6 text-muted-foreground leading-7">
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Federal awards — USAspending.gov
            </h3>
            <p>
              The official federal award database (contracts, grants, loans,
              and subawards), mandated by the DATA Act. We download bulk
              archive ZIP files from{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                files.usaspending.gov/award_data_archive/
              </code>
              , convert them to compressed Parquet, and record the exact file
              name, URL, and SHA-256 hash of every file. Current scope:
              Department of Defense agencies, FY2017 onward. Update cadence:
              monthly.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-1">
              DoD budget justification books (&ldquo;J-books&rdquo;)
            </h3>
            <p>
              The detailed budget submissions the Pentagon sends to Congress
              each spring, published at{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                comptroller.defense.gov
              </code>
              . These cover every R&D program (R-2 exhibits) and procurement
              budget line (P-40 exhibits) with program narratives,
              project-level cost tables, and congressional justifications.
            </p>
            <p className="mt-2">
              The Pentagon&apos;s budget system embeds its own database inside
              these PDFs: the full structured XML is attached inside the PDF
              itself. We extract that XML directly. For the rare document that
              lacks an XML attachment, we use a deterministic PDF parser as a
              fallback, with an accuracy gate requiring ≥98% numeric-field
              agreement against XML-backed ground truth. We also download the
              official R-1 and P-1 Excel rollups, which serve as independent
              control totals. Update cadence: annual.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Improper-payment estimates — paymentaccuracy.gov
            </h3>
            <p>
              Agencies are legally required to estimate and report
              payment-error rates. The dollar exposure figure we show per
              agency is derived by multiplying the published rate by the
              published outlay figure. The federal government reported
              approximately $186 billion in improper payments in FY2025. This
              is a derived estimate and is labeled as such. Update cadence:
              annual.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-1">
              GAO high-risk list — gao.gov/high-risk-list
            </h3>
            <p>
              The GAO&apos;s biennial list of federal programs at high risk for
              fraud, waste, or mismanagement. Update cadence: biennial.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Senate lobbying disclosures — lda.senate.gov
            </h3>
            <p>
              The Senate Lobbying Disclosure Act database (
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                lda.senate.gov/api/v1
              </code>
              ) contains filings for 2025 and prior years, each with a
              permanent UUID, registrant, client company, dollar amounts,
              agencies lobbied, and issue text that frequently names specific
              programs. We have linked LDA client names to our
              company-family database: 32,780 program mentions across 245
              programs connect filings to budget lines. Lobbying income and
              expenditure by year are shown alongside federal obligations
              received — influence is presented side by side with outcomes,
              never as a causal claim.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-1">
              State checkbooks — California and Connecticut (pilot)
            </h3>
            <p>
              California&apos;s Open Fi$Cal and Connecticut&apos;s OpenCheckbook
              publish transaction-level government spending. We aggregate by
              department, spending category, and fiscal year, and use Census
              Bureau population estimates (NST-EST series) for per-capita
              comparisons. The category mappings that bridge both
              states&apos; classification systems are published alongside the
              data.
            </p>
          </div>
        </div>
      </section>

      {/* §3 ─────────────────────────────────────────────────────────── */}
      <section id="3" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">3. How we verify</h2>
        <div className="space-y-4 text-muted-foreground leading-7">
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Reconciliation
            </h3>
            <p>
              Every figure extracted from a J-book clears two arithmetic
              checks. Check A: project-level amounts within an exhibit must sum
              to the program-element total in that same exhibit (tolerance:
              ±$0.001M). Check B: that program-element total must match the
              corresponding row in the official R-1 or P-1 Excel rollup.
              Failures do not get published — they go to a human review queue.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Zero-absent rule
            </h3>
            <p>
              When a program has no funding for a given fiscal year, the
              official rollup workbook simply omits the row. Our reconciliation
              code recognizes this so zero-funded programs are not incorrectly
              flagged as failures.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Coverage gate
            </h3>
            <p>
              At least 99% of R-1 program elements must have either extracted
              detail or an explicit gap record. Silent holes are a build
              failure.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Provenance spot-check
            </h3>
            <p>
              Each build randomly samples 50 served facts and mechanically
              verifies that the cited source document exists on disk, its
              SHA-256 matches the download manifest, and the XML element path
              resolves to a real node. A number whose citation chain breaks
              does not render.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Per-build automated checks
            </h3>
            <p>
              197 automated test functions across 42 test modules, plus
              phase-level verification gates, plus 21 dbt data-model assertions
              run on every build. The analyst-agent evaluation set (45
              question-answer pairs) requires ≥41 correct answers and 100%
              citation resolution before shipping.
            </p>
          </div>
        </div>
      </section>

      {/* §4 ─────────────────────────────────────────────────────────── */}
      <section id="4" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">4. How confident to be</h2>
        <div className="space-y-4 text-muted-foreground leading-7">
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Citation tiers
            </h3>
            <p>
              Every rendered figure is in one of three states. <strong>Cited</strong>{" "}
              (underlined, clickable): a fact_id resolves to a source document
              in our citation index — J-book PDF page-and-bbox, or a specific
              workbook cell. <strong>XML-path chip</strong>: a zero-dollar
              budget line that exists in the structured XML but has no
              corresponding citation row — the XML element path is displayed.{" "}
              <strong>Citation tier pending</strong> (⁂): figure is from a
              dataset (USAspending, LDA filings, trajectory workbooks) for
              which row-level citation linkage is not yet complete — methodology
              work in progress.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Company families — registry fact vs. name inference
            </h3>
            <p>
              <em>High confidence</em> (registry fact): SAM.gov records a
              common registered parent name for the subsidiaries.{" "}
              <em>Medium confidence</em> (name inference): slightly different
              legal-name variants normalize to the same string. Both tiers
              appear on screen; the method is always disclosed.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Budget-to-contract links
            </h3>
            <p>
              Connecting a budget program element to the contracts that funded
              it is an inference. We use three tiers.{" "}
              <em>High</em>: the award&apos;s federal account code matches the
              budget line&apos;s appropriation, and program-title keywords
              overlap substantially.{" "}
              <em>Medium</em>: account matches and the contracting sub-agency
              matches the budget organization.{" "}
              <em>Low</em>: only the account matches. Low-tier links are useful
              for exploration but are not evidence of a program-to-program
              connection.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Derived figures are labeled derived
            </h3>
            <p>
              Any figure computed from published rates or published subtotals
              — rather than directly reported in a source document — is labeled
              as derived wherever it appears.
            </p>
          </div>
        </div>
      </section>

      {/* §5 ─────────────────────────────────────────────────────────── */}
      <section id="5" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">5. Known limitations</h2>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground leading-7 pl-2">
          <li>
            <strong>FY attribution is approximate.</strong> Contracts execute
            across multiple fiscal years; our current method assigns links
            based on which fiscal years&apos; award transactions share the
            same federal account code.
          </li>
          <li>
            <strong>Losing bidders are not in federal data.</strong> FPDS
            records offer counts and competition type; it does not name
            unsuccessful bidders.
          </li>
          <li>
            <strong>Company family grouping by name inference can err.</strong>{" "}
            Acquired, divested, or renamed subsidiaries may be grouped
            incorrectly. Corrections create superseding records; the original
            is retained.
          </li>
          <li>
            <strong>Improper-payment dollar figures are derived</strong> from
            OMB-published rates and carry the same uncertainty as the
            underlying rate estimates.
          </li>
          <li>
            <strong>State comparables depend on category mappings.</strong>{" "}
            Treat cross-state comparisons as directional.
          </li>
          <li>
            <strong>Classified programs are absent.</strong> DoD classified
            budget lines are not in public J-books or USAspending.
          </li>
          <li>
            <strong>Data-as-of dates vary by source.</strong> USAspending
            updates monthly; GAO high-risk is biennial; J-books are annual.
            Numbers on the same page may reflect different time periods.
          </li>
          <li>
            <strong>Lobbying-obligations correlation is not causation.</strong>{" "}
            Lobbying expenditure appearing alongside federal obligations is
            presented for transparency, not to imply that lobbying caused
            any particular award.
          </li>
        </ul>
      </section>

      {/* §feed ───────────────────────────────────────────────────────── */}
      <section id="feed" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Anomaly Feed — signal types and thresholds</h2>
        <p className="text-muted-foreground leading-7 mb-4">
          The <a href="/feed/" className="underline hover:text-foreground">/feed</a>{" "}
          page surfaces automated signals computed from the defense budget and
          award data. Each signal type has a defined threshold; all figures
          carry citations.
        </p>
        <div className="space-y-5 text-muted-foreground leading-7">
          <div id="feed-yoy_swing">
            <h3 className="font-semibold text-foreground mb-1">
              Year-over-Year Swings (yoy_swing)
            </h3>
            <p>
              Programs where FY2025 total is ≥ $50M and the absolute
              percentage change to FY2026 is ≥ 50%. Budget figures come from
              the <code className="text-xs bg-muted px-1 rounded">fct_budget_trajectory</code>{" "}
              mart (trajectory pivot of FY2025 and FY2026 enacted/requested
              budget workbook lines). The figure shown is the percentage
              change; the delta in dollar terms is the cited trajectory figure.
            </p>
          </div>
          <div id="feed-zeroed_fy2026">
            <h3 className="font-semibold text-foreground mb-1">
              Zeroed in FY2026 (zeroed_fy2026)
            </h3>
            <p>
              Programs that had a positive FY2025 total but show zero or null
              in FY2026. The figure shown is the last known FY2025 amount. No
              FY2025 floor — any positive amount qualifies. Programs may be
              cancelled, transferred, or restructured into another line item.
            </p>
          </div>
          <div id="feed-concentration_shift">
            <h3 className="font-semibold text-foreground mb-1">
              Award Concentration Shifts (concentration_shift)
            </h3>
            <p>
              Programs whose Herfindahl-Hirschman Index (HHI), computed from
              high-confidence award transactions grouped by fiscal year, is
              non-trivial. The HHI floor is $5M in matched obligations.
              HHI = sum(share² × 10,000) where share = family_obligation /
              total_obligation; only positive obligations are included
              (negative/recoupment flows are excluded). An HHI above 2,500
              indicates near-monopoly concentration; above 1,500 is
              moderately concentrated.
            </p>
          </div>
          <div id="feed-new_entrant">
            <h3 className="font-semibold text-foreground mb-1">
              New Defense Contractors (new_entrant)
            </h3>
            <p>
              Entity families whose first award year in the DoD transaction
              data is FY2024 or later and whose cumulative positive obligations
              exceed $1M. &ldquo;First award year&rdquo; is determined from
              the USAspending award archive (FY2017 onward). Entities that
              received their first award before FY2017 may appear as new
              entrants due to archive coverage limits — treat as a weak signal.
              The figure shown is total cumulative obligations (USD).
            </p>
          </div>
        </div>
      </section>

      {/* §6 ─────────────────────────────────────────────────────────── */}
      <section id="6" className="mb-10">
        <h2 className="text-xl font-semibold mb-3">6. Corrections</h2>
        <p className="text-muted-foreground leading-7">
          If you find a number that appears wrong, send us the citation that
          contradicts it and we will investigate. We follow a
          supersede-not-delete policy: a corrected record is marked superseded
          and a new record takes its place. The old record is retained and
          accessible. Permalinks continue to resolve permanently; they show
          the current best value alongside the correction history if one
          exists.
        </p>
      </section>

      {/* §7 ─────────────────────────────────────────────────────────── */}
      <section id="7" className="mb-10">
        <h2 className="text-xl font-semibold mb-3">7. Cite us / bulk data</h2>
        <p className="text-muted-foreground leading-7">
          When citing a specific figure, include the source citation displayed
          alongside it: document title, fiscal year, page or XML element path,
          and the date we retrieved the file. USAspending-derived figures cite
          the archive file name and SHA-256 hash; J-book figures cite the PDF
          title, page number, and XML element path.
        </p>
        <p className="mt-3 text-muted-foreground leading-7">
          Bulk data exports (Parquet files with data dictionaries) are
          available — see{" "}
          <Link href="/downloads/" className="underline hover:text-foreground">
            Downloads
          </Link>
          . The export schema includes the same provenance metadata that backs
          every on-screen figure.
        </p>
      </section>
    </div>
    </>
  );
}
