/**
 * glossary.ts — the site's term-definition vocabulary (ROADMAP #60 / Sprint C
 * Task C1).
 *
 * ONE exported map. /glossary/ renders it; the /methodology/ TOA expansion
 * links into it (#toa); any future inline hover would read the SAME strings.
 * This project has been bitten three times by a paired constant drifting
 * from its mirror (CURRENCY_RE vs its allowlist, BASIS_LABEL vs the gate's
 * own copy, CORPUS_SCOPE_TAIL in datatruth.mjs) — this file exists so a
 * fourth pair never gets the chance to form.
 *
 * SCOPE (measured against the built site, 2026-08-13, `out/` grep by page
 * count — see the term-usage table in the Sprint C task report): every entry
 * below is a term this site actually stamps on a meaningful slice of pages,
 * not a guess at what a reader might want defined. Two low-usage candidates
 * from the task brief were deliberately left out: "place of performance"
 * (2 pages — a passing mention, not a stamped term) and none of the
 * candidates were dropped for being hard to define, only for being rare.
 *
 * ACCURACY. Every definition here is traceable to how the site itself uses
 * the term — src/lib/basis.ts, src/lib/footnote.ts, src/lib/pe-link.ts,
 * src/lib/hhi-band.mjs, src/components/reconciliation-strip.tsx,
 * src/components/program-figures.tsx (Fy26SplitNote), and /methodology/'s
 * own prose. "Reconciliation" carries two genuinely different meanings on
 * this site (the internal TOA-vs-J-book verification check, AND the FY2026
 * congressional reconciliation-bill money) and the entry below states both
 * rather than picking one and being wrong about the other context.
 */

