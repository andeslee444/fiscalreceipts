/**
 * feed-model.mjs — the /feed/ syndication model (PM-review Sprint 3 Task 2, §P1-8).
 *
 * "The site that tells you when a program's budget moves, with the receipt
 * attached." §P1-8 called the missing feed the highest-ROI item in the spec:
 * `/rss.xml` and `/feed.xml` both 404'd, and the on-page items reported
 * percentages with no magnitude ("increased 79%" — 79% of WHAT).
 *
 * WHY THIS FILE IS .mjs AND LIVES IN src/lib.
 * Two consumers must agree exactly and neither can be the other's source:
 *   1. scripts/generate-feeds.mjs — a prebuild Node script that writes the
 *      real XML files into public/ (static export: there is no server, and
 *      the llms.txt generator already establishes this pattern).
 *   2. the Next pages — which render <link rel="alternate"> discovery for
 *      exactly the feeds that were generated.
 * A plain-ESM module is importable by both, so the URL rules and the item
 * model exist ONCE. Two implementations of "which feeds exist" would drift
 * into advertising feeds that 404 — the dead-link class gate 13 exists for.
 *
 * NOTHING HERE TOUCHES THE FILESYSTEM. Callers pass data in; this module is
 * pure so vitest can pin every rule.
 */

// ── Namespace for the machine-readable magnitude block ──────────────────────
// Fixed and origin-independent: the namespace URI is an identifier, never a
// fetchable location, so it must NOT vary with NEXT_PUBLIC_SITE_URL.
export const FR_NS = "https://fiscalreceipts.com/ns/feed/1";
export const ATOM_NS = "http://www.w3.org/2005/Atom";

/** Feed formats we emit for every feed target. */
export const FEED_FORMATS = /** @type {const} */ (["rss", "atom"]);

// ── XML escaping ────────────────────────────────────────────────────────────

/**
 * Escape text for an XML text node or attribute value.
 *
 * Program titles in this corpus really do contain `&` ("Strategic Sub &
 * Weapons System Support"), `<`, and the em dash the headline templates use.
 * `&` MUST be replaced first or the replacement's own ampersands get
 * double-escaped.
 *
 * Control characters that XML 1.0 forbids outright (anything below 0x20 that
 * is not tab/LF/CR) are dropped rather than escaped — there is no legal
 * encoding for them, and a single stray byte would make the whole document
 * unparseable for every subscriber.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function escapeXml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Money formatting ────────────────────────────────────────────────────────

/**
 * Card magnitude units → the site's AmountUnits vocabulary.
 * @param {string} units
 * @returns {"USD thousands" | "USD"}
 */
export function siteUnits(units) {
  if (units === "thousands_usd") return "USD thousands";
  if (units === "dollars") return "USD";
  throw new Error(`feed-model: unknown magnitude units ${JSON.stringify(units)}`);
}

const COMPACT_RUNGS = [
  { limit: 1e12, suffix: "T" },
  { limit: 1e9, suffix: "B" },
  { limit: 1e6, suffix: "M" },
  { limit: 1e3, suffix: "K" },
];

/**
 * The compact money ladder — an EXPLICIT MIRROR of formatAmount() in
 * site/src/lib/format.ts (whose docblock lists its mirrors; this is one of
 * them). It is mirrored rather than imported because generate-feeds.mjs runs
 * under plain Node, which cannot import TypeScript.
 *
 * Parity is not left to discipline: __tests__/feed-model.test.ts asserts this
 * function equals formatAmount() across a wide value sweep, so a change to
 * one that is not made to the other fails the suite.
 *
 * @param {number} value
 * @param {string} units — card units ("thousands_usd" | "dollars")
 * @returns {string}
 */
