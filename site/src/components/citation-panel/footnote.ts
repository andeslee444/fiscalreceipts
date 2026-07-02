/**
 * footnote.ts — Copy-as-footnote formatter (Phase 5C, Task 9).
 *
 * Pure functions, no DOM: formatFootnote(input) renders a single quotable
 * footnote string, one template per citation kind. footnoteInputFromCitation
 * maps an already-loaded Citation object (see lib/data.ts) into the
 * formatter's input — the panel's copy button supplies the page permalink
 * and a human label at click time.
 *
 * Shape (all kinds):
 *   {label}: {amount} — {kind-specific source}; sha256:{sha}; retrieved {date}; {permalink}
 * Missing fields drop their segment — never "null"/"undefined" in output.
 */

import type { Citation } from "@/lib/data";

export interface FootnoteInput {
  kind: string; // CitationKind
  factId: string;
  /** Human label for the figure (usually derived from the page title). */
  label?: string | null;
  /** Display amount, e.g. "$293.145M" or "293,145 USD thousands". */
  amountText?: string | null;
  /** Source document title (jbook_pdf / workbook / jbook_narrative). */
  docTitle?: string | null;
  page?: number | null;
  sheet?: string | null;
  cells?: string | null;
  sha256?: string | null;
  /** ISO date (YYYY-MM-DD). */
  retrievedAt?: string | null;
  /** Canonical page permalink (origin + pathname). */
  url: string;
  officialUrl?: string | null;
  /** Derivation formula (derived kind). */
  formula?: string | null;
}

/** Kind-specific source segment. */
function sourceSegment(input: FootnoteInput): string {
  const parts: string[] = [];
  switch (input.kind) {
    case "jbook_pdf":
      if (input.docTitle) parts.push(input.docTitle);
      if (input.page != null) parts.push(`p.${input.page}`);
      return parts.join(", ") || "DoD budget justification PDF";
    case "workbook":
      parts.push(input.docTitle ?? "DoD budget rollup workbook");
      if (input.sheet) parts.push(`sheet ${input.sheet}`);
      if (input.cells) parts.push(`cells ${input.cells}`);
      return parts.join(", ");
    case "usaspending":
      parts.push("USAspending award data");
      if (input.officialUrl) parts.push(input.officialUrl);
      return parts.join(", ");
    case "lda_filing":
      parts.push("Senate LDA filing");
      if (input.officialUrl) parts.push(input.officialUrl);
      return parts.join(", ");
    case "derived":
      // Derived figures always disclose the derivation formula.
      return input.formula
        ? `derived: ${input.formula}`
        : "derived from warehouse data";
    case "state_soql":
      parts.push("state open-data query");
      if (input.officialUrl) parts.push(input.officialUrl);
      return parts.join(", ");
    case "state_file":
      parts.push("state source file");
      if (input.officialUrl) parts.push(input.officialUrl);
      return parts.join(", ");
    case "jbook_narrative":
      parts.push(input.docTitle ?? "DoD J-book narrative");
      return parts.join(", ");
    default:
      return input.officialUrl ?? "";
  }
}

/** Render a single quotable footnote line. Pure — no DOM access. */
export function formatFootnote(input: FootnoteInput): string {
  // Head: "{label}: {amount}" (either part optional).
  const head = [input.label, input.amountText]
    .filter((s): s is string => Boolean(s))
    .join(": ");

  // Tail: verification metadata + permalink.
  const tail: string[] = [];
  const source = sourceSegment(input);
  if (source) tail.push(source);
  if (input.sha256) tail.push(`sha256:${input.sha256}`);
  if (input.retrievedAt) tail.push(`retrieved ${input.retrievedAt}`);
  tail.push(input.url);

  return head ? `${head} — ${tail.join("; ")}` : tail.join("; ");
}

/** Last path segment of a URL, decoded — used as a document title fallback. */
function fileNameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const clean = url.split("#")[0].split("?")[0];
    const seg = clean.split("/").filter(Boolean).pop() ?? null;
    return seg ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}

/** Best display amount for a citation, per kind. */
function amountTextFromCitation(citation: Citation): string | null {
  if (citation.kind === "jbook_pdf" && citation.amount_text) {
    return citation.amount_text;
  }
  if (citation.kind === "workbook" && citation.amount_thousands != null) {
    const n = citation.amount_thousands.toLocaleString("en-US", {
      maximumFractionDigits: 3,
    });
    return `${n} ${citation.units ?? "USD thousands"}`;
  }
  if (citation.recorded_value != null) {
    const n = Number(citation.recorded_value);
    const formatted = Number.isFinite(n)
      ? n.toLocaleString("en-US", { maximumFractionDigits: 3 })
      : citation.recorded_value;
    return citation.units ? `${formatted} ${citation.units}` : formatted;
  }
  return null;
}

/**
 * Build the formatter input from an already-loaded Citation object.
 * `url` is the canonical page permalink; `label` is the caller's human
 * label for the figure (e.g. trimmed document.title).
 */
export function footnoteInputFromCitation(
  citation: Citation,
  factId: string,
  opts: { url: string; label?: string | null },
): FootnoteInput {
  const docUrl =
    citation.kind === "jbook_pdf"
      ? (citation.official_url ?? citation.hosted_pdf_url)
      : citation.official_url;
  return {
    kind: citation.kind,
    factId,
    label: opts.label ?? null,
    amountText: amountTextFromCitation(citation),
    docTitle: fileNameFromUrl(docUrl),
    page: citation.kind === "jbook_pdf" ? citation.page_number : null,
    sheet: citation.kind === "workbook" ? citation.sheet : null,
    cells: citation.kind === "workbook" ? citation.cells : null,
    sha256: citation.sha256,
    retrievedAt: citation.retrieved_at
      ? citation.retrieved_at.slice(0, 10)
      : null,
    url: opts.url,
    officialUrl: citation.official_url,
    formula: citation.kind === "derived" ? citation.formula : null,
  };
}
