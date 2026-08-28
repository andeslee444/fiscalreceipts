/**
 * lineage-flow.ts — types + pure helpers for /lineage/ (ROADMAP #29(c)).
 *
 * Mirrors data/site/json/lineage_flow.json (schema_version 1, exporter
 * src/govbudget/lineage/flow.py). Layout is PRECOMPUTED by the exporter —
 * node rects and edge band geometry g=[sy0,sy1,ty0,ty1] arrive ready to
 * render, exactly the /flow/ contract (spec §3: no client-side layout math),
 * so the same ribbonPath() helper draws both diagrams.
 *
 * THE ONE INVARIANT THIS FILE EXISTS TO NAME. On /flow/ a ribbon's thickness
 * is a dollar amount. Here it is NOT, and it must never be read as one: no
 * lineage edge in the corpus states a transferred amount (portion_amount is
 * non-null on zero rows), so every band is the same `ribbon_w` on both faces
 * and encodes nothing but "this link exists".
 *
 * There is deliberately NO `isConstantWidth()` helper here. The site checking
 * its own payload would be a third copy of one rule agreeing with the other
 * two — the failure mode that shipped a false note on 179 of 319 pages in
 * this codebase. The property is asserted where it can actually be caught:
 * gate 22 leg (g) measures the BUILT `d=` path strings the browser paints,
 * and verify-lineage leg (i) reconciles the payload against the live
 * program_lineage table.
 *
 * Universal module (no server-only guard): the page reads it server-side and
 * the diagram island takes it as props.
 */

/** A cited node-level figure — the ONE place money appears on this page. */
export interface LineageFlowAmount {
  /** Value in USD thousands (the decade-series unit). */
  v: number;
  /** Fact_id — resolves in the cite universe (state-A Cite). */
  fid: string;
  fy: number;
  edition: number | null;
  basis: string | null;
  measure: string | null;
}

export interface LineageFlowNode {
  pe: string;
  title: string | null;
  /** Exporter-truncated title for the identity box (explicit "…"). */
  short: string | null;
  /** Column index: lineage step, NOT a calendar year. See the page copy. */
  step: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** false → no program page for this identity; renders as plain text. */
  resolved: boolean;
  /** Absent when this identity has no cited FY2026 request point. */
  amount?: LineageFlowAmount | null;
}

export interface LineageFlowEdge {
  /** Source / target node INDEXES into the diagram's nodes array. */
  s: number;
  t: number;
  relation: string;
  /** The J-book EDITION asserting the link — not the year money moved. */
  fy: number;
  confidence: "stated" | "inferred";
  /** Stated edges only; null on inferred (the honesty contract). */
  fid: string | null;
  /** Band geometry [sy0, sy1, ty0, ty1]. ALWAYS ribbon_w thick. */
  g: [number, number, number, number];
}

export interface LineageFlowDiagram {
  cyclic: boolean;
  steps: number;
  width: number;
  height: number;
  nodes: LineageFlowNode[];
  edges: LineageFlowEdge[];
}

export interface LineageFlowFamily extends LineageFlowDiagram {
  family_id: number;
  root: string;
  /** True when the family branches — a split, a merge, or any stated fan-out. */
  has_split: boolean;
}

export interface LineageFlowCandidate extends LineageFlowDiagram {
  basis: string | null;
}

export interface LineageFlowCounts {
  stated_edges: number;
  inferred_edges: number;
  families: number;
  identities: number;
  identities_linked: number;
  identities_unresolved: number;
  identities_with_amount: number;
}

export interface LineageFlowPayload {
  schema_version: number;
  /** The constant every band is thick. Never a value. */
  ribbon_w: number;
  node_w: number;
  node_h: number;
  amount_fy: number;
  amount_measure: string;
  counts: LineageFlowCounts;
  families: LineageFlowFamily[];
  candidates: LineageFlowCandidate[];
}

/**
 * Direction-aware plain-language edge label — the SAME vocabulary the program
 * rail uses, and for the same reason: the stored relation is
 * direction-neutral, so the preposition has to come from the edge's direction
 * or the label asserts the opposite money-flow. On this page every ribbon is
 * drawn source→target, so the successor form ("realigned to") is always the
 * right one.
 */
export function edgeRelationLabel(relation: string): string {
  switch (relation) {
    case "realigned":
      return "realigned to";
    case "renamed":
      return "renamed to";
    case "appropriation_transfer":
    case "transferred":
      return "transferred to";
    case "split":
      return "split to";
    case "merged":
      return "merged to";
    case "matured_ba":
      return "BA-maturation";
    default:
      return `${relation.replace(/_/g, " ")} to`;
  }
}

/**
 * How many diagrams are wider than a phone's content box, computed from the
 * payload rather than typed. A literal ("two of the 32 families") on a page
 * whose whole argument is "nothing here is asserted without evidence" would
 * be the one sentence on it nobody re-derives.
 *
 * 340 is the content width a 390px viewport leaves after the page container's
 * padding — the width gate 3's mobile leg measures at.
 */
export const PHONE_CONTENT_WIDTH = 340;

export function wideDiagramCount(
  diagrams: readonly LineageFlowDiagram[],
): number {
  return diagrams.filter((d) => d.width > PHONE_CONTENT_WIDTH).length;
}
