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
  ProgramSummary,
  WorkbookCitation,
} from "@/lib/data";
import {
  isIngestedServiceOrg,
  isRollupDetails,
  isZeroContentDetails,
  rollupProgramRow,
  serviceOrgName,
} from "@/lib/program-tier";
import { findPeLinks } from "@/lib/pe-link";
import { formatAmount } from "@/lib/format";
import { hasLineage } from "@/lib/lineage";
import { Cite, CiteChips } from "@/components/cite";
import { normalizeExhibitFamily } from "@/lib/basis";
import { LineageRail } from "@/components/lineage/lineage-rail";
import { FamilyFundingLine } from "@/components/lineage/family-funding-line";
import { dossierFactIds, isFactCitation } from "@/lib/dossier";
import { whatItIsCard, type WhatItIsCard } from "@/lib/what-it-is";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { programOgImages } from "@/lib/og";
import { programFeedAlternates, programFeedPaths, feedLinks } from "@/lib/feeds";
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
  reconKeySet,
} from "@/components/program-figures";
import { DossierFactChip, DossierUrlChip } from "@/components/dossier-chips";
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
 * Phase 5F §2a: the page universe is EVERY program_details sidecar (~1,995
 * after the Phase 5G Army/AF/SF archive round) — the ~1,741 full-tier
 * programs from programs.json plus the ~254 remaining rollup-tier sidecars
 * (R-1/P-1 figures + trajectory only, no matching R-2/P-40 J-book detail).
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

  // ── §P2-5: the description is WRITTEN, and it is on the canonical basis ──
  //
  // It used to be a slice of R-2/P-40 justification prose, so every share
  // card and every search snippet opened mid-thought: "The FY 2026 budget
  // provides funding for 24 F-35A Aircraft, Engines and associated
  // Non-Recurring and ancillary…". A description is a promise about the page;
  // a truncated paragraph from inside the page is not one.
  //
  // The figures come from `trajectory` — the P-1/R-1 workbook total
  // obligation authority the whole site treats as canonical (lib/basis,
  // BASIS_LABEL.toa), NOT the R-2/P-40 program line that §P0-1 found
  // disagreeing with it. Same basis as the OG image beside it, same basis as
  // the headline cards on the page. Units are USD thousands on the
  // trajectory payload. Nothing here is authored when the corpus is silent:
  // a missing figure drops its clause rather than inventing one.
  const fy26Toa = program.trajectory?.fy2026_total ?? null;
  const fy24Toa = program.trajectory?.fy2024_actuals ?? null;
  const figureClauses: string[] = [];
  if (fy26Toa != null) {
    figureClauses.push(
      `${formatAmount(fy26Toa, "USD thousands")} requested for FY2026`,
    );
  }
  if (fy24Toa != null) {
    figureClauses.push(
      `${formatAmount(fy24Toa, "USD thousands")} in FY2024 actuals`,
    );
  }
  const basisTail =
    figureClauses.length > 0
      ? `${figureClauses.join(", ")} (P-1/R-1 workbook total obligation authority). `
      : "";
  const tierTail =
    tier === "rollup"
      ? isIngestedServiceOrg(details.service_org ?? "")
        ? "Workbook-tier line: no R-2/P-40 J-book narrative for it. "
        : "Workbook-tier line: the detailed service J-book is not yet ingested. "
      : "";
  const description =
    `${program.title} (${peBli}), ${serviceOrgName(program.org)}. ` +
    `${basisTail}${tierTail}` +
    `Every figure links to the document it is printed in.`;

  const canonicalUrl = `${SITE_URL}/program/${peBli}/`;

  return {
    title: `${program.title} — FY2026 Budget, Contracts & Lobbying`,
    description,
    alternates: {
      canonical: canonicalUrl,
      // §P1-8 watch feed: advertised only when this program actually has
      // feed events (programFeedAlternates returns null otherwise), so the
      // page never autodiscovers a file the build did not write.
      ...(programFeedAlternates(peBli, program.title)
        ? { types: programFeedAlternates(peBli, program.title)! }
        : {}),
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

  // Summary union payload (PM Sprint 1): card fids, both reconciliation
  // sides, and the named-primes claim fids all open the citation panel.
  const summary: ProgramSummary = details.summary;
  for (const card of summary.cards) {
    if (card.fid) pageFactIds.push(card.fid);
  }
  for (const entry of summary.reconciliation) {
    pageFactIds.push(entry.toa.fid);
    if (entry.detail.fid) pageFactIds.push(entry.detail.fid);
  }
  for (const prime of summary.named_primes) {
    pageFactIds.push(prime.fact_id);
  }

  // Derived concentration figures (HHI + program dollars)
  if (program.hhi?.hhi_fact_id) pageFactIds.push(program.hhi.hhi_fact_id);
  if (program.hhi?.program_dollars_fact_id) {
    pageFactIds.push(program.hhi.program_dollars_fact_id);
  }

  // Decade series + book-diff (Phase 5E): every sparkline point and the
  // asked-vs-spent delta open the citation panel from the embedded slice.
  const decadeSeries = details.decade_series ?? null;
  const bookDiff = details.book_diff ?? null;
  if (decadeSeries) {
    for (const points of Object.values(decadeSeries)) {
      for (const p of points ?? []) {
        if (p.fid) pageFactIds.push(p.fid);
      }
    }
  }
  if (bookDiff?.fid) pageFactIds.push(bookDiff.fid);

  // Lineage (Task 7): every stated rail edge's evidence.fact_id (sentence
  // citation, opened from the rail marker) AND every family funding_line point
  // fid (a state-A Cite amount) must be in the page slice or the panel won't
  // resolve at runtime. Inferred edges carry no fact_id (evidence:null).
  const lineage = details.lineage ?? null;
  if (lineage) {
    for (const edge of [
      ...(lineage.rail?.predecessors ?? []),
      ...(lineage.rail?.successors ?? []),
    ]) {
      // evidence is present iff stated; its fact_id is never null (type-accurate)
      if (edge.evidence) pageFactIds.push(edge.evidence.fact_id);
    }
    for (const p of lineage.family?.funding_line ?? []) {
      if (p.fid) pageFactIds.push(p.fid);
    }
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

  // FY2026 discretionary/reconciliation split (backlog #50): the two Cite
  // figures rendered beside the FY2026 headline card need their own fact
  // ids in the page slice, or the citation panel can't resolve them.
  const fy26Split = details.fy26_split ?? null;
  if (fy26Split) {
    if (fy26Split.disc?.fid) pageFactIds.push(fy26Split.disc.fid);
    if (fy26Split.reconciliation?.fid) pageFactIds.push(fy26Split.reconciliation.fid);
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
  // Ingested services (Navy, Army, Air Force / Space Force) have their FY2026
  // books in the pipeline — a rollup line for one of them has no matching
  // R-2/P-40 narrative, it is NOT "awaiting ingestion". Drives the honest
  // empty-state wording in the justification section (5G archive round).
  const serviceIngested = isIngestedServiceOrg(details.service_org ?? "");

  // ── WHAT IT IS card (§P1-2) ───────────────────────────────────────────────
  // projectCount is the page's OWN project grain (the R-2/P-40 rows the
  // details table renders), not dim_programs.project_count — the card must
  // describe what this page actually shows.
  const projectCount = new Set(
    details.details
      .map((d) => d.project_number)
      .filter((n): n is string => Boolean(n)),
  ).size;
  const whatItIs = whatItIsCard({
    tier,
    peBli,
    title: program.title,
    org: tier === "rollup" ? (details.service_org ?? "") : program.org,
    exhibitFamily: program.exhibit_family,
    budgetLines: details.budget_lines,
    projectCount,
    dossier,
    serviceOrg: details.service_org ?? "",
    serviceIngested,
  });

  return (
    <CitationPanelProvider
      citations={citationsSlice}
      // §P0-3: program context for the copy-as-footnote formatter — the
      // footnote head is `{title} ({pe_bli})`, never a re-derived page title.
      program={{ name: program.title, code: program.pe_bli }}
    >
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

      {/* §P1-8 watch feed — rendered only when this program has feed events,
          the same rule the metadata autodiscovery uses. "The site that tells
          you when a program's budget moves, with the receipt attached." */}
      {programFeedAlternates(peBli, program.title) && (
        <p data-feed-subscribe="" className="mt-2 text-xs text-muted-foreground">
          Watch this program:{" "}
          <a
            href={feedLinks(programFeedPaths(peBli)).rss}
            className="text-foreground/80 underline decoration-dotted hover:text-foreground hover:decoration-solid"
            title={`${program.title} watch feed — RSS`}
          >
            RSS
          </a>
          {" \u00b7 "}
          <a
            href={feedLinks(programFeedPaths(peBli)).atom}
            className="text-foreground/80 underline decoration-dotted hover:text-foreground hover:decoration-solid"
            title={`${program.title} watch feed — Atom`}
          >
            Atom
          </a>
        </p>
      )}

      {/* ═══ Canonical section skeleton (Phase 5F §2d) — every program page,
          both tiers, renders these thirteen data-section blocks in this order;
          absent data renders a quiet explained empty state, never silence. ═══ */}

      {/* 1 · Answer strip — above-the-fold WHAT/CHANGED/WHO (G6 contract). */}
      <ProgramSection id="answer-strip">
        <AnswerStrip program={program} summary={summary} whatItIs={whatItIs} />
      </ProgramSection>

      {/* 2 · Budget figures — the summary UNION cards (§P0-2) + the
          reconciliation strip (§P0-1). */}
      <ProgramSection id="figures">
        <ProgramFigures program={program} summary={summary} fy26Split={fy26Split} />
      </ProgramSection>

      {/* 3 · Trajectory — union-card sparkline + Phase 5E decade series */}
      <ProgramSection id="trajectory">
        {summary.cards.some((c) => c.key !== "change" && c.value !== null) ||
        decadeSeries ? (
          <ProgramTrajectoryCard
            program={program}
            summary={summary}
            decadeSeries={decadeSeries}
            bookDiff={bookDiff}
          />
        ) : (
          <SectionEmpty title="Budget Trajectory">
            No year-over-year trajectory row for this line — the FY2026
            R-1/P-1 trajectory workbooks carry no entry for it, so no
            FY24→FY26 series can be drawn.
          </SectionEmpty>
        )}
      </ProgramSection>

      {/* 3b · Lineage — evidence-tiered YoY money-flow rail + 1:1 family
          funding line (program-lineage Task 7). Stated edges are cited
          (clickable → panel), inferred edges are dashed/amber behind an
          opt-in disclosure, resolved:false links stay plain text. Absent
          lineage renders the honest empty state (never silence). */}
      <ProgramSection id="lineage">
        {hasLineage(details) && lineage ? (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-3 text-foreground">
              Program Lineage
            </h2>
            <LineageRail
              selfPe={peBli}
              selfTitle={program.title}
              rail={lineage.rail}
              linkablePes={[
                ...lineage.rail.predecessors,
                ...lineage.rail.successors,
              ]
                .map((e) => e.pe)
                .filter((pe) => peIndex.has(pe))}
            />
            {lineage.family && lineage.family.funding_line.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Family Funding Line
                </h3>
                <FamilyFundingLine
                  family={lineage.family}
                  selfPe={peBli}
                  reconKeys={reconKeySet(summary)}
                />
              </div>
            )}
          </div>
        ) : (
          <SectionEmpty title="Program Lineage">
            No predecessor/successor lineage was recorded for this program
            element — no FY-to-FY transfer into or out of this line was stated
            in the ingested J-books, and none was inferred from the program
            structure.
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
            {serviceIngested ? (
              <>
                The {serviceName} FY2026 J-book is ingested, but this program
                element carries no matching R-2/P-40 accomplishments or
                planned-program narrative — see the description note above.
              </>
            ) : (
              <>
                Accomplishments and planned-program narratives live in the{" "}
                {serviceName} J-book, which is not yet ingested — see the
                description note above for the roadmap.
              </>
            )}
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
            <ProgramBudgetLines
              budgetLines={details.budget_lines}
              reconKeys={reconKeySet(summary)}
            />
            <ProgramDetailsTable
              details={details.details}
              reconKeys={reconKeySet(summary)}
            />
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

      {/* 10 · Oversight — GAO overlay when the program's DEPARTMENT has
          high-risk areas / improper-payment exposure.
          §P1-10: this is a department-level designation, and it used to render
          on a program page as "⚠ GAO oversight: DOD – 5 high-risk areas" with
          no qualifier — reading as a program-specific finding. On the F-35
          that is doubly unfortunate, since real program-level GAO work exists
          and this is not it. It now says what it is, is de-emphasized to a
          quiet note rather than an amber alert (amber is reserved for
          program-specific findings, which we do not yet ingest — ROADMAP
          backlog #30), and keeps its link. */}
      <ProgramSection id="oversight">
        {gao ? (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-2 text-foreground">
              Oversight
            </h2>
            <div
              data-gao-scope="department"
              className="rounded-lg border border-border bg-muted/40 px-3 py-2.5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Department-level designation (not specific to this program)
              </p>
              <p className="mt-1 text-sm text-foreground">
                GAO lists{" "}
                {gao.overlay.high_risk_areas.length > 0 ? (
                  <>
                    {gao.overlay.high_risk_areas.length} high-risk area
                    {gao.overlay.high_risk_areas.length !== 1 ? "s" : ""} for{" "}
                  </>
                ) : (
                  "oversight exposure for "
                )}
                {gao.agencyCode} as a whole. That designation covers the
                department, not{" "}
                <span data-program-name>{program.title}</span> — no
                program-specific GAO finding for this line is in the ingested
                data.{" "}
                <Link
                  href={`/agency/${program.org}/#oversight`}
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  title={`GAO oversight context for ${gao.agencyCode} — high-risk areas and improper-payment exposure`}
                >
                  See the {gao.agencyCode} oversight record
                </Link>
                .
              </p>
            </div>
          </div>
        ) : (
          <SectionEmpty title="Oversight">
            No GAO high-risk areas or improper-payment overlays map to{" "}
            {serviceOrgName(program.org)} in the ingested GAO data — absence of
            an overlay is not a clean bill of health, only absence from those
            two lists.
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

/**
 * WHAT IT IS (§P1-2) — the card's three honest sources, decided in
 * lib/what-it-is.ts and rendered here.
 *
 *  - dossier: the dossier's own first sentence(s), VERBATIM, each with its
 *    own citation chip — the same clickable receipt the dossier section
 *    carries 3,000px below. `data-source-text` + the claim's citation anchor
 *    are the render-static a0 contract for quoted source prose.
 *  - fields: a deterministic J-book/workbook sentence; the account clause
 *    carries the fact id of the workbook row it was read from.
 *  - rollup: the template shape PLUS the tier's honest tail.
 *
 * data-what-source declares the tier so gate 21 leg (f) can assert a dossier
 * program's card is dossier-sourced — the template stub cannot come back
 * unnoticed.
 */
function WhatItIsBody({ card }: { card: WhatItIsCard }) {
  if (card.source === "dossier") {
    return (
      <>
        {card.claims.map((claim, i) => (
          <span
            key={i}
            data-what-claim
            // Dossier prose may quote dollar figures from its cited source —
            // the claim's own citation is the required anchor (same contract
            // as the dossier section's <li>).
            data-source-text="dossier-claim"
            {...(isFactCitation(claim.citation)
              ? { "data-cite-fact-id": claim.citation.fact_id }
              : { "data-cite-url": claim.citation.url })}
          >
            {i > 0 && " "}
            {claim.text}
            {isFactCitation(claim.citation) ? (
              <DossierFactChip factId={claim.citation.fact_id} />
            ) : (
              <DossierUrlChip url={claim.citation.url} meta={null} />
            )}
          </span>
        ))}
      </>
    );
  }

  if (card.source === "rollup") {
    return (
      <>
        <span data-program-name>{card.text}</span>{" "}
        <span className="text-muted-foreground">{card.tail}</span>
      </>
    );
  }

  // fields — the account clause is checkable via the workbook row's chip.
  return (
    <>
      {/* Official titles may contain dollar strings ("ORDNANCE ITEMS <$5M") —
          currency-scan exemption, same as the old template card. */}
      <span data-program-name>{card.text}</span>
      {card.accountFactId && <DossierFactChip factId={card.accountFactId} />}
    </>
  );
}

function AnswerStrip({
  program,
  summary,
  whatItIs,
}: {
  program: ProgramRow;
  summary: ProgramSummary;
  whatItIs: WhatItIsCard;
}) {
  // WHAT-CHANGED (§P0-2 fix 1): the summary UNION change card — a derived
  // fact with formula + inputs, so the drawer shows the derivation. Never
  // the raw trajectory mart (its per-org slice produced the live false
  // absence this section was flagged for).
  const changeCard = summary.cards.find((c) => c.key === "change") ?? null;
  const change = changeCard?.value ?? null;
  const pct = changeCard?.pct ?? null;
  const hhi = program.hhi;
  const primes = summary.named_primes;
  // §48: this whole strip is ONE program's own answers — the change card's
  // TOA chip shares the page's own exhibit_family, never "mixed".
  const exhibitFamily = normalizeExhibitFamily(program.exhibit_family);

  return (
    <div className="mb-6 grid grid-cols-1 md:grid-cols-3 rounded-lg border border-border bg-card divide-y md:divide-y-0 md:divide-x divide-border">
      {/* WHAT IT IS (§P1-2) — dossier prose when the page has a dossier,
          otherwise a field-generated J-book sentence; rollup pages keep their
          honest tail. See WhatItIsBody / lib/what-it-is.ts. */}
      <AnswerItem label="What it is" testId="answer-what">
        <span data-what-source={whatItIs.source}>
          <WhatItIsBody card={whatItIs} />
        </span>
      </AnswerItem>

      {/* WHAT CHANGED — the union change card with its derived citation.
          Visual-judge M8: the value cluster "-$885.8M (-17.8%) FY25→26"
          stays contiguous (whitespace-nowrap, Cite chips suppressed) and
          the chips follow AFTER it, wrapping together as one unit
          (<CiteChips> — same sibling-of-[data-amount] contract). */}
      <AnswerItem label="What changed" testId="answer-changed">
        {changeCard && change !== null && changeCard.units ? (
          <>
            <span className="whitespace-nowrap">
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
                  units={changeCard.units}
                  dataset={changeCard.dataset ?? "fct_budget_trajectory"}
                  factId={changeCard.fid}
                  basis={changeCard.basis ?? undefined}
                  fy={changeCard.fy}
                  measure={changeCard.measure}
                  edition={changeCard.edition}
                  exhibitFamily={exhibitFamily}
                  chip={false}
                />
              </span>
              {pct != null && (
                <span className="text-muted-foreground" aria-hidden="true">
                  {" "}
                  ({pct > 0 ? "+" : ""}
                  {pct.toFixed(1)}%)
                </span>
              )}
              <span className="text-muted-foreground">
                {" "}
                {TRAJECTORY_FY_LABEL}
              </span>
            </span>{" "}
            <CiteChips
              factId={changeCard.fid}
              basis={changeCard.basis}
              measure={changeCard.measure}
              edition={changeCard.edition}
              exhibitFamily={exhibitFamily}
            />
          </>
        ) : (
          <span className="text-muted-foreground">
            No {TRAJECTORY_FY_LABEL} comparison —{" "}
            {changeCard?.absence_reason === "no-comparison"
              ? "endpoints unavailable or on different bases."
              : "trajectory data incomplete for this line."}
          </span>
        )}
      </AnswerItem>

      {/* WHO GETS IT — top recipient family + cited program obligations from
          the concentration sidecar; the J-book named-primes fallback when the
          crosswalk is empty (§P0-2 fix 3); honest absence otherwise. */}
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
              basis="usaspending"
              fy="all-years"
              measure="obligations"
            />
            <span className="text-muted-foreground"> in matched awards.</span>
          </>
        ) : primes.length > 0 ? (
          <>
            <span className="text-muted-foreground">Named in the J-book: </span>
            {primes.map((prime, i) => (
              <span key={prime.family_key} className="whitespace-nowrap">
                {i > 0 && <span className="text-muted-foreground">, </span>}
                <span className="font-medium">{prime.name}</span>
                <DossierFactChip factId={prime.fact_id} />
              </span>
            ))}
            <span className="text-muted-foreground">
              {" "}
              — not yet crosswalked to award data.
            </span>
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
