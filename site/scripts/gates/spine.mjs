/**
 * gate 3 — render-live, LAYOUT-SPINE LEG (1440 and 1920)
 *
 * Legs: (s1) the content column starts at ONE declared left edge, the same one
 * the header wordmark sits on, on every route — and any route that differs
 * says why, in the page itself. (s2) no line of prose in that column runs past
 * 80 rendered characters.
 *
 * ROADMAP #42.
 *
 * WHY THIS EXISTS. All three judges on round-3 panel 2 named the same thing,
 * and two put it first on their "what would move 1440 up" list: "no layout
 * spine — the content column starts at five different left edges". Measured
 * on the pre-fix build at 1440, the <h1> left offsets were
 *
 *     96  /flow/ /lineage/ /years/
 *     160 /companies/ /programs/
 *     224 /agency/{org}/ /companies/families/ /company/{slug}/ /coverage/
 *         /data/ /district/ /feed/ /filings/ /program/{pe}/
 *     288 / /agency/ /district/{d}/ /downloads/ /filing/{uuid}/
 *     352 /about/ /fact/ /glossary/ /methodology/
 *     400 /404.html
 *
 * — six edges, against a header wordmark pinned at 96. Nothing was broken;
 * every page was individually fine. The defect only exists BETWEEN pages, and
 * a suite that checks one page at a time cannot see it. That is the shape this
 * leg is written for: it measures a property of the SITE, across routes, and
 * fails on the spread rather than on any single page.
 *
 * THE GENERALISABLE FORM, which is the point. It would be easy — and useless —
 * to pin the answer at 96. That number is a consequence of --spine-max, and a
 * gate that knows it would have to be edited every time the design changes,
 * which is how it comes to be wrong. So the leg derives the expected edge from
 * the page itself: the header wordmark is the site's own declaration of where
 * its left edge is, and the content column has to agree with it. And the route
 * sample is derived from src/app/**\/page.tsx rather than listed here, so the
 * twenty-fifth route file is measured the day it is added — which is exactly
 * how the sixth `max-w-*` got in.
 *
 *   (s1) ONE DECLARED LEFT EDGE — for every route, the <h1>'s box starts at
 *        the same x as the header wordmark (±1px rounding), at 1440 and at
 *        1920. The <h1> box is measured because that is the reader-visible
 *        start of the content column and it is what the ROADMAP entry
 *        measured; a centred <h1> still has its box on the spine.
 *
 *        A route may differ, but it must SAY SO: `data-spine-exception="…"`
 *        on the <h1> or any ancestor up to <main>, carrying a reason of at
 *        least MIN_REASON_CHARS characters. Declared exceptions are reported
 *        in this leg's notes on every run, so "wide for the matrix" can never
 *        become an unexamined default.
 *
 *        Plus the same assertion WITHIN a page: every content-spine element
 *        under #main-content shares that one edge. The home page shipped four
 *        different widths in one document (a 1280 band under a 896 hero under
 *        two 1024 sections), so a per-route check alone would have passed it.
 *
 *        Non-vacuity: every discovered route must resolve to a built page,
 *        must expose a header wordmark, must have an <h1>, and must declare
 *        at least one content-spine element. A page that renders none of
 *        those FAILS rather than passing on nothing measured.
 *
 *   (s2) ONE READING MEASURE — no prose block renders a line longer than
 *        MAX_CPL characters. WCAG 1.4.8 (Visual Presentation, AAA) puts the
 *        ceiling at 80, so that is the number; it is not a preference.
 *
 *        (s1) ALONE WOULD MAKE (s2) WORSE, which is why #42 was deliberately
 *        left unfixed in the fix round: aligning every container to the header
 *        means widening most of them, and the same panel measured explanatory
 *        prose at 136–165 characters per line. Re-measured before this change
 *        it was worse still — 229 on /years/, 224 on /lineage/, 207 on
 *        /companies/. The two only make sense together.
 *
 *        CHARACTERS, NOT PIXELS. A px cap would mean a different number of
 *        characters at every font size on the page, and the criterion is
 *        stated in characters. So the measurement is: group the block's client
 *        rects into visual lines, take the average glyph advance over the
 *        whole block (total inline width ÷ character count), and divide the
 *        widest line by it. Blocks shorter than MIN_PROSE_CHARS or rendering
 *        on a single line are skipped — a line that does not wrap has no
 *        measure to speak of.
 *
 *        SCOPE. Paragraphs, figure captions, and list items whose list
 *        actually carries a marker (Tailwind's preflight sets
 *        `list-style: none` on every ul/ol, so a computed list-style-type is
 *        what separates a prose bullet from a stack of cards that happens to
 *        be a <ul>). Table cells and <summary> are excluded — their width is
 *        set by their column, not by a reading column — and so is any block
 *        that contains other blocks, which is a container rather than a text
 *        block. Captions are NOT excluded: /years/ shipped one 1,248px wide,
 *        and a caption is read like anything else.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const appDir = path.resolve(siteRoot, "src", "app");
const outDir = path.resolve(siteRoot, "out");

/** Desktop widths measured. 1920 is where Tailwind's `container` used to grow
 *  past a page's `max-w-*` — the width at which a header and a body that
 *  agreed at 1440 came apart. */
