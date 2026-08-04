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
          {/* The stat row, reconciled.
              Two figures ~457× apart sat side by side with nothing relating
              them, and "all-district" read as "the 106 districts shown" when
              it means every U.S. district in the award data. The '$' was also
              missing from the middle card — on the page whose §P1-6 fix was a
              formatter. Each card now states its universe; the reconciliation
              line below states the relationship in one sentence. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm mb-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums">
                {index.total_districts}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                districts with at least one crosswalked program
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              {/* §P1-6: was a hand-rolled `(total / 1e9).toFixed(1)}B` that
                  bypassed the shared ladder entirely. The no-currency
                  formatter is still the right one — a bare '$…' outside a
                  [data-amount] span is what the render-static currency gate
                  flags — so the currency sits in the label, spelled out, next
                  to the number rather than only under it. */}
              <p className="text-2xl font-bold tabular-nums">
                <span className="text-lg align-baseline">USD </span>
                {formatAmountNoCurrency(totalLinkable, "USD")}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                linkable to a budget program, in these{" "}
                {index.total_districts} districts <FyRange separator="· " />
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
                  awarded across <strong>every</strong> U.S. district, linked
                  to a program or not <FyRange separator="· " />
                </p>
              </div>
            )}
          </div>
          {index.geo_grand_total !== null && (
            <p
              data-district-reconciliation
              className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              <strong className="text-foreground">
                How these two dollar figures relate:
              </strong>{" "}
              the right-hand total is all defense award obligations recorded
              with a congressional district over the period. The middle figure
              is the small slice of it we can tie back to a specific budget
              program through the crosswalk — {_flowsCount} of{" "}
              {_programsCount} programs — so it is a subset of the same
              universe, roughly{" "}
              {(
                (totalLinkable / (index.geo_grand_total || 1)) *
                100
              ).toFixed(2)}
              % of it, not a competing measurement of it. The gap is coverage,
              not disagreement. Only the right-hand figure is fact-backed
              today: the district count and the linkable subtotal are computed
              over the rows in the table below, each of which carries its own
              citation.
            </p>
          )}
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
