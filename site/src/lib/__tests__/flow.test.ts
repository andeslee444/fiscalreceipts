import { describe, it, expect } from "vitest";
import {
  pctNotCrosswalked,
  COMPETED_CLASS_LABELS,
  BUDGET_LEVEL_LABELS,
  SPEND_LEVEL_LABELS,
} from "@/lib/flow";

describe("pctNotCrosswalked", () => {
  it("computes the real bridge remainder percentage to one decimal", () => {
    // The FY2026 payload values: 380,565,880 of 385,481,675 (USD thousands).
    expect(pctNotCrosswalked("380565880.000", "385481675.000")).toBe("98.7");
  });

  it("handles a zero remainder", () => {
    expect(pctNotCrosswalked("0.000", "100.000")).toBe("0.0");
  });

  it("rounds to one decimal", () => {
    expect(pctNotCrosswalked("1.000", "3.000")).toBe("33.3");
  });
});

describe("competition vocabulary", () => {
  it("labels exactly the four canonical competed classes, in canonical order", () => {
    // Vocabulary order is BINDING (mirrors the exporter + G9 gate).
    expect(Object.keys(COMPETED_CLASS_LABELS)).toEqual([
      "full_and_open",
      "set_aside",
      "other_than_full",
      "not_competed",
    ]);
    for (const label of Object.values(COMPETED_CLASS_LABELS)) {
      expect(label.length).toBeGreaterThan(3);
    }
  });
});

describe("level labels", () => {
  it("covers every budget river level", () => {
    for (const level of [
      "total",
      "component",
      "appropriation",
      "budget_activity",
      "program",
      "bridge",
    ]) {
      expect(BUDGET_LEVEL_LABELS[level]).toBeTruthy();
    }
  });

  it("covers every spend river level", () => {
    for (const level of ["total", "sub_agency", "office", "family"]) {
      expect(SPEND_LEVEL_LABELS[level]).toBeTruthy();
    }
  });
});