export const SPINE_WIDTHS = [1440, 1920];

/** Sub-pixel layout rounding, in CSS px. */
const EDGE_TOLERANCE_PX = 1;

/** WCAG 1.4.8 (Visual Presentation, AAA): no more than 80 characters per line. */
const MAX_CPL = 80;

/** A block shorter than this has no reading measure worth asserting. */
const MIN_PROSE_CHARS = 120;

/** An exception has to be an explanation, not a shrug. */
const MIN_REASON_CHARS = 24;

/** Floors. Not expectations — alarms for a sample that resolved to nothing. */
const MIN_ROUTES = 20;
const MIN_PROSE_BLOCKS = 60;
const MIN_PROSE_PAGES = 8;

/**
 * Every route the app declares, derived from the route files themselves so a
 * new page.tsx joins the sample without anybody remembering to add it here.
 * Dynamic segments resolve against the BUILT output (lowest-sorting directory
 * that carries an index.html), so the sample needs no sidecar knowledge and
 * cannot drift from what actually shipped.
 */
export function discoverRoutes() {
  const routeFiles = [];
  const walk = (dir, segs) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        // Next route groups `(name)` and private folders `_name` add no URL
        // segment; everything else does.
        if (name.startsWith("_")) continue;
        const isGroup = name.startsWith("(") && name.endsWith(")");
        walk(abs, isGroup ? segs : [...segs, name]);
      } else if (name === "page.tsx" || name === "page.jsx") {
        routeFiles.push(segs);
      }
    }
  };
  walk(appDir, []);

  const routes = [];
  const unresolved = [];
  for (const segs of routeFiles) {
    const resolved = [];
    let ok = true;
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      if (!seg.startsWith("[")) {
        resolved.push(seg);
        continue;
      }
      const parentDir = path.join(outDir, ...resolved);
      let pick = null;
      if (fs.existsSync(parentDir)) {
        for (const child of fs.readdirSync(parentDir).sort()) {
          if (fs.existsSync(path.join(parentDir, child, "index.html"))) {
            pick = child;
            break;
          }
        }
      }
      if (!pick) {
        unresolved.push(`/${segs.join("/")}/ (no built instance under out/${resolved.join("/")}/)`);
        ok = false;
        break;
      }
      resolved.push(pick);
    }
    if (ok) routes.push(resolved.length === 0 ? "/" : `/${resolved.join("/")}/`);
  }

  // The 404 document is a real page a reader reaches, is not a page.tsx, and
  // shipped the widest offset of the lot (400px) — it belongs in the sample.
  if (fs.existsSync(path.join(outDir, "404.html"))) routes.push("/404.html");

  return { routes: [...new Set(routes)].sort(), routeFileCount: routeFiles.length, unresolved };
}

