import type { Metadata } from "next";
import { getPrograms, collectCitations } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CorpusStatement } from "@/components/corpus-statement";
import { CoverageNote } from "@/components/coverage-note";
import { ProgramsTable } from "@/components/programs-table";
import { CitationPanelProvider } from "@/components/citation-panel";

// Data-driven page count (programs.json length) — never a hardcoded literal.
// Evaluated at build time (SSG); includes the trajectory-only feed programs
// added by backlog #17.
const PROGRAM_COUNT = getPrograms().length;
const PROGRAMS_DESCRIPTION = `Browse all ${PROGRAM_COUNT} DoD R&D and procurement program elements with FY2024 actuals and FY2026 budget figures.`;

export const metadata: Metadata = {
  title: "All Programs",
  description: PROGRAMS_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/programs/` },
  openGraph: {
    title: `All Programs — ${SITE_NAME}`,
    description: PROGRAMS_DESCRIPTION,
    url: `${SITE_URL}/programs/`,
    siteName: SITE_NAME,
  },
};

export default function ProgramsPage() {
  const programs = getPrograms();

  // Sort default: FY26 total descending (nulls last)
  const sorted = [...programs].sort((a, b) => {
    const av = a.trajectory?.fy2026_total ?? -Infinity;
    const bv = b.trajectory?.fy2026_total ?? -Infinity;
    return bv - av;
  });

  // Distinct orgs sorted alphabetically
  const orgs = [...new Set(programs.map((p) => p.org))].sort();

  // Citation slice: FY24 jbook fact_ids + FY26 derived trajectory fact_ids.
  // Inputs are intentionally NOT pulled in here (326 rows × workbook inputs
  // would bloat the page payload); derived-card input chips render as plain
  // chips on this page and are clickable on the program detail pages.
  const pageFactIds: string[] = [];
  for (const p of programs) {
    if (p.fy2024_fact_id) pageFactIds.push(p.fy2024_fact_id);
    if (p.trajectory_fact_ids?.fy2026_total) {
      pageFactIds.push(p.trajectory_fact_ids.fy2026_total);
    }
  }
  const citationsSlice = collectCitations(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Programs" }]}
      />
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Program Elements</h1>
        {/* §P1-5: the table's own scope, stated as a scope — the corpus
            statement below carries the canonical counts, so this sentence
            no longer opens with a bare number that reads as "all of them". */}
        <p className="text-muted-foreground">
          This table lists the {programs.length} detail-grade program elements
          from the FY2026 budget justification books. FY24 figures are
          J-book–cited; FY26 figures carry derived workbook citations.
          Underlined figures open their source citation.
        </p>
        <CorpusStatement className="mt-2" />
        {/* FY2026 partial-year scope note (Phase 5C Task 8) */}
        <CoverageNote id="fy2026-partial" className="mt-2" />
      </div>
      <ProgramsTable programs={sorted} orgs={orgs} />
    </div>
    </CitationPanelProvider>
  );
}
