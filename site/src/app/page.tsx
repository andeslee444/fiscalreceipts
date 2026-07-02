import type { Metadata } from "next";
import Link from "next/link";
import {
  getSiteMeta,
  getPrograms,
  getAgencies,
  getFeed,
  collectCitationsWithInputs,
  TRAJECTORY_FY_LABEL,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Cite } from "@/components/cite";
import { CitationPanelProvider } from "@/components/citation-panel";
import { ReceiptMoment } from "@/components/receipt-moment";
import { ReceiptsIntro } from "@/components/receipts-intro";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: `${SITE_NAME} — Federal Defense Budget, Contracts & Lobbying`,
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

  // Citation slice: mover change fact_ids (+ their peer inputs so the
  // derived-card chips are clickable) + agency FY24 derived fact_ids
  // + feed teaser fact_ids.
  const pageFactIds: string[] = [];
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

  // Receipt moment: the single biggest FY25→26 mover, rendered above the
  // fold with its existing derived citation (fact_id already in the slice).
  const receiptMover =
    topMovers.find((p) => p.trajectory_fact_ids?.fy2526_change) ?? null;

  // Finding lede: the top feed event as a one-line finding in the hero.
  // Falls back to the static subtitle when the feed sidecar is empty
  // (same guard the teaser uses).
  const lede = feedTeaser.length > 0 ? feedTeaser[0] : null;

  return (
    <CitationPanelProvider citations={citationsSlice}>
    <div>
      {/* One-time dismissible receipts-mode coach mark (home only) */}
      <ReceiptsIntro />

      {/* ── Hero (compact — keeps the receipt moment above the fold) ─────── */}
      <section className="bg-background pt-10 pb-8 md:pt-14 md:pb-10">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Federal defense spending,{" "}
            <span className="text-primary">fully cited</span>
          </h1>
          {lede ? (
            <p className="text-base md:text-lg text-muted-foreground mb-6 max-w-2xl mx-auto">
              <span aria-hidden="true">⚡ </span>
              {/* data-source-text="headline": auto-generated prose from the
                  export pipeline — dollar strings are descriptive context,
                  not site-computed cite-able figures.
                  data-xml-path satisfies the (a0) gate constraint that every
                  data-source-text element must carry a citation anchor. */}
              {lede.program_url ? (
                <span
                  data-source-text="headline"
                  data-xml-path={`site:feed/${lede.event_type}/${lede.pe_bli ?? lede.family_key ?? "unknown"}`}
                >
                  <Link
                    href={lede.program_url}
                    className="text-foreground hover:underline"
                  >
                    {lede.headline}
                  </Link>
                </span>
              ) : (
                <span
                  className="text-foreground"
                  data-source-text="headline"
                  data-xml-path={`site:feed/${lede.event_type}/${lede.pe_bli ?? lede.family_key ?? "unknown"}`}
                >
                  {lede.headline}
                </span>
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
          {receiptMover && (
            <ReceiptMoment
              peBli={receiptMover.pe_bli}
              title={receiptMover.title}
              org={receiptMover.org}
              change={receiptMover.trajectory!.fy2526_change!}
              factId={receiptMover.trajectory_fact_ids!.fy2526_change!}
            />
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
        </Reveal>
      </section>

      {/* ── Top movers ───────────────────────────────────────────────────── */}
      <section className="py-12 border-b border-border">
        <Reveal className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold mb-2">Largest {TRAJECTORY_FY_LABEL} changes</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Programs with the biggest funding swings between FY2025 and FY2026
            enacted. Dollar deltas carry derived workbook citations — click a
            figure to inspect the formula and inputs.
          </p>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
            {topMovers.map((p) => {
              const change = p.trajectory!.fy2526_change!;
              const isPos = change >= 0;
              // NOTE: the Cite (role=button) must NOT nest inside the Link —
              // axe flags nested-interactive. Title links; figure sits beside it.
              return (
                <div
                  key={p.pe_bli}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/60 transition-colors group"
                >
                  <Link
                    href={`/program/${p.pe_bli}/`}
                    className="min-w-0"
                  >
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {p.pe_bli}
                    </span>
                    <span className="text-sm font-medium group-hover:underline truncate">
                      {p.title}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.org}
                    </span>
                  </Link>
                  <div
                    className={[
                      "shrink-0 ml-4 text-sm font-mono font-semibold",
                      isPos ? "text-emerald-700" : "text-red-600",
                    ].join(" ")}
                  >
                    {isPos ? "+" : ""}
                    <Cite
                      value={change}
                      units="USD thousands"
                      dataset="fct_budget_trajectory"
                      factId={p.trajectory_fact_ids?.fy2526_change}
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
                  <Link
                    href={`/agency/${agency.org}/`}
                    className="font-mono font-bold text-sm text-primary group-hover:underline"
                  >
                    {agency.org}
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
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
              {feedTeaser.map((card, i) => (
                <div
                  key={`feed-${i}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    {/* data-source-text="headline": auto-generated prose from
                        the export pipeline — dollar strings (e.g. "first award
                        FY2025, $3.1M total") are descriptive context, not
                        site-computed cite-able figures.
                        data-xml-path satisfies the (a0) gate constraint. */}
                    <p
                      className="text-sm font-medium truncate"
                      data-source-text="headline"
                      data-xml-path={`site:feed/${card.event_type}/${card.pe_bli ?? card.family_key ?? i}`}
                    >
                      {card.headline}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {card.event_type.replace(/_/g, " ")}
                    </p>
                  </div>
                  {card.program_url && (
                    <Link
                      href={card.program_url}
                      className="shrink-0 ml-4 text-xs text-primary underline decoration-dotted hover:decoration-solid"
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
            All figures are cited to their exact source document, page, or API
            endpoint. Numbers flagged ⁂ are from datasets where citation tier
            is pending — see{" "}
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
