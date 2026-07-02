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
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");

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

  return { pass: errors.length === 0, errors, notes };
}
