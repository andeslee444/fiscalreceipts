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
  getDossierCount,
  getCompaniesCount,
  getCompaniesWithAwardsCount,
  getDistrictsCount,
} from "@/lib/data";

export const COVERAGE_IDS = [
  "follow-the-dollar",
  "dossiers",
  "company-awards",
  "districts",
  "state-ca",
  "fy2026-partial",
] as const;

export type CoverageId = (typeof COVERAGE_IDS)[number];

export interface Coverage {
  id: CoverageId;
  numerator: number | null;
  denominator: number | null;
  note: string; // full rendered sentence, numbers interpolated
  anchor: string; // /methodology/#coverage-<id>
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
        anchor: "/methodology/#coverage-follow-the-dollar",
      };
    }
    case "dossiers": {
      const num = getDossierCount();
      const den = getProgramsCount();
      return {
        id,
        numerator: num,
        denominator: den,
        note: `Research dossiers exist for ${num} of ${den} programs — the top-50 programs by FY2026 request, ranked by dollar value.`,
        anchor: "/methodology/#coverage-dossiers",
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
        anchor: "/methodology/#coverage-company-awards",
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
        anchor: "/methodology/#coverage-districts",
      };
    }
    case "state-ca": {
      return {
        id,
        numerator: null,
        denominator: null,
        note: "California data covers FY2025 only — CA Open Fi$Cal updates on a lag; prior years not yet ingested.",
        anchor: "/methodology/#coverage-state-ca",
      };
    }
    case "fy2026-partial": {
      return {
        id,
        numerator: null,
        denominator: null,
        note: "FY2026 award data is a partial year — USASpending awards are reported on a rolling basis and the fiscal year does not close until September 30.",
        anchor: "/methodology/#coverage-fy2026-partial",
      };
    }
  }
}
