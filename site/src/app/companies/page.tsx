import type { Metadata } from "next";
import Link from "next/link";
import { getEntitiesTop, collectCitationsWithInputs } from "@/lib/data";
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
  description: `Top 200 defense contractor families by total federal obligations — USAspending-derived${_fyRangeText}.`,
  alternates: { canonical: `${SITE_URL}/companies/` },
  openGraph: {
    title: `Top Contractors — ${SITE_NAME}`,
    description:
      "Top 200 defense contractor families by total federal obligations.",
    url: `${SITE_URL}/companies/`,
    siteName: SITE_NAME,
  },
};

export default function CompaniesPage() {
  const companies = getEntitiesTop();

  // Citation slice: derived total_obligation fact_ids for all 200 rows
  const citationsSlice = collectCitationsWithInputs(
    companies
      .map((c) => c.total_obligation_fact_id)
      .filter((id): id is string => id != null),
  );

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
          Top {companies.length} contractor families by total federal
          obligations — derived from USAspending.gov award data,{" "}
          <FyRange />. Figures are in raw USD and aggregate the whole period,
          not a single year.
        </p>
        <p className="text-sm text-muted-foreground">
          Obligation totals carry derived USAspending citations — click a
          figure to inspect the derivation. Confidence reflects the
          entity-resolution method (high = SAM.gov registered parent;
          medium = name-inference). See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology §4
          </Link>
          .
        </p>
      </div>
      <CompaniesTable companies={companies} />
    </div>
    </CitationPanelProvider>
  );
}
