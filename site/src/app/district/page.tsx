import type { Metadata } from "next";
import Link from "next/link";
import { getDistrictIndex, collectCitations, getFlowsCount, getProgramsCount } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
import { CoverageNote } from "@/components/coverage-note";
import { DistrictTable } from "@/components/district-table";

const _flowsCount = getFlowsCount();
const _programsCount = getProgramsCount();

export const metadata: Metadata = {
  title: `Congressional Districts — ${SITE_NAME}`,
  description: `Defense spending by congressional district — programs, recipients, and awarded dollars linked via DARPA crosswalk (${_flowsCount} of ${_programsCount} programs currently linkable).`,
  alternates: { canonical: `${SITE_URL}/district/` },
  openGraph: {
    title: `Congressional Districts — ${SITE_NAME}`,
    description:
      "Defense spending by congressional district — programs, recipients, and awarded dollars linked via DARPA crosswalk.",
    url: `${SITE_URL}/district/`,
    siteName: SITE_NAME,
    images: coreOgImages("district-index"),
  },
};

export default function DistrictIndexPage() {
  const index = getDistrictIndex();

  // Citation slice for geo grand total (stays state C / uncited)
  // No fact_ids here — geo total is uncited (dim_geography on uncited ledger).
  const citationsSlice = collectCitations([]);

  const totalLinkable = index.districts.reduce(
    (sum, d) => sum + d.total_linkable_dollars,
    0,
  );

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Congressional Districts" },
          ]}
        />
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Congressional Districts</h1>
          <p className="text-muted-foreground mb-2">
            {index.total_districts} districts with linkable defense obligations
            — {_flowsCount} of {_programsCount} programs currently crosswalkable
            (DARPA budget-to-award crosswalk covers{" "}
            <Link
              href="/program/0601101E/"
              className="underline decoration-dotted hover:decoration-solid"
            >
              DARPA
            </Link>{" "}
            and related programs).
          </p>
          {/* Scope note — G2 contract (data-coverage="districts") */}
          <CoverageNote id="districts" className="mb-3" />
          {/* Coverage disclaimer */}
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 mb-4">
            <strong>Coverage note:</strong> District data reflects only{" "}
            high-confidence award crosswalk links. {_programsCount - _flowsCount} of {_programsCount} programs have no
            district-level linkage yet — crosswalk extension is on the
            roadmap.
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm mb-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums">
                {index.total_districts}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                districts with data
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums">
                {(totalLinkable / 1e9).toFixed(1)}B
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                linkable dollars (USD)
              </p>
            </div>
            {index.geo_grand_total !== null && (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-2xl font-bold tabular-nums">
                  <Cite
                    value={index.geo_grand_total}
                    units="USD"
                    dataset={index.geo_grand_total_dataset}
                  />
                </p>
                <p className="text-muted-foreground text-xs mt-1">
                  all-district contracts (⁂ geography total)
                </p>
              </div>
            )}
          </div>
        </div>

        <DistrictTable districts={index.districts} />

        <p className="mt-4 text-xs text-muted-foreground">
          Dollars are from high-confidence USAspending award links only.
          Geography grand total (⁂) is from award transaction data —
          citation tier pending. See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology
          </Link>
          .
        </p>
      </div>
    </CitationPanelProvider>
  );
}
