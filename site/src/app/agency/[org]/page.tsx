import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAgencies,
  getAgencyMap,
  getProgramDecadeCells,
  getPrograms,
  getGaoOverlayForOrg,
  collectCitationsWithInputs,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { agencyOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Cite } from "@/components/cite";
import { basisChipText } from "@/lib/basis";
import { CitationPanelProvider } from "@/components/citation-panel";
import { CoverageNote } from "@/components/coverage-note";
import { ScopeNote } from "@/components/notes";
import { formatCount } from "@/lib/format";
import { agencyDisplayName, agencyFullName } from "@/lib/agency-names";
import { reproducibleDifference } from "@/lib/derivation";
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
  // §P0-6: the human service name, not the raw workbook token. /agency/N/
  // shipped with <title>N</title> and <h1>N</h1> — a page about the Navy
  // titled with a single letter.
  //
  // Tri-persona Wave 3, Task 3: that fix reached three of 24 pages.
  // serviceOrgName is identity-only outside A/N/F, so /agency/TJS/ was still
  // titled, in full, "TJS" — and 20 others like it. agencyDisplayName reads
  // the curated component-name map (lib/agency-names.ts) and falls back to
  // the code for anything the map has not been taught.
  const orgName = agencyDisplayName(org);
  return {
    title: orgName,
    description: `${orgName}: ${agency.program_count} defense program elements with FY2024 and FY2026 budget data.`,
    alternates: { canonical },
    openGraph: {
      title: `${orgName} Defense Programs — ${SITE_NAME}`,
      description: `${agency.program_count} program elements for ${orgName}.`,
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

  // Program-level decade cells — the same figures /programs/, /years/ and each
  // program page publish, with the same FACT IDS (see getProgramDecadeCells).
  // Backlog #37 fixed programs.json's trajectory at the exporter (it is the
  // program's total now, not the declared org's slice), so this is no longer
  // a correctness workaround: it is the one-number-one-fact rule. A row here
  // links straight at the page that cites this figure, and it should open the
  // same receipt.
  //
  // NOTE the deliberate asymmetry with the header total below: this list is
  // the PROGRAM's money, `agency.fy2026_total_thousands` is THIS AGENCY's
  // share of it. For the three BLI codes shared across organisations they are
  // different questions with different answers.
  const decadeCells = getProgramDecadeCells();
  const agencyPrograms = getPrograms()
    .filter((p) => p.org === org)
    .sort((a, b) => {
      const av = decadeCells.get(a.pe_bli)?.fy26?.v ?? -Infinity;
      const bv = decadeCells.get(b.pe_bli)?.fy26?.v ?? -Infinity;
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
  // #59: the agency-level reconciliation disclosure's TOA-basis total.
  if (agency.fy2024_toa_actuals_fact_id_derived) {
    pageFactIds.push(agency.fy2024_toa_actuals_fact_id_derived);
  }
  for (const p of agencyPrograms) {
    // The FY24 figure this list renders is the program-level TOA fact, not the
    // J-book detail fact it used to render (gate 23 leg e) — so that is the
    // fact that has to be in the page's citation slice.
    const fid = decadeCells.get(p.pe_bli)?.fy24?.fid;
    if (fid) pageFactIds.push(fid);
  }
  if (gao?.overlay.improper?.fact_id) {
    pageFactIds.push(gao.overlay.improper.fact_id);
  }
  const citationsSlice = collectCitationsWithInputs(pageFactIds);

  // #59: reconciliation disclosure — reuses ReconciliationStrip's own
  // TOA-minus-detail arithmetic (site/src/lib/derivation.ts), one grain up.
  // Rendered only when the sidecar reports ≥1 non-reconciling program AND
  // the TOA-total citation actually resolved (both totals need a real
  // fact_id — an uncited delta would be arithmetic between a real number
  // and a guess).
  const showReconciliationNote =
    agency.fy2024_not_reconciled_count > 0 &&
    agency.fy2024_toa_actuals_fact_id_derived != null;
  const reconciliationDelta = showReconciliationNote
    ? reproducibleDifference(
        agency.fy2024_toa_actuals_millions,
        agency.fy2024_total_millions,
        agency.fy2024_toa_actuals_millions - agency.fy2024_total_millions,
      )
    : null;

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
          <h1 className="text-3xl font-bold mb-1" title={`Organization code ${org}`}>
            {agencyDisplayName(org)}
          </h1>
          {/* The workbook code stays on the page under the name: it is this
              page's identity, the workbook's key, and what a reader will see
              stamped on every figure below. Suppressed where the name IS the
              code (an org agency-names.ts has not been taught) rather than
              printed twice. */}
          {agencyFullName(org) && (
            <p className="mb-3 font-mono text-sm text-muted-foreground">
              Organization code <span data-agency-code={org}>{org}</span>
            </p>
          )}
          {/* Explicit {" "} separators between the meta spans keep Pagefind
              excerpts from concatenating fragments (§P1-4 snippet bug). */}
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">
                {agency.program_count}
              </strong>{" "}
              program{agency.program_count !== 1 ? "s" : ""}
            </span>{" "}
            <span>
              FY24 total:{" "}
              <Cite
                value={agency.fy2024_total_millions}
                units="USD millions"
                dataset="dim_programs"
                factId={agency.fy2024_fact_id_derived}
              />
            </span>{" "}
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
          {/* FY2026 partial-year scope note (Phase 5C Task 8) */}
          <CoverageNote id="fy2026-partial" className="mt-2" />

          {/* #59: the rollup reconciliation disclosure — program pages
              already carry ReconciliationStrip (P0-1) and the
              fully_reconciled badge; this is the SAME two-basis
              divergence, summed for the agency. Wording mirrors
              reconciliation-strip.tsx's own header line and mechanism
              sentence rather than inventing a second vocabulary. Rendered
              only when this org actually has a non-reconciling program —
              gate 23 leg i requires exactly this condition. */}
          {showReconciliationNote && (
            <ScopeNote className="mt-2" label={null}>
              <div
                data-agency-reconciliation-note=""
                data-agency-org={org}
                data-not-reconciled-count={agency.fy2024_not_reconciled_count}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                  Two official figures, one label
                  <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground">
                    — reconciled on each program page
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {formatCount(agency.fy2024_not_reconciled_count)} of{" "}
                  {org}&rsquo;s {formatCount(agency.program_count)} programs
                  carry an FY2024 figure that has not reconciled between the
                  R-2/P-40 J-book program line (the FY24 total above) and the
                  P-1/R-1 workbook total obligation authority (TOA) Fiscal
                  Receipts uses as its headline basis sitewide — the workbook
                  TOA includes budget rows (such as advance procurement) the
                  J-book line excludes. See the reconciliation on each
                  affected program&rsquo;s own page, or{" "}
                  <Link
                    href="/methodology/"
                    className="underline decoration-dotted hover:text-foreground hover:decoration-solid"
                  >
                    how the two bases relate &rarr;
                  </Link>
                  .
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  <Cite
                    value={agency.fy2024_toa_actuals_millions}
                    units="USD millions"
                    dataset="budget_lines"
                    factId={agency.fy2024_toa_actuals_fact_id_derived}
                    basis="toa"
                    fy={2024}
                    measure="actuals"
                    edition={2026}
                    chip={false}
                  />{" "}
                  TOA &minus;{" "}
                  <Cite
                    value={agency.fy2024_total_millions}
                    units="USD millions"
                    dataset="dim_programs"
                    factId={agency.fy2024_fact_id_derived}
                    basis="jbook-detail"
                    fy={2024}
                    measure="actuals"
                    edition={2026}
                    chip={false}
                  />{" "}
                  P-40 detail
                  {reconciliationDelta && (
                    <>
                      {" = "}
                      <span
                        title="Difference between the two cited agency totals — arithmetic, not a parsed budget row"
                        className="font-mono tabular-nums"
                      >
                        {reconciliationDelta.delta}
                      </span>{" "}
                      {reconciliationDelta.unitLabel}
                    </>
                  )}
                </p>
              </div>
            </ScopeNote>
          )}
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
          <h2 className="text-xl font-semibold mb-1">Program Elements</h2>
          {/* The list's basis, declared once (gate 23 leg e): a figure whose
              basis is stated nowhere is how the same label came to carry two
              values on two pages. */}
          <p
            data-basis-declared
            className="mb-4 text-xs text-muted-foreground"
          >
            {/* §48: an agency spans BOTH exhibits (its programs mix RDT&E and
                procurement), so this declares "mixed" explicitly rather than
                defaulting — a recorded decision, not an omission. */}
            FY24 figures are {basisChipText("toa", "actuals", 2026, "mixed")} —
            total obligational authority as the PB2026 books report it, in USD
            thousands, the same basis{" "}
            <Link href="/programs/" className="underline hover:text-foreground">
              the program index
            </Link>{" "}
            and each program&rsquo;s own page use.
          </p>
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
                {/* ONE LABEL, ONE BASIS (Sprint 3 round 3, gate 23 leg e).
                    This list carried the P-40/R-2 J-book DETAIL figure under a
                    bare "FY24" label — the same defect /programs/ had, so the
                    same agency page disagreed with every program page it links
                    to. It is the canonical P-1/R-1 TOA figure now, matching
                    /programs/, /years/ and each program's own headline, with
                    the basis declared once above the list. */}
                <div className="shrink-0 text-sm text-right tabular-nums text-muted-foreground">
                  {decadeCells.get(p.pe_bli)?.fy24 != null ? (
                    <>
                      <Cite
                        value={decadeCells.get(p.pe_bli)!.fy24!.v}
                        units="USD thousands"
                        dataset="fct_decade_series"
                        factId={decadeCells.get(p.pe_bli)!.fy24!.fid}
                        basis="toa"
                        fy={2024}
                        measure="actuals"
                        entity={p.pe_bli}
                        edition={2026}
                        chip={false}
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
