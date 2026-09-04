/**
 * footnote.ts — THE unified copy-as-footnote formatter (PM Sprint 1 Task 4,
 * spec §P0-3; gate 23 leg c).
 *
 * One formatter, every citation tier, a fixed field set: program (title +
 * PE/BLI), fiscal year, row/field name, value WITH unit, document TITLE
 * (not filename), locator (Exhibit + page for pdf; sheet + cells for
 * workbook; formula + input permalinks for derived), SHA-256, retrieval
 * date, and the https://…/fact/{fid8} permalink.
 *
 * CONTRACT: the goldens in scripts/gates/goldens/footnotes/ pin the default
 * (Chicago-flavored) style — gate 23 leg (c) imports THIS module with Node's
 * native type stripping and requires formatFootnote(fixture) to reproduce
 * each golden byte-for-byte. Therefore this file is ERASABLE TS ONLY (no
 * enums/namespaces), has NO runtime imports (no "@/…" aliases, no DOM), and
 * every export is a pure function.
 *
 * Styles: "chicago" (default — the golden format), "ap", "bibtex", "json".
 *
 * Two halves:
 *   formatFootnote(input, style)      — FootnoteInput → string
 *   footnoteInputFromCitation(...)    — live cite-shard payload + the
 *     figure/program context threaded through the panel's openPanel call
 *     (see components/cite.tsx) → FootnoteInput. Missing context DROPS
 *     fields — the formatter never guesses a fiscal year or row name.
 */

// ── Input types ─────────────────────────────────────────────────────────────

export type FootnoteTier = "pdf" | "workbook" | "derived" | "generic";
export type FootnoteStyle = "chicago" | "ap" | "bibtex" | "json";

export interface FootnoteProgram {
  /** Program title, e.g. "F-35". */
  name: string;
  /** PE/BLI code, e.g. "ATA000". */
  code: string;
}

export interface FootnoteLocator {
  /** pdf tier: exhibit label, e.g. "Exhibit P-40". */
  exhibit?: string | null;
  /** pdf tier: 1-based page number in the cited document. */
  page?: number | null;
  /** workbook tier: sheet name, e.g. "Exhibit P-1". */
  sheet?: string | null;
  /** workbook tier: cell refs, e.g. "O839,O840,O841". */
  cells?: string | null;
}

export interface FootnoteInput {
  tier: FootnoteTier;
  /** Full 16-hex fact id. */
  factId: string;
  program?: FootnoteProgram | null;
  /** Fallback head when no program context (e.g. trimmed page title). */
  label?: string | null;
  /** Numeric fiscal year. Non-numeric tokens ('all-years') are not rendered. */
  fiscalYear?: number | string | null;
  /** Row/field name, e.g. "Net Procurement (P-1)". */
  rowName?: string | null;
  /** Value WITH unit, e.g. "$5,247.070 million". */
  valueText?: string | null;
  publisher?: string | null;
  /** Document TITLE (not filename). */
  docTitle?: string | null;
  locator?: FootnoteLocator | null;
  /** Full 64-hex sha256 of the cited document. */
  sha256?: string | null;
  /** derived tier: human-readable derivation formula. */
  formula?: string | null;
  /** derived tier: full 16-hex ids of the input facts. */
  inputFactIds?: string[] | null;
  /** derived tier: non-fact input references (source URLs), rendered as-is. */
  inputUrls?: string[] | null;
  /** ISO date (YYYY-MM-DD). */
  retrievedAt?: string | null;
  /** Fact permalink: {origin}/fact/{fid8}. */
  permalink: string;
  /** generic tier: source label ("Senate LDA lobbying filing", …). */
  sourceLabel?: string | null;
  /** generic tier: official source URL. */
  officialUrl?: string | null;
}

// ── Small helpers ───────────────────────────────────────────────────────────

const SITE_NAME = "Fiscal Receipts";
const CANONICAL_FACT_BASE = "https://fiscalreceipts.com";

function isNumericYear(fy: number | string | null | undefined): fy is number | string {
  if (fy == null) return false;
  return /^\d{4}$/.test(String(fy));
}