export function formatCompactUsd(value, units) {
  const scale = siteUnits(units) === "USD thousands" ? 1000 : 1;
  const rawUsd = value * scale;
  const abs = Math.abs(rawUsd);
  const sign = rawUsd < 0 ? "-" : "";
  for (let i = 0; i < COMPACT_RUNGS.length; i++) {
    const { limit, suffix } = COMPACT_RUNGS[i];
    if (abs < limit) continue;
    const v = abs / limit;
    const dec = v < 10 ? 2 : 1;
    if (i > 0 && Number(v.toFixed(dec)) >= 1000) {
      const up = COMPACT_RUNGS[i - 1];
      const uv = abs / up.limit;
      return `${sign}$${uv.toFixed(uv < 10 ? 2 : 1)}${up.suffix}`;
    }
    return `${sign}$${v.toFixed(dec)}${suffix}`;
  }
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

/** Signed display for a delta ("+$46.7M" / "-$1.20B"). */
export function formatSignedUsd(value, units) {
  const body = formatCompactUsd(Math.abs(value), units);
  return `${value < 0 ? "−" : "+"}${body}`;
}

/**
 * The sentence §P1-8 asked for: `FY2025 $59.3M → FY2026 $106.0M (+$46.7M, +79%)`.
 *
 * A single-magnitude event (an award total, an HHI's matched dollars) has no
 * second endpoint, so it states the one figure it has rather than inventing a
 * base — the alternative is exactly the "percent with no denominator" defect
 * in reverse.
 *
 * @param {any} magnitude
 * @returns {string}
 */
export function magnitudeText(magnitude) {
  if (!magnitude || !magnitude.to) return "";
  const u = magnitude.units;
  const to = `${magnitude.to.label} ${formatCompactUsd(magnitude.to.value, u)}`;
  if (magnitude.kind !== "pair" || !magnitude.from) return to;
  const from = `${magnitude.from.label} ${formatCompactUsd(magnitude.from.value, u)}`;
  const parts = [];
  if (magnitude.delta) parts.push(formatSignedUsd(magnitude.delta.value, u));
  if (typeof magnitude.pct_change === "number" && Number.isFinite(magnitude.pct_change)) {
    parts.push(`${magnitude.pct_change >= 0 ? "+" : "−"}${Math.abs(magnitude.pct_change).toFixed(0)}%`);
  }
  const tail = parts.length ? ` (${parts.join(", ")})` : "";
  return `${from} → ${to}${tail}`;
}

/** Every point of a magnitude, in reading order, skipping absent ones. */
export function magnitudePoints(magnitude) {
  if (!magnitude) return [];
  return [
    ["from", magnitude.from],
    ["to", magnitude.to],
    ["delta", magnitude.delta],
  ]
    .filter(([, p]) => p && p.value !== null && p.value !== undefined)
    .map(([role, p]) => ({ role, ...p }));
}

// ── Identity ────────────────────────────────────────────────────────────────

/** The 8-hex public id used by /fact/{id} permalinks (Cite's chip copies the same). */
export function publicFactId(factId) {
  return typeof factId === "string" ? factId.slice(0, 8) : null;
}

export function factPermalink(siteUrl, factId) {
  const id = publicFactId(factId);
  return id ? `${trimSlash(siteUrl)}/fact/${id}` : null;
}

/**
 * A guid that is STABLE across rebuilds and UNIQUE across the corpus.
 *
 * Stability matters more than prettiness: a guid that churns re-notifies every
 * subscriber of every item on every build. So it is built from the event's
 * IDENTITY (what the mart's grain actually is) and never from ordering, index,
 * or the value — which is also why a changed dollar figure does NOT mint a new
 * guid: it is the same claim about the same program, updated.
 *
 * Grains, and the components that make each one unique:
 *   yoy_swing            (pe_bli, organization)      — org included
 *   zeroed_fy2026        (pe_bli, organization)      — org included
 *   concentration_shift  (pe_bli, fiscal_year)
 *   new_entrant          (family_key)
 *   request_vs_actuals_gap (pe_bli, from_fy, to_edition)
 * Callers must still verify uniqueness — buildFeedTargets() throws on a
 * collision rather than silently dropping an item.
 */
export function feedGuid(card) {
  const entity = card.pe_bli ?? card.family_key ?? "unknown";
  const org = card.organization ? `/${card.organization}` : "";
  const fy = card.fiscal_year ?? "na";
  const edition = card.edition ?? "na";
  return `urn:fiscalreceipts:feed:${card.event_type}:${entity}${org}:${fy}:${edition}`;
}

function trimSlash(u) {
  return String(u).replace(/\/$/, "");
}

// ── Feed paths ──────────────────────────────────────────────────────────────
//
// Real files in the static export. `/rss.xml` is the canonical whole feed;
// `/feed.xml` is an alias because both were reported as 404 in §P1-8 and
// readers guess either.

export const WHOLE_FEED_RSS = "/rss.xml";
export const WHOLE_FEED_RSS_ALIAS = "/feed.xml";
export const WHOLE_FEED_ATOM = "/atom.xml";

/** @param {string} eventType */
export function eventTypeFeedPaths(eventType) {
  return {
    rss: `/feeds/${eventType}.xml`,
    atom: `/feeds/${eventType}.atom.xml`,
  };
}

/** @param {string} peBli */
export function programFeedPaths(peBli) {
  return {
    rss: `/feeds/program/${peBli}.xml`,
    atom: `/feeds/program/${peBli}.atom.xml`,
  };
}

/** @param {string} slug */
export function companyFeedPaths(slug) {
  return {
    rss: `/feeds/company/${slug}.xml`,
    atom: `/feeds/company/${slug}.atom.xml`,
  };
}

// ── Membership rules ────────────────────────────────────────────────────────
//
// These decide WHICH watch feeds exist. buildFeedTargets() calls them to
// decide what to write; the Next pages call the same functions to decide
// whether to render a <link rel="alternate"> — so a page cannot advertise a
// feed the build did not write, and a written feed is never unreachable.

/**
 * A program element gets a watch feed iff it has at least one event AND a
 * built /program/{pe}/ page (the G1 dead-link contract: a feed whose items
 * point at a 404 is worse than no feed).
 *
 * @param {string|null|undefined} peBli
 * @param {Array<{pe_bli?: string|null}>} cards
 * @param {Set<string>} programPages
 */
export function hasProgramFeed(peBli, cards, programPages) {
  if (!peBli || !programPages.has(peBli)) return false;
  return cards.some((c) => c.pe_bli === peBli);
}

/**
 * One card belongs on a company's watchlist iff it is about a program element
 * that company's page links to, or it names the company family itself.
 *
 * @param {{pe_bli?: string|null, family_key?: string|null}} card
 * @param {{peBlis: Set<string>|string[], familyKey?: string|null}} watch
 */
export function cardMatchesWatch(card, watch) {
  const peSet = watch.peBlis instanceof Set ? watch.peBlis : new Set(watch.peBlis);
  if (card.pe_bli && peSet.has(card.pe_bli)) return true;
  return Boolean(watch.familyKey && card.family_key === watch.familyKey);
}

/** @param {Array<any>} cards @param {{peBlis: Set<string>|string[], familyKey?: string|null}} watch */
export function hasCompanyFeed(cards, watch) {
  return cards.some((c) => cardMatchesWatch(c, watch));
}

/**
 * The program elements a company's watchlist covers: exactly the two link
 * types its /company/{slug}/ page already renders —
 *   • high-confidence budget-to-award crosswalk rows (a contract), and
 *   • lobbying-filing mentions (a filing that named the program).
 * They are counted separately because they are not equally strong evidence,
 * and the feed description states both counts. Neither is a claim that the
 * company holds the program's budget.
 *
 * @param {{awards?: Array<{pe_bli?: string|null, confidence?: string}>,
 *          linked_programs?: Array<{pe_bli?: string|null}>}} details
 * @returns {{peBlis: Set<string>, awardLinked: number, mentionLinked: number}}
 */
export function companyWatchPeBlis(details) {
  const award = new Set(
    (details?.awards ?? [])
      .filter((a) => a.confidence === "high" && a.pe_bli)
      .map((a) => a.pe_bli),
  );
  const mention = new Set(
    (details?.linked_programs ?? []).map((p) => p.pe_bli).filter(Boolean),
  );
  return {
    peBlis: new Set([...award, ...mention]),
    awardLinked: award.size,
    mentionLinked: mention.size,
  };
}

// ── Items ───────────────────────────────────────────────────────────────────

/**
 * Where the item points a human. Program/company pages only when the page
 * EXISTS in the export — the G1 dead-link contract applies to feeds too, and
 * a feed reader following a 404 is worse than one following a section anchor.
 */
function itemLink(card, siteUrl, { programPages, companySlugByFamilyKey }) {
  const base = trimSlash(siteUrl);
  if (card.pe_bli && programPages.has(card.pe_bli)) {
    return `${base}/program/${card.pe_bli}/`;
  }
  if (card.family_key) {
    const slug = companySlugByFamilyKey.get(card.family_key);
    if (slug) return `${base}/company/${slug}/`;
  }
  return `${base}/feed/#feed-${card.event_type}`;
}

/**
 * Normalize one card into everything both renderers need.
 *
 * @param {any} card
 * @param {{siteUrl: string, pubDate: string, programPages: Set<string>, companySlugByFamilyKey: Map<string,string>}} ctx
 */
export function buildItem(card, ctx) {
  const base = trimSlash(ctx.siteUrl);
  const mag = card.magnitude ?? null;
  const magText = magnitudeText(mag);
  // The on-page claim travels VERBATIM (gate 24 leg h verifies that sentence
  // against budget_lines.parquet, so the two surfaces cannot tell different
  // stories), with the dollars appended where the headline states only a
  // percentage or an index.
  const needsMagnitudeInTitle =
    card.event_type === "yoy_swing" ||
    card.event_type === "zeroed_fy2026" ||
    card.event_type === "concentration_shift" ||
    card.event_type === "request_vs_actuals_gap";
  const title = magText && needsMagnitudeInTitle
    ? `${card.headline} — ${magText}`
    : card.headline;
  const receiptUrl = factPermalink(base, card.figure_fact_id);
  const link = itemLink(card, base, ctx);
  const whyUrl = `${base}${card.why_url}`;

  const descParts = [`<p>${escapeXml(card.headline)}</p>`];
  if (magText) descParts.push(`<p>${escapeXml(magText)}</p>`);
  if (card.basis) {
    descParts.push(
      `<p>Basis: ${escapeXml(card.basis)}${card.edition ? ` (PB${card.edition})` : ""}` +
        `${card.measure ? `, ${escapeXml(card.measure)}` : ""}.</p>`,
    );
  }
  const receiptBits = [];
  if (receiptUrl) {
    receiptBits.push(
      `<a href="${escapeXml(receiptUrl)}">Receipt: fact ${escapeXml(publicFactId(card.figure_fact_id))}</a>`,
    );
  }
  for (const p of magnitudePoints(mag)) {
    const href = factPermalink(base, p.fact_id);
    if (!href) continue;
    receiptBits.push(
      `<a href="${escapeXml(href)}">${escapeXml(p.label)}: ${escapeXml(formatCompactUsd(p.value, mag.units))}</a>`,
    );
  }
  receiptBits.push(`<a href="${escapeXml(whyUrl)}">Why flagged?</a>`);
  descParts.push(`<p>${receiptBits.join(" &middot; ")}</p>`);

  return {
    guid: feedGuid(card),
    title,
    link,
    receiptUrl,
    whyUrl,
    category: card.event_type,
    pubDate: ctx.pubDate,
    description: descParts.join(""),
    magnitude: mag,
    magnitudeText: magText,
    card,
  };
}

// ── Feed targets ────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  yoy_swing: "Year-over-year swings",
  zeroed_fy2026: "Zeroed in FY2026",
  concentration_shift: "Award concentration shifts",
  new_entrant: "New defense contractors",
  request_vs_actuals_gap: "Request-vs-actuals gaps",
};

