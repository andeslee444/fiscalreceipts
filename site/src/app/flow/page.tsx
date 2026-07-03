import type { Metadata } from "next";
import { getFlowChartMeta } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { CoverageNote } from "@/components/coverage-note";
import { FlowChart } from "@/components/flow-chart";

/**
 * /flow/ — experimental two-river budget flowdown (Phase 5H).
 *
 * Server shell only: title + Experimental tag, per-river unit statements,
 * and the bridge coverage note (G2/G9 contracts). The heavy precomputed
 * Sankey payload (flow_chart.json) is fetched by the client island, and
 * citations resolve lazily through cite-shards — the provider mounts with an
 * EMPTY embedded slice (same architecture as /years/).
 *
 * Honesty stance (spec §1): the two rivers are separate measurement systems
 * — request dollars are not obligations, budget years are not obligation
 * years — and the shell says so before the chart loads.
 */

const _meta = getFlowChartMeta();
const _fyFirst = _meta.spendFys[0];
const _fyLast = _meta.spendFys[_meta.spendFys.length - 1];

export const metadata: Metadata = {
  title: "Flow — follow the money",
  description:
    `The FY${_meta.budgetFy} defense budget request flowing down to programs, and DoD contract obligations ` +
    `(FY${_fyFirst}–FY${_fyLast}) flowing out to contractor families — two honestly separated rivers, ` +
    `competition-class overlay, every node cited.`,
  alternates: { canonical: `${SITE_URL}/flow/` },
  openGraph: {
    title: `Flow — follow the money | ${SITE_NAME}`,
    description:
      "An experimental Sankey flowdown: budget request to programs, obligations to contractors, with the crosswalk gap stated instead of papered over.",
    url: `${SITE_URL}/flow/`,
    siteName: SITE_NAME,
    images: coreOgImages("flow"),
  },
};

export default function FlowPage() {
  const meta = getFlowChartMeta();
  return (
    <CitationPanelProvider citations={{}}>
      {/* Wide container — like /years/, the chart is the point. */}
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Flow" }]} />
        <div className="mb-5">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold">Follow the money</h1>
            <span
              data-testid="flow-experimental"
              data-flow-experimental=""
              className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
            >
              Experimental
            </span>
          </div>
          <p className="mb-2 text-sm text-muted-foreground sm:text-base">
            Two rivers, deliberately kept apart: what the Pentagon{" "}
            <em>asked for</em> and what it actually <em>put on contract</em>.
            They use different units, different years, and different source
            systems — the chart bridges them only where the award crosswalk
            can defend the link. Click any block for its citation.
          </p>
          {/* Per-river unit statements — one stated unit per system, always
              visible (the /years/ CapIQ convention, doubled). */}
          <p className="text-sm font-medium text-foreground">
            {/* One template literal, not JSX text chunks: Turbopack drops
                the leading space of an entity-bearing chunk after an
                expression ("FY2026President's" regression — G9 leg e
                asserts the built string). */}
            {`Budget river: USD thousands — FY${meta.budgetFy} President's Budget (R-1 + P-1).`}
          </p>
          <p className="mb-2 text-sm font-medium text-foreground">
            Spend river: USD — DoD prime contract obligations for the selected
            fiscal year (FY{_fyFirst}–FY{_fyLast}
            {meta.fy2026Partial ? "; FY2026 is a partial year" : ""}).
          </p>
          {/* Bridge honesty — G2 + G9 contract (data-coverage="flow-bridge"). */}
          <CoverageNote id="flow-bridge" className="mb-2" />
        </div>
        <FlowChart />
      </div>
    </CitationPanelProvider>
  );
}
