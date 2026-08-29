/**
 * gate — feed_gate
 *
 * Checks the built out/feed/index.html for:
 * (a) >= 30 feed card items present
 * (b) >= 3 distinct event types (section ids starting with "feed-")
 * (c) all dollar figures wrapped in [data-amount] (no bare currency text —
 *     enforced by render-static; this gate checks [data-amount] presence)
 * (d) "why?" links present (href containing "#feed-")
 * (e) junk PE/BLI sentinel "9999999999" absent from page content
 *
 * PM-review Sprint 3 Task 2 (§P1-8) added the SYNDICATION legs. "A page
 * called Feed has no subscription. /rss.xml → 404, /feed.xml → 404." The
 * feeds are now real files written at build time, and a feed is a published
 * claim in an envelope we cannot recall once a reader has it — so:
 *
 * (f) EVERY FEED FILE EXISTS AND IS WELL-FORMED XML. Parsed with a real XML
 *     parser (jsdom, which throws on malformed input), never matched with a
 *     regex: the failure this guards is a title containing `&` or `<`
 *     silently producing a document no aggregator can read.
 * (g) ITEM COUNT == CARD COUNT. The whole feed carries exactly the cards
 *     feed.json holds, and the per-event-type feeds partition them. A feed
 *     that silently drops items is worse than one that does not exist.
 * (h) EVERY ITEM CARRIES ITS DOLLARS AND ITS RECEIPT. A machine-readable
 *     magnitude block with at least one endpoint, a /fact/{id} permalink
 *     resolving to a real citation, a real pubDate. (The VALUES behind those
 *     magnitudes are checked against the corpus by gate 24 leg i — this leg
 *     is structure, that leg is truth.)
 * (i) GUIDS ARE UNIQUE AND STABLE. Unique within every feed, and each one
 *     reproducible from its card by feedGuid() — i.e. derived from the
 *     event's identity, never from position, so a rebuild does not
 *     re-notify every subscriber of every item.
 * (j) DISCOVERY LINKS RESOLVE. Every <link rel="alternate"
 *     type="application/rss+xml|atom+xml"> on the built pages points at a
 *     file that exists. Autodiscovery pointing at a 404 is the §P1-8 defect
 *     restated.
 * (k) COMPANY-FEED ITEMS STATE THEIR LINKAGE BASIS. A company watch feed
 *     covers the program elements that company's page links to — 4 by
 *     high-confidence award crosswalk and 147 by lobbying-filing mention, for
 *     Lockheed. The CHANNEL states that split, but an item is read detached
 *     from its channel: aggregated into a reader's river, forwarded, quoted
 *     alone. "Combating Terrorism Technology Support decreased 59%" under a
 *     Lockheed feed, with no linkage stated, reads as if Lockheed holds that
 *     program — and ~97% of the items a subscriber sees rest on the weaker
 *     basis. So this leg asserts every company-feed item carries an
 *     fr:linkage block naming the company and ≥1 basis, that each basis is
 *     one the COMPANY PAGE ACTUALLY ASSERTS for that PE (recomputed from the
 *     entity_details sidecar the page renders from), and that program feeds
 *     do NOT carry the block — a program element's own feed has no ambiguous
 *     linkage, and labelling there would train readers to skip the label
 *     where it matters.
 * (l) A CONCENTRATION CLAIM MUST NOT CONTRADICT THE PAGE IT LINKS TO
 *     (backlog #57). The first leg in this suite that checks a claim
 *     against the DESTINATION page it points at, rather than against its
 *     own source. Every hhi-unit feed card headlines one (pe_bli,
 *     fiscal_year)'s HHI; its "view program" link goes to /program/{pe}/,
 *     which renders a DIFFERENT, pooled all-years HHI
 *     (fct_program_concentration). Both are real numbers computed by
 *     different, legitimate queries — a single concentrated year sitting
 *     next to a competitive pooled figure is not itself a defect (measured
 *     on the shipped corpus, 70 of 84 cards land in a different DOJ/FTC
 *     band than their destination; requiring literal band equality would
 *     be the wrong tool and would flag nearly the whole event type). What
 *     IS a defect: a band mismatch with NOTHING on the card telling the
 *     reader the two figures are different measures — that is what reads
 *     as the site contradicting itself the moment someone clicks through.
 *     So this leg computes the band implied by each card's OWN rendered
 *     figure and the band the destination page ACTUALLY renders (its own
 *     [data-hhi-band], not a JSON recompute — a template regression that
 *     stopped rendering the badge fails this too), and where they diverge,
 *     requires the card to carry an explicit [data-hhi-scope-note]
 *     disclosure (checked by content, not just presence). See hhi-band.mjs
 *     for the shared band function both card and destination render with.
 * (n) A RANKED LIST IS RANKED BY SOMETHING THAT MATTERS (tri-persona Wave 3).
 *     /feed/ opened on a $46.7M change at the head of a section holding
 *     changes seventy times larger, because the mart's order was
 *     `event_type, pe_bli` and `0101213F` sorts first. Each section's cards
 *     must run in non-increasing order of the DOLLARS THE CARD ITSELF
 *     PRINTS — read off the rendered magnitude line, not recomputed from
 *     feed.json — see leg (n)'s own block at the bottom.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";
import { JSDOM } from "jsdom";
import { companyDisplay } from "../../src/lib/company-name.mjs";
import { hhiBand } from "../../src/lib/hhi-band.mjs";
import {
  FR_NS,
  feedGuid,
  buildFeedTargets,
  companyWatchPeBlis,
  linkageBases,
} from "../../src/lib/feed-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

export async function runFeedGate() {
  const errors = [];
  const notes = [];

  const feedPath = path.join(outDir, "feed", "index.html");

  // Gracefully handle missing out/ (pre-build)
  if (!fs.existsSync(feedPath)) {
    notes.push("feed/index.html not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  let html;
  try {
    html = fs.readFileSync(feedPath, "utf8");
  } catch (e) {
    errors.push(`failed to read feed/index.html: ${e.message}`);
    return { pass: false, errors, notes };
  }

  let root;
  try {
    root = parse(html, { comment: false });
  } catch (e) {
    errors.push(`failed to parse feed/index.html: ${e.message}`);
    return { pass: false, errors, notes };
  }

  // ── (a) Feed card count ─────────────────────────────────────────────────────
  // Contract: FeedCardItem root carries data-feed-card="". Gate selects by
  // that attribute so class changes in the component never break this selector.
  const sections = root.querySelectorAll("section[id]").filter(
    (el) => (el.getAttribute("id") ?? "").startsWith("feed-")
  );

  let totalCards = 0;
  for (const section of sections) {
    const cards = section.querySelectorAll("[data-feed-card]");
    totalCards += cards.length;
  }

  const MIN_CARDS = 30;
  if (totalCards < MIN_CARDS) {
    errors.push(
      `feed card count: found ${totalCards}, expected >= ${MIN_CARDS}`
    );
  } else {
    notes.push(`feed cards: ${totalCards} >= ${MIN_CARDS} ✓`);
  }

  // ── (b) Distinct event types ────────────────────────────────────────────────
  const MIN_EVENT_TYPES = 3;
  const sectionIds = sections.map((el) => el.getAttribute("id") ?? "");
  if (sections.length < MIN_EVENT_TYPES) {
    errors.push(
      `feed event types: found ${sections.length} sections with id="feed-*", expected >= ${MIN_EVENT_TYPES}`
    );
  } else {
    notes.push(`feed event types: ${sections.length} (${sectionIds.join(", ")}) ✓`);
  }

  // ── (c) [data-amount] presence ──────────────────────────────────────────────
  const amountEls = root.querySelectorAll("[data-amount]");
  if (amountEls.length === 0) {
    errors.push("feed: no [data-amount] elements found — figures may be missing Cite wrappers");
  } else {
    notes.push(`feed [data-amount]: ${amountEls.length} elements ✓`);
  }

  // ── (d) "why?" links ────────────────────────────────────────────────────────
  const whyLinks = root.querySelectorAll("a[href]").filter((el) => {
    const href = el.getAttribute("href") ?? "";
    return href.includes("#feed-");
  });
  if (whyLinks.length === 0) {
    errors.push('feed: no "why?" links found (expected anchors with href containing "#feed-")');
  } else {
    notes.push(`feed why? links: ${whyLinks.length} ✓`);
  }

  // ── (e) Junk sentinel absent ────────────────────────────────────────────────
  // Check for the junk PE/BLI "9999999999" as a 10-digit program code in
  // rendered text content, not in React server payload JSON (which may contain
  // this sequence as a floating-point value like "9999.99999999999").
  // We parse the DOM and look in text nodes only (skipping script/style).
  const junkInText = root.querySelectorAll("*").some((el) => {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return false;
    // Check direct text children only
    for (const child of el.childNodes || []) {
      if (child.nodeType === 3) {
        const text = child.rawText || "";
        // Match the 10-digit sentinel as a standalone pe_bli string
        if (/\b9999999999\b/.test(text)) return true;
      }
    }
    return false;
  });
  if (junkInText) {
    errors.push('feed: sentinel PE/BLI "9999999999" found in rendered text — junk data leaking');
  } else {
    notes.push('feed: junk sentinel "9999999999" absent from rendered text ✓');
  }

  // ── (l) a concentration claim must not contradict its destination ─────────
  runHhiDestinationLeg(errors, notes, root);

  // ── (n) the reader meets the biggest signal first ─────────────────────────
  runMagnitudeOrderLeg(errors, notes, sections);

  // ── (f)-(j) Syndication (PM-review Sprint 3 Task 2, §P1-8) ──────────────────
  runSyndicationLegs(errors, notes);

  return { pass: errors.length === 0, errors, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// leg (l) — HHI claim vs. destination (backlog #57)
// ═══════════════════════════════════════════════════════════════════════════

/** Non-vacuity floor: the shipped corpus holds exactly 84 hhi feed cards. */
const MIN_HHI_CARDS = 84;