/**
 * In-page measurement — one evaluate() per page so every rect is read off a
 * single layout. Serialized into the browser, so it closes over nothing.
 */
function measureSpineInPage({ minProseChars }) {
  const round = (n) => Math.round(n * 10) / 10;
  const out = {
    innerWidth: window.innerWidth,
    brandLeft: null,
    h1Left: null,
    h1Text: null,
    h1Exception: null,
    spineBoxes: [],
    prose: [],
    proseSkipped: 0,
  };

  const brand = document.querySelector('header a[href="/"]');
  if (brand) out.brandLeft = round(brand.getBoundingClientRect().left);

  const main = document.getElementById("main-content");
  if (!main) return out;

  const h1 = main.querySelector("h1");
  if (h1) {
    const r = h1.getBoundingClientRect();
    out.h1Left = round(r.left);
    out.h1Text = (h1.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
    // A declared exception may sit on the h1 or on any ancestor up to <main>.
    let node = h1;
    while (node && node !== document.documentElement) {
      const reason = node.getAttribute?.("data-spine-exception");
      if (reason != null) {
        out.h1Exception = reason;
        break;
      }
      if (node === main) break;
      node = node.parentElement;
    }
  }

  for (const el of main.querySelectorAll(".spine, [data-spine]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.spineBoxes.push({
      left: round(r.left),
      width: Math.round(r.width),
      cls: String(el.getAttribute("class") ?? "").slice(0, 40),
      exception: el.getAttribute("data-spine-exception"),
    });
  }

  // ── prose: rendered characters per line ────────────────────────────────
  for (const el of main.querySelectorAll("p, li, figcaption")) {
    if (el.closest("table, summary, nav")) continue;
    if (el.tagName === "LI" && getComputedStyle(el).listStyleType === "none") continue;
    // A block that contains other blocks is a container, not a text block:
    // measuring it would average glyph widths across unrelated children.
    if (el.querySelector("p, li, ul, ol, div, table, figure")) continue;
    const txt = (el.textContent ?? "").trim();
    if (txt.length < minProseChars) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (rects.length === 0) continue;
    // Fragments on the same baseline are one visual line.
    const lines = new Map();
    for (const x of rects) {
      const key = Math.round(x.top / 2) * 2;
      const cur = lines.get(key) ?? { l: Infinity, r: -Infinity, w: 0 };
      cur.l = Math.min(cur.l, x.left);
      cur.r = Math.max(cur.r, x.right);
      cur.w += x.width;
      lines.set(key, cur);
    }
    if (lines.size < 2) {
      out.proseSkipped += 1;
      continue;
    }
    const totalWidth = [...lines.values()].reduce((a, v) => a + v.w, 0);
    if (!(totalWidth > 0)) continue;
    const avgGlyph = totalWidth / txt.length;
    const widest = Math.max(...[...lines.values()].map((v) => v.r - v.l));
    out.prose.push({
      cpl: Math.round(widest / avgGlyph),
      lines: lines.size,
      widthPx: Math.round(widest),
      chars: txt.length,
      text: txt.slice(0, 44).replace(/\s+/g, " "),
    });
  }

  return out;
}

/**
 * The leg. Callable with an existing browser (gate 3 passes its own) or
 * standalone (scripts/run-spine-leg.mjs launches one).
 */
