import { describe, it, expect } from "vitest";
import { getCoverage, COVERAGE_IDS } from "@/lib/coverage";

describe("coverage manifest", () => {
  it("exposes all six surfaces with computed counts", () => {
    const ids = ["follow-the-dollar", "dossiers", "company-awards", "districts", "state-ca", "fy2026-partial"];
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
});
