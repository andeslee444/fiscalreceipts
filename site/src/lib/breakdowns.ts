/**
 * breakdowns.ts — lazy fetch of derived-fact breakdown sidecars (Phase 5D §3b).
 *
 * The exporter emits data/site/json/breakdowns/{fact_id}.json for every
 * sum-decomposable derived fact (≥2 inputs): the full list of input rows that
 * were summed, each `{label, pe_bli, v, fid}`. Conventions:
 *   - Δ (difference) breakdowns mark the subtracted input `subtracted: true`
 *     and carry v ALREADY NEGATED — sum(rows.v) equals recorded_value for
 *     every op (verified by G8 leg e).
 *   - Uncited inputs appear as rows with `fid: null, uncited: true`, so the
 *     table always accounts for 100% of the sum.
 *
 * prepare-assets.mjs copies the directory to public/json/breakdowns/ —
 * served same-origin (NOT under /assets), like the citation shards.
 *
 * Cache semantics: fetched breakdowns are cached forever (immutable per
 * build). A 404 is a REAL answer ("this derived fact has no breakdown") and
 * is cached as null. Network failures resolve null but are NOT poison-cached,
 * so a later panel open retries.
 */

export interface BreakdownRow {
  /** Input citation fact_id — null for uncited inputs (⁂ state). */
  fid: string | null;
  /** Human label (dim_pe_titles / citation metadata). */
  label: string;
  /** PE/BLI key when the input is program-grained (nullable). */
  pe_bli: string | null;
  /** Signed value in `units` — subtracted inputs are already negative. */
  v: number;
  /** True when this input is subtracted in the formula (Δ breakdowns). */
  subtracted?: boolean;
  /** True when the input has no citation row — rendered as the ⁂ state. */
  uncited?: boolean;
}

export interface Breakdown {
  fact_id: string;
  formula: string;
  op: string;
  /** Decimal string — equals sum(rows.v) within canonical rounding. */
  recorded_value: string;
  rows: BreakdownRow[];
  units: string;
}

/** Same-origin base path for breakdown files (copied by prepare-assets). */
export const BREAKDOWN_BASE = "/json/breakdowns";

export function breakdownUrl(factId: string): string {
  return `${BREAKDOWN_BASE}/${factId}.json`;
}

const breakdownCache = new Map<string, Promise<Breakdown | null>>();

/**
 * Fetch (or reuse) the breakdown for a derived fact_id. Single-flight per
 * fact. Resolves null when no breakdown exists (404 — cached) or the fetch
 * fails (network — retryable). Never throws.
 */
export function fetchBreakdown(factId: string): Promise<Breakdown | null> {
  const cached = breakdownCache.get(factId);
  if (cached) return cached;

  const promise: Promise<Breakdown | null> = fetch(breakdownUrl(factId)).then(
    (res) => {
      if (res.status === 404) return null; // no breakdown — a real, cacheable answer
      if (!res.ok) throw new Error(`breakdown ${factId} returned HTTP ${res.status}`);
      return res.json() as Promise<Breakdown>;
    },
  );

  // Network/HTTP failures must not poison the cache (retry on next open).
  const guarded = promise.catch(() => {
    if (breakdownCache.get(factId) === guarded) {
      breakdownCache.delete(factId);
    }
    return null;
  });

  breakdownCache.set(factId, guarded);
  return guarded;
}

/** Test hook — clears the module-level breakdown cache. */
export function __resetBreakdownCache(): void {
  breakdownCache.clear();
}
