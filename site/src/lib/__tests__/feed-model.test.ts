/**
 * feed-model — PM-review Sprint 3 Task 2 (§P1-8).
 *
 * The feed is a PUBLISHED CLAIM in a machine-readable envelope: once a
 * subscriber's reader has an item, we cannot correct it. So the rules that
 * make an item trustworthy — the dollar magnitude, the receipt permalink, a
 * guid that does not churn, and XML that actually parses — are pinned here.
 */

import { describe, it, expect } from "vitest";
import {
  escapeXml,
  formatCompactUsd,
  formatSignedUsd,
  magnitudeText,
  magnitudePoints,
  feedGuid,
  factPermalink,
  publicFactId,
  buildItem,
  buildFeedTargets,
  renderRss,
  renderAtom,
  eventTypeFeedPaths,
  programFeedPaths,
  companyFeedPaths,
  WHOLE_FEED_RSS,
  WHOLE_FEED_RSS_ALIAS,
  WHOLE_FEED_ATOM,
  FR_NS,
} from "../feed-model.mjs";
import { formatAmount } from "../format";

const SITE = "https://fiscalreceipts.com";
const PUB = "2026-08-05T01:43:58.614085+00:00";

const swingCard = {
  event_type: "yoy_swing",
  family_key: null,
  figure_fact_id: "ccc48b6ae1b67a44",
  figure_units: "pct_change",
  figure_value: 78.75,
  fiscal_year: 2026,
  headline: "Minuteman Squadrons increased 79% FY25→26",
  organization: "F",
  pe_bli: "0101213F",
  program_url: "/program/0101213F/",
  title: "Minuteman Squadrons",
  why_url: "/methodology/#feed-yoy_swing",
  basis: "toa",
  fy: 2026,
  measure: "change",
  edition: 2026,
  magnitude: {
    kind: "pair",
    units: "thousands_usd",
    from: { label: "FY2025", fy: 2025, value: 59320, fact_id: "17180cc83bbb4706" },
    to: { label: "FY2026", fy: 2026, value: 106032, fact_id: "10dbf99ab69c8f51" },
    delta: { label: "change", fy: 2026, value: 46712, fact_id: "ccc48b6ae1b67a44" },
    pct_change: 78.75,
  },
};

const entrantCard = {
  event_type: "new_entrant",
  family_key: "ACME & SONS <ROBOTICS>",
  figure_fact_id: "d223e3cfc9617503",
  figure_units: "dollars",
  figure_value: 3075188.92,
  fiscal_year: 2025,
  headline: "ACME & SONS <ROBOTICS> new defense contractor (first award FY2025, $3.1M total)",
  organization: null,
  pe_bli: null,
  program_url: null,
  title: null,
  why_url: "/methodology/#feed-new_entrant",
  basis: null,
  fy: null,
  measure: null,
  edition: null,
  magnitude: {
    kind: "single",
    units: "dollars",
    from: null,
    to: {
      label: "total obligations since FY2025",
      fy: null,
      value: 3075188.92,
      fact_id: "d223e3cfc9617503",
    },
    delta: null,
    pct_change: null,
  },
};

const ctx = () => ({
  siteUrl: SITE,
  pubDate: PUB,
  programPages: new Set(["0101213F"]),
  companySlugByFamilyKey: new Map([["ACME & SONS <ROBOTICS>", "acme-sons-robotics"]]),
});

// ── XML escaping ────────────────────────────────────────────────────────────

describe("escapeXml", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f",
    );
  });

  it("does not double-escape the ampersands it introduces", () => {
    // The single most common way a hand-rolled serializer produces a document
    // that no reader can parse.
    expect(escapeXml("<b>")).toBe("&lt;b&gt;");
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  it("keeps the non-ASCII characters real titles contain", () => {
    expect(escapeXml("Strategic Sub & Weapons — FY25→26")).toBe(
      "Strategic Sub &amp; Weapons — FY25→26",
    );
  });

  it("drops control characters XML 1.0 cannot encode at all", () => {
    expect(escapeXml("a\u0000b\u001Fc")).toBe("abc");
    expect(escapeXml("keep\ttab\nnewline")).toBe("keep\ttab\nnewline");
  });
});

// ── Money ladder parity ─────────────────────────────────────────────────────

