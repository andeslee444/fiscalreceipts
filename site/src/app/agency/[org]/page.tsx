import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAgencies,
  getAgencyMap,
  getPrograms,
  getGaoOverlayForOrg,
  collectCitationsWithInputs,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { agencyOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Cite } from "@/components/cite";
import { CitationPanelProvider } from "@/components/citation-panel";
import { governmentOrganizationJsonLd, safeJsonLd } from "@/lib/jsonld";

export const dynamicParams = false;

export function generateStaticParams(): { org: string }[] {
  return getAgencies().map((a) => ({ org: a.org }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const { org } = await params;
  const agency = getAgencyMap().get(org);
  if (!agency) return { title: "Agency Not Found" };

  const canonical = `${SITE_URL}/agency/${org}/`;
  return {
    title: `${org} — ${SITE_NAME}`,
    description: `${org}: ${agency.program_count} defense program elements with FY2024 and FY2026 budget data.`,
    alternates: { canonical },
    openGraph: {
      title: `${org} Defense Programs — ${SITE_NAME}`,
      description: `${agency.program_count} program elements for ${org}.`,
      url: canonical,
      siteName: SITE_NAME,
      images: agencyOgImages(org),
    },
  };
}

export default async function AgencyPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const agency = getAgencyMap().get(org);
  if (!agency) notFound();

  const allPrograms = getPrograms();
  const agencyPrograms = allPrograms
    .filter((p) => p.org === org)
    .sort((a, b) => {
      const av = a.trajectory?.fy2026_total ?? a.fy2024_actual_millions ?? 0;
      const bv = b.trajectory?.fy2026_total ?? b.fy2024_actual_millions ?? 0;
      return bv - av;
    });

  const pageUrl = `${SITE_URL}/agency/${org}/`;

  // GAO oversight overlay (Task 6b) — high-risk areas + improper exposure
  const gao = getGaoOverlayForOrg(org);

  // Citation slice: agency derived sums (+ their inputs so derived-card
  // chips are clickable) + per-program FY24 jbook fact_ids + the improper
  // exposure derived fact_id (oversight section).
  const pageFactIds: string[] = [];
  if (agency.fy2024_fact_id_derived) pageFactIds.push(agency.fy2024_fact_id_derived);
  if (agency.fy2026_fact_id_derived) pageFactIds.push(agency.fy2026_fact_id_derived);
  for (const p of agencyPrograms) {
    if (p.fy2024_fact_id) pageFactIds.push(p.fy2024_fact_id);
  }
  if (gao?.overlay.improper?.fact_id) {
    pageFactIds.push(gao.overlay.improper.fact_id);
  }
  const citationsSlice = collectCitationsWithInputs(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(governmentOrganizationJsonLd(org, pageUrl)),
        }}
      />
      <div className="container mx-auto px-4 py-8 max-w-5xl" data-pagefind-body>
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Agencies", href: "/#agencies" },
            { label: org },
          ]}
        />

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-3">{org}</h1>
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">
                {agency.program_count}
              </strong>{" "}
              program{agency.program_count !== 1 ? "s" : ""}
            </span>
            <span>
              FY24 total:{" "}
              <Cite
                value={agency.fy2024_total_millions}
                units="USD millions"
                dataset="dim_programs"
                factId={agency.fy2024_fact_id_derived}
              />
            </span>
            {agency.fy2026_total_thousands != null && (
              <span>
                FY26 total:{" "}
                <Cite
                  value={agency.fy2026_total_thousands}
                  units="USD thousands"
                  dataset="dim_programs"
                  factId={agency.fy2026_fact_id_derived}
                />
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Aggregate totals are derived sums over this agency&apos;s program
            figures — click a total to inspect the formula and its cited
            inputs. Individual program FY24 figures are J-book–cited where
            underlined. See{" "}
            <Link
              href="/methodology/"
              className="underline hover:text-foreground"
            >
              methodology
            </Link>
            .
          </p>
        </div>

        {/* GAO oversight overlay (Task 6b) */}
        {gao && (
          <section id="oversight" className="mb-8">
            <h2 className="text-xl font-semibold mb-1">Oversight</h2>
            <p className="text-sm text-muted-foreground mb-4">
              GAO oversight context for the parent department (
              {gao.agencyCode}) — {org} is a {gao.agencyCode} component.
            </p>

            {gao.overlay.high_risk_areas.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold mb-2">
                  GAO high-risk areas ({gao.agencyCode})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {gao.overlay.high_risk_areas.map((area) => (
                    <a
                      key={area.area_title}
                      href={area.area_url ?? area.source_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={area.notes ?? undefined}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-500/20 transition-colors"
                    >
                      <span aria-hidden="true">⚠</span>
                      {area.area_title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* fact_id guard: the figure renders ONLY when its derived
                citation resolves — fct_improper_exposure is off the uncited
                ledger, so a state-C span here would fail the render gate. */}
            {gao.overlay.improper && gao.overlay.improper.fact_id && (
              <div className="rounded-lg border border-border bg-card p-4 max-w-xl">
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                  Estimated improper-payment exposure ({gao.agencyCode}
                  {gao.overlay.improper.latest_fiscal_year
                    ? `, FY${gao.overlay.improper.latest_fiscal_year}`
                    : ""}
                  )
                </p>
                <p className="text-2xl font-bold tabular-nums">
                  <Cite
                    value={gao.overlay.improper.derived_improper_amount_usd}
                    units="USD"
                    dataset="fct_improper_exposure"
                    factId={gao.overlay.improper.fact_id}
                  />
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {gao.overlay.improper.weighted_rate_pct != null && (
                    <>
                      Weighted improper-payment rate{" "}
                      {gao.overlay.improper.weighted_rate_pct.toFixed(2)}%
                    </>
                  )}
                  {gao.overlay.improper.program_count != null && (
                    <>
                      {" "}
                      across {gao.overlay.improper.program_count} reported
                      programs (paymentaccuracy.gov). Click the figure for the
                      derivation and source.
                    </>
                  )}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Programs list */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Program Elements</h2>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
            {agencyPrograms.map((p) => (
              <div
                key={p.pe_bli}
                className="flex items-start justify-between px-5 py-4 hover:bg-muted/40 transition-colors gap-4"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {p.pe_bli}
                  </span>
                  <Link
                    href={`/program/${p.pe_bli}/`}
                    className="font-medium hover:underline text-foreground"
                    data-program-name
                  >
                    {p.title}
                  </Link>
                </div>
                <div className="shrink-0 text-sm text-right tabular-nums text-muted-foreground">
                  {p.fy2024_actual_millions != null ? (
                    <>
                      <Cite
                        value={p.fy2024_actual_millions}
                        units="USD millions"
                        dataset="jbook_details"
                        factId={p.fy2024_fact_id}
                        xmlPath={p.fy2024_xml_path}
                      />
                      <span className="ml-1 text-xs">FY24</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </CitationPanelProvider>
  );
}
