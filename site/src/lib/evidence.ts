/**
 * evidence.ts — human-readable labels for fct_program_lobbying's evidence_kind
 * column (#52, 2026-08).
 *
 * THE DEFECT. `find_mentions()` used to emit a row on ONE title word >=5
 * chars appearing in a filing's activity description — "Ground Based
 * Midcourse (MD08)" matched on "Based", "CYBERCOM Activities" matched on
 * "Activities" via an unrelated company. A 60-word stoplist existed and
 * still missed these; no stoplist can make a single common word evidence of
 * naming. The site was, and remains, honest about printing the matched
 * term per row — that transparency is how four independent reviewers found
 * the defect from four different starting points.
 *
 * THE FIX. A row is now emitted only when the filing's pooled activity text
 * carries the exact PE/BLI code ("pe_literal"), a curated human-verified
 * alias ("alias"), or >=2 distinct non-generic title words ("multi_token").
 * Every row in the mart carries which tier qualified it — this module turns
 * that machine value into the label rendered next to the row, so a reader
 * never has to take the site's evidence claim on faith.
 */

export type EvidenceKind = "pe_literal" | "alias" | "multi_token";

/** Short badge text — next to the matched-term chip(s) on a mention row. */
export function evidenceKindLabel(
  kind: string | null | undefined,
): string {
  switch (kind) {
    case "pe_literal":
      return "PE code cited directly";
    case "alias":
      return "matched a known alias";
    case "multi_token":
      return "matched 2+ title words";
    default:
      return "unclassified match";
  }
}

/**
 * Longer form for a methodology-adjacent tooltip/title attribute — spells
 * out why the tier counts as evidence, not just its name.
 */
export function evidenceKindTitle(
  kind: string | null | undefined,
): string {
  switch (kind) {
    case "pe_literal":
      return "The filing's activity description contains this exact program element / budget line code.";
    case "alias":
      return "The filing's activity description contains a curated, human-verified alias for this program.";
    case "multi_token":
      return "The filing's activity description contains at least two distinct, non-generic words from this program's title — a single common word is never sufficient on its own.";
    default:
      return "Evidence tier not recorded.";
  }
}
