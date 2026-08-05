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
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";
import { JSDOM } from "jsdom";
import {
  FR_NS,
  feedGuid,
  buildFeedTargets,
  companyWatchPeBlis,
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

  // ── (f)-(j) Syndication (PM-review Sprint 3 Task 2, §P1-8) ──────────────────
  runSyndicationLegs(errors, notes);

  return { pass: errors.length === 0, errors, notes };
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
      displayName: e.display_name,
      familyKey: e.family_key,
      ...watch,
    });
  }
  return {
    cards,
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
  let cards, targets;
  try {
    ({ cards, targets } = expectedTargets());
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
}
