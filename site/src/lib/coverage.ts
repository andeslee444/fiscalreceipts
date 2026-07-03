import "server-only";

/**
 * Coverage manifest — Phase 5C.
 *
 * Declarative table of what each surface covers and what it omits.
 * Counts come from the same data sidecars the pages use (loaded via data.ts
 * helpers). Numbers are interpolated at build time — never hardcoded in JSX.
 *
 * Used by <CoverageNote id> and by the G2 gate (coverage.mjs).
 */

import {
  getFlowsCount,
  getProgramsCount,
  getProgramPagesCount,
  getDossierCount,
  getCompaniesCount,
  getCompaniesWithAwardsCount,
  getDistrictsCount,
  getFlowChartMeta,
} from "@/lib/data";

export const COVERAGE_IDS = [
  "follow-the-dollar",
  "dossiers",
  "company-awards",
  "districts",
  "state-ca",
  "fy2026-partial",
  "years-matrix",
  "service-books",
  "flow-bridge",
] as const;

export type CoverageId = (typeof COVERAGE_IDS)[number];

export interface Coverage {
  id: CoverageId;
  numerator: number | null;
  denominator: number | null;
  note: string; // full rendered sentence, numbers interpolated
  /**
   * Empty-state variant for surfaces that are ABSENT on a given page
   * (e.g. a program page with no flow sidecar / no dossier). Numbers are
   * interpolated here too so the G2 number check holds no matter which
   * variant a representative page renders. Null where an empty state
   * cannot occur (the surface always renders).
   */
  emptyNote: string | null;
  anchor: string; // /methodology/#coverage-<id>
  /**
   * Visible link label for <CoverageNote>. States WHAT is being explained
   * (e.g. "why coverage is partial? →") so users know what they're clicking
   * before they arrive at the methodology anchor. Consistent convention:
   * "why <topic>? →"
   */
  linkText: string;
}

export function getCoverage(id: CoverageId): Coverage {
  switch (id) {
    case "follow-the-dollar": {
      const num = getFlowsCount();
      const den = getProgramsCount();
      return {
        id,
        numerator: num,
        denominator: den,
        note: `Follow-the-dollar covers ${num} of ${den} programs — only high-confidence budget→award links are shown.`,
        emptyNote: `No follow-the-dollar view — this program's awards haven't been crosswalked at high confidence (flows cover ${num} of ${den} programs).`,
        anchor: "/methodology/#coverage-follow-the-dollar",
        linkText: "why coverage is partial? →",
      };
    }
    case "dossiers": {
      const num = getDossierCount();
      const den = getProgramsCount();
      return {
        id,
        numerator: num,
        denominator: den,
        note: `Research dossiers exist for ${num} of ${den} programs — the ${num} largest fully J-book-detailed programs by FY2026 request.`,
        emptyNote: `No research dossier for this program — dossiers cover ${num} of ${den} programs, the largest fully J-book-detailed lines by FY2026 requested dollars.`,
        anchor: "/methodology/#coverage-dossiers",
        linkText: "why no dossier here? →",
      };
    }
    case "company-awards": {
      const num = getCompaniesWithAwardsCount();
      const den = getCompaniesCount();
      return {
        id,
        numerator: num,
        denominator: den,
        note: `Award linkage is shown for ${num} of ${den} profiled companies — only high-confidence USASpending matches are included.`,
        emptyNote: null,
        anchor: "/methodology/#coverage-company-awards",
        linkText: "why partial award coverage? →",
      };
    }
    case "districts": {
      const num = getDistrictsCount();
      const den = 435;
      return {
        id,
        numerator: num,
        denominator: den,
        note: `${num} of 435 congressional districts have high-confidence linked defense dollars.`,
        emptyNote: null,
        anchor: "/methodology/#coverage-districts",
        linkText: "why not all districts? →",
      };
    }
    case "state-ca": {
      return {
        id,
        numerator: null,
        denominator: null,
        note: "California data covers FY2025 only — CA Open Fi$Cal updates on a lag; prior years not yet ingested.",
        emptyNote: null,
        anchor: "/methodology/#coverage-state-ca",
        linkText: "why FY2025 only? →",
      };
    }
    case "fy2026-partial": {
      return {
        id,
        numerator: null,
        denominator: null,
        note: "FY2026 award data is a partial year — USASpending awards are reported on a rolling basis and the fiscal year does not close until September 30.",
        emptyNote: null,
        anchor: "/methodology/#coverage-fy2026-partial",
        linkText: "why partial FY2026 data? →",
      };
    }
    case "years-matrix": {
      const num = getProgramsCount();
      const den = getProgramPagesCount();
      return {
        id,
        numerator: num,
        denominator: den,
        note:
          `All year columns come from the FY2026 President's Budget edition — prior-edition backfill is on the roadmap. ` +
          `The matrix covers the ${num} programs with detail-grade data; all ${den} program pages are browsable.`,
        emptyNote: null,
        anchor: "/methodology/#coverage-years-matrix",
        linkText: "why one edition? →",
      };
    }
    case "service-books": {
      const num = getProgramsCount();
      const den = getProgramPagesCount();
      return {
        id,
        numerator: num,
        denominator: den,
        note: `Detailed J-book justification is ingested for ${num} of ${den} program pages — the rest carry cited R-1/P-1 workbook figures while the service J-books await ingestion.`,
        emptyNote: null,
        anchor: "/methodology/#coverage-service-books",
        linkText: "why summary figures only? →",
      };
    }
    case "flow-bridge": {
      // /flow/ bridge honesty (Phase 5H). Numbers come from the flow_chart
      // export; the G2 gate recomputes both counts AND the percentage from
      // the payload, and the G9 leg-e contract requires the rendered note to
      // state the not-yet-crosswalked gap.
      const b = getFlowChartMeta().bridge;
      return {
        id,
        numerator: b.crosswalkedPeCount,
        denominator: b.universePeCount,
        note:
          `Budget→contractor links are drawn for ${b.crosswalkedPeCount} of ${b.universePeCount} crosswalked PEs — ` +
          `${b.pctNotCrosswalked}% of the FY2026 request is not yet crosswalked: an honest gap, not an absence of contractors.`,
        emptyNote: null,
        // Anchor id is "coverage-flowdown" (the section covers the whole
        // /flow/ surface, not just the bridge) — the G2 gate carries an
        // explicit override for this id.
        anchor: "/methodology/#coverage-flowdown",
        linkText: "why is so little bridged? →",
      };
    }
  }
}
