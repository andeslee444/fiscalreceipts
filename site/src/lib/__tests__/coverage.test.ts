import { describe, it, expect, vi } from "vitest";

// Hermetic mock — real data sidecars must not be read in unit tests.
vi.mock("@/lib/data", () => ({
  getFlowsCount: () => 17,
  getProgramsCount: () => 420,
  getDossierCount: () => 50,
  getCompaniesCount: () => 200,
  getCompaniesWithAwardsCount: () => 18,
  getDistrictsCount: () => 106,
}));

import { getCoverage, COVERAGE_IDS } from "@/lib/coverage";

describe("coverage manifest", () => {
  it("exposes all six surfaces with computed counts", () => {
    const ids = ["follow-the-dollar", "dossiers", "company-awards", "districts", "state-ca", "fy2026-partial"] as const;
    expect(COVERAGE_IDS).toEqual(ids);
    for (const id of ids) {
      const c = getCoverage(id);
      expect(c.note.length).toBeGreaterThan(10);
      expect(c.anchor).toMatch(/^\/methodology\/#coverage-/);
      // numerator/denominator present where meaningful (fy2026-partial is prose-only)
      if (id !== "fy2026-partial" && id !== "state-ca") {
        expect(c.numerator).toBeGreaterThan(0);
        expect(c.denominator).toBeGreaterThan(c.numerator!);
      }
    }
  });

  it("follow-the-dollar note interpolates mocked flow and program counts", () => {
    const c = getCoverage("follow-the-dollar");
    expect(c.note).toContain("17 of 420");
  });
});
