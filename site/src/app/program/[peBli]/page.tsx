import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getPrograms,
  getProgramDetails,
  getEntityTopByFamilyKey,
  getGaoOverlayForOrg,
  getCategories,
  getDossier,
  getSnapshotMeta,
  getSiteMeta,
  collectCitationsWithInputs,
  TRAJECTORY_FY_LABEL,
} from "@/lib/data";
import type { JbookPdfCitation, ProgramRow } from "@/lib/data";
import { Cite } from "@/components/cite";
import { dossierFactIds } from "@/lib/dossier";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { programOgImages } from "@/lib/og";
import { CitationPanelProvider } from "@/components/citation-panel";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { CoverageNote } from "@/components/coverage-note";
import {
  FollowTheDollar,
  getFlowData,
} from "@/components/follow-the-dollar";
import { ProgramHeader } from "@/components/program-header";
import { ProgramDossier } from "@/components/program-dossier";
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
      images: programOgImages(peBli),
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

  // ── Dossier + category hero (Task 8a — top-50 pages only) ─────────────────
  // getDossier returns null when no dossier file exists (cited-or-absent:
  // zero placeholder text) and THROWS on ungated content (loud build error).
  // Its fact_ids join the page slice so fact chips open the citation panel.
  const dossier = getDossier(peBli);
  if (dossier) {
    pageFactIds.push(...dossierFactIds(dossier));
  }
  const category = getCategories()?.[peBli] ?? null;

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

      {/* Print-only byline (Phase 5C Task 9) — hidden on screen, revealed by
          the @media print stylesheet ([data-print-only] → display:block). */}
      <p data-print-only className="hidden text-xs text-muted-foreground mb-4">
        Printed from {SITE_URL}/program/{peBli}/ — data as of{" "}
        {new Date(getSiteMeta().built_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
        . Every figure is citation-backed; see the page online for per-number
        provenance.
      </p>

      {/* Header — top-50 pages get a category hero background (Task 8a) */}
      <ProgramHeader program={program} category={category} />

      {/* Above-the-fold answer strip (Phase 5C Task 10, Goal 5) — what it
          is / what changed / who gets it, directly under the header. The G6
          answerfold gate asserts all three testids sit inside the initial
          viewport at 1440×900 AND 390×844. */}
      <AnswerStrip program={program} />

      {/* GAO oversight badge — agency-level risk context (Task 6b) */}
      {gao && (
        <div className="mb-6">
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

      {/* Program dossier — GATED dossiers only, cited-or-absent (Task 8a).
          No dossier file → a one-line coverage note explains the absence
          (Phase 5C: empty sections explain absence instead of disappearing).
          Never placeholder prose — the note is the only ungated text. */}
      {dossier ? (
        <ProgramDossier dossier={dossier} snapshotMeta={getSnapshotMeta()} />
      ) : (
        <CoverageNote id="dossiers" empty className="mt-8" />
      )}

      {/* Budget line items (workbook-cited) */}
      <ProgramBudgetLines budgetLines={details.budget_lines} />

      {/* R-2/P-40 details table */}
      <ProgramDetailsTable details={details.details} />

      {/* Narratives (includes data-pagefind-body) */}
      <ProgramNarratives narratives={details.narratives} />

      {/* Contractor concentration card */}
      <ProgramConcentration hhi={program.hhi} />

      {/* Follow-the-dollar flow — crosswalked programs only (Task 6b).
          Programs without a flow sidecar get a one-line coverage note
          explaining the absence (Phase 5C Task 8). */}
      {flowData ? (
        <FollowTheDollar data={flowData} />
      ) : (
        <CoverageNote id="follow-the-dollar" empty className="mt-8" />
      )}

      {/* Awards — capped at 25, client expand. The company-awards scope
          note is server-rendered here and passed down (client boundary). */}
      <ProgramAwards
        initialAwards={initialAwards}
        totalCount={details.awards.length}
        peBli={peBli}
        scopeNote={<CoverageNote id="company-awards" />}
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

// ── Above-the-fold answer strip (Phase 5C Task 10, Goal 5) ───────────────────
// Answers the three reader questions in one compact row directly under the
// header: WHAT IT IS / WHAT CHANGED / WHO GETS IT.
//
//  - Every dollar figure goes through <Cite> (render-static currency scan);
//    the delta reuses the derived trajectory fact_id the figures grid and the
//    home movers already cite; the obligations total reuses the concentration
//    sidecar fact_id.
//  - Absences are stated honestly ("No award linkage at high confidence")
//    and the data-testid still renders — the G6 gate asserts presence of all
//    three [data-testid^="answer-"] elements inside the initial viewport.

/** Plain-language label for exhibit_family values (answer-strip copy). */
function answerFamilyPlain(family: string): string {
  switch (family.toLowerCase()) {
    case "rdte":
      return "research & development";
    case "procurement":
      return "procurement";
    case "om":
    case "o&m":
      return "operations & maintenance";
    case "milpers":
      return "military personnel";
    default:
      return family.toUpperCase();
  }
}

function AnswerItem({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="min-w-0 px-4 py-2.5 md:py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </div>
      <div className="text-sm leading-snug text-foreground">{children}</div>
    </div>
  );
}

function AnswerStrip({ program }: { program: ProgramRow }) {
  const change = program.trajectory?.fy2526_change ?? null;
  const changeFactId = program.trajectory_fact_ids?.fy2526_change ?? null;
  const pct = program.trajectory?.fy2526_pct_change ?? null;
  const hhi = program.hhi;

  return (
    <div className="mb-6 grid grid-cols-1 md:grid-cols-3 rounded-lg border border-border bg-card divide-y md:divide-y-0 md:divide-x divide-border">
      {/* WHAT IT IS — title + org + exhibit family in plain language.
          data-program-name: official titles may contain dollar strings
          (e.g. "ORDNANCE ITEMS <$5M") — currency-scan exemption. */}
      <AnswerItem label="What it is" testId="answer-what">
        <span data-program-name>{program.title}</span>
        {" — a "}
        {answerFamilyPlain(program.exhibit_family)}
        {" program run by "}
        {program.org}.
      </AnswerItem>

      {/* WHAT CHANGED — FY25→26 delta with its existing derived citation. */}
      <AnswerItem label="What changed" testId="answer-changed">
        {change !== null && changeFactId ? (
          <>
            <span
              className={
                change > 0
                  ? "font-semibold text-emerald-700"
                  : change < 0
                    ? "font-semibold text-red-600"
                    : "font-semibold"
              }
            >
              {change >= 0 ? "+" : ""}
              <Cite
                value={change}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={changeFactId}
              />
            </span>
            {pct !== null && (
              <span className="text-muted-foreground" aria-hidden="true">
                {" "}
                ({pct > 0 ? "+" : ""}
                {pct.toFixed(1)}%)
              </span>
            )}
            <span className="text-muted-foreground"> {TRAJECTORY_FY_LABEL}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            No {TRAJECTORY_FY_LABEL} comparison — trajectory data incomplete
            for this line.
          </span>
        )}
      </AnswerItem>

      {/* WHO GETS IT — top recipient family + cited program obligations from
          the concentration sidecar; honest absence otherwise. */}
      <AnswerItem label="Who gets it" testId="answer-who">
        {hhi ? (
          <>
            <span className="font-medium">{hhi.top_family}</span>
            <span className="text-muted-foreground">
              {" leads "}
              {hhi.family_count} contractor{" "}
              {hhi.family_count === 1 ? "family" : "families"} sharing{" "}
            </span>
            <Cite
              value={hhi.program_dollars}
              units="USD"
              dataset="fct_program_concentration"
              factId={hhi.program_dollars_fact_id}
            />
            <span className="text-muted-foreground"> in matched awards.</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            No award linkage at high confidence.
          </span>
        )}
      </AnswerItem>
    </div>
  );
}
