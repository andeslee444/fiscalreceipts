import { describe, it, expect, vi } from "vitest";

// Hermetic mock — real data sidecars must not be read in unit tests.
vi.mock("@/lib/data", () => ({
  getFlowsCount: () => 17,
  getProgramsCount: () => 420,
  // Backlog #35: the detail-grade tier is a strict SUBSET of the index, and
  // the mock keeps them different so a note that reaches for the index while
  // claiming "detail-grade" fails here.
  getDetailGradeCount: () => 418,
  getProgramPagesCount: () => 1900,
  // ROADMAP #28: the non-detail remainder is two tiers, and the mock keeps
  // them distinct AND summing to 1900 − 418 so a note that describes the
  // whole remainder as one of them fails here.
  getTierPageCounts: () => ({ rollup: 1200, decade: 282 }),
  getDossierCount: () => 50,
  getCompaniesCount: () => 200,
  getCompaniesWithAwardsCount: () => 18,
  getDistrictsCount: () => 106,
  getFlowChartMeta: () => ({
    budgetLabel: "FY2026 President's Budget (R-1 + P-1)",
    budgetUnits: "USD thousands",
    budgetFy: 2026,
    spendUnits: "USD",
    spendFys: [2024, 2025, 2026],
    defaultFy: 2025,
    fy2026Partial: true,
    sourceNote: "USAspending DoD prime contract transactions",
    offersNote: "offers, not bidders' identities",
    bridge: {
      crosswalkedPeCount: 10,
      universePeCount: 24,
      highConfidencePeCount: 6,
      pctNotCrosswalked: "98.7",
    },
  }),
}));

import { getCoverage, COVERAGE_IDS } from "@/lib/coverage";

describe("coverage manifest", () => {
  it("exposes all nine surfaces with computed counts", () => {
    const ids = ["follow-the-dollar", "dossiers", "company-awards", "districts", "state-ca", "fy2026-partial", "years-matrix", "service-books", "flow-bridge"] as const;
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
      "The matrix covers the 420 program elements in the FY2026 budget index, " +
        "418 of which carry detail-grade R-2/P-40 data; all 1,900 program pages are browsable.",
    );
  });

  it("years-matrix note states the edition rule — the 5D roadmap promise is delivered (5E)", () => {
    const c = getCoverage("years-matrix");
    expect(c.note).toContain("actuals for FY N come from the PB(N+2)");
    expect(c.note).toContain("ten editions (PB2017–PB2026)");
    expect(c.note).not.toContain("roadmap");
    expect(c.anchor).toBe("/methodology/#coverage-editions");
  });

  it("service-books note interpolates full-tier vs page-universe counts (5F)", () => {
    const c = getCoverage("service-books");
    expect(c.note).toContain("418 of 1,900 program pages");
    expect(c.anchor).toBe("/methodology/#coverage-service-books");
  });

  it("follow-the-dollar note interpolates mocked flow and program counts", () => {
    const c = getCoverage("follow-the-dollar");
    expect(c.note).toContain("17 of 420");
  });

  it("flow-bridge note states the crosswalk gap with interpolated counts (5H)", () => {
    const c = getCoverage("flow-bridge");
    // The G9 leg-e contract requires the rendered note to state the
    // not-yet-crosswalked gap; the G2 gate recomputes both numbers.
    expect(c.note).toContain("10 of 24 crosswalked PEs");
    expect(c.note).toContain("98.7% of the FY2026 request is not yet crosswalked");
    expect(c.anchor).toBe("/methodology/#coverage-flowdown");
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
    // /flow/ always renders the bridge note.
    expect(getCoverage("flow-bridge").emptyNote).toBeNull();
  });
});
