/**
 * program-tier.ts — pure helpers for the two program-page tiers (Phase 5F §2a).
 *
 *   full   — 462 programs in programs.json with R-2/P-40 J-book detail.
 *   rollup — 1,533 sidecars carrying only R-1/P-1 workbook figures +
 *            trajectory (tier:'rollup', service_org, title on the sidecar).
 *
 * Universal module (no fs, no server-only): data.ts, sitemap.ts, and the
 * program page all consume these; unit tests construct sidecar objects
 * directly. The build/skeleton gates recompute the same predicates
 * independently in scripts/gates/.
 */

import type {
  ProgramDetails,
  ProgramRow,
} from "@/lib/data";

/** Service workbook org code → service name (rollup J-book note wording). */
export function serviceOrgName(code: string): string {
  switch (code) {
    case "A":
      return "Army";
    case "N":
      return "Navy";
    case "F":
      return "Air Force";
    default:
      return code;
  }
}

/** True when the sidecar is a Batch-A rollup-tier export. */
export function isRollupDetails(details: ProgramDetails): boolean {
  return details.tier === "rollup";
}

/**
 * Exhibit family for a rollup page, derived from its workbook lines:
 * R-1 → rdte, P-1/P-1R → procurement; mixed → the family with more lines;
 * no lines → the honest generic "budget".
 */
export function deriveExhibitFamily(
  budgetLines: readonly { exhibit: string }[],
): string {
  let rdte = 0;
  let procurement = 0;
  for (const bl of budgetLines) {
    if (bl.exhibit === "R-1") rdte++;
    else if (bl.exhibit === "P-1" || bl.exhibit === "P-1R") procurement++;
  }
  if (rdte === 0 && procurement === 0) return "budget";
  return rdte >= procurement ? "rdte" : "procurement";
}

/**
 * Synthesize a ProgramRow-shaped record for a rollup-tier page so the shared
 * header / answer-strip / figures components render one honest shape.
 * Everything the rollup export doesn't carry is null/zero — never invented.
 */
export function rollupProgramRow(
  peBli: string,
  details: ProgramDetails,
): ProgramRow {
  return {
    pe_bli: peBli,
    title: details.title ?? peBli,
    org: serviceOrgName(details.service_org ?? ""),
    exhibit_family: deriveExhibitFamily(details.budget_lines),
    fully_reconciled: false,
    fy2024_actual_millions: null,
    fy2024_fact_id: null,
    fy2024_xml_path: null,
    hhi: null,
    award_count: details.awards.length,
    narrative_count: details.narratives.length,
    project_count: 0,
    trajectory: details.trajectory ?? null,
    trajectory_fact_ids: details.trajectory_fact_ids ?? null,
  };
}

/**
 * noindex policy (Phase 5F §2a): a page whose ONLY content is zero-valued
 * figure line(s) — no details, narratives, awards, or mentions, and every
 * workbook amount and trajectory value is 0 (or absent) — is built but
 * noindexed and excluded from the sitemap (same policy as zero-mention
 * filings). Pages with any non-zero figure or any prose stay indexable.
 */
export function isZeroContentDetails(details: ProgramDetails): boolean {
  if (
    details.details.length > 0 ||
    details.narratives.length > 0 ||
    details.awards.length > 0 ||
    details.mentions.length > 0
  ) {
    return false;
  }
  const figures: number[] = details.budget_lines.map((bl) => bl.amount_thousands);
  const t = details.trajectory;
  if (t) {
    for (const v of [t.fy2024_actuals, t.fy2025_total, t.fy2026_total]) {
      if (v !== null && v !== undefined) figures.push(v);
    }
  }
  return figures.every((v) => v === 0);
}
