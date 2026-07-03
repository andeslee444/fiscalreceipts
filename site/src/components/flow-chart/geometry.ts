/**
 * geometry.ts — pure render helpers for the /flow/ Sankey (Phase 5H).
 *
 * The LAYOUT itself is precomputed by the exporter (node rects + edge band
 * geometry g=[sy0,sy1,ty0,ty1] — spec §3: no client-side layout math). These
 * helpers only translate that geometry into SVG path strings and split spend
 * bands for the competition overlay. Pure module — unit-tested directly.
 */

import { formatAmountNoCurrency, type AmountUnits } from "@/lib/format";

export type BandG = readonly [number, number, number, number];

/** Zero-width band (the exporter's negative-flow compression rule). */
export function isZeroBand(g: BandG): boolean {
  const [sy0, sy1, ty0, ty1] = g;
  return sy1 - sy0 <= 0.001 && ty1 - ty0 <= 0.001;
}

/** Round for stable, compact path strings. */
function r(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Closed Sankey ribbon between the source face (x1, sy0..sy1) and the target
 * face (x2, ty0..ty1): cubic top run, straight far face, cubic bottom run.
 */
export function ribbonPath(x1: number, x2: number, g: BandG): string {
  const [sy0, sy1, ty0, ty1] = g;
  const mx = r((x1 + x2) / 2);
  return (
    `M ${r(x1)},${r(sy0)} ` +
    `C ${mx},${r(sy0)} ${mx},${r(ty0)} ${r(x2)},${r(ty0)} ` +
    `L ${r(x2)},${r(ty1)} ` +
    `C ${mx},${r(ty1)} ${mx},${r(sy1)} ${r(x1)},${r(sy1)} Z`
  );
}

/**
 * Open centerline for zero-width (negative) flows — a hairline through the
 * band centers. Stroke-only; the width NEVER encodes the magnitude.
 */
export function centerlinePath(x1: number, x2: number, g: BandG): string {
  const [sy0, sy1, ty0, ty1] = g;
  const sy = r((sy0 + sy1) / 2);
  const ty = r((ty0 + ty1) / 2);
  const mx = r((x1 + x2) / 2);
  return `M ${r(x1)},${sy} C ${mx},${sy} ${mx},${ty} ${r(x2)},${ty}`;
}

export interface ClassBand {
  classIndex: number;
  value: number;
  sy0: number;
  sy1: number;
  ty0: number;
  ty1: number;
}

/**
 * Split an edge band into per-competition-class sub-bands, proportional to
 * the POSITIVE class components (negative components cannot occupy area —
 * they stay honest in the tooltip). Zero-width bands split into nothing.
 */
export function splitEdgeBands(g: BandG, classValues: number[]): ClassBand[] {
  if (isZeroBand(g)) return [];
  const positive = classValues.map((v) => Math.max(v, 0));
  const total = positive.reduce((a, v) => a + v, 0);
  if (total <= 0) return [];
  const [sy0, sy1, ty0, ty1] = g;
  const sh = sy1 - sy0;
  const th = ty1 - ty0;
  const bands: ClassBand[] = [];
  let acc = 0;
  classValues.forEach((v, classIndex) => {
    const p = Math.max(v, 0);
    if (p <= 0) return;
    const f0 = acc / total;
    const f1 = (acc + p) / total;
    bands.push({
      classIndex,
      value: v,
      sy0: r(sy0 + sh * f0),
      sy1: r(sy0 + sh * f1),
      ty0: r(ty0 + th * f0),
      ty1: r(ty0 + th * f1),
    });
    acc += p;
  });
  return bands;
}

export interface DistributionRow {
  key: string;
  value: number;
  /** Share of the positive total: "42%", "<1%", or "—" for negatives. */
  pct: string;
}

/**
 * Pair a parallel value vector with its vocabulary, dropping exact zeros.
 * Shares are of the positive total; negative components keep an em-dash
 * (they are real de-obligations, not shares of anything).
 */
export function distributionRows(
  values: number[],
  keys: string[],
): DistributionRow[] {
  const total = values.reduce((a, v) => a + Math.max(v, 0), 0);
  const rows: DistributionRow[] = [];
  values.forEach((v, i) => {
    if (v === 0) return;
    let pct = "—";
    if (v > 0 && total > 0) {
      const share = (v / total) * 100;
      pct = share < 1 ? "<1%" : `${Math.round(share)}%`;
    }
    rows.push({ key: keys[i] ?? String(i), value: v, pct });
  });
  return rows;
}

/**
 * Compact amount WITHOUT the '$' sign (Task 6b SVG-label convention — the
 * CITED figure is one click away in the node's citation panel). Negative
 * values keep a typographic minus: net de-obligations are shown honestly.
 */
export function displayAmount(value: number, units: AmountUnits): string {
  return formatAmountNoCurrency(value, units).replace(/^-/, "−");
}