/**
 * Reading order — the SAME order /feed/ renders its sections in (see
 * app/feed/page.tsx EVENT_ORDER). A subscriber's first screen should hold
 * what the page's first screen holds: the budget swings, not whichever event
 * class the mart's `order by event_type` happened to sort first.
 * Within a type the mart's order is preserved (request_vs_actuals_gap is
 * already ranked by absolute dollar gap).
 */
export const EVENT_ORDER = [
  "yoy_swing",
  "zeroed_fy2026",
  "request_vs_actuals_gap",
  "concentration_shift",
  "new_entrant",
];

function eventRank(eventType) {
  const i = EVENT_ORDER.indexOf(eventType);
  return i === -1 ? EVENT_ORDER.length : i;
}

/**
 * Every feed file the build emits, with its items already normalized.
 *
 * @param {{
 *   cards: any[],
 *   siteUrl: string,
 *   pubDate: string,
 *   siteName?: string,
 *   programPages: Set<string>,
 *   programTitles?: Map<string,string>,
 *   companySlugByFamilyKey: Map<string,string>,
 *   companyWatch?: Array<{slug: string, displayName: string, peBlis: Set<string>|string[], familyKey?: string}>,
 * }} input
 */
export function buildFeedTargets(input) {
  const {
    cards,
    siteUrl,
    pubDate,
    siteName = "Fiscal Receipts",
    programPages,
    programTitles = new Map(),
    companySlugByFamilyKey,
    companyWatch = [],
  } = input;
  const base = trimSlash(siteUrl);
  const ctx = { siteUrl: base, pubDate, programPages, companySlugByFamilyKey };

  // Array.prototype.sort is stable (spec since ES2019), so within an event
  // type the exporter's ranking survives untouched.
  const items = cards
    .map((c) => buildItem(c, ctx))
    .sort((a, b) => eventRank(a.category) - eventRank(b.category));

  // Uniqueness is a CONTRACT, not a hope: a duplicate guid makes a reader
  // silently drop one of two real events. Fail the build instead.
  const seen = new Map();
  for (const it of items) {
    if (seen.has(it.guid)) {
      throw new Error(
        `feed-model: duplicate guid ${it.guid} — ` +
          `"${seen.get(it.guid)}" and "${it.title}" would collide in every reader`,
      );
    }
    seen.set(it.guid, it.title);
  }

  const targets = [];
  const whole = {
    id: "all",
    kind: "all",
    key: "all",
    title: `${siteName} — budget anomaly feed`,
    description:
      `Every automated signal from the ${siteName} corpus: year-over-year ` +
      `swings, award concentration shifts, request-vs-actuals gaps, and new ` +
      `contractors. Each item states the dollars it is about and links to the ` +
      `receipt for every figure.`,
    htmlUrl: `${base}/feed/`,
    rssPath: WHOLE_FEED_RSS,
    atomPath: WHOLE_FEED_ATOM,
    aliasPaths: [WHOLE_FEED_RSS_ALIAS],
    items,
  };
  targets.push(whole);

  // ── per event type ────────────────────────────────────────────────────
  const byType = new Map();
  for (const it of items) {
    if (!byType.has(it.category)) byType.set(it.category, []);
    byType.get(it.category).push(it);
  }
  for (const [eventType, typeItems] of [...byType.entries()].sort()) {
    const paths = eventTypeFeedPaths(eventType);
    targets.push({
      id: `event:${eventType}`,
      kind: "event_type",
      key: eventType,
      title: `${siteName} — ${EVENT_LABEL[eventType] ?? eventType}`,
      description:
        `${EVENT_LABEL[eventType] ?? eventType} detected in the ${siteName} ` +
        `corpus, each with its dollar magnitude and a link to the receipt.`,
      htmlUrl: `${base}/feed/#feed-${eventType}`,
      rssPath: paths.rss,
      atomPath: paths.atom,
      aliasPaths: [],
      items: typeItems,
    });
  }

  // ── per program (watch feed) ──────────────────────────────────────────
  // hasProgramFeed() is the SINGLE membership rule; the Next program page
  // calls the same function to decide whether to advertise the feed, so a
  // page can never link to a feed the build did not write.
  const byProgram = new Map();
  for (const it of items) {
    const pe = it.card.pe_bli;
    if (!hasProgramFeed(pe, [it.card], programPages)) continue;
    if (!byProgram.has(pe)) byProgram.set(pe, []);
    byProgram.get(pe).push(it);
  }
  for (const [pe, peItems] of [...byProgram.entries()].sort()) {
    const paths = programFeedPaths(pe);
    const title = programTitles.get(pe) || peItems[0].card.title || pe;
    targets.push({
      id: `program:${pe}`,
      kind: "program",
      key: pe,
      title: `${siteName} — ${title} (${pe})`,
      description:
        `Budget and award signals for program element ${pe} (${title}), ` +
        `each with its dollar magnitude and a link to the receipt.`,
      htmlUrl: `${base}/program/${pe}/`,
      rssPath: paths.rss,
      atomPath: paths.atom,
      aliasPaths: [],
      items: peItems,
    });
  }

  // ── per company (watch feed) ──────────────────────────────────────────
  // A company watch feed is the events for the program elements THE COMPANY
  // PAGE ALREADY LINKS TO — high-confidence budget-to-award crosswalk rows
  // and lobbying-filing mentions, the two connection types that page renders
  // — plus any event naming the company family itself. The description names
  // both bases and their counts, because they are not equally strong: an
  // award link is a contract, a lobbying mention is a filing that named the
  // program. Neither is a claim that the company holds the program's budget.
  for (const w of companyWatch) {
    const peSet = w.peBlis instanceof Set ? w.peBlis : new Set(w.peBlis);
    // Same single rule the company page calls to decide whether to advertise.
    const watchItems = items.filter((it) => cardMatchesWatch(it.card, w));
    if (watchItems.length === 0) continue;
    const paths = companyFeedPaths(w.slug);
    targets.push({
      id: `company:${w.slug}`,
      kind: "company",
      key: w.slug,
      title: `${siteName} — ${w.displayName} watchlist`,
      description:
        `Budget and award signals for the ${peSet.size} program element(s) ` +
        `linked to ${w.displayName} on its ${siteName} page` +
        (w.awardLinked != null && w.mentionLinked != null
          ? ` (${w.awardLinked} by high-confidence budget-to-award crosswalk, ` +
            `${w.mentionLinked} by lobbying-filing mention)`
          : "") +
        `, plus any signal naming the company family itself. A link is a ` +
        `documented connection, not a claim that the company holds the ` +
        `program's budget.`,
      htmlUrl: `${base}/company/${w.slug}/`,
      rssPath: paths.rss,
      atomPath: paths.atom,
      aliasPaths: [],
      items: watchItems,
    });
  }

  return targets;
}

