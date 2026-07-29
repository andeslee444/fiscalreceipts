/**
 * lineage.ts — program-lineage sidecar types (program-lineage Task 7).
 *
 * Mirrors the `lineage` block emitted per program into
 * data/site/json/program_details/<pe>.json. Evidence-tiered YoY money-flow
 * tracking: a rail of predecessor/successor edges (each stated-with-citation
 * OR inferred-without) plus a 1:1 family funding line (one cited point per FY).
 *
 * TWO honesty invariants are encoded in the shape and honored by the renderers:
 *   - confidence "stated"   → evidence.{fact_id,page,sentence} present; the
 *     fact_id resolves in the cite universe (rendered as a clickable citation).
 *   - confidence "inferred" → evidence === null; NO citation, rendered dashed /
 *     amber / "candidate (unverified)" behind an opt-in disclosure.
 *   - resolved false        → the linked PE has NO program page; rendered as
 *     plain text (never an <a>, avoids a 404 + the dead-link gate).
 */

/** A stated edge's source-sentence citation (page + verbatim sentence). */
export interface LineageEvidence {
  /**
   * Always a resolving cite-universe fact_id — never null in shipped
   * payloads: the exporter hard-errors on a stated edge whose fact_id is
   * outside the cite universe, and verify-lineage leg (a) fails any stated
   * edge without one (verified against the live sidecars, 2026-07-28:
   * 50/50 stated entries carry a non-null fact_id).
   */
  fact_id: string;
  /** Source page number — null when the narrative row records no page
   *  (31/50 live stated entries ship page: null). */
  page: number | null;
  sentence: string;
}

/**
 * One predecessor/successor edge in the rail.
 *
 * `evidence` is present iff `confidence === "stated"` (and null when
 * "inferred"); `title` is null when `resolved === false` (no page → no title).
 */
export interface LineageRailEntry {
  pe: string;
  title: string | null;
  ba: string | null;
  fy: number;
  /** Edge relation, e.g. "realigned", "transferred", "matured_ba". */
  relation: string;
  confidence: "stated" | "inferred";
  /** false → the linked PE has no program page (render plain, no link). */
  resolved: boolean;
  /** Present for stated edges; null for inferred edges. */
  evidence: LineageEvidence | null;
}

export interface LineageRail {
  predecessors: LineageRailEntry[];
  successors: LineageRailEntry[];
}

/**
 * One cited point on the family funding line (a dollar amount → Cite).
 *
 * Defect-2 shape (2026-07-28): one entry PER (fy, chain member) with a cited
 * request fact — `v` is EXACTLY that member's fact value (nothing is ever
 * summed). An fy where two chain members coexist carries multiple entries;
 * the renderer groups by fy and labels each member's value with its `pe`.
 */
export interface LineageFundingPoint {
  fy: number;
  /** The chain member this point belongs to (its fact's own PE). */
  pe: string;
  /** Value in USD thousands (the decade-series unit) — the cited fact's value. */
  v: number;
  /** Fact_id — resolves in the cite universe (state-A Cite). */
  fid: string;
}

export interface LineageFamily {
  family_id: number;
  /** The 1:1 chain of PE identities, in order, the funding line is drawn for. */
  chain: string[];
  /**
   * Short title of the chain HEAD (chain[0], the family root) — lets the
   * funding-chain summary label itself self-descriptively rather than as a
   * bare id. null when the head carries no title (renderer shows the id alone).
   */
  chain_head_title?: string | null;
  /** One cited point per FY along the 1:1 chain. */
  funding_line: LineageFundingPoint[];
  /** True when the family branches — the line is the 1:1 chain only. */
  has_split: boolean;
}

export interface LineageBlock {
  rail: LineageRail;
  /**
   * Present only when this PE belongs to a lineage family — the exporter
   * attaches `family` iff the PE is in the family map (6 of the 50 live
   * lineage blocks ship without it: edge-only PEs outside any family).
   */
  family?: LineageFamily;
}

/** Minimal shape hasLineage inspects (a ProgramDetails-like carrier). */
export interface HasLineageInput {
  lineage?: LineageBlock;
}

/**
 * True when the program carries lineage worth rendering: at least one rail
 * edge (predecessor or successor) OR a family funding line. An empty block
 * (rail with no edges AND a family with no funding points) is treated as
 * "no lineage" — the page shows the honest empty state instead.
 */
export function hasLineage(d: HasLineageInput): boolean {
  const l = d.lineage;
  if (!l) return false;
  const railEdges =
    (l.rail?.predecessors?.length ?? 0) + (l.rail?.successors?.length ?? 0);
  const familyPoints = l.family?.funding_line?.length ?? 0;
  return railEdges > 0 || familyPoints > 0;
}
