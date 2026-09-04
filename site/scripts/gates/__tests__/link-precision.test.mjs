/**
 * Unit tests for gate 24 leg (n) — the held-out link-precision study
 * (ROADMAP #72), and specifically the two directions added by the 2026-09-04
 * final review (C1, C2).
 *
 * THE DEFECT THESE PIN. /methodology/ published "Measured precision of the
 * published tiers: … fpds-ap 60/60; fpds-ap+account 34/60 …". Every figure
 * matched site_meta exactly, site_meta matched the study table exactly, and
 * the old leg was green — but `fpds-ap+account` had been WITHDRAWN (zero rows
 * in the corpus) and its 60 sampled links had moved into the `fpds-ap` medium
 * tier, whose honest figure was 94/120. Meanwhile the site's LARGEST tier
 * (account+subagency, ~9,100 rows) and account+tokens carried no figure at
 * all, and their silence read as "nothing to report".
 *
 * So the leg now also asks: is every figure about a tier the corpus
 * publishes, and is every published tier either measured or NAMED unmeasured
 * on the page?
 *
 * Corpora are injected (like split-key-awards.test.mjs injects `programs`) so
 * the tests do not depend on a build.
 *
 * Run via `npm test` (vitest).
 */

import { describe, it, expect } from "vitest";
import {
  publishedLinkMethods,
  runLinkPrecisionLeg,
} from "../datatruth.mjs";

/** citations.json shape: {fact_id: {formula, …}} — one row per published
 *  budget→award link, each stating its method and tier. */
function citationsFor(pairs) {
  const out = {};
  pairs.forEach(([method, confidence], i) => {
    out[`f${i}`] = {
      formula:
        `crosswalk link: pe_bli=0604262N matched to award PIID N000${i} via ` +
        `method='${method}', confidence='${confidence}' (dollars live at ` +
        `award grain in fct_award_transactions)`,
    };
  });
  return out;
}

/** The live published universe, measured 2026-09-04 from citations.json. */
const LIVE_CITATIONS = citationsFor([
  ["account", "medium"],
  ["account", "high"],
  ["account+subagency", "medium"],
  ["account+subagency", "high"],
  ["account+tokens", "medium"],
  ["account+tokens", "high"],
  ["announcement+lexicon", "high"],
  ["fpds-ap", "medium"],
  ["subaward+lexicon", "medium"],
  ["account", "low"], // low tiers are not published — must not enter the set
]);

/** The live site_meta.link_precision this branch exports. */
const LIVE_META = {
  link_precision: {
    sample_id: "2026-09-04",
    sampled_at: "2026-09-04",
    methods: {
      "announcement+lexicon": { confirmed: 51, sampled: 54 },
      "fpds-ap": { confirmed: 94, sampled: 120 },
      "subaward+lexicon": { confirmed: 53, sampled: 60 },
    },
    unmeasured: ["account", "account+subagency", "account+tokens"],
  },
};

/** The paragraph the fixed /methodology/ renders for LIVE_META. */
const LIVE_PARAGRAPH =
  "Measured precision of the published tiers, from a held-out " +
  "hand-adjudicated sample re-run through the same two-reviewer process and " +
  "judged 2026-09-04. Each sampled link is counted under the tier it " +
  "publishes under today, not the tier it carried when it was drawn; a " +
  "sampled link the corpus no longer publishes is counted in neither " +
  "direction: announcement+lexicon 51/54; fpds-ap 94/120; " +
  "subaward+lexicon 53/60. Published whatever the numbers turn out to be; a " +
  "tier that misses is renamed or narrowed, never widened to fit. No " +
  "precision figure is published for the remaining tiers a reader can meet " +
  "— account, account+subagency, account+tokens.";

function run({ siteMeta, citations, paragraphText, methodologyBuilt }) {
  const errors = [];
  const notes = [];
  runLinkPrecisionLeg(errors, notes, {
    siteMeta,
    citations,
    paragraphText,
    methodologyBuilt,
  });
  return { errors, notes };
}

describe("publishedLinkMethods", () => {
  it("recovers every high/medium method from the crosswalk formulas", () => {
    expect([...publishedLinkMethods(LIVE_CITATIONS)].sort()).toEqual([
      "account",
      "account+subagency",
      "account+tokens",
      "announcement+lexicon",
      "fpds-ap",
      "subaward+lexicon",
    ]);
  });

  it("does not count a tier that only publishes at low confidence", () => {
    const only = citationsFor([["fpds-ap", "low"]]);
    expect(publishedLinkMethods(only).size).toBe(0);
  });
});

describe("gate 24 leg n — the live shape", () => {
  it("passes on the corpus this branch ships", () => {
    const { errors, notes } = run({
      siteMeta: LIVE_META,
      citations: LIVE_CITATIONS,
      paragraphText: LIVE_PARAGRAPH,
    });
    expect(errors).toEqual([]);
    expect(notes.join(" ")).toMatch(/3 measured method\(s\)/);
    expect(notes.join(" ")).toMatch(/3 unmeasured published tier\(s\)/);
  });
});

