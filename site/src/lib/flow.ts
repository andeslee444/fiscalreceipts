/**
 * flow.ts — types + pure helpers for the /flow/ two-river flowdown (Phase 5H).
 *
 * Mirrors data/site/json/flow_chart.json (schema_version 1, exporter
 * flow_chart.py). The Sankey LAYOUT is precomputed by the exporter — node
 * rects (x0..x1 × y0..y1) and edge band geometry g=[sy0,sy1,ty0,ty1] arrive
 * ready to render in a width×height viewBox; the client does NO layout math
 * (binding spec §3). The G9 flowdown gate independently re-verifies the
 * geometry (proportionality, containment, the negative-edge zero-width rule).
 *
 * Universal module (no server-only guard): consumed by the client island
 * (payload types) and by lib/data.ts (server-side meta extraction).
 */

// ── Payload types (flow_chart.json schema_version 1) ─────────────────────────

export interface FlowOtherMember {
  /** Stable member key (e.g. "Defense Logistics Agency|DLA AVIATION"). */
  k: string;
  /** Display label. */
  l: string;
  /** Value in the river's units. */
  v: number;
}

export interface FlowOther {
  /** Total members aggregated into this "Other (N)" node. */
  count: number;
  /** Top members (up to 50) for the drill-down. */
  members: FlowOtherMember[];
  /** Members beyond the exported top slice. */
  omitted: number;
  /** Their combined value: members Σv + omitted_value == node value. */
  omitted_value: number;
}

/**
 * Exporter-precomputed inline-label geometry (F3 collision contract).
 * `x` is the anchor x; `y` is the label's vertical CENTER (the client adds
 * the baseline offset); `a` is the SVG text anchor ("s"=start, "e"=end).
 * Absent = the exporter suppressed the label (too thin / would collide) —
 * the tooltip and aria-label still carry the name and value.
 */
export interface FlowLabel {
  x: number;
  y: number;
  a: "s" | "e";
}

export interface FlowNode {
  id: string;
  /** Minted derived fact_id — resolves via citations.json / cite-shards. */
  fid: string;
  label: string;
  level: string;
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Present only on "Other (N)" nodes. */
  other?: FlowOther;
  /** Inline-label placement (precomputed; absent = tooltip-only node). */
  lbl?: FlowLabel;
  /** Leader line [x0, y0, x1, y1] for displaced gutter labels. */
  ldr?: [number, number, number, number];
}

export interface FlowEdge {
  /** Source / target node INDEXES into the river's nodes array. */
  s: number;
  t: number;
  /** Value in the river's units (negative = net de-obligations). */
  v: number;
  /** Minted derived fact_id for this edge. */
  f: string;
  /** Band geometry [sy0, sy1, ty0, ty1]; zero-height for negative flows. */
  g: [number, number, number, number];
  /** Spend edges only: value partition across competed_classes (len 4). */
  c?: number[];
  /** Spend edges only: value partition across offers_buckets (len 6). */
  o?: number[];
}

export interface FlowBridgeProgramFamily {
  family_key: string;
  confidence: string;
}

export interface FlowBridgeProgram {
  pe_bli: string;
  title?: string;
  value: number;
  confidence: string;
  families: FlowBridgeProgramFamily[];
}

export interface FlowBridge {
  budget_total: number;
  budget_total_str: string;
  crosswalked_total: number;
  crosswalked_total_str: string;
  not_yet_crosswalked: number;
  not_yet_crosswalked_str: string;
  crosswalk_universe_pe_count: number;
  crosswalked_pe_count: number;
  high_confidence_pe_count: number;
  crosswalked_node: string;
  not_crosswalked_node: string;
  coverage_note: string;
  programs: FlowBridgeProgram[];
}

export interface BudgetRiver {
  fiscal_year: number;
  label: string;
  units: string;
  levels: string[];
  width: number;
  height: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  bridge: FlowBridge;
}

export interface SpendRiverFy {
  nodes: FlowNode[];
  edges: FlowEdge[];
  total: number;
  total_str: string;
}

export interface SpendRiver {
  by_fy: Record<string, SpendRiverFy>;
  fys: number[];
  default_fy: number;
  competed_classes: string[];
  offers_buckets: string[];
  units: string;
  levels: string[];
  width: number;
  height: number;
  notes: { fy2026_partial: boolean; offers: string };
  source_note: string;
}

export interface FlowChartPayload {
  schema_version: number;
  budget: BudgetRiver;
  spend: SpendRiver;
}

// ── Vocabularies (canonical order is BINDING — mirrors the exporter/G9) ─────

/** extent_competed classes, in the payload's canonical vector order. */
export const COMPETED_CLASS_LABELS: Record<string, string> = {
  full_and_open: "Full & open competition",
  set_aside: "Set-aside",
  other_than_full: "Other than full & open",
  not_competed: "Not competed",
};

export const BUDGET_LEVEL_LABELS: Record<string, string> = {
  total: "Total request",
  component: "Component",
  appropriation: "Appropriation",
  budget_activity: "Budget activity",
  program: "Program",
  bridge: "Contractor bridge",
};

export const SPEND_LEVEL_LABELS: Record<string, string> = {
  total: "Total obligations",
  sub_agency: "Awarding sub-agency",
  office: "Contracting office",
  family: "Contractor family",
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Percentage of the budget total NOT yet crosswalked, one decimal, from the
 * canonical decimal strings ("380565880.000", "385481675.000" → "98.7").
 * Number arithmetic is exact enough here (values ≪ 2^53); the EXACT remainder
 * identity is enforced by the G9 gate in BigInt milli-units.
 */
export function pctNotCrosswalked(
  notYetCrosswalkedStr: string,
  budgetTotalStr: string,
): string {
  const not = Number(notYetCrosswalkedStr);
  const total = Number(budgetTotalStr);
  if (!Number.isFinite(not) || !Number.isFinite(total) || total === 0) {
    throw new Error(
      `pctNotCrosswalked: non-numeric bridge strings (${notYetCrosswalkedStr}, ${budgetTotalStr})`,
    );
  }
  return ((not / total) * 100).toFixed(1);
}
