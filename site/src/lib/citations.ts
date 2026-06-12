/**
 * Citation utilities: LDA URL derivation, kind helpers, re-exported types.
 *
 * Citation kinds and their populated fields (per recon):
 *
 * jbook_pdf  — hosted_pdf_url, page_number, x0, x1, top_pt, bottom_pt,
 *              page_width(792), page_height(612), resolution, sha256, amount_text, units
 * workbook   — sha256, sheet, cells, amount_thousands, units, official_url, retrieved_at
 * lda_filing — official_url (LDA JSON API URL, uuid embedded)
 *
 * Zero-amount jbook facts (1,004): NO citations row — the fact_id+xml_path
 * live in jbook_details rows with resolution='zero_amount'. These render as
 * state B (xml-path chip), not state A (citation panel).
 *
 * LDA filing URLs:
 *   official_url  = "https://lda.senate.gov/api/v1/filings/{uuid}/"
 *   human URL     = "https://lda.senate.gov/filings/public/filing/{uuid}/print/"
 *   humanLdaUrl() extracts the uuid from the API URL and builds the human URL.
 *   Returns null if no uuid can be extracted (malformed / null input).
 *
 * 2,781 / 32,780 lobbying rows have dangling family_key — render client_name
 * as plain text (no link) when the family_key is not in entities_top.
 */

/**
 * Citation type re-exports — using `export type` so the bundler
 * knows these are erased at runtime and will not chase through
 * the server-only data.ts module graph.
 */
export type {
  Citation,
  CitationKind,
  CitationsMap,
  JbookPdfCitation,
  LdaFilingCitation,
  WorkbookCitation,
} from "@/lib/data";

// ── Type guards (defined here so client components can import them
//    without pulling in server-only data.ts) ────────────────────────────────

import type {
  Citation,
  JbookPdfCitation,
  WorkbookCitation,
  LdaFilingCitation,
} from "@/lib/data";

export function isJbookPdf(c: Citation): c is JbookPdfCitation {
  return c.kind === "jbook_pdf";
}

export function isWorkbook(c: Citation): c is WorkbookCitation {
  return c.kind === "workbook";
}

export function isLdaFiling(c: Citation): c is LdaFilingCitation {
  return c.kind === "lda_filing";
}

// ── LDA URL helpers ───────────────────────────────────────────────────────────

/**
 * UUID regex (RFC 4122 hyphenated, case-insensitive).
 */
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Extract uuid from an LDA API URL and return the human-readable filing page.
 *
 * Input:  "https://lda.senate.gov/api/v1/filings/84df56d3-5214-4054-854d-944d8af49389/"
 * Output: "https://lda.senate.gov/filings/public/filing/84df56d3-5214-4054-854d-944d8af49389/print/"
 *
 * Returns null if url is null/empty or contains no UUID.
 */
export function humanLdaUrl(officialUrl: string | null | undefined): string | null {
  if (!officialUrl) return null;
  const match = officialUrl.match(UUID_RE);
  if (!match) return null;
  const uuid = match[0].toLowerCase();
  return `https://lda.senate.gov/filings/public/filing/${uuid}/print/`;
}

/**
 * Extract just the UUID from an LDA API URL.
 * Returns null if not found.
 */
export function extractLdaUuid(officialUrl: string | null | undefined): string | null {
  if (!officialUrl) return null;
  const match = officialUrl.match(UUID_RE);
  return match ? match[0].toLowerCase() : null;
}

// ── Citation kind discriminators (re-exported for convenience) ───────────────

// isJbookPdf, isWorkbook, isLdaFiling are re-exported from data.ts above

// ── PDF highlight math ────────────────────────────────────────────────────────

/**
 * Compute the CSS highlight rect for a jbook_pdf citation, given container width.
 * Page is 792pt wide (landscape), scale = containerWidth / 792.
 * Adds 2px padding on each side.
 *
 * Returns { left, top, width, height } in pixels (strings with "px" suffix for CSS).
 */
export function pdfHighlightRect(
  citation: { x0: number; x1: number; top_pt: number; bottom_pt: number },
  containerWidth: number,
): { left: string; top: string; width: string; height: string } {
  const PAGE_WIDTH_PT = 792;
  const PAD = 2;
  const scale = containerWidth / PAGE_WIDTH_PT;

  const left = citation.x0 * scale - PAD;
  const top = citation.top_pt * scale - PAD;
  const width = (citation.x1 - citation.x0) * scale + PAD * 2;
  const height = (citation.bottom_pt - citation.top_pt) * scale + PAD * 2;

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
}
