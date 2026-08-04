import type { Metadata } from "next";
import Link from "next/link";
import {
  getEntitiesTop,
  getEntityFamilyEvents,
  collectCitationsWithInputs,
} from "@/lib/data";
import {
  assertNoDoubleCount,
  companyRowFactIds,
  confidenceIsUniform,
  mergeCompanies,
} from "@/lib/entity-families";
import { getAwardFyRange } from "@/lib/fy-range";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CompaniesTable } from "@/components/companies-table";
import { CitationPanelProvider } from "@/components/citation-panel";
import { FyRange } from "@/components/fy-range";

// §P1-6: the description used to say "FY2017 onward" while the body said
// "FY2017–FY2025" and the data ran through FY2026. Derived, so it cannot rot.
const _fyRange = getAwardFyRange();
const _fyRangeText = _fyRange ? `, ${_fyRange.label}` : "";

export const metadata: Metadata = {
  title: "Top Contractors",
  description: `Top defense contractor families by total federal obligations — USAspending-derived${_fyRangeText}, with renamed and acquired companies merged into one family line.`,
  alternates: { canonical: `${SITE_URL}/companies/` },
  openGraph: {
    title: `Top Contractors — ${SITE_NAME}`,
    description:
      "Top defense contractor families by total federal obligations, with renamed and acquired companies merged.",
    url: `${SITE_URL}/companies/`,
    siteName: SITE_NAME,
  },
};

export default function CompaniesPage() {
  const companies = getEntitiesTop();

  // §P1-3: merge the curated corporate families (Raytheon→RTX and friends)
  // and re-rank. The merged figure is the exporter's CITED combined fact.
  const rows = mergeCompanies(companies, getEntityFamilyEvents());

  // The double-count guard, asserted at BUILD time: a merge that lost or
  // duplicated a registry family must break the build, not ship a wrong
  // number to the top of the page.
  const problems = assertNoDoubleCount(companies, rows);
  if (problems.length > 0) {
    throw new Error(
      `[/companies/] curated family merge is unsafe — refusing to build:\n  ` +
        problems.join("\n  "),
    );
  }

  // §P1-3: the chip conveys nothing when every row reads the same. Computed
  // over ALL rows so the column cannot flicker as the reader filters.
  const showConfidence = !confidenceIsUniform(rows);
  const uniformConfidence = rows[0]?.worstConfidence ?? "medium";
  const mergedCount = rows.filter((r) => r.merged).length;
  const foldedRows = companies.length - rows.length;

  // Citation slice: the rendered figure for every row (combined fact for a
  // merged family) PLUS each member's own fact, so the combined figure's
  // derivation drills down to the rows it replaced.
  const citationsSlice = collectCitationsWithInputs(companyRowFactIds(rows));

  return (
    <CitationPanelProvider citations={citationsSlice}>
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Companies" }]}
      />
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Top Defense Contractors</h1>
        {/* §P1-6: "FY2017–FY2025" was authored here and was a year short of
            the data. The range is now derived from fct_award_transactions and
            worded identically on every surface that states it. */}
        <p className="text-muted-foreground mb-2">
          The top {companies.length} contractor families in the USAspending
          award data, shown as {rows.length} corporate families by total
          federal obligations — <FyRange />. Figures are in raw USD and
          aggregate the whole period, not a single year.
        </p>
        {/* §P1-3: the merge, stated where it happens. */}
        {mergedCount > 0 && (
          <p className="text-sm text-muted-foreground mb-2" data-merge-note>
            {foldedRows} of those registry names are earlier names of a company
            already on this list — Raytheon and RTX are one company, renamed in
            2023. {mergedCount} corporate {mergedCount === 1 ? "family" : "families"}{" "}
            {mergedCount === 1 ? "is" : "are"} shown merged, from a{" "}
            <Link
              href="/companies/families/"
              className="underline hover:text-foreground"
            >
              hand-curated table of renames and acquisitions
            </Link>{" "}
            with an official source for each. Every merged total is a cited
            figure whose inputs are the rows it replaced — click it to see them.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Obligation totals carry derived USAspending citations — click a
          figure to inspect the derivation.{" "}
          {/* §P1-3: the confidence method, stated ONCE, because the per-row
              chip was uniform on all 200 rows and so said nothing. */}
          {!showConfidence && (
            <span data-confidence-method>
              Every family on this list resolves at{" "}
              <strong>{uniformConfidence}</strong> confidence
              {uniformConfidence === "medium"
                ? " (name inference) — the value does not vary across this table, so the per-row chip is suppressed. The SAM.gov registered-parent tier that would promote the largest families to high confidence needs a SAM extract this build does not have."
                : " — the value does not vary across this table, so the per-row chip is suppressed."}{" "}
            </span>
          )}
          See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology §4
          </Link>
          .
        </p>
      </div>
      <CompaniesTable rows={rows} showConfidence={showConfidence} />
    </div>
    </CitationPanelProvider>
  );
}
