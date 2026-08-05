/**
 * derivation.ts — make a displayed derivation reproducible (§P2-8).
 *
 * THE DEFECT. `/program/ATA000/` said: *"the PB2024 book requested $5.28B for
 * FY2024; the PB2026 book reports $5.57B … — $286.5M above the request."*
 * From the figures on screen a reader computes $290M. The $286.5M is right —
 * it is derived from the unrounded values — but the audience for this feature
 * is precisely the reader who checks the site's arithmetic against the site's
 * own numbers, and that reader finds a discrepancy. `/companies/` had the
 * same shape: two of the nine merged families' addend equations
 * (SAIC, TransDigm) do not visibly add up at compact precision.
 *
 * THE RULE. A strip that doesn't add up is worse than no strip. So a strip
 * either shows inputs a reader can add, or says out loud that what it shows
 * is rounded. This module implements the first, which is the better one:
 *
 *   `reproducibleSum(values, total)` finds the SMALLEST decimal precision, in
 *   one stated unit, at which the independently-rounded parts sum EXACTLY to
 *   the independently-rounded total — and returns the strings to print. When
 *   no precision up to `maxDecimals` closes (a genuine data disagreement, not
 *   a rounding artefact) it returns null, and the caller must say so rather
 *   than print an equation that lies.
 *
 * Subtraction is a sum: pass `[a, -b]` with `total = a - b`.
 *
 * Every string here is produced FROM the rounded integer, never by handing
 * the raw float to `toLocaleString` — so what is displayed and what was
 * checked are the same number by construction.
 */

import type { AmountUnits } from "@/lib/format";

const UNIT_SCALE: Record<AmountUnits, number> = {
  "USD thousands": 1_000,
  "USD millions": 1_000_000,
  USD: 1,
};

/** Convert to USD millions — the one unit every derivation strip prints in. */
export function toMillions(value: number, units: AmountUnits): number {
  return (value * UNIT_SCALE[units]) / 1_000_000;
}

export interface ReproducibleSum {
  /** Decimals at which the equation closes. */
  decimals: number;
  /** Rounded, formatted parts — in input order, unsigned handling left to the caller. */
  parts: string[];
  /** Rounded, formatted total. */
  total: string;
  /** e.g. "USD millions" — print it; an equation without a unit is not an equation. */
  unitLabel: string;
}

function fixed(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * The smallest precision at which `values` visibly sum to `total`.
 *
 * @param values inputs, already in the display unit
 * @param total  the derived figure, already in the display unit
 * @param unitLabel printed beside the equation
 * @param maxDecimals give up past here rather than print 9 decimals
 */
export function reproducibleSum(
  values: number[],
  total: number,
  unitLabel = "USD millions",
  maxDecimals = 6,
): ReproducibleSum | null {
  for (let d = 1; d <= maxDecimals; d += 1) {
    const scale = 10 ** d;
    // Round each operand and the total INDEPENDENTLY, exactly as the display
    // does; the equation closes only if the reader's own addition would.
    const roundedParts = values.map((v) => Math.round(v * scale));
    const roundedTotal = Math.round(total * scale);
    const sum = roundedParts.reduce((a, b) => a + b, 0);
    if (sum === roundedTotal) {
      return {
        decimals: d,
        parts: roundedParts.map((r) => fixed(r / scale, d)),
        total: fixed(roundedTotal / scale, d),
        unitLabel,
      };
    }
  }
  return null;
}

/**
 * A two-input difference, ready to print: `a − b = delta`.
 * `b` is the SUBTRAHEND and is printed unsigned; the operator carries it.
 */
export function reproducibleDifference(
  a: number,
  b: number,
  delta: number,
  unitLabel = "USD millions",
): { a: string; b: string; delta: string; unitLabel: string } | null {
  const r = reproducibleSum([a, -b], delta, unitLabel);
  if (!r) return null;
  return {
    a: r.parts[0],
    b: r.parts[1].replace(/^-/, ""),
    delta: r.total,
    unitLabel: r.unitLabel,
  };
}
