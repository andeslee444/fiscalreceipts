/**
 * The award-corpus fiscal-year range — PM-review Sprint 2, spec §P1-6.
 *
 * "$3,657,411,328,834 of all-district obligations" in a card with no period
 * invites exactly one reading: that the Pentagon spent it in a year. It did
 * not — that figure is a decade of USAspending award obligations. Every
 * aggregate that spans years now carries the period, and the period is DERIVED
 * (min/max fiscal_year of fct_award_transactions, computed at export) rather
 * than authored, because the three authored statements the site shipped
 * disagreed with each other and one of them disagreed with the data:
 *
 *   /companies/       "FY2017–FY2025"                     (a year stale)
 *   /company/{slug}/  "across the full USAspending dataset" (unfalsifiable)
 *   /district/        — nothing —
 *
 * awardFyRangeLabel is the ONE wording. It mirrors award_fy_range_label() in
 * src/govbudget/export_site.py; the exporter computes the label, this module
 * recomputes it from the same two numbers and THROWS on disagreement, so a
 * drifting mirror fails the build instead of shipping two vocabularies.
 */

import "server-only";

import { getSiteMeta, type SiteMetaAwardFyRange } from "./data";

export interface AwardFyRange {
  fyMin: number;
  fyMax: number;
  /** Canonical wording, e.g. "FY2017–FY2026". */
  label: string;
  /** True when fyMax is still in progress (latest action predates Sep 30). */
  maxPartial: boolean;
  /**
   * Tooltip-grade sentence naming the range and, when the final year is still
   * open, saying so. Rendered as a title attribute, never as body copy.
   */
  title: string;
}

/**
 * Canonical range wording. Mirrors award_fy_range_label() in export_site.py.
 * En dash, not a hyphen (site typographic convention; the gate matches on it).
 */
export function awardFyRangeLabel(fyMin: number, fyMax: number): string {
  if (!Number.isInteger(fyMin) || !Number.isInteger(fyMax)) {
    throw new Error(
      `[govbudget/fy-range] non-integer fiscal years: ${fyMin}, ${fyMax}`,
    );
  }
  if (fyMin > fyMax) {
    throw new Error(
      `[govbudget/fy-range] award FY range is inverted: FY${fyMin} > FY${fyMax}`,
    );
  }
  return fyMin === fyMax ? `FY${fyMin}` : `FY${fyMin}–FY${fyMax}`;
}

/**
 * The build's award FY range, or null when the export carries none (degenerate
 * exports with no awards mart). Callers render nothing rather than guess.
 */
export function getAwardFyRange(): AwardFyRange | null {
  const raw: SiteMetaAwardFyRange | null | undefined =
    getSiteMeta().award_fy_range;
  if (!raw) return null;

  const label = awardFyRangeLabel(raw.fy_min, raw.fy_max);
  if (label !== raw.label) {
    throw new Error(
      `[govbudget/fy-range] the exporter labeled the award range ${JSON.stringify(
        raw.label,
      )} but this module derives ${JSON.stringify(label)} from the same ` +
        `fiscal years — the Python and TS wordings have drifted apart ` +
        `(award_fy_range_label in export_site.py vs awardFyRangeLabel here).`,
    );
  }

  const period =
    raw.fy_min === raw.fy_max
      ? `fiscal year ${raw.fy_max}`
      : `fiscal years ${raw.fy_min} through ${raw.fy_max}`;
  const title = raw.max_partial
    ? `USAspending award obligations across ${period}. FY${raw.fy_max} is a partial year — it does not close until September 30.`
    : `USAspending award obligations across ${period}.`;

  return {
    fyMin: raw.fy_min,
    fyMax: raw.fy_max,
    label,
    maxPartial: raw.max_partial,
    title,
  };
}
