import type { Metadata } from "next";
import Link from "next/link";
import { getSiteMeta, getPrograms, getAgencies } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Cite } from "@/components/cite";
import { formatAmount } from "@/lib/format";

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
  },
};

export default function HomePage() {
  const meta = getSiteMeta();
  const programs = getPrograms();
  const agencies = getAgencies();

  // Top 5 movers by |fy2526_change| (trajectory must be non-null + change non-null)
  const topMovers = programs
    .filter((p) => p.trajectory && p.trajectory.fy2526_change !== null)
    .sort(
      (a, b) =>
        Math.abs(b.trajectory!.fy2526_change!) -
        Math.abs(a.trajectory!.fy2526_change!),
    )
    .slice(0, 5);

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-background border-b border-border py-16 md:py-24">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-6">
            Federal defense spending,{" "}
            <span className="text-primary">fully cited</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Every budget figure, contract award, and lobbying dollar is linked
            back to its exact source document — J-book XML, USAspending
            archive, or LDA Senate filing. No number without a receipt.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              data-search-trigger
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-8 py-3 text-base font-semibold hover:opacity-90 transition-opacity"
              aria-label="Open search"
            >
              <svg
                className="w-5 h-5"
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
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card text-foreground px-8 py-3 text-base font-semibold hover:bg-muted transition-colors"
            >
              Browse all programs
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats band ───────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <StatCard
              value={meta.counts.programs.toLocaleString("en-US")}
              label="program elements"
            />
            <StatCard
              value={meta.counts.citations.toLocaleString("en-US")}
              label="source citations"
            />
            <StatCard
              value={meta.counts.companies.toLocaleString("en-US")}
              label="contractor families"
            />
            <StatCard
              value={meta.counts.agencies.toLocaleString("en-US")}
              label="defense agencies"
            />
          </div>
        </div>
      </section>

      {/* ── Top movers ───────────────────────────────────────────────────── */}
      <section className="py-12 border-b border-border">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold mb-2">Largest FY25→26 changes</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Programs with the biggest funding swings between FY2025 and FY2026
            enacted. Dollar deltas are from the trajectory dataset —{" "}
            <span className="font-medium">citation tier pending</span> (⁂).
          </p>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
            {topMovers.map((p) => {
              const change = p.trajectory!.fy2526_change!;
              const isPos = change >= 0;
              return (
                <Link
                  key={p.pe_bli}
                  href={`/program/${p.pe_bli}/`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/60 transition-colors group"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {p.pe_bli}
                    </span>
                    <span className="text-sm font-medium group-hover:underline truncate">
                      {p.title}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.org}
                    </span>
                  </div>
                  <div
                    className={[
                      "shrink-0 ml-4 text-sm font-mono font-semibold",
                      isPos ? "text-emerald-700" : "text-red-600",
                    ].join(" ")}
                  >
                    {isPos ? "+" : ""}
                    <Cite value={change} units="USD thousands" />
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            ⁂ Trajectory figures are from budget justification workbooks —
            citation tier pending for this dataset. See{" "}
            <Link href="/methodology/" className="underline hover:text-foreground">
              methodology
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── Agency grid ──────────────────────────────────────────────────── */}
      <section className="py-12">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold mb-2">Browse by agency</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {agencies.length} defense agencies — click to see all program
            elements.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {agencies
              .sort((a, b) => b.program_count - a.program_count)
              .map((agency) => (
                <Link
                  key={agency.org}
                  href={`/agency/${agency.org}/`}
                  className="group flex flex-col rounded-lg border border-border bg-card p-4 hover:bg-muted/60 hover:border-primary/50 transition-colors"
                >
                  <span className="font-mono font-bold text-sm text-primary group-hover:underline">
                    {agency.org}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
                    {agency.program_count} program
                    {agency.program_count !== 1 ? "s" : ""}
                  </span>
                  {agency.fy2024_total_millions > 0 && (
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {formatAmount(agency.fy2024_total_millions, "USD millions")}{" "}
                      FY24 ⁂
                    </span>
                  )}
                </Link>
              ))}
          </div>
        </div>
      </section>

      {/* ── Trust anchor ─────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-muted/30 py-10">
        <div className="container mx-auto px-4 max-w-3xl text-center">
          <p className="text-muted-foreground text-sm">
            All figures are cited to their exact source document, page, or API
            endpoint. Numbers flagged ⁂ are from datasets where citation tier
            is pending — see{" "}
            <Link href="/methodology/" className="underline hover:text-foreground">
              full methodology
            </Link>
            . Correlation is shown, not causation.
          </p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-3xl md:text-4xl font-bold text-foreground tabular-nums">
        {value}
      </span>
      <span className="text-sm text-muted-foreground mt-1">{label}</span>
    </div>
  );
}
