import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  blockParentage,
  pctNotCrosswalked,
  COMPETED_CLASS_LABELS,
  BUDGET_LEVEL_LABELS,
  SPEND_LEVEL_LABELS,
  type FlowChartPayload,
  type FlowEdge,
  type FlowNode,
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

describe("blockParentage — the table view may not print impossible arithmetic", () => {
  const nodes = [
    { id: "total", label: "Total", value: 300, level: "total", x0: 0, x1: 1, y0: 0, y1: 1 },
    { id: "army", label: "Army", value: 100, level: "component", x0: 2, x1: 3, y0: 0, y1: 1 },
    { id: "navy", label: "Navy", value: 200, level: "component", x0: 2, x1: 3, y0: 0, y1: 1 },
    { id: "other", label: "Other (56)", value: 250, level: "appropriation", x0: 4, x1: 5, y0: 0, y1: 1 },
    { id: "solo", label: "Solo", value: 60, level: "appropriation", x0: 4, x1: 5, y0: 0, y1: 1 },
  ] as unknown as FlowNode[];
  const edges = [
    { s: 0, t: 1, v: 100 },
    { s: 0, t: 2, v: 200 },
    { s: 1, t: 3, v: 80 },   // Army sends 80 of the 250
    { s: 2, t: 3, v: 170 },  // Navy sends 170 — Navy is the largest source
    { s: 1, t: 4, v: 60 },   // Solo is fed by Army alone
  ] as unknown as FlowEdge[];

  it("names the single parent when a block has exactly one source", () => {
    const p = blockParentage(nodes, edges, 4)!;
    expect(p.sourceCount).toBe(1);
    expect(p.text).toBe("from Army");
  });

  it("says how many sources feed a multi-source block, and names the largest AS largest", () => {
    const p = blockParentage(nodes, edges, 3)!;
    expect(p.sourceCount).toBe(2);
    expect(p.text).toBe("from 2 sources, largest Navy");
    // The failure mode this replaces: a bare "from X" that reads as the whole
    // node total flowing from one smaller parent.
    expect(p.text).not.toBe("from Navy");
  });

  it("returns null for a source node — nothing flows into the total", () => {
    expect(blockParentage(nodes, edges, 0)).toBeNull();
  });

  /**
   * The regression, run against the REAL shipped payload rather than a
   * fixture: for every block in every river, a single-source "from X" line
   * may only be printed when X is at least as large as the block it feeds.
   * Round 2 fixed 93 of 95 rows this way and left the aggregated ones; this
   * asserts the whole set, both rivers, every spend fiscal year.
   */
  it("never prints a bare parent that is smaller than the block it feeds", () => {
    const payload = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../../../data/site/json/flow_chart.json"),
        "utf8",
      ),
    ) as FlowChartPayload;
    const rivers: { tag: string; nodes: FlowNode[]; edges: FlowEdge[] }[] = [
      { tag: "budget", nodes: payload.budget.nodes, edges: payload.budget.edges },
      ...Object.entries(payload.spend.by_fy).map(([fy, r]) => ({
        tag: `spend ${fy}`,
        nodes: r.nodes,
        edges: r.edges,
      })),
    ];
    let checked = 0;
    let multi = 0;
    for (const river of rivers) {
      river.nodes.forEach((n, i) => {
        const p = blockParentage(river.nodes, river.edges, i);
        if (!p) return;
        checked++;
        if (p.sourceCount > 1) {
          multi++;
          // Multi-source blocks state the source COUNT, so no single parent
          // is being offered as the whole story.
          expect(p.text, `${river.tag} ${n.label}`).toMatch(
            /^from \d+ sources, largest /,
          );
          return;
        }
        const parent = river.nodes[
          river.edges.filter((e) => e.t === i).sort((a, b) => b.v - a.v)[0].s
        ];
        expect(
          parent.value,
          `${river.tag}: "${n.label}" (${n.value}) says "${p.text}" but that parent holds ${parent.value}`,
        ).toBeGreaterThanOrEqual(n.value * 0.999);
      });
    }
    // Vacuity: the real payload must actually exercise both branches.
    expect(checked).toBeGreaterThan(100);
    expect(multi).toBeGreaterThan(0);
  });
});