// ── Renderers ───────────────────────────────────────────────────────────────

function magnitudeXml(magnitude, siteUrl, indent) {
  if (!magnitude) return "";
  const pts = magnitudePoints(magnitude);
  if (pts.length === 0) return "";
  const lines = [
    `${indent}<fr:magnitude kind="${escapeXml(magnitude.kind)}" units="${escapeXml(magnitude.units)}">`,
  ];
  for (const p of pts) {
    const attrs = [
      `role="${escapeXml(p.role)}"`,
      `label="${escapeXml(p.label)}"`,
      p.fy != null ? `fy="${escapeXml(String(p.fy))}"` : null,
      `value="${escapeXml(String(p.value))}"`,
      `display="${escapeXml(formatCompactUsd(p.value, magnitude.units))}"`,
      p.fact_id ? `fact="${escapeXml(p.fact_id)}"` : null,
      p.fact_id ? `href="${escapeXml(factPermalink(siteUrl, p.fact_id))}"` : null,
    ].filter(Boolean);
    lines.push(`${indent}  <fr:point ${attrs.join(" ")}/>`);
  }
  lines.push(`${indent}</fr:magnitude>`);
  return lines.join("\n") + "\n";
}

/**
 * RSS 2.0. `atom:link rel="self"` is required for well-behaved aggregators;
 * `atom:link rel="related"` carries the /fact/{id} receipt permalink, which
 * plain RSS has no element for.
 */
