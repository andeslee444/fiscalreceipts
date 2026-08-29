import type { Metadata } from "next";
import Link from "next/link";
import {
  getProgramDecadeCells,
  getPrograms,
  getProgramsCoverage,
  getUnpagedOrgs,
} from "@/lib/data";
import { agencyDisplayName } from "@/lib/agency-names";
import { formatAmount, formatCount } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CorpusStatement } from "@/components/corpus-statement";
import { CoverageNote } from "@/components/coverage-note";
import { ProgramsTable } from "@/components/programs-table";
import { toProgramsTableRow } from "@/lib/programs-row";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
import { ScopeNote } from "@/components/notes";

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
  const coverage = getProgramsCoverage();
  // Wave 4 item 5 — workbook organizations with FY2026 money and no agency
  // page (lib/data getUnpagedOrgs). /agency/ links here.
  const unpaged = getUnpagedOrgs();
  const namedExcluded = coverage.largest_excluded.slice(0, 3);

  // Sort default: FY26 total descending (nulls last), projected to the eight
  // fields the table renders (see ProgramsTableRow — §P2-1 page weight).
  // Both money columns come from the PROGRAM-LEVEL decade cells — the same
  // years_matrix.json payload /years/ renders, with the same FACT IDS the
  // program pages cite. programs.json's trajectory is the program's total too
  // since backlog #37, and agrees with these to the cent; the decade cell wins
  // because it is the same FACT, so a chip here opens the same receipt as the
  // chip on the page this row links to (see toProgramsTableRow).
  const cells = getProgramDecadeCells();
  // Sprint E, Task E3: look up by slug (identity for every non-split
  // program) — a bare pe_bli lookup would hand BOTH of a split key's rows
  // the same decade cells, which is exactly the #56 fusion shape this
  // sprint removes, reintroduced one surface later.
  const sorted = [...programs]
    .map((p) => toProgramsTableRow(p, cells.get(p.slug)))
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
        {/* Backlog #49: the table below renders "N of N programs" once its
            filter is unfiltered (ProgramsTable's own filter-status counter,
            components/programs-table.tsx) — true, and useless: it
            denominates the index by itself. This denominates it in dollars
            against the site's own FY2026 request universe, and names the
            true exclusion criterion: R-2/P-40 project detail, NOT "not
            covered by the R-1/P-1 rollups" (the site used to say that in two
            other hand-typed spots — page.tsx's top-movers note and
            feed/page.tsx — both now read this same site_meta.corpus_scope
            string instead of a hardcoded, driftable copy). Every figure
            below is a real <Cite> — never a hardcoded literal.
            data-programs-coverage-pct is gate 2 leg (cc)'s hook: it must be
            < 100 on any page that also renders an N-of-N corpus counter.
            #56 addendum: a named line can be excluded for a SECOND, distinct
            reason — 'key_collision' — a program whose own numeric key is
            already a page in the index (a different, unrelated program won
            it), not one that lacks R-2/P-40 detail. Stating "no R-2/P-40
            detail" for a $2.6B line that publishes plenty of detail under a
            key someone else's page occupies would be the exact false-label
            defect #56 exists to fix, so the sentence branches per reason. */}
        <ScopeNote className="mt-2" label={null}>
          <p
            className="text-sm leading-6"
            data-programs-coverage-pct={coverage.coverage_pct}
          >
            <strong className="text-foreground">
              <Cite
                value={coverage.index_total_thousands}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={coverage.index_fact_id}
              />{" "}
              of the{" "}
              <Cite
                value={coverage.universe_total_thousands}
                units="USD thousands"
                dataset="budget_lines"
                factId={coverage.universe_fact_id}
              />{" "}
              FY2026 procurement and RDT&amp;E request ({coverage.coverage_pct}
              %).
            </strong>{" "}
            {/* §P0-4: the denominator is P-1 + R-1 and nothing else. Both
                figures were already cited and the ratio was already right;
                the LABEL said "the FY2026 request", which a reader reads as
                the whole defense request — roughly twice this. Naming the two
                exhibits is the correction, and gate 23 leg (h6) recomputes the
                universe's exhibit composition from fct_budget_lines and fails
                the build if the sentence stops naming any family in it. */}
            That denominator is the P-1 and R-1 workbooks only; military
            personnel, operation and maintenance, military construction and
            the other appropriation titles are outside this corpus entirely,
            so this share is not a share of the whole defense budget.{" "}
            This index covers program elements that publish R-2/P-40 project
            detail, one page per program key. Lines without that detail are
            absent even when they are large and even when they are P-1; a
            line whose own program key is already a different, unrelated
            program&apos;s page is absent for that separate reason — the
            biggest missing either way are{" "}
            {namedExcluded.map((e, i) => (
              <span key={`${e.pe_bli}-${e.title}`}>
                {i > 0 && (i === namedExcluded.length - 1 ? " and " : ", ")}
                {e.title} (
                <Cite
                  value={e.amount_thousands}
                  units="USD thousands"
                  dataset="budget_lines"
                  factId={e.fact_id}
                />
                {e.reason === "key_collision" && (
                  <span
                    data-excluded-reason="key_collision"
                    className="text-muted-foreground"
                  >
                    {" — shares budget-line key "}
                    {e.pe_bli}
                    {" with a different program already listed below"}
                  </span>
                )}
                )
              </span>
            ))}
            .
            {/* #56: the list above is ranked by dollars, and every
                key_collision line is smaller than the five biggest
                no_detail ones — so the collision category would be
                described here but never exemplified, and a reader would
                have no way to learn how much it accounts for. The count
                and total come from programs_coverage, never a literal.

                ROADMAP #69: the link to the full manifest is NOT inside
                this conditional any more. It used to be, and when #69 took
                the collision count to zero — correctly: those four lines
                were being published and disclosed as absent at the same
                time — the site's only pointer to programs_excluded.json
                went with it, silently unlinking the completeness manifest
                for every remaining excluded line. The manifest is the thing
                gate 23 leg (h4) checks for completeness; it has to be
                reachable whether or not a collision happens to exist this
                edition. */}
            {coverage.key_collision_count > 0 && (
              <>
                {" "}
                <span data-excluded-collision-summary={coverage.key_collision_count}>
                  {formatCount(coverage.key_collision_count)} of the absent lines
                  are missing for that second reason, totalling{" "}
                  <Cite
                    value={coverage.key_collision_thousands}
                    units="USD thousands"
                    dataset="budget_lines"
                    factId={coverage.key_collision_fact_id}
                  />
                  .
                </span>
              </>
            )}{" "}
            Every absent line is named in{" "}
            <a
              href="/json/programs_excluded.json"
              className="underline hover:text-foreground"
            >
              programs_excluded.json
            </a>
            .
          </p>
        </ScopeNote>

        {/* ── Absent lines with no agency page either (Wave 4, item 5) ─────
            /agency/ lists 24 organizations; the FY2026 workbooks file money
            under more. The extras have no dim_programs rows, so agencies.json
            never sees them and no agency page collects them — and their
            program pages, which do exist and are indexed, were reachable from
            nothing but a search. An agency page for them would state a real
            header total over a program list showing none of it, which is the
            defect this whole review is about; so this is the browse path
            instead, on the page that already documents the absent lines.
            /agency/ links here rather than carrying the block: measured, it
            costs 7,834 raw bytes and that page has 5,819. */}
        {unpaged.length > 0 && (
          <div id="unpaged-orgs" className="mt-4 scroll-mt-16">
            {/* "Program pages", not "absent lines": twelve of DHA's thirteen
                are absent from the index above, and Medical Development is
                IN it — an org with no agency page makes every one of its
                pages unreachable from /agency/, whether the index rows it or
                not. Calling all seventeen absent lines would be a true list
                under a false label, which is the defect this review is
                about. */}
            <h2 className="text-sm font-semibold text-foreground">
              Program pages filed under an organization with no agency page
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCount(unpaged.length)} organization
              {unpaged.length === 1 ? "" : "s"} carry FY2026 money that no{" "}
              <Link href="/agency/" className="underline hover:text-foreground">
                agency page
              </Link>{" "}
              collects — an agency page is built from the detail-grade program
              table and these have no rows in it. Their program pages, largest
              FY2026 request first, each with its own cited figures:
            </p>
            <div
              className="mt-2 space-y-1 text-sm text-muted-foreground [&_a]:underline [&_a:hover]:text-foreground"
              data-unpaged-orgs
            >
              {unpaged.map((u) => (
                <p key={u.org || "(none)"} data-unpaged-org={u.org}>
                  <span className="text-foreground">
                    {u.org ? agencyDisplayName(u.org) : "No organization code"}
                  </span>
                  {" — "}
                  {u.programs.flatMap((p, i) => [
                    i > 0 ? ", " : "",
                    <Link key={p.slug} href={`/program/${p.slug}/`}>
                      {p.title}
                    </Link>,
                  ])}
                  .
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      <ProgramsTable programs={sorted} orgs={orgs} />
    </div>
    </CitationPanelProvider>
  );
}
