import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CitationPanelContext } from "@/components/cite";
import { FlowChart } from "@/components/flow-chart";
import type { FlowChartPayload } from "@/lib/flow";

/**
 * Fixture payload — minimal but shape-complete flow_chart.json (schema v1).
 * Geometry is exporter-style (width 1000; node rects; edge bands); the
 * component performs no layout math, so consistency is only visual here.
 */
function fixture(): FlowChartPayload {
  return {
    schema_version: 1,
    budget: {
      fiscal_year: 2026,
      label: "FY2026 President's Budget (R-1 + P-1)",
      units: "USD thousands",
      levels: ["total", "component", "bridge"],
      width: 1000,
      height: 640,
      nodes: [
        { id: "b:total", fid: "fb-total", label: "FY2026 request", level: "total", value: 100, x0: 0, x1: 18, y0: 0, y1: 100 },
        { id: "b:c:A", fid: "fb-army", label: "Army", level: "component", value: 60, x0: 491, x1: 509, y0: 0, y1: 60 },
        {
          id: "b:other:component", fid: "fb-other", label: "Other (3)", level: "component", value: 40,
          x0: 491, x1: 509, y0: 70, y1: 110,
          other: {
            count: 3,
            members: [
              { k: "X", l: "X Agency", v: 25 },
              { k: "Y", l: "Y Agency", v: 10 },
            ],
            omitted: 1,
            omitted_value: 5,
          },
        },
        { id: "b:bridge:crosswalked", fid: "fb-cw", label: "Crosswalked to contractors (1 PE)", level: "bridge", value: 30, x0: 982, x1: 1000, y0: 0, y1: 30 },
        { id: "b:bridge:not-crosswalked", fid: "fb-ny", label: "Not yet crosswalked", level: "bridge", value: 70, x0: 982, x1: 1000, y0: 40, y1: 110 },
      ],
      edges: [
        { s: 0, t: 1, v: 60, f: "fe-1", g: [0, 60, 0, 60] },
        { s: 0, t: 2, v: 40, f: "fe-2", g: [60, 100, 70, 110] },
        { s: 1, t: 3, v: 30, f: "fe-3", g: [0, 30, 0, 30] },
        { s: 1, t: 4, v: 30, f: "fe-4", g: [30, 60, 40, 70] },
        { s: 2, t: 4, v: 40, f: "fe-5", g: [70, 110, 70, 110] },
      ],
      bridge: {
        budget_total: 100,
        budget_total_str: "100.000",
        crosswalked_total: 30,
        crosswalked_total_str: "30.000",
        not_yet_crosswalked: 70,
        not_yet_crosswalked_str: "70.000",
        crosswalk_universe_pe_count: 24,
        crosswalked_pe_count: 1,
        high_confidence_pe_count: 1,
        crosswalked_node: "b:bridge:crosswalked",
        not_crosswalked_node: "b:bridge:not-crosswalked",
        coverage_note: "70% of the request is not yet crosswalked.",
        programs: [
          {
            pe_bli: "0602702E",
            value: 30,
            confidence: "high",
            families: [{ family_key: "ACME", confidence: "high" }],
          },
        ],
      },
    },
    spend: {
      fys: [2024, 2025],
      default_fy: 2025,
      competed_classes: ["full_and_open", "set_aside", "other_than_full", "not_competed"],
      offers_buckets: ["1", "2", "3-4", "5-9", "10+", "unknown"],
      units: "USD",
      levels: ["total", "family"],
      width: 1000,
      height: 640,
      notes: { fy2026_partial: true, offers: "offers, not bidders' identities." },
      source_note: "USAspending DoD prime contract transactions.",
      by_fy: {
        "2024": {
          total: 500,
          total_str: "500.000",
          nodes: [
            { id: "s:2024:total", fid: "fs24-total", label: "DoD contract obligations FY2024", level: "total", value: 500, x0: 0, x1: 18, y0: 0, y1: 50 },
            { id: "s:2024:f:ACME", fid: "fs24-acme", label: "ACME", level: "family", value: 550, x0: 982, x1: 1000, y0: 0, y1: 55 },
            { id: "s:2024:f:NEGCO", fid: "fs24-negco", label: "NEGCO", level: "family", value: -50, x0: 982, x1: 1000, y0: 65, y1: 65 },
          ],
          edges: [
            { s: 0, t: 1, v: 550, f: "fse24-1", g: [0, 50, 0, 50], c: [550, 0, 0, 0], o: [550, 0, 0, 0, 0, 0] },
            // Net de-obligation: honest negative value, zero-width band.
            { s: 0, t: 2, v: -50, f: "fse24-2", g: [50, 50, 65, 65], c: [0, 0, 0, -50], o: [0, 0, 0, 0, 0, -50] },
          ],
        },
        "2025": {
          total: 1000,
          total_str: "1000.000",
          nodes: [
            { id: "s:2025:total", fid: "fs25-total", label: "DoD contract obligations FY2025", level: "total", value: 1000, x0: 0, x1: 18, y0: 0, y1: 100 },
            { id: "s:2025:f:ACME", fid: "fs25-acme", label: "ACME", level: "family", value: 900, x0: 982, x1: 1000, y0: 0, y1: 90 },
            {
              id: "s:2025:other:family", fid: "fs25-other", label: "Other (5)", level: "family", value: 100,
              x0: 982, x1: 1000, y0: 100, y1: 110,
              other: {
                count: 5,
                members: [{ k: "Z", l: "Z Corp", v: 100 }],
                omitted: 4,
                omitted_value: 0,
              },
            },
          ],
          edges: [
            { s: 0, t: 1, v: 900, f: "fse25-1", g: [0, 90, 0, 90], c: [400, 200, 100, 200], o: [500, 200, 100, 50, 50, 0] },
            { s: 0, t: 2, v: 100, f: "fse25-2", g: [90, 100, 100, 110], c: [0, 0, 0, 100], o: [0, 0, 0, 0, 0, 100] },
          ],
        },
      },
    },
  };
}

