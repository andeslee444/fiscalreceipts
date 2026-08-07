import type { Metadata } from "next";
import { getProgramDecadeCells, getPrograms } from "@/lib/data";
import { formatCount } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CorpusStatement } from "@/components/corpus-statement";
import { CoverageNote } from "@/components/coverage-note";
import { ProgramsTable } from "@/components/programs-table";
import { toProgramsTableRow } from "@/lib/programs-row";
import { CitationPanelProvider } from "@/components/citation-panel";

// Data-driven page count (programs.json length) — never a hardcoded literal.
// Evaluated at build time (SSG); includes the trajectory-only feed programs
// added by backlog #17.
const PROGRAM_COUNT = formatCount(getPrograms().length);
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

  // Sort default: FY26 total descending (nulls last), projected to the eight
  // fields the table renders (see ProgramsTableRow — §P2-1 page weight).
  // Both money columns come from the PROGRAM-LEVEL decade cells — the same
  // years_matrix.json payload /years/ renders, with the same FACT IDS the
  // program pages cite. programs.json's trajectory is the program's total too
  // since backlog #37, and agrees with these to the cent; the decade cell wins
  // because it is the same FACT, so a chip here opens the same receipt as the
  // chip on the page this row links to (see toProgramsTableRow).
  const cells = getProgramDecadeCells();
  const sorted = [...programs]
    .map((p) => toProgramsTableRow(p, cells.get(p.pe_bli)))
    .sort((a, b) => (b.fy26 ?? -Infinity) - (a.fy26 ?? -Infinity));

  // Distinct orgs sorted alphabetically
  const orgs = [...new Set(programs.map((p) => p.org))].sort();

  return (
    // §P2-1 page weight: citations resolve LAZILY through cite-shards
    // (/json/cite-shards/{fact_id[:2]}.json), so the provider mounts with an
    // EMPTY embedded slice — the same treatment /years/ and /flow/ already
    // use for the same reason. This page's 3,344 FY24+FY26 fact rows were
    // 1.75 MB of the 5.87 MB document (30% of it) purely to save one fetch
    // on the first citation click. Clicking a figure still opens its
    // citation; the panel just resolves the fact's shard first, and shows
    // the declared loading/degraded states while it does.
    //
    // Derived-card input chips render as plain (non-clickable) chips here,
    // exactly as they did before: the workbook INPUTS were never in the
    // embedded slice either, and they stay clickable on program pages.
    <CitationPanelProvider citations={{}}>
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
          {/* Grouped ("1,741") — same notation as the corpus statement
              directly below it, which used to disagree with this sentence. */}
          {/* Backlog #35: this sentence used to call all of these rows
              "detail-grade", two more than actually carry J-book detail. The
              table's own scope is the INDEX; the corpus statement below is
              where the tier split is stated, once, for the whole site. */}
          This table lists the {formatCount(programs.length)} program elements in the
          FY2026 budget index. Underlined figures open their source citation.
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