export async function runSpineLeg({ baseUrl, browser }) {
  const errors = [];
  const notes = [];

  const { routes, routeFileCount, unresolved } = discoverRoutes();
  for (const u of unresolved) {
    errors.push(`spine: route ${u} — the app declares it and the build did not emit one, so it cannot be measured`);
  }
  if (routes.length < MIN_ROUTES) {
    errors.push(
      `spine: route discovery resolved ${routes.length} route(s) from ${routeFileCount} route file(s) under src/app — below the ${MIN_ROUTES} floor, so the sample is vacuous`,
    );
    return { pass: false, errors, notes };
  }
  notes.push(
    `spine leg @ [${SPINE_WIDTHS.join(", ")}]px: ${routes.length} route(s) discovered from ${routeFileCount} route file(s) — ${routes.join(" ")}`,
  );

  const ownBrowser = !browser;
  const b = browser ?? (await chromium.launch({ headless: true }));

  let proseBlocks = 0;
  let prosePages = 0;
  let proseOver = 0;
  const declaredExceptions = [];

  try {
    for (const width of SPINE_WIDTHS) {
      const context = await b.newContext({ viewport: { width, height: 1000 } });
      /** left edge → routes, over the non-exception routes at this width. */
      const edges = new Map();
      let brandEdge = null;
      let brandRoute = null;

      try {
        for (const route of routes) {
          const page = await context.newPage();
          try {
            const response = await page.goto(`${baseUrl}${route}`, {
              waitUntil: "load",
              timeout: 60000,
            });
            if (response && response.status() >= 400) {
              errors.push(`spine ${width}px ${route}: HTTP ${response.status()}`);
              continue;
            }
            // Glyph advances decide (s2), so wait for the real faces.
            await page.evaluate(() => document.fonts.ready).catch(() => {});
            await page.waitForTimeout(200);

            const m = await page.evaluate(measureSpineInPage, {
              minProseChars: MIN_PROSE_CHARS,
            });

            // ── non-vacuity ────────────────────────────────────────────────
            if (m.brandLeft == null) {
              errors.push(
                `spine ${width}px ${route}: no header wordmark (header a[href="/"]) — the site's own left edge is unreadable, so nothing can be measured against it`,
              );
              continue;
            }
            if (m.h1Left == null) {
              errors.push(
                `spine ${width}px ${route}: no <h1> inside #main-content — the content column has no measurable start`,
              );
              continue;
            }
            if (m.spineBoxes.length === 0) {
              errors.push(
                `spine ${width}px ${route}: declares no content spine element (.spine / [data-spine]) — every route states which column it is on`,
              );
            }

            if (brandEdge === null) {
              brandEdge = m.brandLeft;
              brandRoute = route;
            } else if (Math.abs(brandEdge - m.brandLeft) > EDGE_TOLERANCE_PX) {
              errors.push(
                `spine ${width}px ${route}: the header wordmark itself moved — ${m.brandLeft}px here vs ${brandEdge}px on ${brandRoute}`,
              );
            }

            // ── (s1) the content column starts on the spine ────────────────
            // A declared exception is excluded from the edge tally (that is
            // what declaring buys); every other route joins it, aligned or
            // not, so the failure message can report the actual spread rather
            // than only naming the pages that missed.
            if (m.h1Exception != null) {
              const reason = String(m.h1Exception).trim();
              if (reason.length < MIN_REASON_CHARS) {
                errors.push(
                  `spine ${width}px ${route}: data-spine-exception is ${reason.length} characters ("${reason}") — an exception has to state why, in at least ${MIN_REASON_CHARS}`,
                );
              } else if (width === SPINE_WIDTHS[0]) {
                declaredExceptions.push(`${route} at ${m.h1Left}px (wordmark ${m.brandLeft}px): ${reason}`);
              }
            } else {
              if (!edges.has(m.h1Left)) edges.set(m.h1Left, []);
              edges.get(m.h1Left).push(route);
            }

            // ── (s1) …and does not slide sideways within its own page ──────
            const boxEdges = new Map();
            for (const box of m.spineBoxes) {
              if (box.exception != null) continue;
              if (!boxEdges.has(box.left)) boxEdges.set(box.left, []);
              boxEdges.get(box.left).push(box);
            }
            if (boxEdges.size > 1) {
              const spread = [...boxEdges.entries()]
                .sort((x, y) => x[0] - y[0])
                .map(([l, v]) => `${l}px ×${v.length} (${v[0].width}px wide, class="${v[0].cls}")`)
                .join(" | ");
              errors.push(
                `spine ${width}px ${route}: the content column starts at ${boxEdges.size} different left edges WITHIN this one page — ${spread}`,
              );
            }

            // ── (s2) one reading measure ───────────────────────────────────
            if (width === SPINE_WIDTHS[0]) {
              if (m.prose.length > 0) {
                prosePages += 1;
                proseBlocks += m.prose.length;
              }
              const over = m.prose.filter((p) => p.cpl > MAX_CPL).sort((a, b) => b.cpl - a.cpl);
              proseOver += over.length;
              if (over.length > 0) {
                const sample = over
                  .slice(0, 3)
                  .map((p) => `${p.cpl} chars/line (${p.widthPx}px over ${p.lines} lines) — "${p.text}…"`)
                  .join(" | ");
                errors.push(
                  `spine ${width}px ${route}: ${over.length}/${m.prose.length} prose block(s) run past ${MAX_CPL} characters per line (WCAG 1.4.8) — ${sample}`,
                );
              }
            }
          } catch (e) {
            errors.push(`spine ${width}px ${route}: navigation/measure failed: ${e.message}`);
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }

      // ── (s1) across routes: ONE edge, and it is the wordmark's ───────────
      if (edges.size === 0) continue;
      const sorted = [...edges.entries()].sort((a, b) => a[0] - b[0]);
      const spread = sorted
        .map(([l, rs]) => `${l} (${rs.length <= 4 ? rs.join(", ") : `${rs.slice(0, 3).join(", ")} +${rs.length - 3} more`})`)
        .join("; ");
      if (sorted.length > 1) {
        errors.push(
          `spine (s1) ${width}px: the content column starts at ${sorted.length} different left edges — ${spread} — while the header wordmark sits at ${brandEdge}. One spine, or a data-spine-exception saying why this page is not on it.`,
        );
      } else if (Math.abs(sorted[0][0] - brandEdge) > EDGE_TOLERANCE_PX) {
        errors.push(
          `spine (s1) ${width}px: the content column is on one edge (${sorted[0][0]}px, ${sorted[0][1].length} routes) but it is not the header's — the wordmark sits at ${brandEdge}px (Δ${Math.round(Math.abs(sorted[0][0] - brandEdge))}px)`,
        );
      } else {
        notes.push(
          `spine (s1) ${width}px: ${sorted[0][1].length} route(s) all start at ${sorted[0][0]}px, on the header wordmark ✓`,
        );
      }
    }
  } finally {
    if (ownBrowser) await b.close();
  }

  // ── (s2) non-vacuity ─────────────────────────────────────────────────────
  if (proseBlocks < MIN_PROSE_BLOCKS || prosePages < MIN_PROSE_PAGES) {
    errors.push(
      `spine (s2): only ${proseBlocks} prose block(s) across ${prosePages} page(s) resolved a reading measure (need >= ${MIN_PROSE_BLOCKS} on >= ${MIN_PROSE_PAGES}) — the sample is vacuous`,
    );
  } else if (proseOver > 0) {
    // A summary note, NOT a tick. The per-page errors above carry the detail;
    // this line exists so a reader of the notes is not told "✓" beside a
    // failing run — a draft of this leg did exactly that.
    notes.push(
      `spine (s2) ${SPINE_WIDTHS[0]}px: ${proseOver} of ${proseBlocks} prose block(s) across ${prosePages} page(s) run past ${MAX_CPL} characters per line — see errors`,
    );
  } else {
    notes.push(
      `spine (s2) ${SPINE_WIDTHS[0]}px: ${proseBlocks} prose block(s) across ${prosePages} page(s), none past ${MAX_CPL} characters per line ✓`,
    );
  }

  // Declared exceptions are reported on EVERY run, passing or failing: an
  // exception nobody re-reads is how the next default gets set.
  notes.push(
    declaredExceptions.length === 0
      ? "spine: 0 declared exceptions — every route is on the one spine"
      : `spine: ${declaredExceptions.length} declared exception(s) — ${declaredExceptions.join(" | ")}`,
  );

  return { pass: errors.length === 0, errors, notes };
}
