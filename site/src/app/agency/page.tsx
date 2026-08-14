import type { Metadata } from "next";
import Link from "next/link";
import { getAgencies, collectCitations } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { serviceOrgName } from "@/lib/program-tier";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Cite } from "@/components/cite";
import { CitationPanelProvider } from "@/components/citation-panel";
import { formatCount } from "@/lib/format";

/**
 * /agency/ — the agency index (Sprint C Task C3, ROADMAP #62).
 *
 * `/agency/{org}/` pages exist (23 of them, linked from every program page)
 * but nothing indexed them and nothing landed you here by trimming the URL —
 * the commonest way a reader discovers a site section. This is that index:
 * all 23 agencies, sorted by their FY2026 total (the figure a reader
 * comparing agencies most likely wants first), each linking to its own page.
 *
 * Data comes through lib/data.ts's getAgencies() — the SAME agencies.json
 * sidecar and AgencyRow shape /agency/[org]/page.tsx and the homepage's
 * "Browse by agency" section already read. Nothing here is hardcoded: the
 * 23-row count, the totals, and both fact ids are all read off the sidecar
 * at build time.
 */

export const metadata: Metadata = {
  title: "Agencies",
  description:
    "All defense agencies publishing budget program data on Fiscal Receipts — program counts and cited FY2024/FY2026 totals for each.",
  alternates: { canonical: `${SITE_URL}/agency/` },
  openGraph: {
    title: `Agencies — ${SITE_NAME}`,
    description:
      "All defense agencies publishing budget program data, with program counts and cited totals.",
    url: `${SITE_URL}/agency/`,
    siteName: SITE_NAME,
  },
};

export default function AgencyIndexPage() {
  const agencies = getAgencies();

  // Sort by FY2026 total descending — the figure this index leads with.
  // DCAA carries no FY2026 total (null) and sorts last, not to 0: a missing
  // figure is not the same claim as a zero one.
  const sorted = [...agencies].sort((a, b) => {
    if (a.fy2026_total_thousands == null && b.fy2026_total_thousands == null) {
      return b.fy2024_total_millions - a.fy2024_total_millions;
    }
    if (a.fy2026_total_thousands == null) return 1;
    if (b.fy2026_total_thousands == null) return -1;
    return b.fy2026_total_thousands - a.fy2026_total_thousands;
  });

  // Citation slice: every agency's FY24 + FY26 derived sum (skipping the
  // nulls — DCAA has no FY26 fact) so both columns' figures open the panel.
  const pageFactIds: string[] = [];
  for (const a of sorted) {
    if (a.fy2024_fact_id_derived) pageFactIds.push(a.fy2024_fact_id_derived);
    if (a.fy2026_fact_id_derived) pageFactIds.push(a.fy2026_fact_id_derived);
  }
  const citationsSlice = collectCitations(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Agencies" }]} />

        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Agencies</h1>
          <p className="text-muted-foreground">
            {formatCount(sorted.length)} defense agencies with program-level
            budget data, sorted by FY2026 total. Click a total to inspect its
            derivation and cited inputs, or a name to see every program
            element for that agency.
          </p>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
          {/* Column header — hidden on narrow screens, where each row stacks
              its own labels (mirrors the /programs/ table's mobile pattern). */}
          <div className="hidden sm:flex items-center gap-4 px-5 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Agency</span>
            <span className="w-24 text-right">Programs</span>
            <span className="w-32 text-right">FY24 total</span>
            <span className="w-32 text-right">FY26 total</span>
          </div>
          {sorted.map((a) => (
            <div
              key={a.org}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-4 hover:bg-muted/40 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <Link
                  href={`/agency/${a.org}/`}
                  className="font-medium hover:underline text-foreground"
                  title={`Organization code ${a.org}`}
                >
                  {serviceOrgName(a.org)}
                </Link>
              </div>
              <div className="sm:w-24 text-sm text-muted-foreground sm:text-right">
                {a.program_count} program{a.program_count !== 1 ? "s" : ""}
              </div>
              <div className="sm:w-32 text-sm tabular-nums sm:text-right">
                {/*
                  No basis/fy/measure props — mirrors /agency/[org]/page.tsx's
                  own header-stat Cite calls for this SAME (dim_programs)
                  agency-sum pair, deliberately: gate 23 leg a1's basis-attr
                  requirement is scoped to program pages only (its own
                  comment: "[data-amount] on a program page must carry
                  data-basis..."), and leg e's cross-page check only reads
                  /agency/*'/'* (the org subpages), not this index — so no
                  gate reads these attrs either way. Adding an invented
                  basis/measure pair here (the homepage card's "jbook-detail"
                  + "actuals"/"request") would be a NEW claim this exact
                  figure has never carried before, on a page this task's own
                  "verify every premise" instruction warns against guessing
                  on — so it stays unlabeled here exactly as it is on the
                  page this total links to.
                */}
                <Cite
                  value={a.fy2024_total_millions}
                  units="USD millions"
                  dataset="dim_programs"
                  factId={a.fy2024_fact_id_derived}
                />
              </div>
              <div className="sm:w-32 text-sm tabular-nums sm:text-right">
                {a.fy2026_total_thousands != null ? (
                  <Cite
                    value={a.fy2026_total_thousands}
                    units="USD thousands"
                    dataset="dim_programs"
                    factId={a.fy2026_fact_id_derived}
                  />
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Totals are derived sums over each agency&rsquo;s program figures.
          See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology
          </Link>{" "}
          for how the two fiscal years&rsquo; bases relate.
        </p>
      </div>
    </CitationPanelProvider>
  );
}
