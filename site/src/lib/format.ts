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
 * on the surface card. When units are "USD millions" and the value is ≥ 1,000
 * (i.e. ≥ $1B), return the compact equivalence — e.g. "= $3.08B" — for the
 * caller to render as a muted parenthetical. Null otherwise (no clutter for
 * values already legible in millions).
 */
export function usdEquivalence(
  value: number,
  units: string | null,
): string | null {
  if (units !== "USD millions") return null;
  if (!Number.isFinite(value) || Math.abs(value) < 1_000) return null;
  return `= ${formatAmount(value, "USD millions")}`;
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
