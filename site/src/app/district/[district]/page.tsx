import type { Metadata } from "next";
import Link from "next/link";
import { getDistrictIndex, getDistrictDetail, collectCitations } from "@/lib/data";
import { districtDisplayLabel } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
import { CoverageNote } from "@/components/coverage-note";
import { ScopeNote } from "@/components/notes";
import { FyRange } from "@/components/fy-range";

// No fallback pages beyond what generateStaticParams returns (SSG export).
export const dynamicParams = false;

interface Props {
  params: Promise<{ district: string }>;
}

export function generateStaticParams(): { district: string }[] {
  try {
    const index = getDistrictIndex();
    return index.districts.map((d) => ({ district: d.pop_district }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { district } = await params;
  let state = "";
  try {
    const detail = getDistrictDetail(district);
    state = detail.pop_state ? ` (${detail.pop_state})` : "";
  } catch {
    // ignore
  }
  return {
    title: `District ${district}${state}`,
    description: `Defense contract awards in congressional district ${district}${state} — high-confidence program links via USAspending crosswalk.`,
    alternates: { canonical: `${SITE_URL}/district/${district}/` },
    openGraph: {
      title: `District ${district}${state} — ${SITE_NAME}`,
      description: `Defense contract awards in congressional district ${district}${state}.`,
      url: `${SITE_URL}/district/${district}/`,
      siteName: SITE_NAME,
    },
  };
}

export default async function DistrictDetailPage({ params }: Props) {
  const { district } = await params;
  const detail = getDistrictDetail(district);

  // Collect fact_ids for cited dollars — per-program USAspending citations
  // plus the district's derived aggregate citations (header stats).
  const pageFactIds: string[] = [];
  for (const prog of detail.programs) {
    if (prog.fact_id) pageFactIds.push(prog.fact_id);
  }
  if (detail.total_linkable_fact_id) pageFactIds.push(detail.total_linkable_fact_id);
  if (detail.total_cited_fact_id) pageFactIds.push(detail.total_cited_fact_id);
  const citationsSlice = collectCitations(pageFactIds);

  const stateLabel = detail.pop_state ? ` — ${detail.pop_state}` : "";

  // Special pop_district codes (00 at-large, 90/98/99 undistricted) render a
  // plain-language label instead of the raw code — display only; the URL and
  // sidecar data keep the raw code (e.g. /district/DC-98/).
  const displayLabel = districtDisplayLabel(district);
  const isSpecialCode = displayLabel !== district;
  const heading = isSpecialCode
    ? displayLabel
    : `District ${district}${stateLabel}`;

  // §P1-6 (CO-05): "linkable obligations" and "cited (USAspending)" are two
  // genuinely different measures — everything the crosswalk links, versus the
  // subset whose citation row actually resolves — but in the current corpus
  // EVERY linked row carries a resolving citation, so both cards rendered the
  // same $1.14B under two labels and read as a duplication bug.
  //
  // The honest resolution is not to delete a measure: it is to show one card
  // while they coincide and say so, and to split back into two the moment they
  // diverge (a crosswalk row whose citation does not resolve). Deciding this
  // per district from the data means neither state can be a lie.
  const citedEqualsLinkable =
    detail.total_cited_dollars === detail.total_linkable_dollars;

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Districts", href: "/district/" },
            { label: heading },
          ]}
        />

        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">
            {heading}
            {isSpecialCode && (
              <span className="ml-3 align-middle font-mono text-sm font-normal text-muted-foreground">
                {district}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            {detail.program_count} linked program
            {detail.program_count !== 1 ? "s" : ""} via high-confidence
            USAspending crosswalk.
          </p>
          {/* Scope note — same coverage contract as the district index */}
          <CoverageNote id="districts" className="mt-1" />

          {/* §P2-6: this was an amber banner ABOVE the <h1> — the page opened
              with what read as a warning before the reader knew what page they
              were on. It is not a warning: it is an honest account of what
              district coverage means here, which is a credibility asset. Calm
              register, and after the heading. */}
          <ScopeNote className="mt-3" label="Coverage note">
            <p>
              District data reflects only high-confidence award links from the
              DARPA crosswalk. Aggregate totals are derived from USAspending
              award transaction data — click any figure to see the formula and
              query behind it. Recipients and transaction counts are from
              USAspending; no additional verification applied.
            </p>
          </ScopeNote>

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 mt-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums">
                {detail.program_count}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                linked programs
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums">
                {/* Derived 'district' aggregate citation — sums the district's
                    per-program USAspending-cited obligations (state A when the
                    citation resolves; honest state C otherwise). */}
                <Cite
                  value={detail.total_linkable_dollars}
                  units="USD"
                  dataset="fct_district_programs"
                  factId={detail.total_linkable_fact_id}
                />
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                linkable obligations <FyRange separator="· " />
              </p>
              {citedEqualsLinkable && (
                <p className="text-muted-foreground text-xs mt-1">
                  every linked dollar carries a USAspending citation
                </p>
              )}
            </div>
            {!citedEqualsLinkable && (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-2xl font-bold tabular-nums">
                  <Cite
                    value={detail.total_cited_dollars}
                    units="USD"
                    dataset="fct_district_programs"
                    factId={detail.total_cited_fact_id}
                  />
                </p>
                <p className="text-muted-foreground text-xs mt-1">
                  of which cited (USAspending) <FyRange separator="· " />
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Program table */}
        {/* §P1-7 sort contract (gate 24 leg f): exporter-declared order —
            fct_district_programs is queried `order by pop_state, pop_district,
            total_obligation desc nulls last`. */}
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <table
            className="w-full text-sm"
            data-sort-table="district-programs"
            data-sort-order="total_obligation:desc"
          >
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  Program
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide hidden sm:table-cell">
                  Org
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  Obligations
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide hidden md:table-cell">
                  Recipients
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide hidden md:table-cell">
                  Transactions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.programs.map((prog) => (
                <tr
                  key={prog.pe_bli}
                  className="hover:bg-muted/40 transition-colors"
                  data-sort-value={String(prog.total_obligation ?? -Infinity)}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={prog.program_url}
                      className="font-medium text-primary hover:underline"
                    >
                      {prog.title}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {prog.pe_bli}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {prog.organization}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {prog.total_obligation !== null ? (
                      <Cite
                        value={prog.total_obligation}
                        units="USD"
                        dataset="fct_district_programs"
                        factId={prog.fact_id}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                    {prog.recipient_count.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                    {prog.transaction_count.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Obligations are high-confidence USAspending award links only. Cited
          figures (underlined) open a USAspending citation with the API query
          used to verify the amount. See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology
          </Link>{" "}
          for crosswalk details.
        </p>
      </div>
    </CitationPanelProvider>
  );
}
