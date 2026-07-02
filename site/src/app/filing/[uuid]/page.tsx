import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getFilingsIndex,
  getFilingDetail,
  collectCitations,
} from "@/lib/data";
import { humanLdaUrl } from "@/lib/citations";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";

// ── SSG config — 4,258 filing pages, no fallback ──────────────────────────────

export const dynamicParams = false;

interface Props {
  params: Promise<{ uuid: string }>;
}

export function generateStaticParams(): { uuid: string }[] {
  try {
    return getFilingsIndex().filings.map((f) => ({ uuid: f.filing_uuid }));
  } catch {
    return [];
  }
}

// ── Metadata ──────────────────────────────────────────────────────────────────
//
// Policy (plan Task 6a, binding):
//   - canonical → the human lda.senate.gov filing page (authoritative source)
//   - robots noindex when the filing has zero program mentions (1,170 / 4,258
//     thin pages stay crawlable but unindexed)
//   - shared static OG image for all filings (decision 3 — no per-filing render)

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uuid } = await params;
  let detail;
  try {
    detail = getFilingDetail(uuid);
  } catch {
    return { title: "Filing Not Found" };
  }
  const f = detail.filing;
  const hasMentions = detail.mentions.length > 0;
  const client = f.client_name ?? "Unknown client";
  const year = f.filing_year ?? "";
  const title = `${client} — Lobbying Filing ${year} | ${SITE_NAME}`;
  const description = `Senate LDA filing ${f.filing_type ?? ""} ${year} — client ${client}, registrant ${f.registrant_name ?? "unknown"}. Activities, lobbyists, and tracked program mentions.`;
  const human = humanLdaUrl(f.url);

  return {
    title,
    description,
    // Canonical points at the authoritative human LDA page, not our copy.
    alternates: { canonical: human ?? `${SITE_URL}/filing/${uuid}/` },
    robots: hasMentions ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/filing/${uuid}/`,
      siteName: SITE_NAME,
      images: [{ url: `${SITE_URL}/og-default-filing.png`, width: 1200, height: 630 }],
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "first_quarter" → "First Quarter" (display only; raw values kept in data). */
function prettyPeriod(period: string | null): string | null {
  if (!period) return null;
  return period
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function FilingPage({ params }: Props) {
  const { uuid } = await params;
  let detail;
  try {
    detail = getFilingDetail(uuid);
  } catch {
    notFound();
  }
  const f = detail.filing;
  const hasMentions = detail.mentions.length > 0;
  const human = humanLdaUrl(f.url);

  // Citation slice — filing-level lda_filing rows (income/expenses)
  const pageFactIds: string[] = [];
  if (f.income_fact_id) pageFactIds.push(f.income_fact_id);
  if (f.expenses_fact_id) pageFactIds.push(f.expenses_fact_id);
  const citationsSlice = collectCitations(pageFactIds);

  const clientLabel = f.client_name ?? "Unknown client";

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div
        className="container mx-auto px-4 py-8 max-w-4xl"
        {...(hasMentions ? { "data-pagefind-body": true } : {})}
      >
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Filings", href: "/filings/" },
            { label: clientLabel },
          ]}
        />

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Senate LDA lobbying filing
          </p>
          <h1 className="text-3xl font-bold mb-2">{clientLabel}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>
              Registrant:{" "}
              <span className="text-foreground font-medium">
                {f.registrant_name ?? "not reported"}
              </span>
            </span>
            {f.filing_year && (
              <span>
                Year:{" "}
                <span className="text-foreground font-medium">{f.filing_year}</span>
              </span>
            )}
            {f.filing_period && (
              <span>
                Period:{" "}
                <span className="text-foreground font-medium">
                  {prettyPeriod(f.filing_period)}
                </span>
              </span>
            )}
            {f.filing_type && (
              <span>
                Type:{" "}
                <span className="text-foreground font-medium font-mono">
                  {f.filing_type}
                </span>
              </span>
            )}
          </div>

          {/* Canonical source link — always visible */}
          <p className="mt-3 text-sm">
            {human ? (
              <a
                href={human}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                View on lda.senate.gov ↗
              </a>
            ) : (
              <span className="text-muted-foreground">
                Source: Senate LDA filing API
              </span>
            )}
          </p>
        </div>

        {/* Income / expenses — state A via filing-level lda citations,
            "not reported" plain text when the filing omits the amount. */}
        <div className="grid grid-cols-2 gap-4 max-w-md mb-8">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
              Reported income
            </p>
            <p className="text-xl font-bold tabular-nums">
              {f.income_usd !== null && f.income_fact_id ? (
                <Cite
                  value={f.income_usd}
                  units="USD"
                  dataset="lda_filings"
                  factId={f.income_fact_id}
                />
              ) : (
                <span className="text-muted-foreground text-base font-normal">
                  not reported
                </span>
              )}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
              Reported expenses
            </p>
            <p className="text-xl font-bold tabular-nums">
              {f.expenses_usd !== null && f.expenses_fact_id ? (
                <Cite
                  value={f.expenses_usd}
                  units="USD"
                  dataset="lda_filings"
                  factId={f.expenses_fact_id}
                />
              ) : (
                <span className="text-muted-foreground text-base font-normal">
                  not reported
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Tracked program mentions */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">
            Tracked program mentions
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {detail.mentions.length}
            </span>
          </h2>
          {hasMentions ? (
            <ul className="space-y-3">
              {detail.mentions.map((m, i) => (
                <li
                  key={`${m.pe_bli}-${i}`}
                  className="rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    {m.program_url ? (
                      <Link
                        href={m.program_url}
                        className="font-medium text-primary hover:underline"
                        data-program-name
                      >
                        {m.program_title ?? m.pe_bli}
                      </Link>
                    ) : (
                      <span className="font-medium" data-program-name>
                        {m.program_title ?? m.pe_bli}
                      </span>
                    )}
                    <span className="font-mono text-xs text-muted-foreground">
                      {m.pe_bli}
                    </span>
                    {m.matched_term && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        matched: “{m.matched_term}”
                      </span>
                    )}
                  </div>
                  {m.description_snippet && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-3 overflow-hidden">
                      {m.description_snippet}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              This filing does not mention any program tracked by {SITE_NAME}.
            </p>
          )}
        </section>

        {/* Lobbying activities */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">
            Lobbying activities
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {detail.activities.length}
            </span>
          </h2>
          {detail.activities.length > 0 ? (
            <ul className="space-y-3">
              {detail.activities.map((a, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-border bg-card px-4 py-3"
                >
                  <p className="text-sm font-medium mb-1">
                    {a.issue_display ?? a.issue_code ?? "General issue"}
                    {a.issue_code && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {a.issue_code}
                      </span>
                    )}
                  </p>
                  {a.description && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {a.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No activities reported on this filing.
            </p>
          )}
        </section>

        {/* Lobbyists — covered_position non-empty ⇒ revolving-door badge */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">
            Lobbyists
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {detail.lobbyists.length}
            </span>
          </h2>
          {detail.lobbyists.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {detail.lobbyists.map((l, i) => {
                const covered =
                  l.covered_position && l.covered_position.trim() !== ""
                    ? l.covered_position.trim()
                    : null;
                return (
                  <li
                    key={`${l.name}-${i}`}
                    className="rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">{l.name}</span>
                      {covered && (
                        <span
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                          title="Previously held a covered government position (LDA §1602 disclosure)"
                        >
                          revolving door
                        </span>
                      )}
                    </div>
                    {covered && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {covered}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No lobbyists listed on this filing.
            </p>
          )}
        </section>

        <p className="text-xs text-muted-foreground border-t border-border pt-4">
          Source: U.S. Senate Lobbying Disclosure Act database. Dollar figures
          (underlined) cite the filing record on lda.senate.gov — click to view
          the citation. Amounts shown as “not reported” are absent from the
          filing itself.
        </p>
      </div>
    </CitationPanelProvider>
  );
}