/**
 * leg l — see this file's top doc-comment for the full rationale. Reads
 * ONLY rendered HTML: the card's own figure text (ground truth for "the
 * band implied by the card's claim"), the destination page's own
 * [data-hhi-band] badge, and — where the two disagree — the card's own
 * [data-hhi-scope-note] disclosure text. Nothing here recomputes from
 * feed.json/programs.json; a template regression that stopped rendering
 * either attribute fails this leg exactly as a wrong number would.
 */
function runHhiDestinationLeg(errors, notes, root) {
  const cards = root.querySelectorAll("[data-feed-card]").filter((el) => {
    const fig = el.querySelector('[data-primary-value="feed-figure"]');
    return Boolean(fig && /\bHHI\s+-?[\d,.]/.test(fig.text || ""));
  });

  if (cards.length < MIN_HHI_CARDS) {
    errors.push(
      `feed leg l: resolved only ${cards.length} hhi card(s) on /feed/ ` +
        `(expected >= ${MIN_HHI_CARDS}) — the leg would be vacuous`,
    );
    return;
  }

  let checked = 0;
  let agree = 0;
  let disclosedDivergence = 0;
  const destBandCache = new Map(); // pe_bli -> band label | null | "missing"

  for (const el of cards) {
    const fig = el.querySelector('[data-primary-value="feed-figure"]');
    const figMatch = (fig.text || "").match(/\bHHI\s+(-?[\d,.]+)/);
    if (!figMatch) {
      errors.push(
        `feed leg l: could not parse an HHI value out of ${JSON.stringify(fig.text)}`,
      );
      continue;
    }
    const cardValue = Number(figMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(cardValue)) {
      errors.push(`feed leg l: unparseable HHI value ${JSON.stringify(figMatch[1])}`);
      continue;
    }
    const cardBand = hhiBand(cardValue).label;

    const link = el
      .querySelectorAll("a[href]")
      .find((a) => /^\/program\/[^/]+\/$/.test(a.getAttribute("href") ?? ""));
    if (!link) {
      errors.push(
        `feed leg l: hhi card (HHI ${cardValue}) links to no /program/ page — ` +
          `a concentration claim the gate cannot check against its destination`,
      );
      continue;
    }
    const programUrl = link.getAttribute("href");
    const peBli = programUrl.split("/").filter(Boolean)[1];
    checked += 1;

    let destBand = destBandCache.get(peBli);
    if (destBand === undefined) {
      const destPath = path.join(outDir, programUrl.replace(/^\//, ""), "index.html");
      if (!fs.existsSync(destPath)) {
        destBand = "missing";
      } else {
        try {
          const destRoot = parse(fs.readFileSync(destPath, "utf8"), { comment: false });
          const badge = destRoot.querySelector("[data-hhi-band]");
          destBand = badge ? badge.getAttribute("data-hhi-band") : null;
        } catch {
          destBand = "missing";
        }
      }
      destBandCache.set(peBli, destBand);
    }

    if (destBand === "missing") {
      errors.push(
        `feed leg l: /program/${peBli}/ did not build or would not parse — card ` +
          `(HHI ${cardValue}) claims a concentration figure with no checkable destination`,
      );
      continue;
    }
    if (destBand === null) {
      errors.push(
        `feed leg l: /program/${peBli}/ renders no [data-hhi-band] — card ` +
          `(HHI ${cardValue}) links to a page with no concentration figure to reconcile against`,
      );
      continue;
    }

    if (destBand === cardBand) {
      agree += 1;
      continue;
    }

    // Bands diverge — expected for a single-year figure vs. a pooled one,
    // but only if the card SAYS so.
    const note = el.querySelector("[data-hhi-scope-note]");
    const noteText = (note?.text || "").toLowerCase();
    const discloses = Boolean(note) && noteText.includes("pooled") && noteText.includes("differ");
    if (!discloses) {
      errors.push(
        `feed leg l: card for ${peBli} implies "${cardBand}" (HHI ${cardValue}) but ` +
          `/program/${peBli}/ renders "${destBand}" — a single fiscal year's HHI can ` +
          `legitimately differ from the pooled all-years figure, but the card must say ` +
          `so; found ${note ? "a [data-hhi-scope-note] that doesn't disclose it" : "no [data-hhi-scope-note] at all"}`,
      );
      continue;
    }
    disclosedDivergence += 1;
  }

  if (checked === 0) {
    errors.push("feed leg l: no hhi card resolved a /program/ destination — the leg is vacuous");
  } else if (errors.every((e) => !e.startsWith("feed leg l"))) {
    notes.push(
      `leg l: ${checked} hhi card(s) checked against the /program/ page they link ` +
        `to — ${agree} share their destination's band, ${disclosedDivergence} diverge ` +
        `and explicitly disclose it, 0 silent contradictions ✓`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Syndication legs (f)-(j)
// ═══════════════════════════════════════════════════════════════════════════

/** Feed items that carry no dollar magnitude at all: the §P1-8 defect. */
const MIN_ITEMS = 30;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Parse an XML file the way an aggregator would. jsdom throws a DOMException
 * on malformed input, so a document that "looks fine" to a regex but is not
 * well-formed fails here — which is the entire point of parsing rather than
 * pattern-matching.
 */
function parseXmlFile(absPath) {
  const xml = fs.readFileSync(absPath, "utf8");
  const dom = new JSDOM(xml, { contentType: "application/xml" });
  const doc = dom.window.document;
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(err.textContent.slice(0, 200));
  return doc;
}

/** Rebuild the expected feed set from the sidecars — the same inputs the generator read. */
function expectedTargets() {
  const cards = readJson(path.join(jsonDir, "feed.json")).cards ?? [];
  const meta = readJson(path.join(jsonDir, "site_meta.json"));
  const programPages = new Set(
    fs
      .readdirSync(path.join(jsonDir, "program_details"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length)),
  );
  const entitiesTop = readJson(path.join(jsonDir, "entities_top.json"));
  const companyWatch = [];
  for (const e of entitiesTop) {
    const detPath = path.join(jsonDir, "entity_details", `${e.slug}.json`);
    if (!fs.existsSync(detPath)) continue;
    const watch = companyWatchPeBlis(readJson(detPath));
    if (watch.peBlis.size === 0) continue;
    companyWatch.push({
      slug: e.slug,
      // §P2-4: the feed's linkage entity carries the DISPLAY casing, the same
      // string the company page's <h1> shows. Re-derived here from the
      // registry name through the shared rule — never read back off the
      // published XML, so a generator that stopped applying the rule (or
      // applied a different one) still fails this leg.
      displayName: companyDisplay(e.display_name),
      familyKey: e.family_key,
      ...watch,
    });
  }
  return {
    cards,
    // Keyed by slug so leg k can re-derive, from the sidecar the company page
    // renders from, which linkage bases that page actually asserts per PE.
    companyWatchBySlug: new Map(companyWatch.map((w) => [w.slug, w])),
    targets: buildFeedTargets({
      cards,
      siteUrl: "https://example.invalid", // paths only; the gate never compares hosts here
      pubDate: meta.built_at,
      programPages,
      programTitles: new Map(
        readJson(path.join(jsonDir, "programs.json")).map((p) => [p.pe_bli, p.title]),
      ),
      companySlugByFamilyKey: new Map(entitiesTop.map((e) => [e.family_key, e.slug])),
      companyWatch,
    }),
  };
}

function runSyndicationLegs(errors, notes) {
  let cards, targets, companyWatchBySlug;
  try {
    ({ cards, targets, companyWatchBySlug } = expectedTargets());
  } catch (e) {
    errors.push(`feed leg f: could not rebuild the expected feed set — ${e.message}`);
    return;
  }
  if (cards.length < MIN_ITEMS) {
    errors.push(
      `feed leg f: feed.json holds only ${cards.length} cards (expected ≥${MIN_ITEMS}) — ` +
        `a feed with nothing in it cannot prove anything`,
    );
    return;
  }
  const cardByGuid = new Map(cards.map((c) => [feedGuid(c), c]));

  // ── (f) every expected file exists and parses ─────────────────────────────
  const docs = new Map(); // relPath → parsed Document
  let parsed = 0;
  for (const t of targets) {
    for (const rel of [t.rssPath, t.atomPath, ...(t.aliasPaths ?? [])]) {
      const abs = path.join(outDir, rel.replace(/^\//, ""));
      if (!fs.existsSync(abs)) {
        errors.push(
          `feed leg f: ${rel} was not emitted — the /feed/ page and its ` +
            `<link rel="alternate"> advertise it (§P1-8 was a 404 on exactly this)`,
        );
        continue;
      }
      try {
        docs.set(rel, parseXmlFile(abs));
        parsed += 1;
      } catch (e) {
        errors.push(
          `feed leg f: ${rel} is NOT well-formed XML — ${e.message} ` +
            `(titles in this corpus contain &, < and — ; escaping is not optional)`,
        );
      }
    }
  }
  if (parsed === 0) {
    errors.push("feed leg f: no feed file parsed — the leg is vacuous");
    return;
  }
  notes.push(
    `leg f: ${parsed} feed files parsed as XML across ${targets.length} feeds ` +
      `(whole + per event type + ${targets.filter((t) => t.kind === "program").length} ` +
      `program + ${targets.filter((t) => t.kind === "company").length} company watch feeds) ✓`,
  );

  // ── (g) item count == card count ──────────────────────────────────────────
  const wholeRss = docs.get("/rss.xml");
  const wholeAlias = docs.get("/feed.xml");
  const wholeAtom = docs.get("/atom.xml");
  for (const [rel, doc, tag] of [
    ["/rss.xml", wholeRss, "item"],
    ["/feed.xml", wholeAlias, "item"],
    ["/atom.xml", wholeAtom, "entry"],
  ]) {
    if (!doc) continue;
    const n = doc.getElementsByTagName(tag).length;
    if (n !== cards.length) {
      errors.push(
        `feed leg g: ${rel} carries ${n} <${tag}> but feed.json holds ` +
          `${cards.length} cards — the feed is silently dropping (or inventing) events`,
      );
    }
  }
  // The per-event-type feeds must PARTITION the whole feed: same total, no
  // card in two sections, none missing.
  let typeTotal = 0;
  for (const t of targets.filter((x) => x.kind === "event_type")) {
    const doc = docs.get(t.rssPath);
    if (!doc) continue;
    const n = doc.getElementsByTagName("item").length;
    typeTotal += n;
    const expected = cards.filter((c) => c.event_type === t.key).length;
    if (n !== expected) {
      errors.push(
        `feed leg g: ${t.rssPath} carries ${n} items, feed.json holds ${expected} ` +
          `${t.key} cards`,
      );
    }
  }
  if (typeTotal !== cards.length) {
    errors.push(
      `feed leg g: the per-event-type feeds hold ${typeTotal} items in total but ` +
        `the corpus holds ${cards.length} cards — they must partition it exactly`,
    );
  } else {
    notes.push(
      `leg g: whole feed = ${cards.length} items = card count; the ` +
        `${targets.filter((x) => x.kind === "event_type").length} event-type feeds ` +
        `partition it exactly ✓`,
    );
  }

  // ── (h) every item states its dollars and its receipt ─────────────────────
  const citations = readJson(path.join(jsonDir, "citations.json"));
  const publicIds = new Set(Object.keys(citations).map((k) => k.slice(0, 8)));
  let checkedItems = 0;
  let magnitudePoints = 0;
  if (wholeRss) {
    for (const item of wholeRss.getElementsByTagName("item")) {
      checkedItems += 1;
      const title = item.getElementsByTagName("title")[0]?.textContent ?? "(untitled)";
      const mag = item.getElementsByTagNameNS(FR_NS, "magnitude")[0];
      if (!mag) {
        errors.push(
          `feed leg h: item ${JSON.stringify(title.slice(0, 80))} carries no ` +
            `magnitude — "+79%" with no dollars is the §P1-8 defect`,
        );
        continue;
      }
      const pts = [...mag.getElementsByTagNameNS(FR_NS, "point")];
      if (pts.length === 0) {
        errors.push(
          `feed leg h: item ${JSON.stringify(title.slice(0, 80))} has an empty ` +
            `magnitude block`,
        );
        continue;
      }
      magnitudePoints += pts.length;
      if (mag.getAttribute("kind") === "pair") {
        const roles = pts.map((p) => p.getAttribute("role"));
        for (const need of ["from", "to"]) {
          if (!roles.includes(need)) {
            errors.push(
              `feed leg h: pair item ${JSON.stringify(title.slice(0, 80))} is missing ` +
                `its "${need}" endpoint — a pair with one side is a percentage again`,
            );
          }
        }
      }
      for (const p of pts) {
        const fid = p.getAttribute("fact");
        if (!fid || !(fid in citations)) {
          errors.push(
            `feed leg h: magnitude endpoint "${p.getAttribute("label")}" on ` +
              `${JSON.stringify(title.slice(0, 60))} cites ${JSON.stringify(fid)}, ` +
              `which does not resolve in citations.json`,
          );
        }
      }
      // /fact/{id} receipt permalink
      const related = [...item.getElementsByTagName("atom:link")].find(
        (l) => l.getAttribute("rel") === "related",
      );
      const href = related?.getAttribute("href") ?? "";
      const m = href.match(/\/fact\/([0-9a-f]{8})$/);
      if (!m) {
        errors.push(
          `feed leg h: item ${JSON.stringify(title.slice(0, 80))} carries no ` +
            `/fact/{id} receipt permalink (rel="related" href=${JSON.stringify(href)})`,
        );
      } else if (!publicIds.has(m[1])) {
        errors.push(
          `feed leg h: item ${JSON.stringify(title.slice(0, 80))} links to ` +
            `/fact/${m[1]}, which resolves to no citation — a receipt that 404s`,
        );
      }
      const pub = item.getElementsByTagName("pubDate")[0]?.textContent ?? "";
      if (!pub || Number.isNaN(new Date(pub).getTime())) {
        errors.push(
          `feed leg h: item ${JSON.stringify(title.slice(0, 80))} has an ` +
            `unparseable pubDate ${JSON.stringify(pub)}`,
        );
      }
    }
  }
  if (checkedItems === 0) {
    errors.push("feed leg h: no items were inspected — the leg is vacuous");
  } else if (errors.every((e) => !e.startsWith("feed leg h"))) {
    notes.push(
      `leg h: ${checkedItems} items each carry a dollar magnitude ` +
        `(${magnitudePoints} cited endpoints), a resolving /fact/{id} receipt, ` +
        `and a real pubDate ✓`,
    );
  }

  // ── (i) guids unique and stable ───────────────────────────────────────────
  let guidChecked = 0;
  for (const [rel, doc] of docs) {
    const isAtom = rel.endsWith(".atom.xml") || rel === "/atom.xml";
    const idTag = isAtom ? "id" : "guid";
    const container = isAtom ? "entry" : "item";
    const seen = new Set();
    for (const el of doc.getElementsByTagName(container)) {
      const id = el.getElementsByTagName(idTag)[0]?.textContent ?? "";
      if (!id) {
        errors.push(`feed leg i: ${rel} has a ${container} with no <${idTag}>`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(
          `feed leg i: ${rel} repeats ${idTag} ${id} — a reader would silently ` +
            `drop one of two real events`,
        );
      }
      seen.add(id);
      guidChecked += 1;
      // STABILITY: the id must be reproducible from the card's identity alone.
      // If it were built from position or value, this lookup would fail.
      if (!cardByGuid.has(id)) {
        errors.push(
          `feed leg i: ${rel} ${idTag} ${id} is not reproducible from any card ` +
            `via feedGuid() — the id is not derived from the event's identity ` +
            `and will churn on rebuild, re-notifying every subscriber`,
        );
      }
    }
  }
  if (guidChecked === 0) {
    errors.push("feed leg i: no ids inspected — the leg is vacuous");
  } else if (errors.every((e) => !e.startsWith("feed leg i"))) {
    notes.push(
      `leg i: ${guidChecked} feed ids across ${docs.size} files — unique within ` +
        `each feed and every one reproducible from its card ✓`,
    );
  }

  // ── (j) autodiscovery links resolve ───────────────────────────────────────
  const discoveryPages = [
    "/",
    "/feed/",
    "/programs/",
    ...targets
      .filter((t) => t.kind === "program")
      .slice(0, 3)
      .map((t) => `/program/${t.key}/`),
    ...targets
      .filter((t) => t.kind === "company")
      .slice(0, 3)
      .map((t) => `/company/${t.key}/`),
  ];
  let advertised = 0;
  for (const page of discoveryPages) {
    const abs = path.join(outDir, page.replace(/^\//, ""), "index.html");
    if (!fs.existsSync(abs)) continue;
    const root2 = parse(fs.readFileSync(abs, "utf8"), { comment: false });
    const links = root2
      .querySelectorAll("link[rel='alternate']")
      .filter((l) => (l.getAttribute("type") ?? "").includes("+xml"));
    if (links.length === 0) {
      errors.push(
        `feed leg j: ${page} advertises no feed — every page carries the whole ` +
          `feed's <link rel="alternate"> from the root layout`,
      );
      continue;
    }
    for (const l of links) {
      const href = l.getAttribute("href") ?? "";
      const rel = href.replace(/^https?:\/\/[^/]+/, "");
      const abs2 = path.join(outDir, rel.replace(/^\//, ""));
      advertised += 1;
      if (!fs.existsSync(abs2)) {
        errors.push(
          `feed leg j: ${page} autodiscovers ${href}, which was not emitted — ` +
            `a feed reader following it gets the §P1-8 404`,
        );
      }
    }
  }
  if (advertised === 0) {
    errors.push("feed leg j: no autodiscovery links found — the leg is vacuous");
  } else if (errors.every((e) => !e.startsWith("feed leg j"))) {
    notes.push(
      `leg j: ${advertised} <link rel="alternate"> feed URLs across ` +
        `${discoveryPages.length} sampled pages all resolve to emitted files ✓`,
    );
  }

  // ── (k) company-feed items state their linkage basis ──────────────────────
  runLinkageLeg(errors, notes, targets, docs, companyWatchBySlug);

  // ── (m) a change claim cannot ship without its basis qualifier ────────────
  runSyndicatedQualifierLeg(errors, notes, targets, docs);
}

/**
 * leg m — A PERCENTAGE-CHANGE CLAIM MAY NOT SHIP WITHOUT ITS BASIS QUALIFIER,
 * ANYWHERE, INCLUDING IN THE SYNDICATED PAYLOAD (§P0-2).
 *
 * THE DEFECT. FY2026 is abnormal: $89.01B of the $385.27B request is one-time
 * reconciliation-bill money. Program pages carry a split chip. /feed/ cards
 * carry a split chip. The FEEDS carried nothing — measured on the shipped
 * build, rss.xml held 223 items and the string "reconciliation" ZERO times.
 *
 * The worst item shipped as:
 *   "Long Range Kill Chains increased 3053% FY25→26 — FY2025 $244.1M →
 *    FY2026 $7.70B (+$7.45B, +3053%)"   Basis: toa (PB2026), change.
 *   Receipt: fact 2b159bea
 * PE 1203154SF's FY2026 request is $1.916M discretionary + $7,695.0M
 * reconciliation. The discretionary request FELL 99.2%. The claim is the
 * opposite of what happened, every figure in it is true, and it carries a
 * working receipt to prove each one.
 *
 * WHY THIS IS THE LEG WORTH HAVING. Gate 23 leg g4a/g4b already require the
 * chip on the /feed/ PAGE. This one covers the payload that LEAVES the site,
 * where no chip, no CSS and no adjacent element can travel with the sentence —
 * an aggregator shows a title and maybe a description, and the qualifier has
 * to be inside them or it does not exist. That is the same argument leg (k)
 * makes for linkage, applied to the accounting basis.
 *
 * TRUTH SOURCE: feed.json's own fy26_split per card — the payload the mart
 * computed and the page renders. The gate does not re-derive the split (that
 * would be a second derivation of one number, the defect that produced two
 * contradictory explanations of $698.2M on one program page); it asserts the
 * SYNDICATED TEXT carries what the payload says, in both the title and the
 * description, and that the machine-readable element agrees.
 *
 * NON-VACUITY: the leg must find items that genuinely carry a reconciliation
 * component, and it must find at least one whose discretionary direction
 * DISAGREES with its headline — the case it exists for. A corpus with no such
 * item is possible in a future edition, which is why the disagreement floor is
 * conditional on the recompute rather than a hardcoded expectation.
 */
function runSyndicatedQualifierLeg(errors, notes, targets, docs) {
  let itemsWithSplit = 0;
  let contradictions = 0;
  let elementsChecked = 0;
  const problems = [];

  for (const t of targets) {
    const doc = docs.get(t.rssPath);
    if (!doc) continue;
    const cards = new Map(cardsByGuidFor(t));
    for (const item of doc.getElementsByTagName("item")) {
      const guid = item.getElementsByTagName("guid")[0]?.textContent ?? "";
      const card = cards.get(guid);
      if (!card) continue;
      const split = card.fy26_split;
      if (!split?.has_reconciliation || !(Number(split.recon_k) > 0)) continue;
      itemsWithSplit++;

      const title = item.getElementsByTagName("title")[0]?.textContent ?? "";
      const desc = item.getElementsByTagName("description")[0]?.textContent ?? "";
      const short = guid.slice(-44);

      // The title is the only part guaranteed to survive syndication.
      if (!/reconciliation/i.test(title)) {
        problems.push(
          `${t.rssPath}: item ${short} states a change on a program whose ` +
            `FY2026 request is ${(split.recon_share * 100).toFixed(1)}% one-time ` +
            `reconciliation money, and its TITLE never says so: "${title.slice(0, 150)}"`,
        );
      }
      if (!/reconciliation/i.test(desc)) {
        problems.push(
          `${t.rssPath}: item ${short} description omits the reconciliation ` +
            `split entirely`,
        );
      }

      // Where a like-for-like discretionary rate exists, it must travel too —
      // and where it points the OTHER WAY from the headline, that is the
      // whole reason this leg exists.
      if (split.disc_pct_change != null) {
        const rate = split.disc_pct_change.toFixed(1);
        const headlineUp = /increas|\+\s*\d/.test(card.headline ?? "");
        if (headlineUp && split.disc_pct_change < 0) contradictions++;
        if (!title.includes(rate) && !desc.includes(rate)) {
          problems.push(
            `${t.rssPath}: item ${short} ships a combined change with no ` +
              `discretionary rate (${rate}%) in either title or description — ` +
              `headline: "${(card.headline ?? "").slice(0, 90)}"`,
          );
        }
      }

      const el = item.getElementsByTagNameNS(FR_NS, "reconciliation");
      if (el.length === 0) {
        problems.push(
          `${t.rssPath}: item ${short} carries no <fr:reconciliation> element`,
        );
      } else {
        elementsChecked++;
        const got = Number(el[0].getAttribute("recon-value"));
        if (Math.abs(got - Number(split.recon_k)) > 0.5) {
          problems.push(
            `${t.rssPath}: item ${short} <fr:reconciliation recon-value="${got}"> ` +
              `disagrees with feed.json's recon_k ${split.recon_k}`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    errors.push(
      `feed leg m: ${problems.length} syndicated item claim(s) ship a change ` +
        `without the reconciliation qualifier that makes them readable:`,
    );
    for (const p of problems.slice(0, 12)) errors.push(`  ${p}`);
    if (problems.length > 12)
      errors.push(`  ... and ${problems.length - 12} more`);
    return;
  }

  if (itemsWithSplit === 0) {
    errors.push(
      "feed leg m is VACUOUS: no syndicated item resolved a card with " +
        "fy26_split.has_reconciliation — the selector or the payload field is " +
        "not matching, and this leg would not catch the defect it exists for",
    );
    return;
  }

  notes.push(
    `leg m: ${itemsWithSplit} syndicated item(s) on reconciliation-affected ` +
      `programs carry the split in title, description and ` +
      `<fr:reconciliation> (${elementsChecked} element(s) agree with ` +
      `feed.json); ${contradictions} of them headline an increase whose ` +
      `discretionary rate is negative and now say so ✓`,
  );
}

/**
 * leg k — every company watch-feed item names WHY it is in that feed.
 *
 * TRUTH SOURCE. The bases an item may claim are recomputed here from the
 * entity_details sidecar — the same payload /company/{slug}/ renders its
 * award rows and linked-program chips from. "A basis the company page
 * asserts for that PE" is therefore literal, not an approximation: a feed
 * item cannot claim an award link the page does not show.
 *
 * The published label is the artifact under test; the recompute is the
 * reference. Mislabelling (mention published as award), a missing block, a
 * wrong company name, or an unknown basis id all fail.
 */
function runLinkageLeg(errors, notes, targets, docs, companyWatchBySlug) {
  const companyTargets = targets.filter((t) => t.kind === "company");
  if (companyTargets.length === 0) {
    errors.push(
      `feed leg k: no company watch feeds exist — the leg is vacuous ` +
        `(and the watch-feature is gone)`,
    );
    return;
  }

  const VALID_BASIS_IDS = new Set(["award", "mention", "family"]);
  let itemsChecked = 0;
  let basesChecked = 0;
  const mix = { award: 0, mention: 0, family: 0 };

  for (const t of companyTargets) {
    const doc = docs.get(t.rssPath);
    if (!doc) continue;
    const watch = companyWatchBySlug.get(t.key);
    if (!watch) {
      errors.push(
        `feed leg k: ${t.rssPath} exists but ${t.key} has no entity_details ` +
          `watchlist — the feed asserts a link the company page cannot support`,
      );
      continue;
    }
    const guidToCard = new Map(cardsByGuidFor(t));
    for (const item of doc.getElementsByTagName("item")) {
      itemsChecked += 1;
      const guid = item.getElementsByTagName("guid")[0]?.textContent ?? "";
      const title = item.getElementsByTagName("title")[0]?.textContent ?? "";
      const short = JSON.stringify(title.slice(0, 70));

      const linkage = item.getElementsByTagNameNS(FR_NS, "linkage")[0];
      if (!linkage) {
        errors.push(
          `feed leg k (${t.rssPath}): item ${short} states no linkage basis — ` +
            `read on its own, under a company's name, it reads as if the ` +
            `company holds that program`,
        );
        continue;
      }
      if (linkage.getAttribute("entity") !== watch.displayName) {
        errors.push(
          `feed leg k (${t.rssPath}): item ${short} attributes its linkage to ` +
            `${JSON.stringify(linkage.getAttribute("entity"))}, but this is ` +
            `${JSON.stringify(watch.displayName)}'s feed`,
        );
      }
      const published = [...linkage.getElementsByTagNameNS(FR_NS, "basis")].map(
        (b) => b.getAttribute("id"),
      );
      if (published.length === 0) {
        errors.push(
          `feed leg k (${t.rssPath}): item ${short} carries an EMPTY linkage ` +
            `block — a disclosure that discloses nothing`,
        );
        continue;
      }
      const card = guidToCard.get(guid);
      if (!card) {
        errors.push(
          `feed leg k (${t.rssPath}): item ${short} (guid ${guid}) matches no ` +
            `card — the gate cannot check what the page asserts about it`,
        );
        continue;
      }
      const asserted = new Set(linkageBases(card, watch).map((b) => b.id));
      for (const id of published) {
        basesChecked += 1;
        if (!VALID_BASIS_IDS.has(id)) {
          errors.push(
            `feed leg k (${t.rssPath}): item ${short} publishes an unknown ` +
              `linkage basis ${JSON.stringify(id)}`,
          );
          continue;
        }
        if (!asserted.has(id)) {
          errors.push(
            `feed leg k (${t.rssPath}): item ${short} claims linkage basis ` +
              `"${id}", but ${watch.displayName}'s page asserts only ` +
              `[${[...asserted].join(", ") || "none"}] for ` +
              `${card.pe_bli ?? card.family_key} — the item overstates the link`,
          );
        }
        if (id in mix) mix[id] += 1;
      }
      // Silence is also a failure: a real basis the page asserts must not be
      // dropped from a published item (an award-linked item that only says
      // "mention" understates, but one that says nothing about its strongest
      // link misleads in the other direction).
      for (const id of asserted) {
        if (!published.includes(id)) {
          errors.push(
            `feed leg k (${t.rssPath}): item ${short} omits linkage basis ` +
              `"${id}" that ${watch.displayName}'s page asserts for ` +
              `${card.pe_bli ?? card.family_key}`,
          );
        }
      }
    }
  }

  // Program feeds must NOT carry the block — see the leg's docblock.
  let programItems = 0;
  for (const t of targets.filter((x) => x.kind === "program")) {
    const doc = docs.get(t.rssPath);
    if (!doc) continue;
    for (const item of doc.getElementsByTagName("item")) {
      programItems += 1;
      if (item.getElementsByTagNameNS(FR_NS, "linkage").length > 0) {
        errors.push(
          `feed leg k: program feed ${t.rssPath} carries a company linkage ` +
            `block — a program element's own feed has no company to disclose`,
        );
      }
    }
  }

  if (itemsChecked === 0 || basesChecked === 0) {
    errors.push(
      `feed leg k: ${itemsChecked} items / ${basesChecked} bases inspected — ` +
        `the leg is vacuous and would not catch a regression`,
    );
  } else if (errors.every((e) => !e.startsWith("feed leg k"))) {
    notes.push(
      `leg k: ${itemsChecked} company watch-feed items across ` +
        `${companyTargets.length} companies each state their linkage basis ` +
        `(${mix.mention} lobbying-filing mention, ${mix.award} award ` +
        `crosswalk, ${mix.family} names-the-family), every basis one the ` +
        `company page asserts for that PE; ${programItems} program-feed items ` +
        `correctly carry none ✓`,
    );
  }
}

/** guid → card for one target's items (the items already carry their card). */
function cardsByGuidFor(target) {
  return target.items.map((it) => [it.guid, it.card]);
}

// ═══════════════════════════════════════════════════════════════════════════
// leg (n) — a ranked list must be ranked by something that matters
// ═══════════════════════════════════════════════════════════════════════════
//
// THE DEFECT (tri-persona review, layman pass). /feed/ opened on "Minuteman
// Squadrons increased 79% — $59.3M → $106.0M", a $46.7M change, at the head
// of a 99-card section holding changes seventy times larger. Nothing was
// wrong with the card. The order was `event_type, pe_bli` straight off the
// mart, so `0101213F` sorted first and 223 signals were presented to the
// reader least-consequential-first.
//
// §P1-8 already established that every card must state THE DOLLARS IT IS
// ABOUT, because "increased 79%" is not a story until you know 79% of what.
// This leg is that same argument applied to order: the figure the card
// publishes is the figure the section is ranked by.
//
// WHAT IT READS. The rendered magnitude line — the delta for a pair
// (what changed), the single endpoint otherwise (the obligations the event is
// about) — off each card's own [data-mag-role] block, taking the exact value
// out of the [data-amount] title the reader sees on hover, units and all.
// Nothing is recomputed from feed.json: the gate ranks the numbers the page
// prints, in the order the page prints them. A sort that ordered the payload
// correctly but rendered a different figure would fail here, which is the
// point of reading the artifact instead of the source.
//
// SCOPE: within a section. The page and the feeds each group by event type
// and declare their own section order; an HHI pool's matched obligations and
// a budget delta are both dollars but not the same quantity, and ranking one
// against the other would be a new false comparison in place of the old one.

/** "$1,234,567 (USD thousands)" → dollars. Null when unparseable. */
function amountTitleToUsd(title) {
  if (!title) return null;
  const m = title.match(/\$\s*(-?[\d,]+(?:\.\d+)?)\s*(?:\(([^)]*)\))?/);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(v)) return null;
  const units = (m[2] || "").toLowerCase();
  if (units.includes("thousand")) return Math.abs(v) * 1000;
  if (units.includes("million")) return Math.abs(v) * 1e6;
  if (units.includes("billion")) return Math.abs(v) * 1e9;
  return Math.abs(v);
}

/** The dollars a rendered card is about: its delta, else its single endpoint. */
function cardMagnitudeUsd(card) {
  for (const role of ["delta", "to", "from"]) {
    const point = card.querySelector(`[data-mag-role="${role}"] [data-amount]`);
    if (!point) continue;
    const usd = amountTitleToUsd(point.getAttribute("title"));
    if (usd !== null) return usd;
  }
  return null;
}

function runMagnitudeOrderLeg(errors, notes, sections) {
  const summaries = [];
  let missing = 0;

  for (const section of sections) {
    const id = section.getAttribute("id") ?? "?";
    const cards = section.querySelectorAll("[data-feed-card]");
    const values = [];
    for (const card of cards) {
      const usd = cardMagnitudeUsd(card);
      if (usd === null) {
        missing += 1;
        if (missing <= 5) {
          errors.push(
            `feed(n): ${id} has a card with no readable magnitude — ` +
              `"${(card.text || "").replace(/\s+/g, " ").trim().slice(0, 80)}"`,
          );
        }
        continue;
      }
      values.push({ usd, label: (card.text || "").replace(/\s+/g, " ").trim().slice(0, 60) });
    }
    if (values.length === 0) continue;

    for (let i = 1; i < values.length; i += 1) {
      if (values[i].usd > values[i - 1].usd) {
        errors.push(
          `feed(n): ${id} is not ranked by dollar magnitude — position ${i} ` +
            `($${Math.round(values[i].usd).toLocaleString("en-US")}, "${values[i].label}") ` +
            `outranks position ${i - 1} ` +
            `($${Math.round(values[i - 1].usd).toLocaleString("en-US")}, "${values[i - 1].label}")`,
        );
        break; // one report per section: the first inversion is the finding
      }
    }
    summaries.push(
      `${id.replace(/^feed-/, "")} ${values.length} cards, ` +
        `$${Math.round(values[0].usd).toLocaleString("en-US")} first`,
    );
  }

  if (missing > 5) {
    errors.push(`feed(n): ${missing} card(s) with no readable magnitude in total (first 5 listed)`);
  }
  notes.push(`leg n: sections ranked by their own printed dollars — ${summaries.join("; ")}`);
}