describe("formatCompactUsd", () => {
  it("is identical to the site's formatAmount across the corpus's range", () => {
    // The feed's money ladder is a MIRROR of lib/format.ts (plain Node cannot
    // import the TypeScript one). Drift would print a different dollar figure
    // in the feed than on the page for the same fact — so parity is asserted,
    // not trusted.
    const values = [
      0, 1, 9.5, 10, 999, 1000, 1234, 59320, 106032, 999_999, 1_000_000,
      3_075_188.92, 61_590_082, 999_999_999, 1_234_567_890,
      3_657_411_328_834.89, -46_712, -3_227_858,
    ];
    for (const v of values) {
      expect(formatCompactUsd(v, "thousands_usd"), `${v} thousands`).toBe(
        formatAmount(v, "USD thousands"),
      );
      expect(formatCompactUsd(v, "dollars"), `${v} dollars`).toBe(
        formatAmount(v, "USD"),
      );
    }
  });

  it("rejects units it was not told about rather than guessing scale", () => {
    expect(() => formatCompactUsd(1, "millions_usd")).toThrow(/unknown magnitude units/);
  });
});

describe("formatSignedUsd", () => {
  it("always states the direction of a change", () => {
    expect(formatSignedUsd(46712, "thousands_usd")).toBe("+$46.7M");
    expect(formatSignedUsd(-3_227_858, "thousands_usd")).toBe("−$3.23B");
  });
});

// ── The §P1-8 sentence ──────────────────────────────────────────────────────

describe("magnitudeText", () => {
  it("states $X → $Y (+delta, +pct) for a pair — the fix §P1-8 asked for", () => {
    expect(magnitudeText(swingCard.magnitude)).toBe(
      "FY2025 $59.3M → FY2026 $106.0M (+$46.7M, +79%)",
    );
  });

  it("states the one magnitude a single-endpoint event has, and invents no base", () => {
    expect(magnitudeText(entrantCard.magnitude)).toBe(
      "total obligations since FY2025 $3.08M",
    );
    expect(magnitudeText(entrantCard.magnitude)).not.toContain("→");
  });

  it("reproduces the percentage the headline states", () => {
    const m = swingCard.magnitude;
    const pct = (100 * (m.to.value - m.from.value)) / m.from.value;
    expect(Math.round(pct)).toBe(79);
    expect(magnitudeText(m)).toContain("+79%");
  });
});

describe("magnitudePoints", () => {
  it("returns every present endpoint with its role", () => {
    expect(magnitudePoints(swingCard.magnitude).map((p) => p.role)).toEqual([
      "from",
      "to",
      "delta",
    ]);
    expect(magnitudePoints(entrantCard.magnitude).map((p) => p.role)).toEqual(["to"]);
  });
});

// ── Identity ────────────────────────────────────────────────────────────────

describe("feedGuid", () => {
  it("is stable across rebuilds — it depends only on the event's identity", () => {
    const a = feedGuid(swingCard);
    const b = feedGuid({ ...swingCard, figure_value: 91.2, magnitude: null });
    expect(b).toBe(a);
  });

  it("separates two organizations sharing a program element", () => {
    expect(feedGuid({ ...swingCard, organization: "N" })).not.toBe(feedGuid(swingCard));
  });

  it("separates event types and fiscal years for the same program", () => {
    expect(feedGuid({ ...swingCard, event_type: "concentration_shift" })).not.toBe(
      feedGuid(swingCard),
    );
    expect(feedGuid({ ...swingCard, fiscal_year: 2025 })).not.toBe(feedGuid(swingCard));
  });
});

describe("factPermalink", () => {
  it("uses the 8-hex public id the Cite chip copies", () => {
    expect(publicFactId("ccc48b6ae1b67a44")).toBe("ccc48b6a");
    expect(factPermalink(SITE, "ccc48b6ae1b67a44")).toBe(
      "https://fiscalreceipts.com/fact/ccc48b6a",
    );
  });

  it("is null rather than a broken link when there is no fact", () => {
    expect(factPermalink(SITE, null)).toBeNull();
  });
});

// ── Items ───────────────────────────────────────────────────────────────────