/** Base for input-fact permalinks, derived from the fact's own permalink. */
function factBase(input: FootnoteInput): string {
  const m = input.permalink.match(/^(.*)\/fact\/[0-9a-f]{8,16}$/);
  return m ? m[1] : CANONICAL_FACT_BASE;
}

function inputFactLinks(input: FootnoteInput): string[] {
  const base = factBase(input);
  const links = (input.inputFactIds ?? []).map(
    (fid) => `${base}/fact/${fid.slice(0, 8)}`,
  );
  return links.concat(input.inputUrls ?? []);
}

/**
 * The quoted head: `F-35 (ATA000), FY2024 Net Procurement (P-1): $5,247.070
 * million`. Every part optional — absent parts drop, never render "null".
 */
function quoteHead(input: FootnoteInput): string {
  const programPart = input.program
    ? `${input.program.name} (${input.program.code})`
    : (input.label ?? null);
  const fyPart = isNumericYear(input.fiscalYear) ? `FY${input.fiscalYear}` : null;
  const fyRow = [fyPart, input.rowName ?? null].filter(Boolean).join(" ");
  const head = [programPart, fyRow || null].filter(Boolean).join(", ");
  if (input.valueText) return head ? `${head}: ${input.valueText}` : input.valueText;
  return head;
}

