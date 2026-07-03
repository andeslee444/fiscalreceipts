import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getProgramMap,
  getProgramDetails,
  getProgramPeBlis,
  getPeLinkIndex,
  getEntityTopByFamilyKey,
  getAgencies,
  getGaoOverlayForOrg,
  getCategories,
  getDossier,
  getSnapshotMeta,
  getSiteMeta,
  collectCitationsWithInputs,
  TRAJECTORY_FY_LABEL,
} from "@/lib/data";
import type {
  CitationsMap,
  JbookPdfCitation,
  ProgramDetails,
  ProgramRow,
  WorkbookCitation,
} from "@/lib/data";
import {
  isRollupDetails,
  isZeroContentDetails,
  rollupProgramRow,
  serviceOrgName,
} from "@/lib/program-tier";
import { findPeLinks } from "@/lib/pe-link";
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
import {
  ProgramSection,
  SectionEmpty,
} from "@/components/program-section";
import { ServiceBooksNote } from "@/components/service-books-note";
import { ProgramHeader } from "@/components/program-header";
import { ProgramDossier } from "@/components/program-dossier";
import {
  ProgramFigures,
  ProgramTrajectoryCard,
} from "@/components/program-figures";
import { ProgramBudgetLines } from "@/components/program-budget-lines";
import {
  ProgramNarratives,
  narrativesInGroup,
} from "@/components/program-narratives";
import { ProgramDetailsTable } from "@/components/program-details-table";
import { ProgramAwards } from "@/components/program-awards";
import { ProgramMentions } from "@/components/program-mentions";
import { ProgramConcentration } from "@/components/program-concentration";

// ── SSG config ────────────────────────────────────────────────────────────────

export const dynamicParams = false;

/**
 * Phase 5F §2a: the page universe is EVERY program_details sidecar (1,995) —
 * the 462 full-tier programs from programs.json plus the 1,533 rollup-tier
 * sidecars (R-1/P-1 figures + trajectory, service J-book not yet ingested).
 */
export function generateStaticParams(): { peBli: string }[] {
  return getProgramPeBlis().map((peBli) => ({ peBli }));
}

/** Resolve the page's ProgramRow: full tier from programs.json, rollup tier
 *  synthesized from the sidecar. Throws (loud build failure) on a sidecar
 *  that is neither — that would be an export regression, not a 404. */