describe("gate 24 leg n — C1: a figure for a tier the corpus does not publish", () => {
  it("FAILS on the shape that shipped (fpds-ap+account 34/60)", () => {
    const shipped = {
      link_precision: {
        sample_id: "2026-09-04",
        sampled_at: "2026-09-04",
        methods: {
          "account+subagency": { confirmed: 60, sampled: 60 },
          "announcement+lexicon": { confirmed: 54, sampled: 60 },
          "fpds-ap": { confirmed: 60, sampled: 60 },
          "fpds-ap+account": { confirmed: 34, sampled: 60 },
          "subaward+lexicon": { confirmed: 53, sampled: 60 },
        },
        unmeasured: [],
      },
    };
    const paragraph =
      "Measured precision of the published tiers: account+subagency 60/60; " +
      "announcement+lexicon 54/60; fpds-ap 60/60; fpds-ap+account 34/60; " +
      "subaward+lexicon 53/60.";
    const { errors } = run({
      siteMeta: shipped,
      citations: LIVE_CITATIONS,
      paragraphText: paragraph,
    });
    expect(errors.join("\n")).toMatch(/"fpds-ap\+account" is published as measured precision/);
    // account+tokens and account publish and are neither measured nor named.
    expect(errors.join("\n")).toMatch(/method='account\+tokens'.*neither measures it nor lists it/s);
  });
});

describe("gate 24 leg n — C2: an unmeasured published tier must be named", () => {
  it("FAILS when a published tier is neither measured nor listed unmeasured", () => {
    const meta = {
      link_precision: {
        ...LIVE_META.link_precision,
        unmeasured: ["account", "account+tokens"], // account+subagency dropped
      },
    };
    const { errors } = run({
      siteMeta: meta,
      citations: LIVE_CITATIONS,
      paragraphText: LIVE_PARAGRAPH,
    });
    expect(errors.join("\n")).toMatch(
      /method='account\+subagency'.*neither measures it nor lists it/s,
    );
  });

  it("FAILS when site_meta lists a tier unmeasured but the paragraph never names it", () => {
    const paragraph = LIVE_PARAGRAPH.replace(
      "— account, account+subagency, account+tokens.",
      "— account, account+tokens.",
    );
    const { errors } = run({
      siteMeta: LIVE_META,
      citations: LIVE_CITATIONS,
      paragraphText: paragraph,
    });
    expect(errors.join("\n")).toMatch(
      /"account\+subagency" is listed unmeasured in site_meta but \[data-link-precision\] never names it/,
    );
  });

  it("does not accept 'account' inside 'account+subagency' as naming the account tier", () => {
    const paragraph = LIVE_PARAGRAPH.replace(
      "— account, account+subagency, account+tokens.",
      "— account+subagency, account+tokens.",
    );
    const { errors } = run({
      siteMeta: LIVE_META,
      citations: LIVE_CITATIONS,
      paragraphText: paragraph,
    });
    expect(errors.join("\n")).toMatch(/"account" is listed unmeasured/);
  });
});

describe("gate 24 leg n — non-vacuity floor on the published universe", () => {
  it("FAILS when the crosswalk formula stops parsing (empty universe)", () => {
    const unparseable = {
      f0: { formula: "crosswalk link via METHOD fpds-ap at MEDIUM confidence" },
    };
    const { errors } = run({
      siteMeta: LIVE_META,
      citations: unparseable,
      paragraphText: LIVE_PARAGRAPH,
    });
    expect(errors.join("\n")).toMatch(
      /only 0 published link method\(s\) recovered from citations\.json \(floor 4/,
    );
  });

  it("FAILS just below the floor, passes at it", () => {
    const three = citationsFor([
      ["announcement+lexicon", "high"],
      ["fpds-ap", "medium"],
      ["subaward+lexicon", "medium"],
    ]);
    const metaNoUnmeasured = {
      link_precision: { ...LIVE_META.link_precision, unmeasured: [] },
    };
    expect(
      run({
        siteMeta: metaNoUnmeasured,
        citations: three,
        paragraphText: LIVE_PARAGRAPH,
      }).errors.join("\n"),
    ).toMatch(/only 3 published link method\(s\)/);

    const four = citationsFor([
      ["announcement+lexicon", "high"],
      ["fpds-ap", "medium"],
      ["subaward+lexicon", "medium"],
      ["account+subagency", "medium"],
    ]);
    const metaFour = {
      link_precision: {
        ...LIVE_META.link_precision,
        unmeasured: ["account+subagency"],
      },
    };
    expect(
      run({
        siteMeta: metaFour,
        citations: four,
        paragraphText: LIVE_PARAGRAPH,
      }).errors,
    ).toEqual([]);
  });
});

describe("gate 24 leg n — the pre-existing directions still hold", () => {
  it("FAILS when the paragraph states a figure site_meta does not have", () => {
    const { errors } = run({
      siteMeta: LIVE_META,
      citations: LIVE_CITATIONS,
      paragraphText: LIVE_PARAGRAPH.replace("fpds-ap 94/120", "fpds-ap 118/120"),
    });
    expect(errors.join("\n")).toMatch(
      /"fpds-ap" renders 118\/120, site_meta\.link_precision has 94\/120/,
    );
  });

  it("FAILS when the paragraph renders with an empty study", () => {
    const { errors } = run({
      siteMeta: { link_precision: {} },
      citations: LIVE_CITATIONS,
      paragraphText: LIVE_PARAGRAPH,
    });
    expect(errors.join("\n")).toMatch(/renders while site_meta\.link_precision is empty/);
  });

  it("passes silently when no study is loaded and no paragraph renders", () => {
    const { errors, notes } = run({
      siteMeta: {},
      citations: LIVE_CITATIONS,
      paragraphText: null,
    });
    expect(errors).toEqual([]);
    expect(notes.join(" ")).toMatch(/nothing published yet/);
  });

  it("FAILS on a stale export carrying the pre-2026-09-04 flat shape", () => {
    const { errors } = run({
      siteMeta: {
        link_precision: { "fpds-ap": { confirmed: 60, sampled: 60 } },
      },
      citations: LIVE_CITATIONS,
      paragraphText: LIVE_PARAGRAPH,
    });
    expect(errors.join("\n")).toMatch(/pre-2026-09-04 flat shape/);
  });
});
