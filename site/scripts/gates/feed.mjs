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
  // Cards render as <div class="flex items-start justify-between gap-4 px-5 py-4 ...">
  // Count by looking for elements containing the feed card classes.
  // More robustly: count <section> elements with id starting "feed-", then
  // sum the card items inside each section (divs that carry both px-5 and py-4).
  const sections = root.querySelectorAll("section[id]").filter(
    (el) => (el.getAttribute("id") ?? "").startsWith("feed-")
  );

  // Count card items: each card is a direct child div inside the section's
  // .divide-y container — look for the nested card items by px-5 py-4 pattern.
  let totalCards = 0;
  for (const section of sections) {
    // Cards are <div class="...px-5 py-4..."> inside the section
    const cards = section.querySelectorAll("div").filter((el) => {
      const cls = el.getAttribute("class") ?? "";
      return cls.includes("px-5") && cls.includes("py-4");
    });
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
  if (html.includes("9999999999")) {
    errors.push('feed: sentinel PE/BLI "9999999999" found in page content — junk data leaking');
  } else {
    notes.push('feed: junk sentinel "9999999999" absent ✓');
  }

  return { pass: errors.length === 0, errors, notes };
}
