/**
 * gate — linkgraph_gate (Phase 5C, G1)
 *
 * The connected graph must have no dead ends:
 * (a) No orphaned indexes: /district/, /filings/, /feed/, /downloads/ each
 *     appear as an href in the shared chrome (header/footer as rendered on /)
 *     or the home page body.
 * (b) Every page TYPE is reachable from / within <= 3 clicks. Types:
 *     programs index, program detail, companies index, company detail,
 *     agency detail, district index, district detail, filings index,
 *     filing detail, feed, data, downloads, methodology, about.
 * (c) Entity-link contracts:
 *     - out/feed/index.html: every card inside section#feed-new_entrant
 *       contains <a href^="/company/"> OR carries [data-no-company-page].
 *     - home stats band: every [data-stat] element is (or contains) an <a>.
 *     - sampled program pages with lobbying mentions: every
 *       [data-filing-mention] contains an <a href^="/filing/">.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "out");

const PAGE_TYPES = [
  { key: "programs_index", re: /^\/programs\/$/ },
  { key: "program_detail", re: /^\/program\/[^/]+\/$/ },
  { key: "companies_index", re: /^\/companies\/$/ },
  { key: "company_detail", re: /^\/company\/[^/]+\/$/ },
  { key: "agency_detail", re: /^\/agency\/[^/]+\/$/ },
  { key: "district_index", re: /^\/district\/$/ },
  { key: "district_detail", re: /^\/district\/[^/]+\/$/ },
  { key: "filings_index", re: /^\/filings\/$/ },
  { key: "filing_detail", re: /^\/filing\/[^/]+\/$/ },
  { key: "feed", re: /^\/feed\/$/ },
  { key: "data", re: /^\/data\/$/ },
  { key: "downloads", re: /^\/downloads\/$/ },
  { key: "methodology", re: /^\/methodology\/$/ },
  { key: "about", re: /^\/about\/$/ },
];

function normalize(href) {
  if (!href || href.startsWith("http") || href.startsWith("mailto:")) return null;
  let u = href.split("#")[0].split("?")[0];
  if (!u.startsWith("/")) return null;
  if (!u.endsWith("/")) u += "/";
  return u;
}

function htmlPathFor(url) {
  return path.join(outDir, ...url.split("/").filter(Boolean), "index.html");
}

function linksIn(html) {
  const root = parse(html, { comment: false });
  const hrefs = new Set();
  for (const a of root.querySelectorAll("a[href]")) {
    const n = normalize(a.getAttribute("href"));
    if (n) hrefs.add(n);
  }
  return { root, hrefs };
}

export async function runLinkgraphGate() {
  const errors = [];
  const notes = [];
  const homePath = htmlPathFor("/");
  if (!fs.existsSync(homePath)) {
    notes.push("out/index.html not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── (a) orphaned indexes ──
  const { root: homeRoot, hrefs: homeHrefs } = linksIn(fs.readFileSync(homePath, "utf8"));
  for (const must of ["/district/", "/filings/", "/feed/", "/downloads/"]) {
    if (!homeHrefs.has(must)) {
      errors.push(`orphaned index: ${must} has no inbound link from home/header/footer`);
    } else {
      notes.push(`${must} linked from chrome/home ✓`);
    }
  }

  // ── (b) BFS reachability of page types, depth <= 3 ──
  // Parse pages at depth 0..2; anything linked from depth 2 is reachable at 3.
  const reachedAt = new Map([["/", 0]]);
  let frontier = ["/"];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const url of frontier) {
      const p = htmlPathFor(url);
      if (!fs.existsSync(p)) continue;
      const { hrefs } = linksIn(fs.readFileSync(p, "utf8"));
      for (const h of hrefs) {
        if (!reachedAt.has(h)) {
          reachedAt.set(h, depth + 1);
          next.push(h);
        }
      }
    }
    // Parsing every program/company page at depth 2 is wasteful; only keep
    // parsing pages we still need: stop early if all types are reached.
    const unreached = PAGE_TYPES.filter(
      (t) => ![...reachedAt.keys()].some((u) => t.re.test(u))
    );
    if (unreached.length === 0) break;
    // Cap frontier parsing: index/hub pages first, then a sample of details.
    next.sort((a, b) => a.length - b.length);
    frontier = next.slice(0, 200);
  }
  for (const t of PAGE_TYPES) {
    const hit = [...reachedAt.entries()].find(([u]) => t.re.test(u));
    if (!hit) {
      errors.push(`page type unreachable within 3 clicks of /: ${t.key}`);
    }
  }
  notes.push(`BFS covered ${reachedAt.size} URLs`);

  // ── (c1) feed new_entrant company links ──
  const feedPath = htmlPathFor("/feed/");
  if (fs.existsSync(feedPath)) {
    const feedRoot = parse(fs.readFileSync(feedPath, "utf8"), { comment: false });
    const section = feedRoot.querySelector("section#feed-new_entrant");
    if (!section) {
      errors.push("feed: section#feed-new_entrant not found (contract missing)");
    } else {
      // Contract: FeedCardItem root carries data-feed-card="". Selecting by
      // that attribute instead of class makes this selector stable against style changes.
      const cards = section.querySelectorAll("[data-feed-card]");
      if (cards.length === 0) {
        errors.push("feed new_entrant: section present but 0 cards matched the card selector (selector rot?)");
      } else {
        let bad = 0;
        for (const card of cards) {
          const hasCompanyLink = card
            .querySelectorAll("a[href]")
            .some((a) => (a.getAttribute("href") ?? "").startsWith("/company/"));
          const optedOut =
            card.getAttribute("data-no-company-page") !== undefined ||
            card.querySelectorAll("[data-no-company-page]").length > 0;
          if (!hasCompanyLink && !optedOut) bad++;
        }
        if (bad > 0) errors.push(`feed new_entrant: ${bad} card(s) with neither a /company/ link nor [data-no-company-page]`);
        else notes.push(`feed new_entrant: ${cards.length} cards all linked/opted-out ✓`);
      }
    }
  }

  // ── (c2) home stats are links ──
  const stats = homeRoot.querySelectorAll("[data-stat]");
  if (stats.length === 0) {
    errors.push("home: no [data-stat] elements found (stats band contract missing)");
  } else {
    const nonLink = stats.filter((el) => {
      if (el.tagName === "A") return false;
      if (el.querySelectorAll("a").length > 0) return false;
      // node-html-parser may not have closest; guard it
      if (typeof el.closest === "function" && el.closest("a")) return false;
      return true;
    });
    if (nonLink.length > 0) errors.push(`home: ${nonLink.length} [data-stat] element(s) are not links`);
    else notes.push(`home stats: ${stats.length} all linked ✓`);
  }

  // ── (c3) filing mentions link internally (sample 5 program pages) ──
  const programDir = path.join(outDir, "program");
  if (!fs.existsSync(programDir)) {
    errors.push("out/program/ missing — build incomplete");
  } else {
    const slugs = fs.readdirSync(programDir).sort().slice(0, 400);
    let checked = 0, missing = 0;
    for (const slug of slugs) {
      if (checked >= 5) break;
      const p = path.join(programDir, slug, "index.html");
      if (!fs.existsSync(p)) continue;
      const r = parse(fs.readFileSync(p, "utf8"), { comment: false });
      const mentions = r.querySelectorAll("[data-filing-mention]");
      if (mentions.length === 0) continue;
      checked++;
      for (const m of mentions) {
        const ok = m.querySelectorAll("a[href]").some((a) =>
          (a.getAttribute("href") ?? "").startsWith("/filing/"));
        if (!ok) missing++;
      }
    }
    if (checked === 0) {
      errors.push("program pages: no [data-filing-mention] elements found on any sampled page (contract missing)");
    } else if (missing > 0) {
      errors.push(`program pages: ${missing} filing mention(s) without internal /filing/ link`);
    } else {
      notes.push(`filing mentions: ${checked} pages sampled, all internally linked ✓`);
    }
  }

  return { pass: errors.length === 0, errors, notes };
}
