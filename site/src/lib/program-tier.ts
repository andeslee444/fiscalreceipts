/**
 * program-tier.ts — pure helpers for the two program-page tiers (Phase 5F §2a).
 *
 *   full   — programs in programs.json with R-2/P-40 J-book detail (~1,741
 *            after the Phase 5G Army/AF/SF archive round; grows as books land).
 *   rollup — sidecars carrying only R-1/P-1 workbook figures + trajectory
 *            (tier:'rollup', service_org, title on the sidecar).
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

/**
 * Org codes (in the details.service_org / budget_lines.organization code space)
 * whose FY2026 J-book IS loaded. A rollup page for one of these is NOT
 * "awaiting ingestion" — the book is loaded, this PE simply has no matching
 * R-2/P-40 narrative in it (a procurement-only, summary, classified, or SBIR
 * line, or an R-1-only workbook remainder).
 *
 * DATA-DERIVED, NOT HARDCODED: the exporter emits the live set into
 * site_meta.ingested_service_orgs — the distinct FY2026 status='downloaded'
 * jbook_documents orgs, each translated through workbook_org() into this same
 * code space (so CYBERCOM→CYBER, CHIPS/DPAP→OSD line up with service_org).
 * That is ~25 codes: the three services PLUS every defense-wide agency book
 * (OSD, DCSA, MDA, DISA, DARPA, …). data.ts injects it at build time via
 * setIngestedServiceOrgs. A hardcoded A/N/F set previously lied on every
 * defense-wide agency rollup page ("the {org} J-book is not yet ingested").
 *
 * This module is universal (no fs / no server-only), so it cannot read the
 * payload itself; the build-time server layer (data.ts getSiteMeta) sets it.
 * The default is the three services so any consumer that never injects (unit
 * tests, a stray import) still behaves sensibly rather than seeing an empty
 * set. Single source of truth for the rollup note wording.
 */
const DEFAULT_INGESTED_SERVICE_ORGS: readonly string[] = ["A", "N", "F"];

let _ingestedServiceOrgs: ReadonlySet<string> = new Set(
  DEFAULT_INGESTED_SERVICE_ORGS,
);

/**
 * Inject the data-derived ingested-org set (from
 * site_meta.ingested_service_orgs). Called once at build time by data.ts.
 * Empty/absent input falls back to the A/N/F default rather than blanking the
 * set — a missing payload key must never silently make every service page lie.
 */
export function setIngestedServiceOrgs(orgs: readonly string[] | undefined): void {
  _ingestedServiceOrgs = new Set(
    orgs && orgs.length > 0 ? orgs : DEFAULT_INGESTED_SERVICE_ORGS,
  );
}

export function isIngestedServiceOrg(code: string): boolean {
  return _ingestedServiceOrgs.has(code);
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
    // ProgramRow.org is an org CODE ("F"), the code space shared by
    // programs.json, agencies.json and gao_overlays.agency_code_by_org.
    // It is NOT the display name: every consumer that SHOWS it humanizes at
    // the point of display (serviceOrgName, which passes agency acronyms and
    // "DoD" through unchanged), and the consumers that LOOK IT UP need the
    // code. This field used to be humanized here, which is why 226 rollup
    // pages resolved no GAO department overlay (getGaoOverlayForOrg keys by
    // code) and rendered their own organization as dead plain text instead of
    // a link to the /agency/{code}/ page that does exist — while their header
    // tooltip claimed "Organization code Air Force". ROADMAP #30 patched that
    // silence; this is the cause.
    //
    // Empty service_org (1 sidecar) still falls back to the honest umbrella
    // "DoD" — the figures come from the DoD-wide R-1/P-1 workbooks. "DoD" is
    // deliberately not a service code: it has no agency page and no overlay,
    // which is the correct outcome for a line with no declared service.
    org: details.service_org || "DoD",
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
    // Sprint E, Task E3: a rollup-tier program is never one of the 8
    // appropriation-account collisions (those all have a dim_programs row,
    // i.e. full tier) — slug is always its own bare pe_bli.
    slug: peBli,
    account: null,
    account_title: null,
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
