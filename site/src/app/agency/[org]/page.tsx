import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencies, getAgencyMap, getPrograms } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Cite } from "@/components/cite";
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

  return (
    <>
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
            { label: "Agencies", href: "/programs/" },
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
              />
              <span className="ml-1 text-xs">
                ⁂{" "}
                <span
                  className="italic"
                  title="citation tier pending — sum of cited program figures, derivation tier pending"
                >
                  sum of cited program figures — derivation tier pending
                </span>
              </span>
            </span>
            {agency.fy2026_total_thousands != null && (
              <span>
                FY26 total:{" "}
                <Cite
                  value={agency.fy2026_total_thousands}
                  units="USD thousands"
                />
                <span className="ml-1 text-xs">⁂</span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            ⁂ Aggregate totals are sums of cited program figures — derivation
            tier pending. Individual program FY24 figures are J-book–cited
            where underlined. See{" "}
            <Link
              href="/methodology/"
              className="underline hover:text-foreground"
            >
              methodology
            </Link>
            .
          </p>
        </div>

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
                        factId={p.fy2024_fact_id}
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
    </>
  );
}
