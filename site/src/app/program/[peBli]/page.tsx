import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getPrograms,
  getProgramDetails,
  getEntityTopByFamilyKey,
  getGaoOverlayForOrg,
  collectCitationsWithInputs,
} from "@/lib/data";
import type { JbookPdfCitation } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { CitationPanelProvider } from "@/components/citation-panel";

import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  FollowTheDollar,
  getFlowData,
} from "@/components/follow-the-dollar";
import { ProgramHeader } from "@/components/program-header";
import { ProgramFigures } from "@/components/program-figures";
import { ProgramBudgetLines } from "@/components/program-budget-lines";
import { ProgramNarratives } from "@/components/program-narratives";
import { ProgramDetailsTable } from "@/components/program-details-table";
import { ProgramAwards } from "@/components/program-awards";
import { ProgramMentions } from "@/components/program-mentions";
import { ProgramConcentration } from "@/components/program-concentration";

// ── SSG config ────────────────────────────────────────────────────────────────

export const dynamicParams = false;

export function generateStaticParams(): { peBli: string }[] {
  const programs = getPrograms();
  return programs.map((p) => ({ peBli: p.pe_bli }));
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ peBli: string }>;
}): Promise<Metadata> {
  const { peBli } = await params;
  const programs = getPrograms();
  const program = programs.find((p) => p.pe_bli === peBli);

  if (!program) {
    return {
      title: "Program Not Found",
    };
  }

  // Description: first narrative sentence, fallback to org + pe_bli
  let description: string;
  try {
    const details = getProgramDetails(peBli);
    // Mission narrative first, then any narrative
    const missionNarrative = details.narratives.find(
      (n) => n.kind === "mission",
    );
    const firstNarrative =
      missionNarrative ?? details.narratives[0] ?? null;
    if (firstNarrative?.body) {
      // Take the first sentence (up to first period + space, or first 200 chars)
      const firstSentence = firstNarrative.body.split(/\.\s/)[0];
      description =
        firstSentence.length > 200
          ? firstSentence.slice(0, 197) + "…"
          : firstSentence;
    } else {
      description = `${program.org} — ${peBli} — FY2026 budget, contracts & lobbying data.`;
    }
  } catch {
    description = `${program.org} — ${peBli} — FY2026 budget, contracts & lobbying data.`;
  }

  const canonicalUrl = `${SITE_URL}/program/${peBli}/`;

  return {
    title: `${program.title} — FY2026 Budget, Contracts & Lobbying | ${SITE_NAME}`,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${program.title} — FY2026 Budget, Contracts & Lobbying`,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CAP = 25;

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ peBli: string }>;
}) {
  const { peBli } = await params;

  // Load program row
  const programs = getPrograms();
  const program = programs.find((p) => p.pe_bli === peBli);
  if (!program) notFound();

  // Load detailed data
  const details = getProgramDetails(peBli);

  // Build set of linkable family_keys (entities_top).
  // Passed to ProgramMentions (client component) as a plain string[] — Sets are
  // not serializable across the server→client boundary in Next.js App Router.
  const entityByFamilyKey = getEntityTopByFamilyKey();
  const linkableKeysArray = Array.from(entityByFamilyKey.keys());

  // Slice lists for SSG cap
  const initialAwards = details.awards.slice(0, CAP);
  const initialMentions = details.mentions.slice(0, CAP);

  // ── Collect per-page citation slice (Task 5 + 5B-3 flips) ─────────────────
  // Gather ALL fact_ids referenced on this page to avoid a 10MB full-citations
  // client payload: jbook_pdf details, workbook budget_lines, plus the derived
  // trajectory / concentration fact_ids (Phase 5B-3). Derived inputs are
  // pulled in too (one level) so derived-card input chips are clickable.
  const pageFactIds: string[] = [];

  // FY2024 header figure (state A when fact_id present)
  if (program.fy2024_fact_id) {
    pageFactIds.push(program.fy2024_fact_id);
  }

  // Derived trajectory figures (FY24/FY25/FY26/change + sparkline legend)
  if (program.trajectory_fact_ids) {
    for (const fid of Object.values(program.trajectory_fact_ids)) {
      if (fid) pageFactIds.push(fid);
    }
  }

  // Derived concentration figures (HHI + program dollars)
  if (program.hhi?.hhi_fact_id) pageFactIds.push(program.hhi.hhi_fact_id);
  if (program.hhi?.program_dollars_fact_id) {
    pageFactIds.push(program.hhi.program_dollars_fact_id);
  }

  // Details table: resolution ∈ {unique, ambiguous_first} → state A (fact_id resolves)
  for (const d of details.details) {
    if (d.resolution !== "zero_amount" && d.fact_id) {
      pageFactIds.push(d.fact_id);
    }
  }

  // Budget lines: workbook-cited, always state A
  for (const bl of details.budget_lines) {
    if (bl.fact_id) {
      pageFactIds.push(bl.fact_id);
    }
  }

  // Follow-the-dollar (Task 6b): only the 17 crosswalked programs have a
  // flows sidecar. The cited per-district table needs the (district, pe_bli)
  // USAspending fact_ids in the page slice.
  const flowData = getFlowData(peBli);
  if (flowData) {
    for (const row of flowData.districtRows) {
      if (row.factId) pageFactIds.push(row.factId);
    }
  }

  // GAO oversight overlay badge (Task 6b) — compact chip linking to the
  // agency oversight section when the program's org has overlays.
  const gao = getGaoOverlayForOrg(program.org);

  const citationsSlice = collectCitationsWithInputs(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Programs", href: "/programs/" },
          { label: program.title },
        ]}
      />

      {/* Header */}
      <ProgramHeader program={program} />

      {/* GAO oversight badge — agency-level risk context (Task 6b) */}
      {gao && (
        <div className="-mt-4 mb-6">
          <Link
            href={`/agency/${program.org}/#oversight`}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-500/20 transition-colors"
            title={`GAO oversight context for ${gao.agencyCode} — high-risk areas and improper-payment exposure`}
          >
            <span aria-hidden="true">⚠</span>
            GAO oversight: {gao.agencyCode}
            {gao.overlay.high_risk_areas.length > 0 &&
              ` — ${gao.overlay.high_risk_areas.length} high-risk area${gao.overlay.high_risk_areas.length !== 1 ? "s" : ""}`}
          </Link>
        </div>
      )}

      {/* Budget figures + sparkline */}
      <ProgramFigures program={program} />

      {/* Budget line items (workbook-cited) */}
      <ProgramBudgetLines budgetLines={details.budget_lines} />

      {/* R-2/P-40 details table */}
      <ProgramDetailsTable details={details.details} />

      {/* Narratives (includes data-pagefind-body) */}
      <ProgramNarratives narratives={details.narratives} />

      {/* Contractor concentration card */}
      <ProgramConcentration hhi={program.hhi} />

      {/* Follow-the-dollar flow — 17 crosswalked programs only (Task 6b) */}
      {flowData && <FollowTheDollar data={flowData} />}

      {/* Awards — capped at 25, client expand */}
      <ProgramAwards
        initialAwards={initialAwards}
        totalCount={details.awards.length}
        peBli={peBli}
      />

      {/* Lobbying mentions — capped at 25, client expand */}
      <ProgramMentions
        initialMentions={initialMentions}
        totalCount={details.mentions.length}
        peBli={peBli}
        linkableKeys={linkableKeysArray}
      />

      {/* Primary Sources — static links with #page=N for direct PDF navigation.
          Rendered server-side so they appear in SSG HTML (gate compliance + UX).
          Only jbook_pdf citations with an official_url containing #page= are shown. */}
      {(() => {
        const pdfLinks = Object.entries(citationsSlice)
          .filter(
            ([, cit]) =>
              cit.kind === "jbook_pdf" &&
              cit.official_url?.includes("#page="),
          )
          .slice(0, 5) as [string, JbookPdfCitation][];
        if (pdfLinks.length === 0) return null;
        return (
          <section className="mt-8 pt-6 border-t border-border">
            <h2 className="text-base font-semibold mb-3 text-foreground">
              Primary Sources
            </h2>
            <ul className="space-y-1.5">
              {pdfLinks.map(([factId, cit]) => (
                <li key={factId}>
                  <a
                    href={cit.official_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Budget Justification PDF (page {cit.page_number})
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}
    </div>
    </CitationPanelProvider>
  );
}
