/**
 * basis.ts — the basis-chip vocabulary (PM Sprint 1, gate 23 legs a1/a2),
 * extracted from components/cite.tsx so SERVER components (TrajectorySpark's
 * shared-provenance caption, visual-judge M7) can call it too: a "use
 * client" module's functions cannot be invoked from a server component.
 *
 * Pure module — no React, no DOM. cite.tsx re-exports basisChipText for
 * back-compat, so the chip and every caption share ONE vocabulary.
 */

export const BASIS_LABEL: Record<string, string> = {
  toa: "P-1 TOA",
  "jbook-detail": "P-40 detail",
};

/**
 * Human labels for the extended measure tokens, mirroring the exporter's
 * `_amount_type_meta` / `_scenario_meta` slug decisions (export_site.py).
 * Core tokens (actuals/enacted/request/total/change) are conveyed by the
 * surrounding label (card title, table header) and stay OUT of the chip.
 */
export const EXTENDED_MEASURE_LABEL: Record<string, string> = {
  "disc-request": "discretionary request",
  "reconciliation-request": "reconciliation request",
  supplemental: "supplemental",
  "base-request": "base request",
  "all-prior-years": "all prior years",
  // decade-grid kind-qualified tokens (_decade_measure_token): rendered
  // under one row label, sourced from a diverging column
  "enacted-request": "enacted (request column)",
  "enacted-total": "enacted (book total)",
  "actuals-base-oco": "actuals (base + OCO)",
  "request-total-base-oco": "request (base + OCO total)",
};

export const CORE_MEASURES = new Set([
  "actuals",
  "enacted",
  "request",
  "total",
  "change",
]);

/** Chip text: basis label, extended-measure label when applicable, edition. */
export function basisChipText(
  basis: string,
  measure?: string,
  edition?: number,
): string | null {
  const basisLabel = BASIS_LABEL[basis];
  if (!basisLabel) return null; // non-budget bases render no chip
  const parts = [basisLabel];
  if (measure && !CORE_MEASURES.has(measure)) {
    parts.push(
      EXTENDED_MEASURE_LABEL[measure] ?? measure.replace(/-/g, " "),
    );
  }
  if (edition) parts.push(`PB${edition}`);
  return parts.join(" · ");
}