export function renderRss(target, siteUrl) {
  const base = trimSlash(siteUrl);
  const selfUrl = `${base}${target.rssPath}`;
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<rss version="2.0" xmlns:atom="${ATOM_NS}" xmlns:fr="${FR_NS}">`,
  );
  out.push("  <channel>");
  out.push(`    <title>${escapeXml(target.title)}</title>`);
  out.push(`    <link>${escapeXml(target.htmlUrl)}</link>`);
  out.push(`    <description>${escapeXml(target.description)}</description>`);
  out.push("    <language>en-us</language>");
  out.push(`    <lastBuildDate>${escapeXml(toRfc822(target.items[0]?.pubDate))}</lastBuildDate>`);
  out.push(`    <generator>${escapeXml("Fiscal Receipts export-site")}</generator>`);
  out.push(
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>`,
  );
  for (const it of target.items) {
    out.push("    <item>");
    out.push(`      <title>${escapeXml(it.title)}</title>`);
    out.push(`      <link>${escapeXml(it.link)}</link>`);
    out.push(`      <guid isPermaLink="false">${escapeXml(it.guid)}</guid>`);
    out.push(`      <pubDate>${escapeXml(toRfc822(it.pubDate))}</pubDate>`);
    out.push(`      <category>${escapeXml(it.category)}</category>`);
    out.push(`      <description>${escapeXml(it.description)}</description>`);
    if (it.receiptUrl) {
      out.push(
        `      <atom:link rel="related" type="text/html" href="${escapeXml(it.receiptUrl)}"/>`,
      );
    }
    const mx = magnitudeXml(it.magnitude, base, "      ");
    if (mx) out.push(mx.trimEnd());
    out.push("    </item>");
  }
  out.push("  </channel>");
  out.push("</rss>");
  return out.join("\n") + "\n";
}

