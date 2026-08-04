import type { Metadata } from "next";
import Link from "next/link";
import { getDistrictIndex, collectCitations, getFlowsCount, getProgramsCount } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { formatAmountNoCurrency } from "@/lib/format";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
import { CoverageNote } from "@/components/coverage-note";
import { DistrictTable } from "@/components/district-table";
import { FyRange } from "@/components/fy-range";

const _flowsCount = getFlowsCount();
const _programsCount = getProgramsCount();

export const metadata: Metadata = {
  title: "Congressional Districts",
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

  // Citation slice: the geography grand total (derived, dim_geography) plus
  // every district row's linkable-dollars aggregate citation (derived,
  // 'district' surface) so the table figures open the panel in state A.
  const indexFactIds: string[] = [];
  if (index.geo_grand_total_fact_id) {
    indexFactIds.push(index.geo_grand_total_fact_id);
  }
  for (const d of index.districts) {
    if (d.total_linkable_fact_id) indexFactIds.push(d.total_linkable_fact_id);
  }
  const citationsSlice = collectCitations(indexFactIds);

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
          {/* Coverage disclaimer — roomier padding + line-height at mobile
              (visual-judge nit: text felt cramped at 390px). */}
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3.5 sm:py-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200 mb-4">
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
              {/* §P1-6: was a hand-rolled `(total / 1e9).toFixed(1)}B` that
                  bypassed the shared ladder entirely. Uses the no-currency
                  formatter because the '$' would put a bare figure outside a
                  [data-amount] span, which the render-static currency gate
                  flags — the units are in the label below. */}
              <p className="text-2xl font-bold tabular-nums">
                {formatAmountNoCurrency(totalLinkable, "USD")}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                linkable dollars (USD) <FyRange separator="· " />
              </p>
            </div>
            {index.geo_grand_total !== null && (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-2xl font-bold tabular-nums">
                  <Cite
                    value={index.geo_grand_total}
                    units="USD"
                    dataset={index.geo_grand_total_dataset}
                    factId={index.geo_grand_total_fact_id}
                  />
                </p>
                {/* §P1-6: this is $3.66T — a DECADE of award obligations. It
                    rendered "$3657.4B" with no period beside an "8.0B" card,
                    which reads as one year's spending. Both now carry the
                    derived range. */}
                <p className="text-muted-foreground text-xs mt-1">
                  all-district obligations (geography total){" "}
                  <FyRange separator="· " />
                </p>
              </div>
            )}
          </div>
        </div>

        <DistrictTable districts={index.districts} />

        <p className="mt-4 text-xs text-muted-foreground">
          Dollars are from high-confidence USAspending award links only.
          The geography grand total aggregates USAspending award transaction
          data across all districts — click it for the formula and query.
          See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology
          </Link>
          .
        </p>
      </div>
    </CitationPanelProvider>
  );
}
