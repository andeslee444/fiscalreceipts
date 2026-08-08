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
 * Short hover-title form (a `title` attribute) — one sentence, not a
 * paragraph. Kept deliberately terse: this repeats once per rendered
 * mention row (up to ~130+ on the heaviest filing page today), and the
 * full explanation already lives once on /methodology/ — see
 * evidenceKindLongExplanation() for that copy. A verbose per-row title
 * attribute was gate 1's page-weight ceiling failure on the heaviest
 * /filing/ page (131 rows x ~180 bytes = 23.7KB, more than the entire
 * overage) — this is the fix, not a workaround: the label text already
 * says the tier; the tooltip only needs to say why briefly.
 */
export function evidenceKindTitle(
  kind: string | null | undefined,
): string {
  switch (kind) {
    case "pe_literal":
      return "Exact program code found in the filing text.";
    case "alias":
      return "A curated, verified alias was found in the filing text.";
    case "multi_token":
      return "2+ distinct title words found together — never just one.";
    default:
      return "Evidence tier not recorded.";
  }
}

/**
 * Full-sentence rationale per tier — for a one-time explanation (e.g. a
 * methodology paragraph or glossary), NOT for repeating on every mention
 * row. See evidenceKindTitle() for the per-row hover form.
 */
export function evidenceKindLongExplanation(
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