/** Locator text: "Exhibit P-40, p. 55" / "sheet Exhibit P-1, cells O839…". */
function locatorText(input: FootnoteInput): string | null {
  const loc = input.locator;
  if (!loc) return null;
  if (input.tier === "pdf") {
    const parts = [
      loc.exhibit ?? null,
      loc.page != null ? `p. ${loc.page}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (input.tier === "workbook") {
    const parts = [
      loc.sheet ? `sheet ${loc.sheet}` : null,
      loc.cells ? `cells ${loc.cells}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

// ── Default (Chicago-flavored) style — the golden format ────────────────────

function formatChicago(input: FootnoteInput): string {
  const sentences: string[] = [];

  // 1. `Fiscal Receipts, "F-35 (ATA000), FY2024 …: $5,247.070 million."`
  const head = quoteHead(input);
  sentences.push(head ? `${SITE_NAME}, "${head}."` : `${SITE_NAME}.`);

  // 2. Source sentence.
  if (input.tier === "derived") {
    if (input.formula) {
      const links = inputFactLinks(input);
      const inputsPart = links.length ? `; inputs ${links.join(", ")}` : "";
      sentences.push(`Derived: ${input.formula}${inputsPart}.`);
    }
  } else {
    const parts = [
      input.publisher ?? null,
      input.docTitle ?? null,
      locatorText(input),
    ].filter(Boolean);
    if (input.tier === "generic") {
      if (input.sourceLabel) parts.push(input.sourceLabel);
      if (input.officialUrl) parts.push(input.officialUrl);
    }
    if (parts.length) sentences.push(`${parts.join(", ")}.`);
  }

  // 3. Integrity sentence: sha (when the tier has a document) + retrieved.
  const integrity: string[] = [];
  if (input.sha256) integrity.push(`SHA-256 ${input.sha256.slice(0, 8)}…`);
  if (input.retrievedAt) {
    integrity.push(
      integrity.length ? `retrieved ${input.retrievedAt}` : `Retrieved ${input.retrievedAt}`,
    );
  }
  if (integrity.length) sentences.push(`${integrity.join("; ")}.`);

  // 4. The fact permalink.
  sentences.push(input.permalink);

  return sentences.join(" ");
}

// ── AP style ────────────────────────────────────────────────────────────────

function formatAp(input: FootnoteInput): string {
  const programPart = input.program
    ? `${input.program.name} (${input.program.code})`
    : (input.label ?? SITE_NAME);
  const fyPart = isNumericYear(input.fiscalYear) ? `FY${input.fiscalYear}` : null;
  const fyRow = [fyPart, input.rowName ?? null].filter(Boolean).join(" ");

  let claim = programPart;
  if (fyRow) claim += `: ${fyRow}`;
  if (input.valueText) claim += ` of ${input.valueText}`;

  if (input.tier === "derived" && input.formula) {
    const links = inputFactLinks(input);
    claim += `, derived as ${input.formula}`;
    if (links.length) claim += `; inputs ${links.join(", ")}`;
  } else {
    const src = [input.docTitle ?? null, locatorText(input)]
      .filter(Boolean)
      .join(", ");
    if (src) {
      claim += `, per ${src}`;
      if (input.publisher) claim += ` (${input.publisher})`;
    } else if (input.officialUrl) {
      claim += `, per ${input.officialUrl}`;
    }
  }

  // Verification tail — the same full field set as the default style.
  const tail: string[] = [];
  if (input.sha256) tail.push(`SHA-256 ${input.sha256.slice(0, 8)}…`);
  tail.push(
    input.retrievedAt
      ? `retrieved ${input.retrievedAt} via ${SITE_NAME}`
      : `via ${SITE_NAME}`,
  );
  const tailText = tail.join("; ");
  const tailSentence = tailText.charAt(0).toUpperCase() + tailText.slice(1);
  return `${claim}. ${tailSentence}: ${input.permalink}`;
}

// ── BibTeX style ────────────────────────────────────────────────────────────

/** Escape the BibTeX-active characters in a value. */
function bibEscape(s: string): string {
  return s.replace(/([$#%&_])/g, "\\$1");
}

function formatBibtex(input: FootnoteInput): string {
  const key = `fiscalreceipts_${input.factId.slice(0, 8)}`;
  const fields: Array<[string, string]> = [];

  const head = quoteHead(input);
  if (head) fields.push(["title", bibEscape(head)]);
  fields.push(["author", `{${bibEscape(input.publisher ?? SITE_NAME)}}`]);

  if (input.tier === "derived" && input.formula) {
    const links = inputFactLinks(input);
    const inputsPart = links.length ? `; inputs ${links.join(", ")}` : "";
    fields.push(["howpublished", bibEscape(`Derived: ${input.formula}${inputsPart}`)]);
  } else {
    const src = [input.docTitle ?? null, locatorText(input)]
      .filter(Boolean)
      .join(", ");
    if (src) fields.push(["howpublished", bibEscape(src)]);
    else if (input.officialUrl) fields.push(["howpublished", bibEscape(input.officialUrl)]);
  }

  const note: string[] = [];
  if (input.sha256) note.push(`SHA-256 ${input.sha256}`);
  if (input.retrievedAt) note.push(`retrieved ${input.retrievedAt} via ${SITE_NAME}`);
  if (note.length) fields.push(["note", bibEscape(note.join("; "))]);

  fields.push(["url", input.permalink]);
  if (input.retrievedAt && /^\d{4}/.test(input.retrievedAt)) {
    fields.push(["year", input.retrievedAt.slice(0, 4)]);
  }

  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@misc{${key},\n${body}\n}`;
}

// ── JSON style ──────────────────────────────────────────────────────────────

function formatJson(input: FootnoteInput): string {
  const obj: Record<string, unknown> = { source: SITE_NAME };
  obj.fact_id = input.factId;
  obj.permalink = input.permalink;
  if (input.program) {
    obj.program = input.program.name;
    obj.program_code = input.program.code;
  } else if (input.label) {
    obj.program = input.label;
  }
  if (isNumericYear(input.fiscalYear)) obj.fiscal_year = Number(input.fiscalYear);
  if (input.rowName) obj.row = input.rowName;
  if (input.valueText) obj.value = input.valueText;
  if (input.tier === "derived") {
    if (input.formula) obj.derivation = input.formula;
    const links = inputFactLinks(input);
    if (links.length) obj.inputs = links;
  } else {
    if (input.publisher) obj.publisher = input.publisher;
    if (input.docTitle) obj.document = input.docTitle;
    const loc = locatorText(input);
    if (loc) obj.locator = loc;
    if (input.officialUrl && input.tier === "generic") obj.official_url = input.officialUrl;
  }
  if (input.sha256) obj.sha256 = input.sha256;
  if (input.retrievedAt) obj.retrieved = input.retrievedAt;
  return JSON.stringify(obj, null, 2);
}

// ── The formatter ───────────────────────────────────────────────────────────

/**
 * Render one quotable footnote. Pure — no DOM, no fetches. The default
 * style is the gate-23 golden contract.
 */
export function formatFootnote(
  input: FootnoteInput,
  style: FootnoteStyle = "chicago",
): string {
  if (style === "ap") return formatAp(input);
  if (style === "bibtex") return formatBibtex(input);
  if (style === "json") return formatJson(input);
  return formatChicago(input);
}

/** Human labels for the style picker (stable order). */
export const FOOTNOTE_STYLES: Array<{ value: FootnoteStyle; label: string }> = [
  { value: "chicago", label: "Chicago" },
  { value: "ap", label: "AP" },
  { value: "bibtex", label: "BibTeX" },
  { value: "json", label: "JSON" },
];

// ── Panel-side input builder ────────────────────────────────────────────────

/**
 * Structural view of a citations.json / cite-shard row — kept local so this
 * module stays importable by bare Node (lib/data.ts is server-only). The
 * real Citation union assigns to this shape.
 */
export interface CitationFields {
  kind: string;
  official_url?: string | null;
  hosted_pdf_url?: string | null;
  retrieved_at?: string | null;
  units?: string | null;
  amount_text?: string | null;
  amount_thousands?: number | null;
  recorded_value?: string | null;
  page_number?: number | null;
  sheet?: string | null;
  cells?: string | null;
  sha256?: string | null;
  formula?: string | null;
  inputs?: string | null;
}

/**
 * Figure context threaded through the panel's openPanel call — the
 * attributes the <Cite> element already declares (gate 23 leg a1). The
 * citation payload cannot supply these; without them the footnote OMITS
 * fiscal year / row name rather than guessing.
 */
export interface FootnoteFigure {
  value?: number | null;
  units?: string | null;
  /** Display override for non-currency figures (rendered verbatim). */
  display?: string | null;
  fy?: number | string | null;
  measure?: string | null;
  basis?: string | null;
  entity?: string | null;
  edition?: number | null;
}

/** Options for footnoteInputFromCitation. */
export interface FootnoteBuildOptions {
  /**
   * Site origin for the fact permalink. Callers pass the CANONICAL origin
   * (lib/site SITE_URL — visual-judge M3: permalinks are identifiers and
   * must never render the runtime origin); omitted, it defaults to the
   * canonical fact base this module already pins for input-fact links.
   */
  origin?: string;
  program?: FootnoteProgram | null;
  figure?: FootnoteFigure | null;
  /** Fallback head when no program context (trimmed document.title). */
  pageLabel?: string | null;
}

const PUBLISHER_DOD_COMPTROLLER =
  "Office of the Under Secretary of Defense (Comptroller)";

/**
 * Workbook display files (comptroller.war.gov/…/defbudget/FY{Y}/{file}) →
 * the exhibit title on the Comptroller's budget-materials page. The shard
 * payload carries only official_url, so the human document title is THIS
 * curated mapping — 3 files cover 100% of workbook citations in the corpus
 * (p1_display / r1_display / p1r_display; verified against citations.json).
 */
const WORKBOOK_TITLES: Record<string, string> = {
  "p1_display.xlsx": "Procurement Programs (P-1)",
  "r1_display.xlsx": "RDT&E Programs (R-1)",
  "p1r_display.xlsx": "Procurement Programs (P-1R)",
};

/** Last path segment of a URL, decoded, without fragment/query. */
function fileNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.split("#")[0].split("?")[0];
  const seg = clean.split("/").filter(Boolean).pop() ?? null;
  if (!seg) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Best human title for a cited document, from its official_url.
 *
 * workbook: curated WORKBOOK_TITLES + the FY from the URL path →
 *   "FY2026 Department of Defense Budget: Procurement Programs (P-1)".
 * jbook pdf/narrative: filename normalization, never invention —
 *   "FY26 Air Force Aircraft Procurement Vol I.pdf" →
 *   "FY2026 Air Force Aircraft Procurement, Vol. I"; opaque underscore
 *   names ("RDTE_OSD_PB_2026") just become readable ("RDTE OSD PB 2026").
 */
export function documentTitleFromUrl(
  url: string | null | undefined,
  kind: string,
): string | null {
  const file = fileNameFromUrl(url);
  if (!file) return null;

  if (kind === "workbook") {
    const exhibitTitle = WORKBOOK_TITLES[file.toLowerCase()];
    const fyMatch = (url ?? "").match(/\/fy(\d{4})\//i);
    if (exhibitTitle) {
      const fyPrefix = fyMatch ? `FY${fyMatch[1]} ` : "";
      return `${fyPrefix}Department of Defense Budget: ${exhibitTitle}`;
    }
    return file;
  }

  // J-book PDFs: readable normalization of the filename.
  let title = file.replace(/\.pdf$/i, "");
  title = title.replace(/_/g, " ");
  title = title.replace(/\bFY(\d{2})\b/, (_m, yy: string) => `FY20${yy}`);
  // "… Procurement Vol I" → "… Procurement, Vol. I" (word char before "Vol"
  // so Army's "RDTE - Vol 1 - …" structural hyphens are left alone).
  title = title.replace(
    /(\w) Vol\.? ([IVXL]+|\d+)\b/,
    (_m, prev: string, num: string) => `${prev}, Vol. ${num}`,
  );
  return title.replace(/\s+/g, " ").trim();
}

/** rdte vs procurement family, from the cited document's filename. */
function docFamily(url: string | null | undefined): "rdte" | "procurement" | null {
  const file = fileNameFromUrl(url);
  if (!file) return null;
  if (/rdte|research and development/i.test(file)) return "rdte";
  if (/proc|apn|wpn|ammunition|weapons/i.test(file)) return "procurement";
  return null;
}

/** Unit word for valueText ("USD millions" → "million"). */
function unitWord(units: string | null | undefined): string | null {
  if (!units) return null;
  if (/million/i.test(units)) return "million";
  if (/thousand/i.test(units)) return "thousand";
  if (/billion/i.test(units)) return "billion";
  return units;
}

function withCommas(n: number, minFrac: number, maxFrac: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  });
}

/**
 * Value WITH unit. Prefers the citation's own recorded value (amount_text
 * verbatim from the PDF; amount_thousands; recorded_value) over the threaded
 * figure value. Millions render with the J-book's 3 decimals; thousands as
 * integers ("$5,565,655 thousand").
 */
function valueTextFrom(
  citation: CitationFields,
  figure: FootnoteFigure | null | undefined,
): string | null {
  if (figure?.display) return figure.display;

  if (citation.amount_text) {
    const word = unitWord(citation.units);
    return word
      ? `$${citation.amount_text} ${word}`
      : `$${citation.amount_text}`;
  }
  if (citation.amount_thousands != null) {
    return `$${withCommas(citation.amount_thousands, 0, 3)} thousand`;
  }
  if (citation.recorded_value != null) {
    const n = Number(citation.recorded_value);
    if (Number.isFinite(n)) {
      const word = unitWord(citation.units);
      const text = `$${withCommas(n, 0, 3)}`;
      return word ? `${text} ${word}` : text;
    }
  }
  if (figure?.value != null && figure.units) {
    const word = unitWord(figure.units);
    const isMillions = /million/i.test(figure.units);
    const text = `$${withCommas(figure.value, isMillions ? 3 : 0, 3)}`;
    return word ? `${text} ${word}` : text;
  }
  return null;
}

/**
 * Defensible row/field name — derived ONLY where the mapping is certain:
 *   workbook: the P-1/R-1 display rows are Total Obligation Authority.
 *   jbook_pdf at PROGRAM level (entity carries no "/"): the cited Resource
 *     Summary total row — "Net Procurement (P-1)" (P-40) / "Total Program
 *     Element" (R-2).
 *   derived: the threaded measure token, marked "(derived)".
 * Project-scoped rows and missing context return null (field omitted).
 */
function rowNameFrom(
  citation: CitationFields,
  figure: FootnoteFigure | null | undefined,
): string | null {
  if (citation.kind === "workbook" && citation.sheet) {
    const exhibit = citation.sheet.replace(/^Exhibit\s+/i, "");
    return `Total Obligation Authority (${exhibit})`;
  }
  if (citation.kind === "jbook_pdf" && figure?.basis === "jbook-detail") {
    const programLevel = !figure.entity || !figure.entity.includes("/");
    if (!programLevel) return null;
    const family = docFamily(citation.official_url ?? citation.hosted_pdf_url);
    if (family === "procurement") return "Net Procurement (P-1)";
    if (family === "rdte") return "Total Program Element";
    return null;
  }
  if (citation.kind === "derived" && figure?.measure) {
    return `${figure.measure.replace(/-/g, " ")} (derived)`;
  }
  return null;
}

/** Source label for the generic tier, by citation kind. */
function genericSourceLabel(kind: string): string | null {
  if (kind === "lda_filing") return "Senate LDA lobbying filing";
  if (kind === "usaspending") return "USAspending award data";
  if (kind === "state_soql") return "State open-data query";
  if (kind === "state_file") return "State source file";
  if (kind === "jbook_narrative") return "J-book narrative";
  if (kind === "announcement") return "Official DoD contract announcement";
  return null;
}

function tierFor(kind: string): FootnoteTier {
  if (kind === "jbook_pdf") return "pdf";
  if (kind === "workbook") return "workbook";
  if (kind === "derived") return "derived";
  return "generic";
}

/** 16-hex fact ids from the derived citation's `inputs` JSON-array string. */
function parseInputRefs(inputs: string | null | undefined): {
  factIds: string[];
  urls: string[];
} {
  const factIds: string[] = [];
  const urls: string[] = [];
  if (inputs) {
    try {
      const arr = JSON.parse(inputs);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item !== "string") continue;
          if (/^[0-9a-f]{16}$/.test(item)) factIds.push(item);
          else if (/^https?:\/\//.test(item)) urls.push(item);
        }
      }
    } catch {
      // Malformed inputs — omit rather than render garbage.
    }
  }
  return { factIds, urls };
}

/**
 * Build the formatter input from a live citation payload + the threaded
 * figure/program context. Fields the payload/context cannot supply are
 * omitted — the formatter drops their segment (never fabricates).
 */
export function footnoteInputFromCitation(
  citation: CitationFields,
  factId: string,
  opts: FootnoteBuildOptions,
): FootnoteInput {
  const tier = tierFor(citation.kind);
  const figure = opts.figure ?? null;
  const origin = opts.origin ?? CANONICAL_FACT_BASE;
  const permalink = `${origin.replace(/\/$/, "")}/fact/${factId.slice(0, 8)}`;
  const retrievedAt = citation.retrieved_at
    ? citation.retrieved_at.slice(0, 10)
    : null;
  const docUrl = citation.official_url ?? citation.hosted_pdf_url ?? null;

  const input: FootnoteInput = {
    tier,
    factId,
    program: opts.program ?? null,
    label: opts.program ? null : (opts.pageLabel ?? null),
    fiscalYear: figure?.fy ?? null,
    rowName: rowNameFrom(citation, figure),
    valueText: valueTextFrom(citation, figure),
    sha256: citation.sha256 ?? null,
    retrievedAt,
    permalink,
  };

  if (tier === "pdf") {
    const family = docFamily(docUrl);
    input.publisher = PUBLISHER_DOD_COMPTROLLER;
    input.docTitle = documentTitleFromUrl(docUrl, citation.kind);
    input.locator = {
      exhibit:
        family === "procurement"
          ? "Exhibit P-40"
          : family === "rdte"
            ? "Exhibit R-2"
            : null,
      page: citation.page_number ?? null,
    };
  } else if (tier === "workbook") {
    input.publisher = PUBLISHER_DOD_COMPTROLLER;
    input.docTitle = documentTitleFromUrl(docUrl, citation.kind);
    input.locator = {
      sheet: citation.sheet ?? null,
      cells: citation.cells ?? null,
    };
  } else if (tier === "derived") {
    const refs = parseInputRefs(citation.inputs);
    input.formula = citation.formula ?? null;
    input.inputFactIds = refs.factIds;
    input.inputUrls = refs.urls;
  } else {
    // generic: narratives keep their document title; the query/filing kinds
    // carry a source label + the official URL.
    if (citation.kind === "jbook_narrative") {
      input.publisher = PUBLISHER_DOD_COMPTROLLER;
      input.docTitle = documentTitleFromUrl(docUrl, citation.kind);
      if (citation.page_number != null) {
        input.locator = { page: citation.page_number };
        input.tier = "pdf"; // narrative with page provenance cites like a pdf
      }
    } else {
      input.sourceLabel = genericSourceLabel(citation.kind);
      input.officialUrl = citation.official_url ?? null;
    }
  }

  return input;
}
