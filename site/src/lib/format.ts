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
 * Format a raw USD value into compact display string.
 * Rules:
 *   ≥ 100B   → X.XB  (1 decimal)
 *   ≥ 10B    → XX.XB (1 decimal)
 *   ≥ 1B     → X.XXB (2 decimals if <10, i.e. 2 dec when lead digit < 10)
 *   ≥ 100M   → $XXXM (1 decimal)
 *   ≥ 10M    → $XX.XM (1 decimal)
 *   ≥ 1M     → $X.XM (1 decimal, 2 when < 10)
 *   ≥ 100K   → $XXXK (1 decimal)
 *   ≥ 10K    → $XX.XK (1 decimal)
 *   ≥ 1K     → $X.XK (1 decimal, 2 when < 10)
 *   < 1K     → $X (integer)
 *
 * Plan spec: "one decimal except <10 two decimals"
 *   - <10B → 2 dec; ≥10B → 1 dec
 *   - <10M → 2 dec; ≥10M → 1 dec
 *   - <10K → 2 dec; ≥10K → 1 dec
 */
function compactFormat(rawUsd: number): string {
  const abs = Math.abs(rawUsd);
  const sign = rawUsd < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    const v = abs / 1_000_000_000;
    const dec = v < 10 ? 2 : 1;
    return `${sign}$${v.toFixed(dec)}B`;
  }
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    const dec = v < 10 ? 2 : 1;
    return `${sign}$${v.toFixed(dec)}M`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    const dec = v < 10 ? 2 : 1;
    return `${sign}$${v.toFixed(dec)}K`;
  }
  // Sub-thousand: integer dollars
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

/**
 * Format an amount for compact display.
 * Units determine scale; magnitude never determines scale.
 *
 * Examples:
 *   formatAmount(1234567, 'USD thousands') → "$1.23T" (1234567 * 1000 = $1.234B)
 *   Wait — 1234567 thousands = $1,234,567,000 = $1.23B
 *   formatAmount(280494, 'USD thousands') → "$280.5M"  (280494 * 1000 = $280,494,000)
 *   formatAmount(0.994, 'USD millions') → "$994.0K"  (0.994 * 1e6 = $994,000)
 */
export function formatAmount(value: number, units: AmountUnits): string {
  const rawUsd = toRawUsd(value, units);
  return compactFormat(rawUsd);
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
