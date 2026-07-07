/**
 * Tests for <LineageRail> — the program-page lineage rail (Task 7).
 *
 * The honesty contract, asserted at the DOM level so the render-static gate
 * and the reader see the same distinctions:
 *   - stated edge   → clickable citation (opens the panel on evidence.fact_id),
 *     NO data-inferred marker.
 *   - inferred edge → data-inferred="true", a visible "candidate (unverified)"
 *     label, dashed/amber styling, inside a collapsed <details> disclosure.
 *   - resolved:false → plain text "PE <code> (unresolved)", NEVER an <a>.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { LineageRail } from "./lineage-rail";
import { CitationPanelContext } from "@/components/cite";
import type { LineageRail as LineageRailData } from "@/lib/lineage";

const statedResolved = {
  pe: "0602201F",
  title: "Aerospace Vehicle Technologies",
  ba: "2",
  fy: 2026,
  relation: "realigned",
  confidence: "stated" as const,
  resolved: true,
  evidence: {
    fact_id: "122e5070554facba",
    page: 137,
    sentence: "In FY 2025, the RDT&E Budget Activity 02 efforts under PE 0602201F were transferred to PE 0602203F.",
  },
};

const inferredResolved = {
  pe: "0604294D8Z",
  title: "Trusted & Assured Microelectronics",
  ba: "4",
  fy: 2021,
  relation: "matured_ba",
  confidence: "inferred" as const,
  resolved: true,
  evidence: null,
};

const statedUnresolved = {
  pe: "0303005F",
  title: null,
  ba: null,
  fy: 2026,
  relation: "realigned",
  confidence: "stated" as const,
  resolved: false,
  evidence: {
    fact_id: "595b7bc230776350",
    page: 607,
    sentence: "PE 0303005F EIT END USER DEVICES — efforts were transferred to PE 0303005F.",
  },
};

/** All rail PEs are linkable by default; pass an explicit list to restrict. */
function renderRail(rail: LineageRailData, opts: { linkablePes?: string[] } = {}) {
  const allPes = [...rail.predecessors, ...rail.successors].map((e) => e.pe);
  return render(
    <LineageRail
      selfPe="0602203F"
      selfTitle="Aerospace Propulsion"
      rail={rail}
      linkablePes={opts.linkablePes ?? allPes}
    />,
  );
}

describe("LineageRail", () => {
  it("renders a stated predecessor as a clickable citation on evidence.fact_id", () => {
    let opened: string | null = null;
    const { container } = render(
      <CitationPanelContext.Provider value={{ openPanel: (id) => { opened = id; } }}>
        <LineageRail
          selfPe="0602203F"
          selfTitle="Aerospace Propulsion"
          rail={{ predecessors: [statedResolved], successors: [] }}
          linkablePes={["0602201F"]}
        />
      </CitationPanelContext.Provider>,
    );
    // A clickable citation marker carrying the stated fact_id.
    const cite = container.querySelector('[data-fact-id="122e5070554facba"]') as HTMLElement;
    expect(cite).not.toBeNull();
    cite.click();
    expect(opened).toBe("122e5070554facba");
  });

  it("stated edge is NOT marked data-inferred", () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    const inferredEls = container.querySelectorAll('[data-inferred="true"]');
    expect(inferredEls.length).toBe(0);
  });

  it("renders a resolved stated edge's PE as an internal link", () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    // next/link normalizes the trailing slash in jsdom; assert on the prefix so
    // the test does not depend on trailingSlash rewriting (the real build has it).
    const link = container.querySelector('a[href^="/program/0602201F"]');
    expect(link).not.toBeNull();
  });

  it("renders an inferred edge with data-inferred, a candidate label, and dashed styling", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    const el = container.querySelector('[data-inferred="true"]') as HTMLElement;
    expect(el).not.toBeNull();
    // visible "candidate (unverified)" honesty label
    expect(el.textContent?.toLowerCase()).toContain("candidate");
    expect(el.textContent?.toLowerCase()).toContain("unverified");
    // dashed amber affordance (className token)
    expect(el.className).toContain("border-dashed");
  });

  it("hides inferred edges behind a collapsed <details> disclosure", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    // collapsed by default (opt-in): no `open` attribute
    expect(details).not.toHaveAttribute("open");
    // the inferred marker lives inside the details subtree
    expect(details!.querySelector('[data-inferred="true"]')).not.toBeNull();
    // summary invites the reader to opt in
    const summary = details!.querySelector("summary");
    expect(summary?.textContent?.toLowerCase()).toContain("possible");
  });

  it("inferred edge never opens a citation (no data-fact-id, no data-prose-cite)", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    const el = container.querySelector('[data-inferred="true"]') as HTMLElement;
    expect(el.querySelector("[data-fact-id]")).toBeNull();
    expect(el.querySelector("[data-prose-cite]")).toBeNull();
  });

  it("renders a resolved:false entry as plain text with an unresolved marker, no <a>", () => {
    const { container } = renderRail({ predecessors: [statedUnresolved], successors: [] });
    // no anchor to the unresolved PE (prefix match — trailing slash agnostic)
    expect(container.querySelector('a[href^="/program/0303005F"]')).toBeNull();
    // plain PE code + an unresolved marker are both present
    expect(container.textContent).toContain("0303005F");
    expect(container.textContent?.toLowerCase()).toContain("unresolved");
  });

  it("shows the relation label on each edge", () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    expect(container.textContent?.toLowerCase()).toContain("realigned");
  });

  it("renders an honest empty state when there are no edges", () => {
    const { container } = renderRail({ predecessors: [], successors: [] });
    // no rail entries, but a stated non-silent explanation
    expect(container.querySelector('[data-fact-id]')).toBeNull();
    expect(container.textContent?.toLowerCase()).toMatch(/no .*(lineage|predecessor|successor|edge)/);
  });
});