describe("buildItem", () => {
  it("carries the page's claim verbatim and appends the dollars", () => {
    const it = buildItem(swingCard, ctx());
    expect(it.title).toBe(
      "Minuteman Squadrons increased 79% FY25→26 — FY2025 $59.3M → FY2026 $106.0M (+$46.7M, +79%)",
    );
    expect(it.title.startsWith(swingCard.headline)).toBe(true);
  });

  it("links to the program page when one exists, and never when it does not", () => {
    expect(buildItem(swingCard, ctx()).link).toBe(
      "https://fiscalreceipts.com/program/0101213F/",
    );
    const noPage = { ...ctx(), programPages: new Set<string>() };
    expect(buildItem(swingCard, noPage).link).toBe(
      "https://fiscalreceipts.com/feed/#feed-yoy_swing",
    );
  });

  it("carries a /fact/{id} receipt permalink", () => {
    expect(buildItem(swingCard, ctx()).receiptUrl).toBe(
      "https://fiscalreceipts.com/fact/ccc48b6a",
    );
  });

  it("links every magnitude endpoint to its own receipt", () => {
    const desc = buildItem(swingCard, ctx()).description;
    for (const id of ["17180cc8", "10dbf99a", "ccc48b6a"]) {
      expect(desc).toContain(`/fact/${id}`);
    }
  });
});

// ── Targets ─────────────────────────────────────────────────────────────────

const targets = () =>
  buildFeedTargets({
    cards: [swingCard, entrantCard],
    siteUrl: SITE,
    pubDate: PUB,
    programPages: new Set(["0101213F"]),
    programTitles: new Map([["0101213F", "Minuteman Squadrons"]]),
    companySlugByFamilyKey: new Map([
      ["ACME & SONS <ROBOTICS>", "acme-sons-robotics"],
    ]),
    companyWatch: [
      {
        slug: "acme-sons-robotics",
        displayName: "Acme & Sons Robotics",
        peBlis: new Set(["0101213F"]),
        familyKey: "ACME & SONS <ROBOTICS>",
      },
    ],
  });

describe("buildFeedTargets", () => {
  it("emits the whole feed at /rss.xml with /feed.xml as an alias (both 404'd)", () => {
    const whole = targets().find((t) => t.kind === "all")!;
    expect(whole.rssPath).toBe(WHOLE_FEED_RSS);
    expect(whole.atomPath).toBe(WHOLE_FEED_ATOM);
    expect(whole.aliasPaths).toContain(WHOLE_FEED_RSS_ALIAS);
  });

  it("the whole feed's item count equals the card count", () => {
    const whole = targets().find((t) => t.kind === "all")!;
    expect(whole.items.length).toBe(2);
  });

  it("leads with the budget swings, the same order /feed/ renders", () => {
    // The mart returns cards ordered by event_type alphabetically, which puts
    // concentration_shift first. A subscriber's first screen should hold what
    // the page's first screen holds.
    const whole = buildFeedTargets({
      cards: [entrantCard, swingCard],
      siteUrl: SITE,
      pubDate: PUB,
      programPages: new Set(["0101213F"]),
      companySlugByFamilyKey: new Map(),
    }).find((t) => t.kind === "all")!;
    expect(whole.items.map((i: { category: string }) => i.category)).toEqual(["yoy_swing", "new_entrant"]);
  });

  it("emits one feed per event type, and nothing for an absent type", () => {
    const types = targets()
      .filter((t) => t.kind === "event_type")
      .map((t) => t.key);
    expect(types.sort()).toEqual(["new_entrant", "yoy_swing"]);
    expect(eventTypeFeedPaths("yoy_swing").rss).toBe("/feeds/yoy_swing.xml");
  });

  it("emits a watch feed only for programs that already have a page", () => {
    const progs = targets().filter((t) => t.kind === "program");
    expect(progs.map((t) => t.key)).toEqual(["0101213F"]);
    expect(progs[0].rssPath).toBe(programFeedPaths("0101213F").rss);

    const noPages = buildFeedTargets({
      cards: [swingCard],
      siteUrl: SITE,
      pubDate: PUB,
      programPages: new Set(),
      companySlugByFamilyKey: new Map(),
    });
    expect(noPages.filter((t) => t.kind === "program")).toHaveLength(0);
  });

  it("a company watch feed collects its linked programs plus its own events", () => {
    const co = targets().find((t) => t.kind === "company")!;
    expect(co.rssPath).toBe(companyFeedPaths("acme-sons-robotics").rss);
    expect(co.items.map((i: { card: { event_type: string } }) => i.card.event_type).sort()).toEqual([
      "new_entrant",
      "yoy_swing",
    ]);
    expect(co.description).toMatch(/not a claim that the company holds/i);
  });

  it("refuses to build when two events would share a guid", () => {
    expect(() =>
      buildFeedTargets({
        cards: [swingCard, { ...swingCard, figure_value: 1 }],
        siteUrl: SITE,
        pubDate: PUB,
        programPages: new Set(["0101213F"]),
        companySlugByFamilyKey: new Map(),
      }),
    ).toThrow(/duplicate guid/);
  });
});