export interface GlossaryEntry {
  /** URL-safe anchor id, e.g. "toa" → /glossary/#toa. */
  id: string;
  /** The term exactly as it is stamped on the site. */
  term: string;
  /** What the term stands for / a short descriptive gloss for non-acronyms. */
  expansion: string;
  /** One or two plain-register sentences. */
  definition: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "toa",
    term: "TOA",
    expansion: "Total Obligational Authority",
    definition:
      "The dollar amount reported on the R-1 (RDT&E) and P-1 (procurement) budget exhibits — the workbook rollup total Congress is asked to authorize. Fiscal Receipts uses TOA as the headline dollar basis for every figure on the site (the “P-1/R-1 TOA” chip); it can differ from the R-2/P-40 project-detail total for the same line because TOA includes budget rows, such as advance procurement, that the detail exhibit excludes.",
  },
  {
    id: "p-1",
    term: "P-1",
    expansion: "Procurement Programs exhibit",
    definition:
      "The official DoD budget exhibit listing every procurement budget line item and its Total Obligational Authority (TOA). Fiscal Receipts downloads the P-1 Excel rollup as an independent control total for procurement lines.",
  },
  {
    id: "r-1",
    term: "R-1",
    expansion: "RDT&E Programs exhibit",
    definition:
      "The official DoD budget exhibit listing every research, development, test, and evaluation (RDT&E) program element and its Total Obligational Authority (TOA). Fiscal Receipts downloads the R-1 Excel rollup as an independent control total for RDT&E lines.",
  },
  {
    id: "r-2",
    term: "R-2",
    expansion: "RDT&E Project Justification exhibit",
    definition:
      "The detailed budget-justification exhibit for one RDT&E program element: program narrative, project-level cost tables, and the congressional justification text. Cited detail figures on RDT&E program pages come from this exhibit.",
  },
  {
    id: "p-40",
    term: "P-40",
    expansion: "Procurement Budget Item Justification exhibit",
    definition:
      "The detailed budget-justification exhibit for one procurement budget line item: program narrative, project-level cost tables, and the congressional justification text. Cited detail figures on procurement program pages come from this exhibit.",
  },
  {
    id: "pe",
    term: "PE",
    expansion: "Program Element",
    definition:
      "The identifying code DoD assigns to an RDT&E budget line (7 digits + a letter, e.g. 0601101E). Fiscal Receipts uses the PE code — or PE/BLI, for lines identified either way — as the row key, page URL, and citation anchor for every RDT&E program.",
  },
  {
    id: "bli",
    term: "BLI",
    expansion: "Budget Line Item",
    definition:
      "The identifying code DoD assigns to a procurement budget line (e.g. BLI 1445). A handful of BLI codes are reused across services for the same equipment type; where that happens, this site attributes each organization's own reported slice, never a shared total.",
  },
  {
    id: "pb-edition",
    term: "PB20XX",
    expansion: "President's Budget edition",
    definition:
      "The fiscal year of the President's Budget submission a figure was published in — e.g. PB2026 is the FY2026 request submitted to Congress. Each edition reports three fiscal years (its own request, the prior year's enacted total, and the year before that as actuals); Fiscal Receipts loads ten defense-wide editions (PB2017–PB2026) and states which edition every figure comes from, because editions are parallel publications, never corrected into one another.",
  },
  // The three words rendered as a program page's summary cards — "FY24
  // Actuals", "FY25 Enacted", "FY26 Request" — and as the row labels on
  // /years/. They were the three most load-bearing words on the site and the
  // only stamped measures with no entry here (tri-persona Wave 3, Task 3);
  // the layman review's point was that the reader who does not already know
  // the difference between asking, being given, and having spent cannot read
  // a single program page. Definitions traced to CORE_MEASURES in
  // src/lib/basis.ts and to how the exporter fills each row.
  {
    id: "actuals",
    term: "Actuals",
    expansion: "What the year finally came to",
    definition:
      "The amount a budget book reports for a fiscal year that has already finished. Each President's Budget edition reports the year two before it as actuals — PB2026 reports FY2024 actuals — so an actuals figure is the government's own later account of a completed year, not a plan. It is still Total Obligational Authority, not cash out the door: see Obligation for the money that was actually committed.",
  },
  {
    id: "enacted",
    term: "Enacted",
    expansion: "What Congress appropriated",
    definition:
      "The amount for the year in progress, as passed by Congress in an appropriations act. Each edition reports the year before its own as enacted — PB2026 reports FY2025 enacted. Where a book went to press under a continuing resolution it fills that row with a request column instead; those cells are marked on this site and explained under Enacted (request column). Treat an unmarked enacted figure as what was appropriated, and a marked one as what was asked for.",
  },
  {
    id: "request",
    term: "Request",
    expansion: "What the Pentagon asked for",
    definition:
      "The amount the President's Budget asks Congress to provide for the budget year — the headline number in the book's own title year, and nothing more than a proposal at the time it is published. PB2026 requests FY2026. Congress may fund more, less, or nothing; the Request-vs-actuals gaps in the anomaly feed are exactly the distance between the two, per program.",
  },
  {
    id: "j-book",
    term: "J-book",
    expansion: "Budget Justification Book",
    definition:
      "The Pentagon's detailed budget submission to Congress each spring, covering every RDT&E program (R-2 exhibits) and procurement budget line (P-40 exhibits) with program narratives, project-level cost tables, and congressional justifications.",
  },
  {
    id: "discretionary",
    term: "Discretionary",
    expansion: "Annual appropriation (not reconciliation)",
    definition:
      "Regular annual funding set through the normal appropriations process, as distinct from one-time reconciliation-bill money (see Reconciliation). Where a program's FY2026 request includes both, Fiscal Receipts shows the split explicitly — discretionary amount plus reconciliation amount — rather than folding them into one unlabeled total.",
  },
  {
    id: "reconciliation",
    term: "Reconciliation",
    expansion: "Two meanings on this site",
    definition:
      "Used two ways here. (1) The verification check where a program's P-1/R-1 workbook TOA is compared against its R-2/P-40 detail-exhibit total for the same year, shown as the reconciliation strip under a program's figures. (2) For FY2026 specifically, the congressional budget reconciliation process: a one-time funding mechanism separate from the annual discretionary appropriations bill. Context on the page makes clear which sense applies.",
  },
  {
    id: "partial-reconciliation",
    term: "Partial Reconciliation",
    expansion: "The badge on a program page's header",
    definition:
      "The reconciliation badge states the result of the checks described under How we verify. “Reconciled” means every scenario this site checks — prior-year actuals, current-year enacted, and the budget-year request and its base — ties to the R-1/P-1 workbook rollup for that line. “Partial Reconciliation” means at least one of those checks failed and the failure is filed in the review queue; it is a real, specific disagreement, not a to-do. “No detail to reconcile” means the line has no R-2/P-40 detail to check against, so no check ran. One scenario in the J-book XML, All Prior Years, is a cumulative to-date figure with no R-1 or P-1 column to compare it to; it is never checked and never counted against a line's badge.",
  },
  {
    id: "enacted-request",
    term: "Enacted (request column)",
    expansion: "An enacted year reported through a request column",
    definition:
      "Some President's Budget editions publish no enacted column for the prior year, because that year ran under a continuing resolution when the book went to press. The PB2025 books report FY2024 in a column headed “FY 2024 PB Request with CR Amounts*” — the request, adjusted for the CR, not an appropriation Congress passed. FY2017 and FY2018 have the same shape in the PB2018 and PB2019 books. Fiscal Receipts still files those figures under the year's Enacted row, because that is the slot the book itself fills, and marks every such column so the label never reads as an enacted total. Treat these cells as “asked for”, never as “got”.",
  },
  {
    id: "hhi",
    term: "HHI",
    expansion: "Herfindahl-Hirschman Index",
    definition:
      "A standard market-concentration measure, computed here per program per fiscal year as the sum of each contractor family's obligation share squared (× 10,000), counting only high-confidence award links and positive obligations. Fiscal Receipts follows the DOJ/FTC Horizontal Merger Guidelines bands: below 1,500 is competitive, 1,500–2,500 is moderately concentrated, and 2,500 or above is highly concentrated.",
  },
  {
    id: "obligation",
    term: "Obligation",
    expansion: "Money legally committed to be paid",
    definition:
      "The point at which a federal agency legally commits to pay for goods or services, such as when a contract is signed. Obligation figures on this site come from USAspending.gov award records and are a different quantity from TOA: TOA is what was requested or authorized; an obligation is what was actually committed, tracked separately by fiscal year.",
  },
  // Tri-persona Wave 3, Task 3. The home page's agency grid rendered 21 bare
  // acronyms and /agency/TJS/ was titled "TJS". Both now render the component
  // name (lib/agency-names.ts); this entry explains what the code IS, since
  // a reader who has seen "org DMACT" on a citation chip has no other way to
  // find out. The names themselves live in ONE place — agency-names.ts — and
  // are deliberately not repeated here: a second copy is a second thing to
  // drift.
  {
    id: "agency-code",
    term: "Organization code",
    expansion: "The workbook's short name for a DoD component",
    definition:
      "Each budget-justification workbook files its rows under a short organization code — A, N and F for the Army, Navy and Air Force, and an acronym for each defense-wide component (DTRA, DMACT, TJS, DHRA, …). The code is the workbook's own key, so this site keeps it on every agency page and every citation, and prints the component's full name beside it. Codes are not agencies in the budget-authority sense: several defense-wide components share one appropriation account.",
  },
  {
    id: "non-add",
    term: "Non-Add",
    expansion: "Memo line, excluded from totals",
    definition:
      "A workbook row flagged Non-Add is informational only — its dollar amount is a memo or reference figure already counted inside another row, so site totals exclude it to avoid double-counting. The flag appears verbatim in a workbook citation's preview whenever the source row carries it.",
  },
];
