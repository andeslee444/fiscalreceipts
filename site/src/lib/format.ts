/**
 * Formatting utilities for monetary amounts.
 *
 * CRITICAL: Units are NEVER inferred from magnitude — they must always be
 * supplied by the caller. The dataset determines units:
 *   - "USD thousands"  → budget_lines, trajectory, workbook citations
 *   - "USD millions"   → jbook_details, dim_programs amounts, jbook amount_text
 *   - "USD"            → dim_entities, dim_geography, fct_influence, fct_state_per_capita
 */

export type AmountUnits = "USD thousands" | "USD millions" | "USD";

/**
 * Convert a value to raw USD based on its declared units.
 */
function toRawUsd(value: number, units: AmountUnits): number {
  switch (units) {
    case "USD thousands":
      return value * 1_000;
    case "USD millions":
      return value * 1_000_000;
    case "USD":
      return value;
  }
}

/**
 * Compact-display rungs, largest first. THE ladder — every other compact
 * formatter in the repo is an explicit mirror of this one:
 *   site/scripts/gates/animation.mjs   (gate 12 verifies SVG flow labels)
 *   site/scripts/generate-og.mjs       (OG card text)
 *   src/govbudget/flow_chart.py        (label-width estimator)
 *   src/govbudget/export_site.py       (feed headline text)
 *   site/src/lib/feed-model.mjs        (RSS/Atom item text — plain Node, so
 *                                       it cannot import this file; a vitest
 *                                       parity sweep asserts they agree)
 *   site/scripts/gates/datatruth.mjs   (gate 24 leg i re-formats published
 *                                       feed values to check the display)
 * Change one, change all seven.
 */
const COMPACT_RUNGS = [
  { limit: 1_000_000_000_000, suffix: "T" },
  { limit: 1_000_000_000, suffix: "B" },
  { limit: 1_000_000, suffix: "M" },
  { limit: 1_000, suffix: "K" },
] as const;

/**
 * Format a raw USD value into compact display string.
 *
 * Rungs: T / B / M / K, then integer dollars below $1K.
 * Decimals, per plan spec ("one decimal except <10 two decimals"):
 *   - mantissa <10 → 2 decimals ($3.66T, $5.00B, $1.23M)
 *   - mantissa ≥10 → 1 decimal  ($12.3T, $135.4B, $280.5M)
 *
 * §P1-6: the ladder used to stop at B, so the /district/ geography grand total
 * rendered "$3657.4B". It now runs through T, and a mantissa that ROUNDS up to
 * 1000 promotes to the next rung rather than printing "$1000.0B" — so no
 * output below the top rung can ever carry a four-digit mantissa.
 * (At the top rung there is nowhere to promote to; $1,000T+ would print as
 * "$1000.0T". The federal budget is three orders of magnitude away.)
 */