// ── Rendering ───────────────────────────────────────────────────────────────

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`XML parse error: ${err.textContent}`);
  return doc;
}

describe("renderRss", () => {
  const whole = () => targets().find((t) => t.kind === "all")!;

  it("produces XML that a real parser accepts", () => {
    const doc = parseXml(renderRss(whole(), SITE));
    expect(doc.documentElement.nodeName).toBe("rss");
    expect(doc.querySelectorAll("item")).toHaveLength(2);
  });

  it("survives titles containing &, < and >", () => {
    const doc = parseXml(renderRss(whole(), SITE));
    const titles = [...doc.querySelectorAll("item > title")].map((t) => t.textContent);
    expect(titles.some((t) => t!.includes("ACME & SONS <ROBOTICS>"))).toBe(true);
  });

  it("gives every item a non-permalink guid and a real pubDate", () => {
    const doc = parseXml(renderRss(whole(), SITE));
    for (const item of doc.querySelectorAll("item")) {
      const guid = item.querySelector("guid")!;
      expect(guid.getAttribute("isPermaLink")).toBe("false");
      expect(guid.textContent).toMatch(/^urn:fiscalreceipts:feed:/);
      const pub = item.querySelector("pubDate")!.textContent!;
      expect(Number.isNaN(new Date(pub).getTime())).toBe(false);
      expect(new Date(pub).toISOString()).toBe("2026-08-05T01:43:58.000Z");
    }
  });

  it("carries the machine-readable magnitude with a fact id per endpoint", () => {
    const doc = parseXml(renderRss(whole(), SITE));
    const mags = doc.getElementsByTagNameNS(FR_NS, "magnitude");
    expect(mags).toHaveLength(2);
    const pair = [...mags].find((m) => m.getAttribute("kind") === "pair")!;
    const pts = [...pair.getElementsByTagNameNS(FR_NS, "point")];
    expect(pts.map((p) => p.getAttribute("role"))).toEqual(["from", "to", "delta"]);
    expect(pts.map((p) => Number(p.getAttribute("value")))).toEqual([
      59320, 106032, 46712,
    ]);
    for (const p of pts) {
      expect(p.getAttribute("fact")).toMatch(/^[0-9a-f]{16}$/);
      expect(p.getAttribute("href")).toMatch(/\/fact\/[0-9a-f]{8}$/);
    }
  });

  it("declares itself with atom:link rel=self", () => {
    const doc = parseXml(renderRss(whole(), SITE));
    const self = [...doc.getElementsByTagName("atom:link")].find(
      (l) => l.getAttribute("rel") === "self",
    )!;
    expect(self.getAttribute("href")).toBe("https://fiscalreceipts.com/rss.xml");
  });
});

describe("renderAtom", () => {
  it("produces parseable Atom with one entry per card", () => {
    const whole = targets().find((t) => t.kind === "all")!;
    const doc = parseXml(renderAtom(whole, SITE));
    expect(doc.documentElement.nodeName).toBe("feed");
    const entries = doc.getElementsByTagName("entry");
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.getElementsByTagName("id")[0].textContent).toMatch(
        /^urn:fiscalreceipts:feed:/,
      );
      const updated = e.getElementsByTagName("updated")[0].textContent!;
      expect(Number.isNaN(new Date(updated).getTime())).toBe(false);
      const related = [...e.getElementsByTagName("link")].find(
        (l) => l.getAttribute("rel") === "related",
      )!;
      expect(related.getAttribute("href")).toMatch(/\/fact\/[0-9a-f]{8}$/);
    }
  });
});
