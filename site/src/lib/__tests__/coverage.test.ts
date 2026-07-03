import { describe, it, expect, vi } from "vitest";

// Hermetic mock — real data sidecars must not be read in unit tests.
vi.mock("@/lib/data", () => ({
  getFlowsCount: () => 17,
  getProgramsCount: () => 420,
  getProgramPagesCount: () => 1900,
  getDossierCount: () => 50,
  getCompaniesCount: () => 200,
  getCompaniesWithAwardsCount: () => 18,
  getDistrictsCount: () => 106,
}));

import { getCoverage, COVERAGE_IDS } from "@/lib/coverage";

describe("coverage manifest", () => {
  it("exposes all eight surfaces with computed counts", () => {
    const ids = ["follow-the-dollar", "dossiers", "company-awards", "districts", "state-ca", "fy2026-partial", "years-matrix", "service-books"] as const;
    expect(COVERAGE_IDS).toEqual(ids);
    for (const id of ids) {
      const c = getCoverage(id);
      expect(c.note.length).toBeGreaterThan(10);
      expect(c.anchor).toMatch(/^\/methodology\/#coverage-/);
      // numerator/denominator present where meaningful
      // (fy2026-partial / state-ca are prose-only)
      if (id !== "fy2026-partial" && id !== "state-ca") {
        expect(c.numerator).toBeGreaterThan(0);
        expect(c.denominator).toBeGreaterThan(c.numerator!);
      }
      // linkText must be present and follow the "why …? →" convention
      expect(c.linkText).toMatch(/^why .+\? →$/);
    }
  });

  it("years-matrix note states matrix scope vs browsable pages with interpolated counts (5F)", () => {
    const c = getCoverage("years-matrix");
    expect(c.note).toContain(
      "The matrix covers the 420 programs with detail-grade data; all 1900 program pages are browsable.",
    );
  });

  it("service-books note interpolates full-tier vs page-universe counts (5F)", () => {
    const c = getCoverage("service-books");
    expect(c.note).toContain("420 of 1900 program pages");
    expect(c.anchor).toBe("/methodology/#coverage-service-books");
  });

  it("follow-the-dollar note interpolates mocked flow and program counts", () => {
    const c = getCoverage("follow-the-dollar");
    expect(c.note).toContain("17 of 420");
  });

  it("empty-state notes carry the same interpolated counts", () => {
    // Empty-state variants must satisfy the same G2 number check as the
    // standard notes (the representative flow page may lack a dossier).
    expect(getCoverage("follow-the-dollar").emptyNote).toContain("17 of 420");
    expect(getCoverage("dossiers").emptyNote).toContain("50 of 420");
    // Surfaces that always render have no empty-state variant.
    expect(getCoverage("districts").emptyNote).toBeNull();
    expect(getCoverage("state-ca").emptyNote).toBeNull();
    expect(getCoverage("fy2026-partial").emptyNote).toBeNull();
    expect(getCoverage("years-matrix").emptyNote).toBeNull();
    // service-books renders through the per-service <ServiceBooksNote>, not
    // an emptyNote variant.
    expect(getCoverage("service-books").emptyNote).toBeNull();
  });
});
