import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getEntitiesTop,
  getEntityTopMap,
  getEntityDetails,
  collectCitationsWithInputs,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { companyOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Cite } from "@/components/cite";
import { CitationPanelProvider } from "@/components/citation-panel";
import { humanLdaUrl } from "@/lib/citations";

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return getEntitiesTop().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entity = getEntityTopMap().get(slug);
  if (!entity) return { title: "Company Not Found" };

  const canonical = `${SITE_URL}/company/${slug}/`;
  return {
    title: `${entity.display_name} — ${SITE_NAME}`,
    description: `${entity.display_name}: federal defense obligations, lobbying filings, and program connections.`,
    alternates: { canonical },
    openGraph: {
      title: `${entity.display_name} — Defense Contracts & Lobbying | ${SITE_NAME}`,
      description: `${entity.display_name}: federal defense obligations, lobbying filings, and program connections.`,
      url: canonical,
      siteName: SITE_NAME,
      images: companyOgImages(slug),
    },
  };
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-red-100 text-red-700 border-red-200",
};

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entity = getEntityTopMap().get(slug);
  if (!entity) notFound();

  const details = getEntityDetails(slug);

  // Resolve family_obligations_usd from influence rows (non-additive — show once)
  const firstInfluenceRow = details.influence[0];
  const familyObligationsUsd = firstInfluenceRow?.family_obligations_usd;
  const familyObligationsFactId =
    firstInfluenceRow?.family_obligations_fact_id ?? null;

  // Linked programs chips
  const linkedPrograms = details.linked_programs.slice(0, 20);

  // Citation slice: entity total + influence dollars (Phase 5B-3 flips).
  // Derived inputs are URLs (filing API links) → no extra slice entries.
  const pageFactIds: string[] = [];
  if (entity.total_obligation_fact_id) {
    pageFactIds.push(entity.total_obligation_fact_id);
  }
  if (familyObligationsFactId) pageFactIds.push(familyObligationsFactId);
  for (const row of details.influence) {
    for (const fid of [row.income_fact_id, row.expense_fact_id, row.total_fact_id]) {
      if (fid) pageFactIds.push(fid);
    }
  }
  const citationsSlice = collectCitationsWithInputs(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
    <div className="container mx-auto px-4 py-8 max-w-5xl" data-pagefind-body>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Companies", href: "/companies/" },
          { label: entity.display_name },
        ]}
      />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{entity.display_name}</h1>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-3">
          <span>
            <span className="font-medium text-foreground">
              {entity.uei_count}
            </span>{" "}
            unique entity identifier
            {entity.uei_count !== 1 ? "s" : ""}
          </span>
          <span>
            Total obligations:{" "}
            <Cite
              value={entity.total_obligation}
              units="USD"
              dataset="dim_entities"
              factId={entity.total_obligation_fact_id}
            />
          </span>
          <span
            className={[
              "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium",
              CONFIDENCE_COLORS[entity.worst_confidence] ??
                "bg-muted border-border text-muted-foreground",
            ].join(" ")}
          >
            {entity.worst_confidence} confidence
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Total obligations carry a derived USAspending citation — click the
          figure to inspect the derivation. Confidence reflects entity
          resolution method (see{" "}
          <Link href="/methodology/#4" className="underline hover:text-foreground">
            methodology §4
          </Link>
          ).
        </p>

        {/* Family obligations — non-additive, shown once.
            Rendered only when the figure carries its derived citation
            (cited-or-absent under the dataset-ledger gate). */}
        {familyObligationsUsd != null && familyObligationsFactId != null && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <span className="font-medium">Family-level obligations:</span>{" "}
            <Cite
              value={familyObligationsUsd}
              units="USD"
              dataset="fct_influence"
              factId={familyObligationsFactId}
            />
            <span className="ml-2 text-xs text-amber-700">
              — constant across all filing years listed below and non-additive
              (do not sum across rows; this figure represents total family
              obligations across the full USAspending dataset).
            </span>
          </div>
        )}
      </div>

      {/* ── Lobbying influence table ─────────────────────────────────────── */}
      {details.influence.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Lobbying Activity</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Filings from the Senate Lobbying Disclosure Act database.
            Amounts are raw USD from LDA filings. Correlation is shown, not
            causation.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                    Filing year
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground text-right">
                    Filings
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground text-right">
                    Income
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground text-right">
                    Expense
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {details.influence.map((row, i) => (
                  <tr
                    key={`${row.filing_year}-${i}`}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs">
                      {String(row.filing_year)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {Number(row.filings_count)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.lobbying_income_usd != null ? (
                        <Cite
                          value={row.lobbying_income_usd as number}
                          units="USD"
                          dataset="fct_influence"
                          factId={row.income_fact_id}
                        />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.lobbying_expense_usd != null ? (
                        <Cite
                          value={row.lobbying_expense_usd as number}
                          units="USD"
                          dataset="fct_influence"
                          factId={row.expense_fact_id}
                        />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.lobbying_total_usd != null ? (
                        <Cite
                          value={row.lobbying_total_usd as number}
                          units="USD"
                          dataset="fct_influence"
                          factId={row.total_fact_id}
                        />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Lobbying dollar aggregates carry derived LDA citations — click a
            figure for the formula and constituent filings. This table shows
            lobbying activity side by side with federal obligations; lobbying
            and contracts reflect correlation, not causation.
          </p>
        </section>
      )}

      {/* ── Linked programs chips ────────────────────────────────────────── */}
      {linkedPrograms.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">
            Budget Program Mentions
          </h2>
          <div className="flex flex-wrap gap-2">
            {linkedPrograms.map((lp) => (
              <Link
                key={lp.pe_bli}
                href={`/program/${lp.pe_bli}/`}
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted/60 transition-colors"
              >
                <span className="font-mono text-muted-foreground">
                  {lp.pe_bli}
                </span>
                <span className="truncate max-w-[200px]">{lp.title}</span>
              </Link>
            ))}
            {details.linked_programs.length > 20 && (
              <span className="inline-flex items-center px-2 py-1 text-xs text-muted-foreground">
                +{details.linked_programs.length - 20} more — see mentions
                below
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── Mentions list ────────────────────────────────────────────────── */}
      {details.mentions.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">
            LDA Filing Mentions ({details.mentions.length})
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Lobbying filings that mention a budget program by name or code.
          </p>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
            {details.mentions.slice(0, 50).map((m, i) => {
              const humanUrl = humanLdaUrl(m.filing_url);
              return (
                <div key={`${m.filing_uuid}-${i}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Link
                      href={`/program/${m.pe_bli}/`}
                      className="font-medium text-sm hover:underline"
                    >
                      {m.program_title}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {m.pe_bli}
                    </span>
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {m.filing_year}
                    </span>
                    {m.matched_term && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                        {m.matched_term}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {humanUrl ? (
                      <a
                        href={humanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground"
                      >
                        View LDA filing ↗
                      </a>
                    ) : (
                      <span>LDA filing (no link available)</span>
                    )}
                  </div>
                </div>
              );
            })}
            {details.mentions.length > 50 && (
              <div className="px-5 py-3 text-sm text-muted-foreground bg-muted/40">
                Showing 50 of {details.mentions.length} mentions.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Awards section ───────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Budget-Linked Awards</h2>
        {details.awards.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 px-5 py-6 text-sm text-muted-foreground">
            <p>
              No crosswalk-linked award rows for this family — our
              budget→award links are confidence-tiered; see{" "}
              <Link
                href="/methodology/"
                className="underline hover:text-foreground"
              >
                methodology
              </Link>
              .
            </p>
            <p className="mt-2 text-xs">
              The crosswalk mart contains R&amp;D performers, not primes.
              Approximately 18 of the top-200 contractor families have
              award links in the current dataset. A family-level awards mart
              is on the roadmap.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                    Recipient
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                    Award PIID
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground text-center">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {details.awards.map((award, i) => (
                  <tr
                    key={`${award.award_piid}-${i}`}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      {award.recipient_name ?? entity.display_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {award.award_piid ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {award.confidence && (
                        <span
                          className={[
                            "inline-block rounded px-2 py-0.5 text-xs font-medium",
                            CONFIDENCE_COLORS[award.confidence] ??
                              "bg-muted text-muted-foreground",
                          ].join(" ")}
                        >
                          {award.confidence}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
    </CitationPanelProvider>
  );
}
