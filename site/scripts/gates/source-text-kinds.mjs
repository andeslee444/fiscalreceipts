/**
 * source-text-kinds.mjs — what `data-source-text` is actually allowed to exempt.
 *
 * BACKGROUND (ROADMAP backlog #38). One attribute was doing three jobs:
 *
 *   1. CITATION (render-static a0). "This prose is cited as a block, at the
 *      container, so its figures need no per-figure anchor — and no computed
 *      [data-amount] may hide inside it."
 *   2. CURRENCY ATTRIBUTION (render-static b). "The dollar strings here are
 *      not site-composed <Cite> figures, so do not demand [data-amount]."
 *   3. NUMBER NOTATION (datatruth leg j). "The integer notation here is the
 *      SOURCE's, not ours, so do not demand comma grouping."
 *
 * Jobs 2 and 3 are FORMATTING exemptions and they are only earned by prose
 * that genuinely comes from somewhere else. Job 1 is a PROVENANCE exemption.
 * Because one attribute granted all three, `/methodology/` — the site's own
 * hand-written explanatory prose, quoted from nothing — wrapped its entire
 * container in the marker and became the single page on the site that neither
 * formatting sweep could see. Nothing was wrong on it, which is precisely why
 * a defect there would have gone unnoticed; round 3 found three by hand
 * (run-together words, an outdented list, `17 of 1741`) that these sweeps
 * would have caught had they been able to look.
 *
 * The fix is to stop letting the attribute's mere PRESENCE grant the
 * formatting exemptions, and to make each marker VALUE declare, here, exactly
 * which of them it earns. Both gates read this one table:
 *
 *   quotedFigures  → render-static (b) does not require [data-amount] around
 *                    dollar tokens in this subtree.
 *   sourceNotation → datatruth leg j does not require comma grouping on
 *                    4+-digit cardinalities in this subtree.
 *
 * A value that appears in the built HTML and is NOT in this table fails
 * render-static. Adding one is therefore a deliberate, reviewed edit that has
 * to say, in `why`, whose prose it is — which is the question the old
 * attribute never made anyone answer.
 */

/**
 * @typedef {Object} SourceTextKind
 * @property {boolean} quotedFigures  dollar tokens are not site-composed figures
 * @property {boolean} sourceNotation integer notation belongs to the source
 * @property {string}  why            whose prose this is, in one sentence
 */

/** @type {Record<string, SourceTextKind>} */
export const SOURCE_TEXT_KINDS = {
  narrative: {
    quotedFigures: true,
    sourceNotation: true,
    why:
      "Verbatim J-book XML narrative prose, block-cited by data-xml-path. " +
      "Both the dollar strings ('$136.315 million') and the integer notation " +
      "are the source document's own; a cited fact inside it renders as " +
      "<ProseCite>, never <Cite>.",
  },
  "dossier-claim": {
    quotedFigures: true,
    sourceNotation: true,
    why:
      "Dossier claim text quoted from the source the claim cites " +
      "(data-cite-fact-id / data-cite-url). Reformatting a quoted claim " +
      "would misquote it.",
  },
  "lineage-evidence": {
    quotedFigures: true,
    sourceNotation: true,
    why:
      "The verbatim transfer sentence lifted from a J-book narrative, " +
      "anchored to the same evidence fact the rail's 'cited' chip opens.",
  },
  "footnote-preview": {
    quotedFigures: true,
    sourceNotation: true,
    why:
      "A rendered citation footnote (BibTeX/JSON) echoing the fact it was " +
      "formatted from. Client-only, so it never reaches the static HTML, but " +
      "the marking is the honest one.",
  },
  headline: {
    quotedFigures: true,
    sourceNotation: false,
    why:
      "Feed headlines composed by the export pipeline, not by a source " +
      "document. The sentence is a generated string, so its dollar tokens " +
      "cannot carry per-token anchors today — a KNOWN GAP (ROADMAP backlog " +
      "#44), not a provenance claim. The NOTATION is ours, so leg j sweeps it.",
  },
};

/** Every marker value this build is allowed to render. */
export const KNOWN_SOURCE_TEXT_KINDS = Object.freeze(
  Object.keys(SOURCE_TEXT_KINDS),
);

/** @param {string|null|undefined} value */
export function isKnownSourceTextKind(value) {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SOURCE_TEXT_KINDS, value)
  );
}

/**
 * render-static (b): may this subtree's dollar tokens sit outside
 * [data-amount]? Unknown values are NOT exempt — an unclassified marker must
 * not be able to buy silence by existing.
 *
 * @param {string|null|undefined} value
 */
export function exemptFromCurrencyScan(value) {
  return isKnownSourceTextKind(value) && SOURCE_TEXT_KINDS[value].quotedFigures;
}

/**
 * datatruth leg j: may this subtree render a bare 4+-digit cardinality?
 * Unknown values are NOT exempt, for the same reason.
 *
 * @param {string|null|undefined} value
 */
export function exemptFromNotationSweep(value) {
  return isKnownSourceTextKind(value) && SOURCE_TEXT_KINDS[value].sourceNotation;
}
