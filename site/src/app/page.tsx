import type { Metadata } from "next";
import Link from "next/link";
import {
  getSiteMeta,
  getPrograms,
  getAgencies,
  getFeed,
  getReceiptMomentFact,
  collectCitationsWithInputs,
  TRAJECTORY_FY_LABEL,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Cite } from "@/components/cite";
import { CitationPanelProvider } from "@/components/citation-panel";
import { FeedHeadline, hhiScopeNote } from "@/components/feed-headline";
import { ReceiptMoment } from "@/components/receipt-moment";
import { ReceiptsIntro } from "@/components/receipts-intro";
import { Reveal } from "@/components/reveal";
import { serviceOrgName } from "@/lib/program-tier";

export const metadata: Metadata = {
  title: {
    absolute: `${SITE_NAME} — Federal Defense Budget, Contracts & Lobbying`,
  },
  description:
    "Every defense R&D and procurement program element — budget figures, awarded contracts, and lobbying filings — all traceable to their source documents.",
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    title: `${SITE_NAME} — Federal Defense Budget, Contracts & Lobbying`,
    description:
      "Every defense R&D and procurement program element — budget figures, awarded contracts, and lobbying filings — all traceable to their source documents.",
    url: `${SITE_URL}/`,
    siteName: SITE_NAME,
    images: coreOgImages("home"),
  },
};

