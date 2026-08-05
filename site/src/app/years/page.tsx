import type { Metadata } from "next";
import { getPrograms, TRAJECTORY_FY_LABEL } from "@/lib/data";
import { formatCount } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { CorpusStatement } from "@/components/corpus-statement";
import { CoverageNote } from "@/components/coverage-note";
import { CollapsibleBelowSm } from "@/components/collapsible-below-sm";
import { ScopeNote } from "@/components/notes";
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
          {/* §P2-2: the grid opens sorted on the newest request column,
              largest first — this sentence says so, because it used to
              promise the organization grouping the grid opened on. Grouping
              is still one control away ("Group by organization"). */}
          <p className="mb-2 text-sm text-muted-foreground sm:text-base">
            {`${_programCount} program elements as rows, fiscal-year amount types as columns — opening on the newest request, largest first.`}
            {/* The controls half of the sentence is two more lines at 390px,
                between the heading and the grid, describing affordances the
                reader can see. Kept for desktop; deferred on a phone. */}
            <span className="hidden sm:inline">
              {` Rows expand to the J-book's own project grain. Sort any column, or group by organization. Click any figure to open its citation.`}
            </span>
          </p>
          {/* Unit statement — always visible (CapIQ convention: one stated
              unit for the whole grid). */}
          <p className="mb-2 text-sm font-medium text-foreground">
            All figures in USD millions.
          </p>
          {/* §P2-6 + the 390px fold. These two blocks are SCOPE DISCLOSURE —
              which edition the grid is drawn from, and how big the corpus
              behind it is — so they share one calm panel instead of two
              stray paragraphs, and below `sm` they collapse behind a single
              tappable line. The text stays in the DOM at every width: the
              G2 coverage leg and gate 24's corpus leg read the built HTML.
              Measured effect at 390×844: first data cell 766px → 519px. */}
          <ScopeNote className="mb-2" label={null}>
            <CollapsibleBelowSm summary="Scope: edition and corpus">
              <CoverageNote id="years-matrix" />
              <CorpusStatement />
            </CollapsibleBelowSm>
          </ScopeNote>
        </div>
        <YearsMatrix />
      </div>
    </CitationPanelProvider>
  );
}
