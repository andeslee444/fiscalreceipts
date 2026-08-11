/**
 * hhi-band — backlog #57. The single source for the DOJ/FTC concentration
 * bands rendered on /program/{peBli}/ (program-concentration.tsx), the
 * homepage lede gloss (page.tsx), and every /feed/ hhi card
 * (feed-headline.tsx's hhiScopeNote) — and read by scripts/gates/feed.mjs
 * leg (l). Pinning the boundaries here is what keeps the pages and the
 * gate from silently drifting apart the way BASIS_LABEL once did
 * (backlog #48).
 */

import { describe, it, expect } from "vitest";
import { hhiBand, HHI_MODERATE_MIN, HHI_CONCENTRATED_MIN } from "../hhi-band.mjs";

describe("hhiBand", () => {
  it("bands the standard DOJ/FTC thresholds", () => {
    expect(HHI_MODERATE_MIN).toBe(1500);
    expect(HHI_CONCENTRATED_MIN).toBe(2500);
  });

  it("labels values below 1,500 Competitive", () => {
    expect(hhiBand(0).label).toBe("Competitive");
    expect(hhiBand(505.5).label).toBe("Competitive");
    expect(hhiBand(1499.99).label).toBe("Competitive");
  });

  it("labels 1,500 up to (not including) 2,500 Moderately Concentrated", () => {
    expect(hhiBand(1500).label).toBe("Moderately Concentrated");
    expect(hhiBand(2000).label).toBe("Moderately Concentrated");
    expect(hhiBand(2499.99).label).toBe("Moderately Concentrated");
  });

  it("labels 2,500 and above Highly Concentrated", () => {
    // Four EQUAL-share firms alone produce exactly 2,500 (4 * 25^2) — the
    // DOJ/FTC "highly concentrated" floor, not a near-monopoly line.
    expect(hhiBand(2500).label).toBe("Highly Concentrated");
    expect(hhiBand(9715.83).label).toBe("Highly Concentrated");
    expect(hhiBand(10000).label).toBe("Highly Concentrated");
  });

  it("carries a stable machine-readable key alongside the label", () => {
    expect(hhiBand(100).key).toBe("competitive");
    expect(hhiBand(2000).key).toBe("moderate");
    expect(hhiBand(5000).key).toBe("concentrated");
  });
});