export default function HomePage() {
  const meta = getSiteMeta();
  const programs = getPrograms();
  const agencies = getAgencies();

  // Feed teaser: first 3 cards from the feed sidecar
  let feedTeaser: ReturnType<typeof getFeed>["cards"] = [];
  try {
    feedTeaser = getFeed().cards.slice(0, 3);
  } catch {
    // feed sidecar not yet generated — render without teaser
  }

  // Top 5 movers by |fy2526_change| (trajectory must be non-null + change non-null)
  const topMovers = programs
    .filter((p) => p.trajectory && p.trajectory.fy2526_change !== null)
    .sort(
      (a, b) =>
        Math.abs(b.trajectory!.fy2526_change!) -
        Math.abs(a.trajectory!.fy2526_change!),
    )
    .slice(0, 5);

  // Receipt moment: the largest FY2024-actuals figure with a jbook_pdf
  // citation — the panel renders the actual PDF page + highlight (Goal 1).
  const receiptFact = getReceiptMomentFact();

  // §P0-5: the canonical-TOA hero payload + corpus scope qualifier.
  const hero = meta.hero ?? null;
  const scopeQualifier = hero?.scope_qualifier ?? meta.scope_qualifier ?? null;

  // Citation slice: receipt-moment jbook_pdf fact_id + mover change fact_ids
  // (+ their peer inputs so the derived-card chips are clickable) + agency
  // FY24 derived fact_ids + feed teaser fact_ids.
  const pageFactIds: string[] = [];
  if (receiptFact) pageFactIds.push(receiptFact.fact_id);
  if (hero) pageFactIds.push(hero.fid);
  for (const p of topMovers) {
    if (p.trajectory_fact_ids?.fy2526_change) {
      pageFactIds.push(p.trajectory_fact_ids.fy2526_change);
    }
  }
  for (const a of agencies) {
    if (a.fy2024_fact_id_derived) pageFactIds.push(a.fy2024_fact_id_derived);
  }
  for (const card of feedTeaser) {
    if (card.figure_fact_id) pageFactIds.push(card.figure_fact_id);
  }
  const citationsSlice = collectCitationsWithInputs(pageFactIds);

  // Finding lede: the top feed event as a one-line finding in the hero.
  // Falls back to the static subtitle when the feed sidecar is empty
  // (same guard the teaser uses).
  const lede = feedTeaser.length > 0 ? feedTeaser[0] : null;
  // §57: the HHI scope note (null for non-hhi ledes) — see feed-headline.tsx.
  const ledeHhiScope = lede ? hhiScopeNote(lede) : null;

  return (
    <CitationPanelProvider citations={citationsSlice}>
    <div>
      {/* One-time dismissible receipts-mode coach mark (home only) */}
      <ReceiptsIntro />

      {/* ── Hero (compact — keeps the receipt moment above the fold) ─────── */}
      <section className="bg-background pt-10 pb-8 md:pt-14 md:pb-10">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
            Federal defense spending,{" "}
            <span className="text-primary">fully cited</span>
          </h1>
          {lede ? (
            <p className="text-base md:text-lg text-muted-foreground mb-6 max-w-2xl mx-auto">
              <span aria-hidden="true">⚡ </span>
              {/* data-source-text="headline": prose COMPOSED by the export
                  pipeline. Since backlog #44 it earns neither formatting
                  exemption — its dollar tokens carry their own fact ids
                  through <ProseCite> (see <FeedHeadline>). The marker's
                  remaining job is (a0): no [data-amount] may nest inside it,
                  which is what forces those per-token anchors.
                  data-xml-path is the block-level anchor (a0) requires. */}
              <span
                className={lede.program_url ? undefined : "text-foreground"}
                data-source-text="headline"
                data-xml-path={`site:feed/${lede.event_type}/${lede.pe_bli ?? lede.family_key ?? "unknown"}`}
              >
                <FeedHeadline
                  card={lede}
                  href={lede.program_url}
                  linkClassName="text-foreground hover:underline"
                />
              </span>
              {/* HHI scope note (site-authored prose, so it sits OUTSIDE the
                  data-source-text span — see feed-headline.tsx doc-comment).
                  Backlog #57: this used to gloss ANY hhi lede with a
                  two-way "near-monopoly" / "high supplier-concentration"
                  editorial split at the DOJ/FTC "highly concentrated"
                  FLOOR (>=2500 — four EQUAL competitors alone produce
                  2,500), which both overstated the band name and implied
                  the figure describes the PROGRAM generally. It is a single
                  fiscal year's HHI; the /program/ page it links to renders
                  a different, pooled all-years figure that can legitimately
                  land in a different band (dbt fct_feed_events year-slice
                  vs fct_program_concentration all-years/high+medium-
                  confidence pool) — hhiScopeNote() names the standard band
                  for THAT figure and says so explicitly, so a reader who
                  clicks through and finds a different band on the program
                  page can reconcile the two instead of catching the site in
                  a contradiction. data-hhi-band/data-hhi-scope-note are read
                  by scripts/gates/feed.mjs leg (l). */}
              {ledeHhiScope && (
                <>
                  {" — "}
                  <span data-hhi-scope-note="" data-hhi-band={ledeHhiScope.band}>
                    {ledeHhiScope.text}
                  </span>
                </>
              )}
              {" — "}
              <Link
                href="/feed/"
                className="text-primary underline decoration-dotted hover:decoration-solid whitespace-nowrap"
              >
                see the feed &rarr;
              </Link>
            </p>
          ) : (
            <p className="text-base md:text-lg text-muted-foreground mb-6 max-w-2xl mx-auto">
              Every budget figure, contract award, and lobbying dollar is
              linked back to its exact source document. No number without a
              receipt.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              data-search-trigger
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
              aria-label="Open search"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              Search programs, companies, agencies
            </button>
            <Link
              href="/programs/"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card text-foreground px-6 py-2.5 text-sm font-semibold hover:bg-muted transition-colors"
            >
              Browse all programs
            </Link>
          </div>
        </div>
      </section>

      {/* ── Receipt moment + persona row ─────────────────────────────────── */}
      <section className="bg-background border-b border-border pb-10 md:pb-12">
        <div className="container mx-auto px-4 max-w-4xl">
          {receiptFact && (
            <>
              <ReceiptMoment
                peBli={receiptFact.pe_bli}
                title={receiptFact.title}
                org={receiptFact.org}
                amountMillions={receiptFact.amount_millions}
                factId={receiptFact.fact_id}
                hero={hero}
              />
              {/* §P0-5 scope qualifier — small print under the superlative
                  (12px per P1-1; outside the card so the G4 fold assert on
                  [data-testid="receipt-moment"] is unaffected). */}
              {scopeQualifier && (
                <p
                  data-testid="hero-scope-qualifier"
                  className="mt-1.5 px-1 text-xs leading-5 text-muted-foreground"
                >
                  {"Scope: "}
                  {scopeQualifier}.
                </p>
              )}
            </>
          )}

          {/* Persona row — route the three primary jobs, no insider nouns.
              Staggered reveal on scroll (mobile: below the fold). */}
          <div
            data-testid="persona-row"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4"
          >
            <Reveal index={0} className="h-full">
              <PersonaCard
                href="/programs/"
                title="Verify a number"
                description="Pick any program, click a figure, and see the exact source page it comes from."
              />
            </Reveal>
            <Reveal index={1} className="h-full">
              <PersonaCard
                href="/district/"
                title="See what a district builds"
                description="Defense dollars mapped to the congressional districts where the work happens."
              />
            </Reveal>
            <Reveal index={2} className="h-full">
              <PersonaCard
                href="/feed/"
                title="Track who's winning"
                description="New contractors, big budget swings, and concentration signals — every build."
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Stats band (every stat links to its surface) ─────────────────── */}
      <section className="border-b border-border bg-muted/40 py-10">
        <Reveal className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <StatCard
              value={meta.counts.programs.toLocaleString("en-US")}
              label="program elements"
              href="/programs/"
              stat="programs"
            />
            <StatCard
              value={meta.counts.citations.toLocaleString("en-US")}
              label="source citations"
              href="/methodology/#verification"
              stat="citations"
            />
            <StatCard
              value={meta.counts.companies.toLocaleString("en-US")}
              label="contractor families"
              href="/companies/"
              stat="companies"
            />
            <StatCard
              value={meta.counts.agencies.toLocaleString("en-US")}
              label="defense agencies"
              href="#agencies"
              stat="agencies"
            />
          </div>
          {/* Coverage qualifier — the four totals above span datasets with
              different coverage (crosswalk, dossiers, districts, …). */}
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Coverage varies by dataset —{" "}
            <Link
              href="/methodology/#coverage"
              className="underline hover:text-foreground"
            >
              see methodology
            </Link>
            .
          </p>
        </Reveal>
      </section>

      {/* ── Top movers ───────────────────────────────────────────────────── */}
      <section className="py-12 border-b border-border">
        <Reveal className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold mb-2">Largest {TRAJECTORY_FY_LABEL} changes</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Programs with the biggest funding swings between FY2025 enacted and
            the FY2026 request, ranked by the size of the change in dollars with
            increases and decreases ranked together — when the list is all
            increases, that is the result, not a filter. Dollar deltas carry
            derived workbook citations — click a figure to inspect the formula
            and inputs.
            {/* Backlog #49: this used to hand-type the scope tail, which had
                drifted false ("appropriations not covered by the R-1/P-1
                rollups" — COLUMBIA is a P-1 line and still absent). Reads
                meta.corpus_scope now — the SAME string the hero qualifier
                and the /programs/, /years/, /methodology/, /data/ corpus
                statement carry, so this sentence cannot drift from them
                again. */}
            {scopeQualifier && meta.corpus_scope && (
              <span className="block mt-1 text-xs">
                Scope: ranked across the R&D and procurement program elements
                in our corpus ({meta.corpus_scope}).
              </span>
            )}
          </p>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
            {topMovers.map((p) => {
              const change = p.trajectory!.fy2526_change!;
              const isPos = change >= 0;
              // NOTE: the Cite (role=button) must NOT nest inside the Link —
              // axe flags nested-interactive. Title links; figure sits beside it.
              return (
                // PM Sprint 3 round-1 judging: this row used to be a single
                // `flex items-center justify-between` line whose Link was a
                // blockified flex item with `min-w-0` but no `overflow-hidden`
                // — so at 390 the inline title simply overflowed its box and
                // printed ON TOP of the dollar delta beside it. Two of the
                // five figures on the site's front page were unreadable.
                //
                // It stacks below `sm` (title above figure, so a collision is
                // impossible by construction) and keeps the one-line desktop
                // row above it. `min-w-0` alone was never enough; the Link now
                // also clips, so a long title truncates instead of escaping.
                <div
                  key={p.pe_bli}
                  data-mover-row=""
                  className="flex flex-col items-start gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/60 transition-colors group"
                >
                  <Link
                    href={`/program/${p.pe_bli}/`}
                    data-mobile-pair-label=""
                    className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 overflow-hidden"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.pe_bli}
                    </span>
                    <span className="text-sm font-medium group-hover:underline">
                      {p.title}
                    </span>
                    {/* §P1-E badge sweep: the human service name, never the
                        raw workbook token ("F"). */}
                    <span className="text-xs text-muted-foreground" title={`Organization code ${p.org}`}>
                      {serviceOrgName(p.org)}
                    </span>
                  </Link>
                  <div
                    data-mobile-pair-value=""
                    data-primary-value="mover-change"
                    className={[
                      "shrink-0 text-sm font-mono font-semibold sm:ml-4",
                      isPos ? "text-emerald-700" : "text-red-600",
                    ].join(" ")}
                  >
                    {isPos ? "+" : ""}
                    <Cite
                      value={change}
                      units="USD thousands"
                      dataset="fct_budget_trajectory"
                      factId={p.trajectory_fact_ids?.fy2526_change}
                      basis="toa"
                      fy={2026}
                      measure="change"
                      entity={p.pe_bli}
                      edition={2026}
                      chip={false}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Trajectory figures are derived from budget justification
            workbooks — each delta cites its FY25/FY26 inputs. See{" "}
            <Link href="/methodology/" className="underline hover:text-foreground">
              methodology
            </Link>
            .
          </p>
        </Reveal>
      </section>

      {/* ── Agency grid ──────────────────────────────────────────────────── */}
      <section id="agencies" className="py-12 scroll-mt-16">
        <Reveal className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold mb-2">Browse by agency</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {agencies.length} defense agencies — click to see all program
            elements.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[...agencies]
              .sort((a, b) => b.program_count - a.program_count)
              .map((agency) => (
                // Cite (role=button) must not nest inside the Link — the org
                // name links; the FY24 sum is a sibling Cite (derived citation).
                <div
                  key={agency.org}
                  className="group flex flex-col rounded-lg border border-border bg-card p-4 hover:bg-muted/60 hover:border-primary/50 transition-colors interactive-raise"
                >
                  {/* §P1-E badge sweep: label humanized, href keeps the
                      raw org code (the agency page's identity). */}
                  <Link
                    href={`/agency/${agency.org}/`}
                    className="font-bold text-sm text-primary group-hover:underline"
                    title={`Organization code ${agency.org}`}
                  >
                    {serviceOrgName(agency.org)}
                  </Link>
                  <span className="text-xs text-muted-foreground mt-1">
                    {agency.program_count} program
                    {agency.program_count !== 1 ? "s" : ""}
                  </span>
                  {agency.fy2024_total_millions > 0 && (
                    <span className="text-xs text-muted-foreground mt-0.5">
                      <Cite
                        value={agency.fy2024_total_millions}
                        units="USD millions"
                        dataset="dim_programs"
                        factId={agency.fy2024_fact_id_derived}
                        basis="jbook-detail"
                        fy={2024}
                        measure="actuals"
                        entity={agency.org}
                        edition={2026}
                        chip={false}
                      />{" "}
                      FY24
                    </span>
                  )}
                </div>
              ))}
          </div>
        </Reveal>
      </section>

      {/* ── Feed teaser ──────────────────────────────────────────────────── */}
      {feedTeaser.length > 0 && (
        <section className="py-12 border-b border-border">
          <Reveal className="container mx-auto px-4 max-w-5xl">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-2xl font-bold">Anomaly Feed</h2>
              <Link
                href="/feed/"
                className="text-sm text-primary underline decoration-dotted hover:decoration-solid"
              >
                View all &rarr;
              </Link>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Automated signals: budget swings, cancelled programs, and new
              contractors. Figures cite their source.
            </p>
            {/* Round-3 judging: `truncate` cut all three headlines at the SAME
                point at 390, so the three cards read identically and the
                differentiator — the value and the year — was exactly what was
                lost. The headline wraps to two lines now (line-clamp keeps the
                row height bounded), and "view →" drops below it on a phone
                instead of stealing its width. */}
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
              {feedTeaser.map((card, i) => (
                <div
                  key={`feed-${i}`}
                  className="flex flex-col gap-1 px-5 py-4 hover:bg-muted/60 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    {/* data-source-text="headline": pipeline-composed prose
                        whose dollar tokens carry their own fact ids through
                        <ProseCite> (backlog #44). data-xml-path is the
                        block-level anchor (a0) requires. */}
                    <p
                      className="text-sm font-medium line-clamp-2 sm:truncate"
                      data-source-text="headline"
                      data-xml-path={`site:feed/${card.event_type}/${card.pe_bli ?? card.family_key ?? i}`}
                    >
                      <FeedHeadline card={card} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {card.event_type.replace(/_/g, " ")}
                    </p>
                  </div>
                  {card.program_url && (
                    <Link
                      href={card.program_url}
                      className="shrink-0 self-start text-xs text-primary underline decoration-dotted hover:decoration-solid sm:ml-4 sm:self-auto"
                    >
                      view &rarr;
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </Reveal>
        </section>
      )}

      {/* ── Trust anchor ─────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-muted/30 py-10">
        <Reveal className="container mx-auto px-4 max-w-3xl text-center">
          <p className="text-muted-foreground text-sm">
            All figures are cited to their exact source document, page, API
            query, or derived formula — every published dataset carries a
            citation tier. See{" "}
            <Link href="/methodology/" className="underline hover:text-foreground">
              full methodology
            </Link>
            . Correlation is shown, not causation.
          </p>
        </Reveal>
      </section>
    </div>
    </CitationPanelProvider>
  );
}

function StatCard({
  value,
  label,
  href,
  stat,
}: {
  value: string;
  label: string;
  href: string;
  stat: string;
}) {
  return (
    <Link
      href={href}
      data-stat={stat}
      className="group flex flex-col items-center rounded-lg px-3 py-2 hover:bg-muted/60 transition-colors interactive-raise"
    >
      <span className="text-3xl md:text-4xl font-bold text-foreground tabular-nums group-hover:text-primary transition-colors">
        {value}
      </span>
      <span className="text-sm text-muted-foreground mt-1">
        {label}
        <span
          aria-hidden="true"
          className="inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          &rarr;
        </span>
      </span>
    </Link>
  );
}

function PersonaCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-lg border border-border bg-card p-4 hover:bg-muted/60 hover:border-primary/50 transition-colors interactive-raise"
    >
      <span className="text-sm font-semibold text-foreground group-hover:underline">
        {title} <span aria-hidden="true">&rarr;</span>
      </span>
      <span className="mt-1 text-xs text-muted-foreground leading-5">
        {description}
      </span>
    </Link>
  );
}
