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
  DerivedCitation,
  UsaspendingCitation,
  StateSoqlCitation,
  StateFileCitation,
  JbookNarrativeCitation,
} from "@/lib/data";

// ── Type guards (defined here so client components can import them
//    without pulling in server-only data.ts) ────────────────────────────────

import type {
  Citation,
  JbookPdfCitation,
  WorkbookCitation,
  LdaFilingCitation,
  DerivedCitation,
  UsaspendingCitation,
  StateSoqlCitation,
  StateFileCitation,
  JbookNarrativeCitation,
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

export function isDerived(c: Citation): c is DerivedCitation {
  return c.kind === "derived";
}

export function isUsaspending(c: Citation): c is UsaspendingCitation {
  return c.kind === "usaspending";
}

export function isStateSoql(c: Citation): c is StateSoqlCitation {
  return c.kind === "state_soql";
}

export function isStateFile(c: Citation): c is StateFileCitation {
  return c.kind === "state_file";
}

export function isJbookNarrative(c: Citation): c is JbookNarrativeCitation {
  return c.kind === "jbook_narrative";
}

// ── PDF-page renderable citations (Phase 5F §2b) ─────────────────────────────

/**
 * Structural type for anything PdfView can render: a hosted PDF page plus a
 * bbox highlight. jbook_pdf citations always fit; jbook_narrative citations
 * fit when the provenance builder resolved their passage start (2,449/2,457).
 */
export interface PdfPageCitation {
  hosted_pdf_url: string;
  page_number: number;
  x0: number;
  x1: number;
  top_pt: number;
  bottom_pt: number;
  resolution: "unique" | "ambiguous_first" | null;
  amount_text: string | null;
  units: string | null;
  official_url: string | null;
}

/**
 * Narrow a narrative citation to its paged (PdfView-renderable) form.
 * The 8 unresolved narratives fail this and keep the non-paged card —
 * never a fake location.
 */
export function pagedNarrativeCitation(
  c: JbookNarrativeCitation,
): PdfPageCitation | null {
  if (
    c.hosted_pdf_url == null ||
    c.page_number == null ||
    c.x0 == null ||
    c.x1 == null ||
    c.top_pt == null ||
    c.bottom_pt == null
  ) {
    return null;
  }
  return {
    hosted_pdf_url: c.hosted_pdf_url,
    page_number: c.page_number,
    x0: c.x0,
    x1: c.x1,
    top_pt: c.top_pt,
    bottom_pt: c.bottom_pt,
    resolution: c.resolution,
    amount_text: null, // narratives cite prose, not an amount
    units: null,
    official_url: c.official_url,
  };
}

// ── Derived-citation input helpers ───────────────────────────────────────────

/** 16-hex fact_id pattern (export_site identity hashes). */
export const FACT_ID_PATTERN = /^[0-9a-f]{16}$/;

export interface DerivedInput {
  /** Raw input string from the inputs JSON array. */
  value: string;
  /** True when the input is a 16-hex fact_id referencing another citation. */
  isFactId: boolean;
  /** True when the input looks like an http(s) URL. */
  isUrl: boolean;
}

/**
 * Parse a derived citation's `inputs` JSON-array string into typed entries.
 * Returns [] on null/malformed input (never throws).
 */
export function parseDerivedInputs(inputs: string | null | undefined): DerivedInput[] {
  if (!inputs) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputs);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DerivedInput[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || item.length === 0) continue;
    out.push({
      value: item,
      isFactId: FACT_ID_PATTERN.test(item),
      isUrl: /^https?:\/\//i.test(item),
    });
  }
  return out;
}

/**
 * Pretty-print a usaspending query_body JSON string (2-space indent).
 * Falls back to the raw string when it does not parse.
 */
export function prettyQueryBody(queryBody: string | null | undefined): string {
  if (!queryBody) return "";
  try {
    return JSON.stringify(JSON.parse(queryBody), null, 2);
  } catch {
    return queryBody;
  }
}

/**
 * Classify a usaspending citation's official_url:
 *   'permalink' — usaspending.gov search-hash permalink (…/search/?hash=…)
 *   'profile'   — usaspending.gov recipient profile page
 *   'endpoint'  — api.usaspending.gov API endpoint (default)
 */
export function usaspendingUrlKind(
  officialUrl: string | null | undefined,
): "permalink" | "profile" | "endpoint" {
  if (!officialUrl) return "endpoint";
  if (/usaspending\.gov\/search\/?\?hash=/i.test(officialUrl)) return "permalink";
  if (/usaspending\.gov\/recipient\//i.test(officialUrl)) return "profile";
  return "endpoint";
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