/** Atom 1.0. */
export function renderAtom(target, siteUrl) {
  const base = trimSlash(siteUrl);
  const selfUrl = `${base}${target.atomPath}`;
  const updated = toIso(target.items[0]?.pubDate);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<feed xmlns="${ATOM_NS}" xmlns:fr="${FR_NS}" xml:lang="en-us">`);
  out.push(`  <title>${escapeXml(target.title)}</title>`);
  out.push(`  <subtitle>${escapeXml(target.description)}</subtitle>`);
  out.push(`  <id>${escapeXml(selfUrl)}</id>`);
  out.push(`  <updated>${escapeXml(updated)}</updated>`);
  out.push(`  <link rel="self" type="application/atom+xml" href="${escapeXml(selfUrl)}"/>`);
  out.push(`  <link rel="alternate" type="text/html" href="${escapeXml(target.htmlUrl)}"/>`);
  for (const it of target.items) {
    out.push("  <entry>");
    out.push(`    <title>${escapeXml(it.title)}</title>`);
    out.push(`    <id>${escapeXml(it.guid)}</id>`);
    out.push(`    <updated>${escapeXml(toIso(it.pubDate))}</updated>`);
    out.push(`    <link rel="alternate" type="text/html" href="${escapeXml(it.link)}"/>`);
    if (it.receiptUrl) {
      out.push(
        `    <link rel="related" type="text/html" href="${escapeXml(it.receiptUrl)}"/>`,
      );
    }
    out.push(`    <category term="${escapeXml(it.category)}"/>`);
    out.push(`    <content type="html">${escapeXml(it.description)}</content>`);
    const mx = magnitudeXml(it.magnitude, base, "    ");
    if (mx) out.push(mx.trimEnd());
    out.push("  </entry>");
  }
  out.push("</feed>");
  return out.join("\n") + "\n";
}

/**
 * RFC-822 date for RSS <pubDate>.
 *
 * The corpus carries NO per-event timestamp — an anomaly is a property of a
 * budget edition, not an event with a clock. The honest date is the moment
 * the claim entered the corpus: site_meta.built_at, the export timestamp.
 * It is deliberately NOT the `next build` time, so re-rendering the site
 * without re-exporting does not re-date every item.
 */
export function toRfc822(iso) {
  const d = iso ? new Date(iso) : new Date(0);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`feed-model: unparseable pubDate ${JSON.stringify(iso)}`);
  }
  return d.toUTCString();
}

export function toIso(iso) {
  const d = iso ? new Date(iso) : new Date(0);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`feed-model: unparseable date ${JSON.stringify(iso)}`);
  }
  return d.toISOString();
}
