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

  // ── Directional-honesty guard (visual-judge round) ─────────────────────────
  // The relation is stored direction-NEUTRAL; the preposition MUST come from
  // the entry's rail POSITION. A predecessor reads "…from" (funding flowed in),
  // a successor reads "…to" (funding flowed out). Rendering "from" under a
  // successor asserts the opposite money-flow — a directional-honesty bug.
  it('renders a PREDECESSOR edge with a "from" phrasing (funding flowed in)', () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("realigned from");
    expect(text).not.toContain("realigned to");
  });

  it('renders a SUCCESSOR edge with a "to" phrasing (funding flowed out)', () => {
    // Same direction-neutral relation ("realigned"), now as a SUCCESSOR.
    const succ = { ...statedResolved, pe: "0602203G" };
    const { container } = renderRail({ predecessors: [], successors: [succ] });
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("realigned to");
    expect(text).not.toContain("realigned from");
  });

  it("keeps the SAME relation direction-aware across both rail positions", () => {
    // One relation token, rendered in BOTH positions on one rail: pred → from,
    // succ → to. Proves the preposition tracks position, not the relation.
    const { container } = renderRail({
      predecessors: [statedResolved],
      successors: [{ ...statedResolved, pe: "0602203G" }],
    });
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("realigned from");
    expect(text).toContain("realigned to");
  });

  it("renders an inferred SUCCESSOR direction-aware, not directionless-wrong", () => {
    // matured_ba stays directionless; use a from/to relation to prove inferred
    // successors also read "to" (the bug was uniform "from" everywhere).
    const infSucc = {
      ...inferredResolved,
      pe: "0604294E9Z",
      relation: "realigned",
    };
    const { container } = renderRail({ predecessors: [], successors: [infSucc] });
    const el = container.querySelector('[data-inferred="true"]') as HTMLElement;
    const text = el.textContent?.toLowerCase() ?? "";
    expect(text).toContain("realigned to");
    expect(text).not.toContain("realigned from");
  });

  it("keeps matured_ba directionless (no forced from/to)", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("ba-maturation");
    expect(text).not.toContain("matured_ba to");
    expect(text).not.toContain("matured_ba from");
  });

  it("renders an honest empty state when there are no edges", () => {
    const { container } = renderRail({ predecessors: [], successors: [] });
    // no rail entries, but a stated non-silent explanation
    expect(container.querySelector('[data-fact-id]')).toBeNull();
    expect(container.textContent?.toLowerCase()).toMatch(/no .*(lineage|predecessor|successor|edge)/);
  });

  // ── FY-chip honesty (Fix C, 2026-07-28) ────────────────────────────────────
  // A stated edge's fiscal_year is the J-BOOK EDITION the link is asserted in
  // (the FY2026 narrative fence), NOT the transfer year. A bare "FY2026" chip
  // reads as the transfer year — the eyebrow must say what the year actually
  // is: "per FY2026 J-book".
  it("stated eyebrow reads 'per FY<year> J-book', never a bare FY chip", () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    const stated = container.querySelector("[data-lineage-stated]") as HTMLElement;
    expect(stated).not.toBeNull();
    expect(stated.textContent?.toLowerCase()).toContain("per fy2026 j-book");
  });

  it("inferred eyebrow keeps its bare FY (the inferred handoff year IS a year, not an edition)", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    const el = container.querySelector('[data-inferred="true"]') as HTMLElement;
    const text = el.textContent?.toLowerCase() ?? "";
    expect(text).toContain("fy2021");
    // an inferred edge is stated in NO J-book — it must never claim one
    expect(text).not.toContain("j-book");
  });

  // ── Evidence sentence shown to the reader (Fix D, 2026-07-28) ──────────────
  // The gate-verified verbatim transfer sentence ships in the sidecar; the
  // stated card must let the reader SEE it — a collapsed-by-default native
  // <details> containing the quoted sentence. Inferred cards have no sentence.
  it("stated card carries the evidence sentence in a collapsed <details>", () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    const stated = container.querySelector("[data-lineage-stated]") as HTMLElement;
    const details = stated.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open"); // collapsed by default
    const summary = details!.querySelector("summary");
    expect(summary?.textContent?.toLowerCase()).toContain("sentence");
    const quote = details!.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain(statedResolved.evidence.sentence);
  });

  it("evidence blockquote is anchored source text (a0 contract: data-source-text + data-cite-fact-id)", () => {
    // The verbatim J-book sentence may quote dollar figures (e.g. "The
    // remaining $19.8M … was realigned to PE 0306250JCY"). Quoted source
    // prose must carry data-source-text with a citation anchor so the
    // render-static currency scan treats it as source text, not an
    // unattributed site-computed figure.
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    const quote = container.querySelector(
      "[data-lineage-stated] blockquote",
    ) as HTMLElement;
    expect(quote).not.toBeNull();
    expect(quote.getAttribute("data-source-text")).toBeTruthy();
    expect(quote.getAttribute("data-cite-fact-id")).toBe(
      statedResolved.evidence.fact_id,
    );
  });

  it("inferred card has NO sentence block (no details, no blockquote)", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    const el = container.querySelector('[data-inferred="true"]') as HTMLElement;
    expect(el.querySelector("blockquote")).toBeNull();
    expect(el.querySelector("details")).toBeNull();
  });

  // ── Stated-card gate marker (Fix F, 2026-07-28) ────────────────────────────
  // render-static's stated-side positive leg identifies stated rail entries
  // via [data-lineage-stated] and requires each to contain the
  // [data-lineage-cite][data-fact-id] marker. Pin both halves of the contract.
  it("stated card carries data-lineage-stated with the cite marker inside", () => {
    const { container } = renderRail({ predecessors: [statedResolved], successors: [] });
    const stated = container.querySelector("[data-lineage-stated]") as HTMLElement;
    expect(stated).not.toBeNull();
    expect(stated.querySelector("[data-lineage-cite][data-fact-id]")).not.toBeNull();
  });

  it("inferred card never carries data-lineage-stated", () => {
    const { container } = renderRail({ predecessors: [], successors: [inferredResolved] });
    expect(container.querySelector("[data-lineage-stated]")).toBeNull();
  });

  // ── React key uniqueness under the DB schema (Fix G, 2026-07-28) ───────────
  // The schema permits two edges sharing (pe, direction) with different
  // relation/fy — keys must not collide (a collision drops/duplicates a card).
  it("renders BOTH edges when two stated predecessors share the same PE", () => {
    const twin = { ...statedResolved, relation: "transferred", fy: 2025 };
    const { container } = renderRail({
      predecessors: [statedResolved, twin],
      successors: [],
    });
    const cards = container.querySelectorAll("[data-lineage-stated]");
    expect(cards.length).toBe(2);
  });
});
