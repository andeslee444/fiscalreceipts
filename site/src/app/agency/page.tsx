import type { Metadata } from "next";
import Link from "next/link";
import { getAgencies, getUnpagedOrgs, collectCitations } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { agencyDisplayName } from "@/lib/agency-names";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Cite } from "@/components/cite";
import { CitationPanelProvider } from "@/components/citation-panel";
import { formatCount } from "@/lib/format";
import { ScopeNote } from "@/components/notes";

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
  // Wave 4 item 5: the workbook organizations this index does not collect.
  //
  // NO FIGURES IN THIS BLOCK, AND THE REASON IS PAGE WEIGHT, MEASURED. A
  // first cut rendered each program's own cited FY2026 headline as a <Cite>.
  // Seventeen more citations in the slice cross the server→client boundary
  // twice (rendered HTML + RSC payload) and put this page at 219,668 raw
  // against a 190,000 ceiling — 15.6% over, and 2,469 bytes over on gzip.
  // The ceiling does not move for a convenience: the disclosure this item is
  // about is the BROWSE PATH, and one click away every one of these pages
  // states its figure with the citation attached. The list is ordered by
  // FY2026 request so the material lines lead.
  const unpaged = getUnpagedOrgs();
  const citationsSlice = collectCitations(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Agencies" }]} />

        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Agencies</h1>
          <p className="text-muted-foreground">
            {formatCount(sorted.length)} defense agencies with program-level
            budget data, sorted by the FY2026 total{" "}
            <strong className="text-foreground">this site has ingested</strong>
            . Click a total to inspect its derivation and cited inputs, or a
            name to see every program element for that agency.
          </p>
          {/* §P0-6 — THE SORT WAS THE FALSE CLAIM, AND THEN IT WASN'T.
              This page said "sorted by FY2026 total" and put the Air Force
              above the Navy. Every figure in the table was true and
              correctly cited; the ORDER was not, because the totals are sums
              over what has been ingested and ingestion was very uneven by
              service — the Navy rendered at $46.8B against a real $121.8B
              because five of its six procurement appropriations were
              unparsed. Ranking those against each other silently ranked
              INGESTION COMPLETENESS under a spending label.
              Wave 5 parsed them. Measured against fct_budget_lines' own
              fy_2026_total, the three services now sit at N 97.0%, F 99.0%,
              A 99.5%, and the ingested order (N $118.1B > F $97.7B >
              A $43.1B) matches the workbook order (N $121.8B > F $98.7B >
              A $43.3B). Gate 14 leg cr no longer requires a disclosure here
              — it is symmetric on the reconciliation and turns the
              requirement back on by itself if a future edition arrives
              unevenly. The note below stays anyway and says the one thing
              that is still true: these are sums over what is loaded, not the
              services' requests. It is deliberately shorter than the claim it
              replaces; this page has ~250 bytes of raw headroom (see the
              chip note below) and the honest sentence is the small one. */}
          <ScopeNote className="mt-3" label={null}>
            <p className="text-sm leading-6">
              <strong className="text-foreground">
                These are totals this site has loaded, not what each agency
                requested.
              </strong>{" "}
              Every FY2026 justification volume held here is parsed. The
              three services&rsquo; totals are each within a few percent of
              their workbook figures — the Navy&rsquo;s is the furthest short
              — and the three rank here in the order the workbook itself puts
              them. Where the remaining gap comes from, line by line, is on{" "}
              <Link href="/coverage/" className="underline hover:text-foreground">
                what is and is not loaded
              </Link>
              .
            </p>
          </ScopeNote>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
          {/* Column header — hidden on narrow screens, where each row stacks
              its own labels (mirrors the /programs/ table's mobile pattern). */}
          <div className="hidden sm:flex items-center gap-4 px-5 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Agency</span>
            <span className="w-24 text-right">Programs</span>
            <span className="w-32 text-right">FY24 total</span>
            <span className="w-32 text-right">FY26 total (ingested)</span>
          </div>
          {sorted.map((a) => (
            <div
              key={a.org}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-4 hover:bg-muted/40 transition-colors"
            >
              <div className="flex-1 min-w-0">
                {/* Tri-persona Wave 3, Task 3 — the component's name, not the
                    workbook code (see lib/agency-names.ts). NO visible code
                    chip on THIS page, unlike the home grid and the agency page
                    itself: measured on the first post-fix build, the names
                    plus a chip put /agency/ at 189,750 of its 190,000 RAW
                    ceiling — 250 bytes, 99.9%, the same cliff /coverage/ hit
                    at nine bytes and /programs/ at 643. The chip is the part
                    that buys least here (every row's href and title already
                    carry the code, and the page a reader lands on states it
                    outright), so the chip went rather than the ceiling. */}
                <Link
                  href={`/agency/${a.org}/`}
                  className="font-medium hover:underline text-foreground"
                  title={`Organization code ${a.org}`}
                >
                  {agencyDisplayName(a.org)}
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

        {/* ── Money filed under an organization with no page here ──────────
            Tri-persona review Wave 4, item 5. The index lists 24
            organizations; the FY2026 budget lines carry money under more
            than that. Every one of those programs HAS a page and is in the
            sitemap — there was simply no way to reach it from the agency
            index. Why a list rather than four more agency pages: see
            getUnpagedOrgs()'s note in lib/data.ts. */}
        {/* Tri-persona review Wave 4, item 5 — a POINTER, and the reason it
            is only a pointer is page weight, measured with the gate's own
            logic. The organizations, their program pages and the explanation
            live on /programs/, beside the absent-lines note that already
            covers the same ground. Rendering them here instead cost 7,834 raw
            bytes against 5,819 of headroom (and 1,804 gzip against 1,614);
            /programs/ has 169,576 raw and 17,426 gzip free. The ceiling did
            not move and the disclosure did not shrink — it went to the page
            that could hold it. */}
        {unpaged.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            {formatCount(unpaged.length)} organization
            {unpaged.length === 1 ? "" : "s"} in the FY2026 workbooks carry
            money no page above collects, because an agency page is built from
            the detail-grade program table and these have no rows in it. They
            are named, with links to their program pages, on{" "}
            <Link
              href="/programs/#unpaged-orgs"
              className="underline hover:text-foreground"
            >
              Programs
            </Link>
            .
          </p>
        )}
      </div>
    </CitationPanelProvider>
  );
}
