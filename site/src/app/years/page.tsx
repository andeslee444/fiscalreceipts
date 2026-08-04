import type { Metadata } from "next";
import { getPrograms, TRAJECTORY_FY_LABEL } from "@/lib/data";
import { formatCount } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { CorpusStatement } from "@/components/corpus-statement";
import { CoverageNote } from "@/components/coverage-note";
import { YearsMatrix } from "@/components/years-matrix";

/**
 * /years/ — budget-over-time matrix (Phase 5D).
 *
 * Server shell only: title, unit statement, single-edition coverage note.
 * Nothing heavy loads server-side — the grid data (years_matrix.json) is
 * fetched by the client island, and citations resolve lazily through the
 * cite-shards mechanism, so the provider gets an EMPTY embedded slice
 * (~20k potential fact_ids would dwarf the embedded-slice budget).
 */

// Grouped ("1,741") through the shared count formatter — the same
// notation the corpus statement and /programs/ use.
const _programCount = formatCount(getPrograms().length);

export const metadata: Metadata = {
  title: "Years — budget over time",
  description: `Every one of ${_programCount} defense program elements as rows, fiscal years as columns — a decade of edition-honest actuals (FY2015–FY2024) through the FY2026 request, with cited ${TRAJECTORY_FY_LABEL} deltas. Every cell opens its source citation.`,
  alternates: { canonical: `${SITE_URL}/years/` },
  openGraph: {
    title: `Years — budget over time | ${SITE_NAME}`,
    description:
      "Program budgets year over year — a dense, sortable grid where every dollar cell opens its citation.",
    url: `${SITE_URL}/years/`,
    siteName: SITE_NAME,
    images: coreOgImages("years"),
  },
};

export default function YearsPage() {
  return (
    <CitationPanelProvider citations={{}}>
      {/* Wider container than detail pages — the grid is the point. */}
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Years" }]}
        />
        <div className="mb-4">
          <h1 className="mb-2 text-3xl font-bold">Budget over time</h1>
          {/* Single template-literal child: an adjacent {expr} + text pair
              lost its joining space in the static export on this page (the
              same shape renders fine elsewhere) — one expression sidesteps
              the whitespace hazard entirely. */}
          {/* text-sm below sm: the intro must not push the grid off the
              390px fold (visual-judge finding). */}
          <p className="mb-2 text-sm text-muted-foreground sm:text-base">
            {`${_programCount} program elements as rows, fiscal-year amount types as columns — grouped by organization, expandable to the J-book's own project grain. Click any figure to open its citation.`}
          </p>
          {/* Unit statement — always visible (CapIQ convention: one stated
              unit for the whole grid). */}
          <p className="mb-2 text-sm font-medium text-foreground">
            All figures in USD millions.
          </p>
          {/* Single-edition honesty — G2 contract (data-coverage="years-matrix").
              Collapsible: below sm only the "why one edition? →" link shows. */}
          <CoverageNote id="years-matrix" collapsible className="mb-2" />
          {/* §P1-5: the grid's rows are the detail-grade tier; the canonical
              corpus statement is what says so in the same words everywhere. */}
          <CorpusStatement className="mb-2" />
        </div>
        <YearsMatrix />
      </div>
    </CitationPanelProvider>
  );
}
