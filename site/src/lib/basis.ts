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
  // §48: was the bare "P-1 TOA" — wrong on every RDT&E row (1,077 of 1,741
  // corpus programs). Any call site that has not yet learned its row's
  // exhibit_family now degrades to the honest both-exhibits form instead of
  // a single exhibit it cannot prove. See basisChipForExhibit below for the
  // exhibit-qualified label a call site CAN prove.
  toa: "P-1/R-1 TOA",
  "jbook-detail": "P-40 detail",
};

/**
 * Exhibit-qualified TOA labels (§48). P-1 is procurement, R-1 is RDT&E — a
 * figure may not claim an exhibit its own row does not report. `mixed` and
 * unknown both render the honest both-exhibits form.
 */
export type ExhibitFamily = "rdte" | "procurement" | "mixed" | null | undefined;

const TOA_LABEL_BY_EXHIBIT: Record<string, string> = {
  rdte: "R-1 TOA",
  procurement: "P-1 TOA",
  mixed: "P-1/R-1 TOA",
};

/**
 * The TOA chip's label, qualified by the figure's own exhibit when known.
 * Non-TOA bases are unaffected — they still resolve through BASIS_LABEL,
 * which has never had an exhibit ambiguity (P-40 detail is a single exhibit
 * regardless of the row's TOA exhibit).
 */
export function basisChipForExhibit(
  basis: string,
  exhibit: ExhibitFamily,
): string | null {
  if (basis !== "toa") return BASIS_LABEL[basis] ?? null;
  return TOA_LABEL_BY_EXHIBIT[exhibit ?? "mixed"] ?? "P-1/R-1 TOA";
}

/**
 * Narrows the corpus's raw exhibit_family token (ProgramRow.exhibit_family
 * is a plain `string` — program-header.tsx's exhibitFamilyLabel() defensively
 * handles "om"/"milpers"/unknown tokens for its own badge) to the chip's
 * two-exhibit vocabulary. A token this function does not recognize degrades
 * to null (→ the mixed chip via basisChipForExhibit) rather than being
 * passed through and silently mis-rendered as one of the two known exhibits.
 */
export function normalizeExhibitFamily(
  family: string | null | undefined,
): ExhibitFamily {
  return family === "rdte" || family === "procurement" ? family : null;
}

/**
 * Exhibit family from a WORKBOOK citation's own `sheet` locator ("Exhibit
 * R-1" / "Exhibit P-1" / "Exhibit P-1R"). This is the tightest signal
 * available at the citation drawer and the /fact/{id} permalink page — both
 * already have the clicked figure's own citation record in scope, with no
 * need for a program-level lookup.
 *
 * Verified against the shipped corpus (data/site/json/cite-shards/, all 256
 * shards): exactly these three sheet strings occur — "Exhibit R-1" (27,578
 * citations), "Exhibit P-1" (7,959) and "Exhibit P-1R" (403) — and no other
 * workbook sheet name appears. P-1R is the combined procurement workbook
 * (footnote.ts's own WORKBOOK_TITLES calls p1r_display.xlsx "Procurement
 * Programs (P-1R)"), so it resolves to procurement, not a third family.
 */
export function exhibitFamilyFromSheet(
  sheet: string | null | undefined,
): ExhibitFamily {
  if (sheet === "Exhibit R-1") return "rdte";
  if (sheet === "Exhibit P-1" || sheet === "Exhibit P-1R") return "procurement";
  return null;
}

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

/**
 * Chip text: basis label, extended-measure label when applicable, edition.
 *
 * `exhibit` (§48) qualifies a TOA basis label to the figure's OWN exhibit
 * (rdte → R-1, procurement → P-1) via basisChipForExhibit. Omitted —
 * every call site not yet threading exhibit_family — degrades to the honest
 * "P-1/R-1 TOA" form rather than the wrong single-exhibit claim.
 */
export function basisChipText(
  basis: string,
  measure?: string,
  edition?: number,
  exhibit?: ExhibitFamily,
): string | null {
  const basisLabel = basisChipForExhibit(basis, exhibit);
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
