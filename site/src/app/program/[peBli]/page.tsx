import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPrograms,
  getProgramDetails,
  getEntityTopByFamilyKey,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";

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

  return (
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
  );
}