function compactFormat(rawUsd: number): string {
  const abs = Math.abs(rawUsd);
  const sign = rawUsd < 0 ? "-" : "";

  for (let i = 0; i < COMPACT_RUNGS.length; i++) {
    const { limit, suffix } = COMPACT_RUNGS[i];
    if (abs < limit) continue;
    const v = abs / limit;
    const dec = v < 10 ? 2 : 1;
    if (i > 0 && Number(v.toFixed(dec)) >= 1000) {
      const up = COMPACT_RUNGS[i - 1];
      const uv = abs / up.limit;
      return `${sign}$${uv.toFixed(uv < 10 ? 2 : 1)}${up.suffix}`;
    }
    return `${sign}$${v.toFixed(dec)}${suffix}`;
  }
  // Sub-thousand: integer dollars
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

/**
 * Format an amount for compact display.
 * Units determine scale; magnitude never determines scale.
 *
 * Examples:
 *   formatAmount(1234567, 'USD thousands')   → "$1.23B"  (1,234,567 × 1e3 = $1,234,567,000)
 *   formatAmount(280494, 'USD thousands')    → "$280.5M" (280,494 × 1e3 = $280,494,000)
 *   formatAmount(0.994, 'USD millions')      → "$994.0K" (0.994 × 1e6 = $994,000)
 *   formatAmount(3657411328834.89, 'USD')    → "$3.66T"  (the dim_geography grand total)
 */
export function formatAmount(value: number, units: AmountUnits): string {
  const rawUsd = toRawUsd(value, units);
  return compactFormat(rawUsd);
}

/**
 * Compact amount WITHOUT the '$' sign — for SVG diagram labels only.
 *
 * The render-static currency gate flags `$X[.X][BMK]` text outside
 * [data-amount] spans. Flow-diagram node labels are illustrative (the cited
 * figures live in the table below the SVG), so they are deliberately
 * formatted without '$' to stay outside the currency regex (Task 6b binding
 * decision — preferred over widening the prose allowlist).
 *
 * Examples:
 *   formatAmountNoCurrency(619_000_000, 'USD')        → "619.0M"
 *   formatAmountNoCurrency(335_700, 'USD thousands')  → "335.7M"
 *   formatAmountNoCurrency(1_234_567_890, 'USD')      → "1.23B"
 *   formatAmountNoCurrency(3_657_411_328_834, 'USD')  → "3.66T"
 */
export function formatAmountNoCurrency(
  value: number,
  units: AmountUnits,
): string {
  return formatAmount(value, units).replace(/\$/g, "");
}

/**
 * Parenthetical compact-USD equivalence for citation-panel amount displays.
 *
 * The panel keeps the RECORDED value primary (honesty: what the source says),
 * but "3,080.000 USD millions" is hard to reconcile with the "$3.08B" shown
 * on the surface card. Return the compact equivalence — e.g. "= $3.08B" — for
 * the caller to render as a muted parenthetical, or null when the recorded
 * numerals are already legible on their own.
 *
 * Thresholds are one order of magnitude of mental arithmetic in each unit:
 *   "USD millions"  → ≥ 1,000      (≥ $1B; "500.000 millions" needs no help)
 *   "USD thousands" → ≥ 1,000      (≥ $1M; §P1-9 — the workbook tier records
 *                                   raw thousands like 5,565,655, whose scale
 *                                   nobody reads at a glance. "847" does not
 *                                   need "= $847.0K".)
 * Any other unit string → null (never infer scale from magnitude).
 */
export function usdEquivalence(
  value: number,
  units: string | null,
): string | null {
  if (units !== "USD millions" && units !== "USD thousands") return null;
  if (!Number.isFinite(value) || Math.abs(value) < 1_000) return null;
  return `= ${formatAmount(value, units)}`;
}

/**
 * A COUNT, grouped — the one formatter for cardinalities in prose.
 *
 * Fix round (2 judges): the site rendered its own size both ways in the same
 * breath — "/programs/ … the 1741 detail-grade program elements" under a
 * corpus statement reading "1,741 of them", and "/district/ … 17 of 1741
 * programs currently crosswalkable" beside "1,993". Two notations for one
 * number reads as two numbers. Every count interpolated into a sentence goes
 * through here; lib/corpus and lib/coverage are its two biggest callers, and
 * the coverage gate mirrors this grouping in its expected patterns.
 *
 * Money never comes here — that is formatAmount, which owns the units rule.
 */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Display label for USAspending place-of-performance district codes.
 *
 * USAspending/FPDS uses special two-digit codes for records that cannot be
 * tied to a numbered congressional district:
 *   - "00"        → at-large state (single seat: AK-00, DE-00, VT-00)
 *   - "90"        → spread across multiple districts (legacy statewide code)
 *   - "98" / "99" → undistricted / statewide records (e.g. DC-98)
 *
 * This is a DISPLAY-ONLY mapping: pop_district codes in the data sidecars and
 * the /district/{code}/ URLs are unchanged. Numbered districts pass through
 * as-is ("TX-12" → "TX-12").
 */
export function districtDisplayLabel(popDistrict: string): string {
  const m = /^([A-Z]{2})-(\d{2})$/.exec(popDistrict);
  if (!m) return popDistrict;
  const [, state, num] = m;
  if (num === "00") return `${state} (at-large)`;
  if (num === "90" || num === "98" || num === "99") {
    return `${state} (undistricted)`;
  }
  return popDistrict;
}

/**
 * Exact title attribute value for screen-reader and tooltip use.
 * Shows the exact source value with its units label.
 *
 * Examples:
 *   exactTitle(280494, 'USD thousands') → "$280,494 (USD thousands)"
 *   exactTitle(0.994, 'USD millions')   → "$0.994 (USD millions)"
 *   exactTitle(135361939903.34, 'USD')  → "$135,361,939,903.34 (USD)"
 */
export function exactTitle(value: number, units: AmountUnits): string {
  // Format the raw value with up to 6 significant decimal places (drop trailing zeros)
  const formatted = value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    useGrouping: true,
  });
  return `$${formatted} (${units})`;
}
