import { describe, it, expect } from "vitest";
import {
  ribbonPath,
  centerlinePath,
  isZeroBand,
  splitEdgeBands,
  distributionRows,
  displayAmount,
} from "@/components/flow-chart/geometry";

describe("ribbonPath", () => {
  it("builds a closed cubic ribbon between the two node faces", () => {
    const d = ribbonPath(18, 196.4, [0, 171.94, 0, 171.94]);
    // Anchors: top-left, top-right, bottom-right, bottom-left.
    expect(d.startsWith("M 18,0")).toBe(true);
    expect(d).toContain("196.4,0");
    expect(d).toContain("196.4,171.94");
    expect(d).toContain("18,171.94");
    expect(d.trim().endsWith("Z")).toBe(true);
    // Two cubic segments (top run + bottom run), one line down the far face.
    expect(d.match(/C /g)?.length).toBe(2);
    expect(d.match(/L /g)?.length).toBe(1);
  });

  it("uses the horizontal midpoint as the control x", () => {
    const d = ribbonPath(0, 100, [0, 10, 40, 50]);
    expect(d).toContain("C 50,0 50,40 100,40");
  });
});

describe("centerlinePath (zero-width negative flows)", () => {
  it("draws an open curve through the band centers", () => {
    const d = centerlinePath(18, 100, [10, 10, 30, 30]);
    expect(d.startsWith("M 18,10")).toBe(true);
    expect(d).toContain("100,30");
    expect(d).not.toContain("Z");
  });
});

describe("isZeroBand", () => {
  it("detects the exporter's zero-width compression rule", () => {
    // Real FY2017 TACOM→Boeing de-obligation geometry.
    expect(isZeroBand([292.62, 292.62, 104.43, 104.43])).toBe(true);
    expect(isZeroBand([0, 171.94, 0, 171.94])).toBe(false);
  });
});

describe("splitEdgeBands (competition overlay)", () => {
  it("partitions both faces proportionally by positive class values", () => {
    const bands = splitEdgeBands([0, 100, 200, 300], [50, 25, 0, 25]);
    expect(bands).toEqual([
      { classIndex: 0, value: 50, sy0: 0, sy1: 50, ty0: 200, ty1: 250 },
      { classIndex: 1, value: 25, sy0: 50, sy1: 75, ty0: 250, ty1: 275 },
      { classIndex: 3, value: 25, sy0: 75, sy1: 100, ty0: 275, ty1: 300 },
    ]);
  });

  it("returns no bands for a zero-width (negative) edge", () => {
    expect(splitEdgeBands([10, 10, 20, 20], [5, 5, 0, 0])).toEqual([]);
  });

  it("clamps negative class components out of the geometry (honesty stays in the tooltip)", () => {
    const bands = splitEdgeBands([0, 100, 0, 100], [150, -50, 0, 0]);
    expect(bands).toEqual([
      { classIndex: 0, value: 150, sy0: 0, sy1: 100, ty0: 0, ty1: 100 },
    ]);
  });

  it("returns no bands when no class value is positive", () => {
    expect(splitEdgeBands([0, 100, 0, 100], [0, 0, 0, 0])).toEqual([]);
  });
});

describe("distributionRows", () => {
  it("pairs values with keys, drops zeros, shares of the positive total", () => {
    const rows = distributionRows(
      [10, 0, 20, 0, 0, 70],
      ["1", "2", "3-4", "5-9", "10+", "unknown"],
    );
    expect(rows).toEqual([
      { key: "1", value: 10, pct: "10%" },
      { key: "3-4", value: 20, pct: "20%" },
      { key: "unknown", value: 70, pct: "70%" },
    ]);
  });

  it("keeps negative components with an em-dash share", () => {
    const rows = distributionRows([-5, 105], ["a", "b"]);
    expect(rows).toEqual([
      { key: "a", value: -5, pct: "—" },
      { key: "b", value: 105, pct: "100%" },
    ]);
  });

  it("labels sub-1% shares as <1%", () => {
    const rows = distributionRows([1, 999], ["a", "b"]);
    expect(rows[0].pct).toBe("<1%");
  });
});

describe("displayAmount", () => {
  it("formats without a currency sign (Task 6b SVG convention)", () => {
    expect(displayAmount(121837608, "USD thousands")).toBe("121.8B");
    expect(displayAmount(491589488703.66, "USD")).toBe("491.6B");
  });

  it("renders negatives with a typographic minus, honestly", () => {
    expect(displayAmount(-97569367.88, "USD")).toBe("−97.6M");
  });
});