function mockFetchOk(payload: FlowChartPayload) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function renderChart(openPanel = vi.fn()) {
  const utils = render(
    <CitationPanelContext.Provider value={{ openPanel, hasCitation: () => true }}>
      <FlowChart />
    </CitationPanelContext.Provider>,
  );
  return { openPanel, ...utils };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetchOk(fixture()));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function waitForChart() {
  await waitFor(() => {
    expect(screen.getByTestId("flow-chart")).toBeInTheDocument();
  });
}

describe("FlowChart", () => {
  it("renders both rivers; the spend river carries the default FY", async () => {
    renderChart();
    await waitForChart();
    const budget = document.querySelector('[data-flow-river="budget"]');
    const spend = document.querySelector('[data-flow-river="spend"]');
    expect(budget).not.toBeNull();
    expect(spend).not.toBeNull();
    expect(spend!.getAttribute("data-fy")).toBe("2025");
  });

  it("gives every plain node data-flow-node + data-node-id; Other nodes are data-flow-other only", async () => {
    renderChart();
    await waitForChart();
    const total = document.querySelector('[data-node-id="b:total"]');
    expect(total).not.toBeNull();
    expect(total!.hasAttribute("data-flow-node")).toBe(true);
    const other = document.querySelector('[data-node-id="b:other:component"]');
    expect(other).not.toBeNull();
    expect(other!.hasAttribute("data-flow-other")).toBe(true);
    // Plain click on an Other node must open the drill-down, NOT the panel —
    // it must not match the gate's [data-flow-node] click contract.
    expect(other!.hasAttribute("data-flow-node")).toBe(false);
  });

  it("opens the citation panel from a node click (lazy shard fid)", async () => {
    const { openPanel } = renderChart();
    await waitForChart();
    fireEvent.click(document.querySelector('[data-node-id="b:total"]')!);
    expect(openPanel).toHaveBeenCalledWith("fb-total");
  });

  it("opens the citation panel from the keyboard (Enter on a tabbable node)", async () => {
    const { openPanel } = renderChart();
    await waitForChart();
    const node = document.querySelector<HTMLElement>('[data-node-id="s:2025:total"]')!;
    expect(node.getAttribute("tabindex")).toBe("0");
    expect(node.getAttribute("role")).toBe("button");
    fireEvent.keyDown(node, { key: "Enter" });
    expect(openPanel).toHaveBeenCalledWith("fs25-total");
  });

  it("expands an Other node into the drill-down with member rows and the omitted line", async () => {
    renderChart();
    await waitForChart();
    fireEvent.click(document.querySelector('[data-node-id="b:other:component"]')!);
    await waitFor(() => {
      expect(screen.getByTestId("flow-drilldown")).toBeInTheDocument();
    });
    const members = document.querySelectorAll("[data-drill-member]");
    expect(members.length).toBe(2);
    expect(screen.getByTestId("flow-drilldown").textContent).toContain("X Agency");
    // 1 member beyond the exported top slice.
    expect(screen.getByTestId("flow-drilldown").textContent).toMatch(/1 more/);
  });

  it("switches the spend river from the FY selector without refetching", async () => {
    renderChart();
    await waitForChart();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId("flow-fy-select"), {
      target: { value: "2024" },
    });
    const spend = document.querySelector('[data-flow-river="spend"]');
    expect(spend!.getAttribute("data-fy")).toBe("2024");
    expect(document.querySelector('[data-node-id="s:2024:total"]')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("renders negative flows as zero-width hairlines with the honest negative value", async () => {
    renderChart();
    await waitForChart();
    fireEvent.change(screen.getByTestId("flow-fy-select"), {
      target: { value: "2024" },
    });
    const neg = document.querySelector("[data-flow-negative]");
    expect(neg).not.toBeNull();
    // The honest negative value travels on the accessible label.
    // role="img" makes aria-label permitted on <path> (axe aria-prohibited-attr).
    expect(neg!.getAttribute("role")).toBe("img");
    expect(neg!.getAttribute("aria-label")).toContain("−50");
  });

  it("shows the explicit degraded state when the payload fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderChart();
    await waitFor(() => {
      expect(document.querySelector('[data-degraded="flow"]')).not.toBeNull();
    });
    expect(screen.queryByTestId("flow-chart")).toBeNull();
  });
});
