import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPrograms,
  getProgramDetails,
  getEntityTopByFamilyKey,
  collectCitations,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { CitationPanelProvider } from "@/components/citation-panel";

import { Breadcrumbs } from "@/components/breadcrumbs";
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

  // Build set of linkable family_keys (entities_top)
  const entityByFamilyKey = getEntityTopByFamilyKey();
  const linkableKeys = new Set(entityByFamilyKey.keys());

  // Slice lists for SSG cap
  const initialAwards = details.awards.slice(0, CAP);
  const initialMentions = details.mentions.slice(0, CAP);

  // ── Collect per-page citation slice (Task 5) ──────────────────────────────
  // Gather ALL fact_ids referenced on this page to avoid a 10MB full-citations
  // client payload. Only jbook_pdf + workbook fact_ids appear on program pages
  // (details rows with unique/ambiguous_first resolution, and budget_lines).
  const pageFactIds: string[] = [];

  // FY2024 header figure (state A when fact_id present)
  if (program.fy2024_fact_id) {
    pageFactIds.push(program.fy2024_fact_id);
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

  const citationsSlice = collectCitations(pageFactIds);

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
        linkableKeys={linkableKeys}
      />
    </div>
    </CitationPanelProvider>
  );
}