function resolveProgram(
  peBli: string,
  details: ProgramDetails,
): { program: ProgramRow; tier: "full" | "rollup" } {
  const full = getProgramMap().get(peBli);
  if (full) return { program: full, tier: "full" };
  if (isRollupDetails(details)) {
    return { program: rollupProgramRow(peBli, details), tier: "rollup" };
  }
  throw new Error(
    `[program page] ${peBli} has a sidecar but is neither in programs.json ` +
      `nor rollup-tier — export regression, refusing to render a broken page.`,
  );
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ peBli: string }>;
}): Promise<Metadata> {
  const { peBli } = await params;
  if (!getPeLinkIndex().has(peBli)) {
    return { title: "Program Not Found" };
  }
  const details = getProgramDetails(peBli);
  const { program, tier } = resolveProgram(peBli, details);

  // Description: first narrative sentence; rollup pages state their tier
  // honestly; fallback to org + pe_bli.
  let description: string;
  const missionNarrative = details.narratives.find((n) => n.kind === "mission");
  const firstNarrative = missionNarrative ?? details.narratives[0] ?? null;
  if (firstNarrative?.body) {
    const firstSentence = firstNarrative.body.split(/\.\s/)[0];
    description =
      firstSentence.length > 200
        ? firstSentence.slice(0, 197) + "…"
        : firstSentence;
  } else if (tier === "rollup") {
    description = `${program.org} — ${peBli} — FY2026 budget figures from the R-1/P-1 workbooks, every number cited. Detailed service J-book not yet ingested.`;
  } else {
    description = `${program.org} — ${peBli} — FY2026 budget, contracts & lobbying data.`;
  }

  const canonicalUrl = `${SITE_URL}/program/${peBli}/`;

  return {
    title: `${program.title} — FY2026 Budget, Contracts & Lobbying | ${SITE_NAME}`,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    // noindex policy (§2a): pages whose only content is zero-valued figure
    // lines are built (linkable) but not indexed — same policy as
    // zero-mention filings. Everything else stays indexable.
    robots: isZeroContentDetails(details)
      ? { index: false, follow: true }
      : undefined,
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

  if (!getPeLinkIndex().has(peBli)) notFound();
  const details = getProgramDetails(peBli);
  const { program, tier } = resolveProgram(peBli, details);
  const peIndex = getPeLinkIndex();

  // Build set of linkable family_keys (entities_top).
  // Passed to ProgramMentions (client component) as a plain string[] — Sets are
  // not serializable across the server→client boundary in Next.js App Router.
  const entityByFamilyKey = getEntityTopByFamilyKey();
  const linkableKeysArray = Array.from(entityByFamilyKey.keys());

  // Slice lists for SSG cap
  const initialAwards = details.awards.slice(0, CAP);
  const initialMentions = details.mentions.slice(0, CAP);

  // PE token → href map for the mention rows (client component gets a
  // serializable record; §2a). Self-references excluded (stay plain).
  const peHrefs: Record<string, string> = {};
  for (const m of initialMentions) {
    for (const text of [m.matched_term, m.description_snippet]) {
      if (!text) continue;
      for (const link of findPeLinks(text, peIndex, { selfPe: peBli })) {
        peHrefs[link.token] = link.href;
      }
    }
  }

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

  // Narratives (Phase 5F §2b/§2c): per-paragraph jbook_narrative fact chips
  // + prose amount-link targets both open the panel from the embedded slice.
  for (const n of details.narratives) {
    if (n.fact_id) pageFactIds.push(n.fact_id);
    for (const l of n.amount_links ?? []) {
      if (l.fact_id) pageFactIds.push(l.fact_id);
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

  // Narrative groups for the two prose sections (§2d).
  const descriptionNarratives = narrativesInGroup(details.narratives, "description");
  const justificationNarratives = narrativesInGroup(details.narratives, "justification");
  const serviceName = serviceOrgName(details.service_org ?? "") || "service";

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

      {/* Header — top-50 pages get a category hero background (Task 8a).
          orgHasPage gates the org link: rollup/trajectory-only programs carry
          service orgs (Army/Navy/Air Force/DHA…) that have no agency pages —
          plain text instead of a dead link (G1 contract).
          Rollup pages wrap the header in data-pagefind-body so their title /
          org / PE are deep-searchable (full pages index their narratives). */}
      <div data-pagefind-body={tier === "rollup" ? "" : undefined}>
        <ProgramHeader
          program={program}
          category={category}
          orgHasPage={getAgencies().some((a) => a.org === program.org)}
          tier={tier}
        />
      </div>

      {/* ═══ Canonical section skeleton (Phase 5F §2d) — every program page,
          both tiers, renders these twelve data-section blocks in this order;
          absent data renders a quiet explained empty state, never silence. ═══ */}

      {/* 1 · Answer strip — above-the-fold WHAT/CHANGED/WHO (G6 contract). */}
      <ProgramSection id="answer-strip">
        <AnswerStrip program={program} />
      </ProgramSection>

      {/* 2 · Budget figures */}
      <ProgramSection id="figures">
        <ProgramFigures program={program} />
      </ProgramSection>

      {/* 3 · Trajectory */}
      <ProgramSection id="trajectory">
        {program.trajectory ? (
          <ProgramTrajectoryCard program={program} />
        ) : (
          <SectionEmpty title="Budget Trajectory">
            No year-over-year trajectory row for this line — the FY2026
            R-1/P-1 trajectory workbooks carry no entry for it, so no
            FY24→FY26 series can be drawn.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 4 · Description (mission) — rollup pages carry the honest
          service-J-book note (data-coverage="service-books", §2a). */}
      <ProgramSection id="description">
        {descriptionNarratives.length > 0 ? (
          <ProgramNarratives
            narratives={details.narratives}
            group="description"
            peIndex={peIndex}
            selfPe={peBli}
          />
        ) : tier === "rollup" ? (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-2 text-foreground">
              Description
            </h2>
            <ServiceBooksNote serviceOrg={details.service_org ?? ""} />
          </div>
        ) : (
          <SectionEmpty title="Description">
            The J-book detail for this line carries no separate mission or
            description narrative — see the justification and line items
            below for its own prose.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 5 · Justification (accomplishments/plans) */}
      <ProgramSection id="justification">
        {justificationNarratives.length > 0 ? (
          <ProgramNarratives
            narratives={details.narratives}
            group="justification"
            peIndex={peIndex}
            selfPe={peBli}
          />
        ) : tier === "rollup" ? (
          <SectionEmpty title="Justification">
            Accomplishments and planned-program narratives live in the{" "}
            {serviceName} J-book, which is not yet ingested — see the
            description note above for the roadmap.
          </SectionEmpty>
        ) : (
          <SectionEmpty title="Justification">
            No accomplishments or planned-program narratives in this
            line&apos;s J-book detail — some exhibits carry figures without
            per-project prose.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 6 · Line items — workbook budget lines + R-2/P-40 details table
          (project rows carry #project-{n} anchors for §2a references). */}
      <ProgramSection id="line-items">
        {details.budget_lines.length > 0 || details.details.length > 0 ? (
          <>
            <ProgramBudgetLines budgetLines={details.budget_lines} />
            <ProgramDetailsTable details={details.details} />
          </>
        ) : (
          <SectionEmpty title="Line Items">
            No workbook or J-book line items are linked to this program
            element — its figures appear only in the trajectory mart.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 7 · Follow-the-dollar flow — crosswalked programs only (Task 6b). */}
      <ProgramSection id="follow-dollar">
        {flowData ? (
          <FollowTheDollar data={flowData} />
        ) : (
          <CoverageNote id="follow-the-dollar" empty className="mt-8 mb-8" />
        )}
      </ProgramSection>

      {/* 8 · Awards — capped at 25, client expand — plus the contractor
          concentration card (award-share HHI belongs with awards). */}
      <ProgramSection id="awards">
        {details.awards.length > 0 ? (
          <>
            <ProgramAwards
              initialAwards={initialAwards}
              totalCount={details.awards.length}
              peBli={peBli}
              scopeNote={<CoverageNote id="company-awards" />}
            />
            <ProgramConcentration hhi={program.hhi} />
          </>
        ) : (
          <SectionEmpty title="Awards">
            No awards are linked to this program element at high confidence —
            the budget→award crosswalk only asserts links it can defend, and
            this line has none yet.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 9 · Lobbying mentions — capped at 25, client expand */}
      <ProgramSection id="lobbying">
        {details.mentions.length > 0 ? (
          <ProgramMentions
            initialMentions={initialMentions}
            totalCount={details.mentions.length}
            peBli={peBli}
            linkableKeys={linkableKeysArray}
            peHrefs={peHrefs}
          />
        ) : (
          <SectionEmpty title="Lobbying Mentions">
            No Senate LDA lobbying filing in the tracked data mentions this
            program element by code or alias.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 10 · Oversight — GAO overlay chip when the program's agency has
          high-risk areas / improper-payment exposure. */}
      <ProgramSection id="oversight">
        {gao ? (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-2 text-foreground">
              Oversight
            </h2>
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
        ) : (
          <SectionEmpty title="Oversight">
            No GAO high-risk areas or improper-payment overlays map to{" "}
            {program.org} in the ingested GAO data — absence of an overlay is
            not a clean bill of health, only absence from those two lists.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 11 · Program dossier — GATED dossiers only, cited-or-absent (Task 8a). */}
      <ProgramSection id="dossier">
        {dossier ? (
          <ProgramDossier
            dossier={dossier}
            snapshotMeta={getSnapshotMeta()}
            peIndex={peIndex}
          />
        ) : (
          <CoverageNote id="dossiers" empty className="mt-8 mb-8" />
        )}
      </ProgramSection>

      {/* 12 · Primary sources — J-book PDF pages when cited on this page;
          otherwise the workbook source documents (rollup tier). */}
      <ProgramSection id="sources">
        <PrimarySources citationsSlice={citationsSlice} />
      </ProgramSection>
    </div>
    </CitationPanelProvider>
  );
}

// ── Primary sources (§2d section 12) ─────────────────────────────────────────

function PrimarySources({ citationsSlice }: { citationsSlice: CitationsMap }) {
  const pdfLinks = Object.entries(citationsSlice)
    .filter(
      ([, cit]) =>
        cit.kind === "jbook_pdf" && cit.official_url?.includes("#page="),
    )
    .slice(0, 5) as [string, JbookPdfCitation][];

  if (pdfLinks.length > 0) {
    return (
      <div className="mt-8 pt-6 border-t border-border mb-8">
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
      </div>
    );
  }

  // Rollup tier: no J-book PDF pages are cited — list the workbook source
  // documents instead (deduped by sheet), so every page still ends at its
  // primary sources.
  const seen = new Set<string>();
  const workbookLinks: [string, WorkbookCitation][] = [];
  for (const [factId, cit] of Object.entries(citationsSlice)) {
    if (cit.kind !== "workbook") continue;
    const wb: WorkbookCitation = cit;
    if (!wb.official_url) continue;
    const key = `${wb.sha256}:${wb.sheet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    workbookLinks.push([factId, wb]);
    if (workbookLinks.length >= 3) break;
  }

  if (workbookLinks.length > 0) {
    return (
      <div className="mt-8 pt-6 border-t border-border mb-8">
        <h2 className="text-base font-semibold mb-3 text-foreground">
          Primary Sources
        </h2>
        <ul className="space-y-1.5">
          {workbookLinks.map(([factId, wb]) => (
            <li key={factId}>
              <a
                href={wb.official_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                Budget workbook — sheet {wb.sheet}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <SectionEmpty title="Primary Sources" className="mt-8 pt-6 border-t border-border">
      No document-tier citations resolve on this page — its figures are
      derived-tier only; open any cited number for its derivation chain.
    </SectionEmpty>
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
    case "budget":
      return "budget"; // rollup tier with no classifiable workbook lines
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
        {hhi && hhi.program_dollars_fact_id ? (
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
