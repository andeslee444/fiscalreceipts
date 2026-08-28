/**
 * gate 3 — render-live, MOBILE-VIEWPORT LEG (390×844)
 *
 * Legs: (m1) no page-level horizontal overflow, (m2) the primary value is on
 * screen, (m3) no label painted across its value, (m4) the site's own
 * navigation is usable — see runNavLeg at the bottom for why the first three
 * could not see the nav defect that shipped. (m5) no page-level horizontal
 * overflow in the TABLET band (768/900/1000px) — see runTabletOverflowLeg,
 * added for Sprint C Task C6 (ROADMAP #65) for the reason this file's other
 * four legs, all fixed at 390×844, could never have caught it: the defect
 * lived entirely between 768 and 1023px, a band none of them visit.
 *
 * PM-review Sprint 3 Task 1 / ROADMAP backlog #31.
 *
 * WHY THIS EXISTS. Sprint 2 shipped three mobile blockers that walked past a
 * 24-gate suite untouched and were caught only by human visual judging:
 *
 *   1. /companies/ rendered its Total-obligations column — the money, the
 *      whole point of the page — entirely off the right edge at 390px.
 *   2. /data/ pushed its Citation and "Scope — what one row is" columns
 *      off-canvas behind 250–400px rows that were ~85% empty.
 *   3. /companies/families/ hid the Source column (98px of overflow), which
 *      is that page's entire credibility claim.
 *
 * Every gate that drives a browser did so at desktop width, so the suite was
 * blind to this class by construction. This leg closes it.
 *
 * THREE ASSERTIONS, and the second and third are the ones that matter.
 * (m3) was added after PM Sprint 3's round-1 visual judging, which found a
 * defect BOTH earlier assertions pass: on the home page the mover title was
 * painted straight over its dollar delta. Nothing overflowed the document
 * ((m1) ok) and the figure's own box was inside the viewport ((m2) ok) — the
 * label simply overflowed its flex item and covered it. Two of the five
 * figures on the site's front page were unreadable. `/` WAS in this sample —
 * but overflow-only, so the front page's sole assertion was one the defect
 * could not trip. Both holes are closed below.
 *
 *   (m1) NO PAGE-LEVEL HORIZONTAL OVERFLOW —
 *        document.documentElement.scrollWidth <= clientWidth (+1px rounding)
 *        over a sample that includes every page class carrying a table or a
 *        wide chart.
 *
 *   (m2) THE MONEY IS ON SCREEN — for the value-bearing tables, the primary
 *        value element's bounding box lies fully inside the viewport
 *        (-1 <= rect.left, rect.right <= innerWidth + 1).
 *
 *        (m1) ALONE WOULD NOT HAVE CAUGHT ANY OF THE THREE. All three tables
 *        live inside an `overflow-x-auto` wrapper, so the page itself never
 *        overflowed — the container scrolled and the money sat off-screen
 *        behind it. A naive overflow check passes on all three defects.
 *
 *   (m3) THE LABEL IS NOT PAINTED OVER THE MONEY — where a row declares a
 *        `[data-mobile-pair-label]` / `[data-mobile-pair-value]` pair, their
 *        boxes must not intersect. A row that stacks label above value
 *        satisfies this by construction; a row whose label overflows its flex
 *        item and prints across the figure does not.
 *
 * NON-VACUITY. Every sampled page must resolve at least `min` value elements
 * (and, where the sample is row-scoped, at least `minRows` rows). A page that
 * silently stops rendering its table FAILS rather than passing on an empty
 * set.
 *
 * VIEWPORT CONVENTION. Plain 390×844 `viewport`, matching the sibling 390px
 * legs already in the suite (answerfold, receiptmoment, yearsmatrix) — not
 * Playwright `isMobile` emulation, so all four legs measure the same thing.
 * Headless chromium uses overlay scrollbars here (measured: clientWidth is a
 * full 390 on every sampled page), so (m1) has no scrollbar allowance to make.
 *
 * PRIMARY-VALUE CONTRACT. The value element is identified by a stable
 * `data-*` hook already in the DOM where one exists (`[data-external-source]`
 * on /companies/families/, `[data-dataset-rowcount]` on /data/,
 * `td[data-col]` on /years/) and by a minimal `data-primary-value` attribute
 * where the page had no hook for its money column (/companies/, /district/,
 * and /data/'s scope + citation cells). Never by matching on text.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

/** The viewport this leg measures at — iPhone 14/15 logical size. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Page-level overflow tolerance, in CSS px (sub-pixel layout rounding). */
const OVERFLOW_TOLERANCE_PX = 1;

/** Cap on elements measured per page, so /district/ and /years/ stay quick. */
const MEASURE_CAP = 300;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Deterministic instance pages, so the sample covers the templated page
 * classes (program / company / filing) and not only the singleton routes.
 * Same sidecars the other gates read; lowest-sorting id wins, so the sample
 * is stable across builds unless the corpus itself changes.
 */
export function computeMobileInstancePages() {
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  const filings = readJson(path.join(jsonDir, "filings_index.json")).filings ?? [];

  // Heaviest program page (the one the render-live gate also pins).
  const programPbl = programs.some((p) => p.pe_bli === "0606301D8Z")
    ? "0606301D8Z"
    : [...programs].sort((a, b) => a.pe_bli.localeCompare(b.pe_bli))[0]?.pe_bli;

  // Top company by obligations — the widest money string on any company page.
  const companySlug = entities[0]?.slug ?? "lockheed-martin";

  // A filing WITH mentions: those are the indexed ones that carry the
  // income/expense figures and the mention table.
  const filing = [...filings]
    .filter((f) => f.has_mentions)
    .sort((a, b) => a.filing_uuid.localeCompare(b.filing_uuid))[0];

  return {
    programPbl,
    companySlug,
    filingUuid: filing?.filing_uuid ?? null,
  };
}

/**
 * The sample. Every page class that carries a table or a wide chart is here;
 * `value` is present only where the page carries a primary value column.
 *
 * `ready` waits for the client islands to paint before measuring: /years/ is
 * a 27KB shell that hydrates its rows from /json/years_matrix.json, and
 * /flow/ fetches its Sankey payload — measuring either before it lands would
 * measure an empty page.
 */
export function buildMobileSample({ programPbl, companySlug, filingUuid }) {
  const sample = [
    {
      // THE GATE'S OWN BLIND SPOT, found by round-1 visual judging. `/` was
      // already in this sample — but overflow-only, so the ONLY thing measured
      // on the site's front page was `documentElement.scrollWidth`. The home
      // page then shipped the exact defect class this leg exists for: the
      // "Largest FY25→26 changes" rows drew the program title straight over
      // the dollar delta, so two of the five figures on the front door were
      // unreadable — and nothing overflowed, so (m1) passed on it.
      //
      // (m2) would not have caught it either: the figure's own box was inside
      // the viewport; the TITLE was painted across it. Hence (m3).
      path: "/",
      label: "home",
      value: {
        rowSelector: "[data-mover-row]",
        selector: "[data-primary-value='mover-change']",
        first: true,
        minRows: 5,
        min: 5,
        describe: "top-mover change figure",
      },
      pairs: {
        rowSelector: "[data-mover-row]",
        labelSelector: "[data-mobile-pair-label]",
        valueSelector: "[data-mobile-pair-value]",
        describe: "mover title vs change figure",
      },
    },
    {
      path: "/programs/",
      label: "programs index",
      value: {
        // Added with the §P2-1 restructure (Sprint 3 Task 3): this page used
        // to be overflow-only here while its two money columns sat off the
        // right edge inside the table's own scroll container — the exact
        // defect (m2) exists to catch. The FY26 request is the column the
        // page sorts on and the one a reader comes for.
        //
        // The CELL, not the figure inside it: 263 of the 1,741 programs have
        // no FY26 request and render an honest "—", so a [data-amount]
        // selector would make those rows unmeasurable (same rule as
        // /district/'s Linkable-dollars column).
        rowSelector: 'table[data-sort-table="programs"] tbody tr',
        selector: 'td[data-primary-value="fy2026-total"]',
        first: true,
        minRows: 50,
        min: 50,
        describe: "FY26-total cell",
      },
    },
    {
      path: "/companies/",
      label: "companies index",
      value: {
        rowSelector: 'table[data-sort-table="companies"] tbody tr',
        selector: 'td[data-primary-value="total-obligations"] [data-amount]',
        first: true,
        minRows: 50,
        min: 50,
        describe: "Total-obligations figure",
      },
    },
    {
      path: "/companies/families/",
      label: "entity families",
      value: {
        selector: "[data-external-source]",
        min: 10,
        describe: "Source (external reference) link",
      },
    },
    {
      path: "/data/",
      label: "data inventory + explorer",
      value: {
        rowSelector: "tr[data-dataset-card]",
        selector:
          "[data-dataset-rowcount], [data-primary-value='scope'], [data-primary-value='citation']",
        minRows: 10,
        min: 30,
        describe: "dataset row-count / citation / scope cell",
      },
    },
    {
      path: "/years/",
      label: "decade matrix",
      ready: { selector: "tr[data-program-row]", timeout: 45000 },
      value: {
        rowSelector: "tr[data-program-row]",
        // STRENGTHENED after round-1 judging. This used to be `td[data-col]`
        // + `first`, i.e. the LEFTMOST column's cell — a proxy for "the money
        // is on screen" that held only while the grid opened scrolled hard
        // left. It was passing on the defect all three judges reported: the
        // leftmost columns are FY2015A/FY2016A, which are empty for exactly
        // the newest, biggest programs §P2-2's row sort promotes to the top,
        // so "on screen" was satisfied by a column of em-dashes while the
        // column the grid is SORTED BY sat off the right edge.
        //
        // It now measures the sorted column itself, read from the table's own
        // `data-sorted-col`. That is strictly stronger: it ties the money in
        // frame to the money the page says it opens on, and it fails if the
        // grid ever sorts by a column it does not show.
        selectorFrom: {
          on: 'table[data-testid="years-matrix"]',
          attr: "data-sorted-col",
          template: 'td[data-col="{}"]',
        },
        first: true,
        minRows: 50,
        min: 50,
        describe: "sorted-column amount cell",
      },
    },
    {
      path: "/district/",
      label: "districts",
      value: {
        // The CELL, not the figure inside it: 5 of the 106 districts have no
        // crosswalked dollars and render an honest "—", so a [data-amount]
        // selector would make those rows unmeasurable. The cell box is the
        // money column's box, which is what "the money is on screen" means
        // for a table that stays a real table at 390 (the State column hides
        // below `sm` precisely to keep this column in frame).
        rowSelector: 'table[data-sort-table="districts"] tbody tr',
        selector: 'td[data-primary-value="linkable-dollars"]',
        first: true,
        minRows: 50,
        min: 50,
        describe: "Linkable-dollars cell",
      },
    },
    {
      // PM Sprint 3 Task 6 (§Coverage). A four-column table whose two widest
      // columns are prose — exactly the shape that put /data/'s Scope and
      // Citation cells off-canvas. The card treatment below `sm` is what keeps
      // them on screen, and (m2) is what proves it stayed that way.
      path: "/coverage/",
      label: "coverage map",
      value: {
        rowSelector: "table[data-coverage-map] tbody tr",
        selector: 'td[data-primary-value="covered"]',
        first: true,
        minRows: 10,
        min: 10,
        describe: "coverage-today cell",
      },
    },
    {
      // PM Sprint 3 judging round 1. /flow/ used to be overflow-only here, and
      // the round-1 judges found why that was not enough: the Sankey is an
      // 840px SVG inside a 356px scroller, so at 390 the right-hand column is
      // cut mid-word — and the "View as table" affordance the page tells the
      // reader to use instead rendered its Kind and Label columns wide enough
      // to push the AMOUNT column out of the scroller entirely. The stated
      // fallback for an unreadable chart carried no dollars at all.
      //
      // So the amount cells are measured with the disclosures OPEN: that is
      // the state the page's own copy sends the reader to.
      path: "/flow/",
      label: "flow-down Sankey",
      ready: { selector: '[data-testid="flow-chart"]', timeout: 45000 },
      openDetails: true,
      value: {
        rowSelector: "table[data-chart-table] tbody tr",
        selector: "td[data-primary-value='chart-amount']",
        first: true,
        minRows: 20,
        min: 20,
        describe: "chart-table amount cell",
      },
    },
    {
      // ROADMAP #29(c). The lineage diagrams are sized to their own content
      // rather than to a fixed 840px like /flow/'s Sankey, so most of them fit
      // a 390 viewport outright and the two that do not scroll inside their
      // own box. (m1) is what proves the page itself never moves sideways.
      //
      // (m2) measures the identity table's money cell with the disclosures
      // OPEN, for the same reason /flow/ does: the figure's own description
      // sends the reader to the table for the one number the diagram
      // deliberately does not draw, and /flow/'s table shipped with its
      // AMOUNT column pushed clean out of the scroller. The cell — not the
      // [data-amount] inside it — is measured, because 36 of the 84 rows
      // honestly render "—" and a [data-amount] selector would skip them.
      path: "/lineage/",
      label: "lineage identity map",
      openDetails: true,
      value: {
        rowSelector: 'table[data-basis-table="lineage-identities"] tbody tr',
        selector: "td[data-primary-value='lineage-amount']",
        first: true,
        minRows: 60,
        min: 60,
        describe: "identity FY2026 request cell",
      },
    },
    {
      // Round-1 judges: every feed card kept its desktop two-column row at
      // 390, squeezing the headline into ~130px (one or two words per line)
      // while the figure column sat `shrink-0` beside it. The magnitude pair
      // is the whole point of the §P1-8 work, so it gets a value assertion.
      path: "/feed/",
      label: "feed",
      value: {
        rowSelector: "[data-feed-card]",
        selector: "[data-primary-value='feed-figure']",
        first: true,
        minRows: 30,
        min: 30,
        describe: "feed headline figure",
      },
      pairs: {
        rowSelector: "[data-feed-card]",
        labelSelector: "[data-mobile-pair-label]",
        valueSelector: "[data-mobile-pair-value]",
        describe: "feed card headline vs figure",
      },
    },
    { path: `/program/${programPbl}/`, label: "program page" },
    { path: `/company/${companySlug}/`, label: "company page" },
    { path: "/methodology/", label: "methodology" },
  ];

  if (filingUuid) {
    sample.push({ path: `/filing/${filingUuid}/`, label: "filing page" });
  }

  return sample;
}

/**
 * In-page measurement. Runs once per page with the whole config so the round
 * trip is a single evaluate() and the rects are all read from one layout.
 */
function measureInPage({ cfg, tolerance, cap }) {
  const de = document.documentElement;
  const vw = window.innerWidth;

  const out = {
    innerWidth: vw,
    docScrollWidth: de.scrollWidth,
    docClientWidth: de.clientWidth,
    overflowPx: de.scrollWidth - de.clientWidth,
    // Widest non-scroll-contained offender, for a diagnosable failure message.
    widest: null,
    rows: null,
    measured: 0,
    offScreen: [],
    emptyRows: 0,
    // (m3) label/value collisions — see the `pairs` block below.
    pairRows: 0,
    pairsMeasured: 0,
    collisions: [],
  };

  if (out.overflowPx > tolerance) {
    let worst = null;
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= vw + tolerance) continue;
      // Ignore elements that overflow INSIDE a deliberately scrollable
      // ancestor — those do not push the document wide.
      let a = el.parentElement;
      let contained = false;
      while (a && a !== de) {
        if (a.scrollWidth > a.clientWidth + 1) {
          contained = true;
          break;
        }
        a = a.parentElement;
      }
      if (contained) continue;
      if (!worst || r.right > worst.right) {
        worst = {
          right: r.right,
          tag: el.tagName.toLowerCase(),
          cls: String(el.getAttribute("class") ?? "").slice(0, 70),
          text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        };
      }
    }
    out.widest = worst;
  }

  const v = cfg.value;
  if (v) {
    // A selector the page itself names (see /years/): read the attribute off
    // the declaring element and substitute it. An absent or empty attribute is
    // left as an unresolvable selector so the non-vacuity floor FAILS rather
    // than the assertion silently measuring nothing.
    if (v.selectorFrom) {
      const host = document.querySelector(v.selectorFrom.on);
      const key = host ? host.getAttribute(v.selectorFrom.attr) : null;
      out.resolvedSelector = key
        ? v.selectorFrom.template.replace("{}", key)
        : "__unresolved__";
      v.selector = out.resolvedSelector;
    }
    let els = [];
    if (v.rowSelector) {
      const rows = Array.from(document.querySelectorAll(v.rowSelector));
      out.rows = rows.length;
      for (const row of rows.slice(0, cap)) {
        const found = v.first
          ? [row.querySelector(v.selector)].filter(Boolean)
          : Array.from(row.querySelectorAll(v.selector));
        if (found.length === 0) out.emptyRows += 1;
        els.push(...found);
      }
    } else {
      els = Array.from(document.querySelectorAll(v.selector)).slice(0, cap);
    }

    out.measured = els.length;
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left >= -tolerance && r.right <= vw + tolerance) continue;
      out.offScreen.push({
        i,
        left: Math.round(r.left),
        right: Math.round(r.right),
        text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
      });
    }
  }

  // ── (m3) a label must never be painted across its own value ─────────────
  //
  // (m1) and (m2) both pass on text-over-text: the document does not widen
  // and the value's own box stays inside the viewport — the label simply
  // overflows its flex item and paints over it. That is what shipped on the
  // home page. So: when a row declares a label/value pair, their boxes must
  // not intersect. Rows that stack (label ABOVE value) are fine by
  // construction, because vertical separation means no intersection.
  const p = cfg.pairs;
  if (p) {
    const rows = Array.from(document.querySelectorAll(p.rowSelector));
    out.pairRows = rows.length;
    for (const row of rows.slice(0, cap)) {
      const label = row.querySelector(p.labelSelector);
      const value = row.querySelector(p.valueSelector);
      if (!label || !value) continue;
      out.pairsMeasured += 1;
      // THE PAINTED extent, not the element's own border box.
      //
      // The first cut of this check measured `label.getBoundingClientRect()`
      // and passed on the very defect it was written for: the label is a
      // blockified flex item with `min-w-0`, so its BOX shrinks to almost
      // nothing while its inline text overflows and paints across the figure.
      // The box never intersected; the glyphs did. Recorded because a check
      // that cannot fail on its own motivating case is worse than no check.
      //
      // Inline descendants and text line-boxes DO report the painted extent,
      // so the label's extent is the union of its own rect, its descendants'
      // rects, and its text rects.
      const painted = (el) => {
        let l = Infinity;
        let r = -Infinity;
        let t = Infinity;
        let btm = -Infinity;
        const add = (x) => {
          if (x.width === 0 && x.height === 0) return;
          l = Math.min(l, x.left);
          r = Math.max(r, x.right);
          t = Math.min(t, x.top);
          btm = Math.max(btm, x.bottom);
        };
        add(el.getBoundingClientRect());
        for (const d of el.querySelectorAll("*")) add(d.getBoundingClientRect());
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const x of range.getClientRects()) add(x);
        return { left: l, right: r, top: t, bottom: btm, width: r - l };
      };
      const a = painted(label);
      const b = painted(value);
      if (!(a.width > 0) || !(b.width > 0)) continue;
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > tolerance && overlapY > tolerance) {
        out.collisions.push({
          label: (label.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 44),
          value: (value.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24),
          overlapX: Math.round(overlapX),
          overlapY: Math.round(overlapY),
        });
      }
    }
  }

  return out;
}

/**
 * The leg. Callable with an existing browser (gate 3 passes its own) or
 * standalone (scripts/run-mobile-leg.mjs launches one).
 */
export async function runMobileLeg({ baseUrl, browser }) {
  const errors = [];
  const notes = [];

  const instances = computeMobileInstancePages();
  const sample = buildMobileSample(instances);

  notes.push(
    `mobile leg @ ${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height}: ${sample.length} pages — ${sample
      .map((s) => s.path)
      .join(" ")}`
  );

  const ownBrowser = !browser;
  const b = browser ?? (await chromium.launch({ headless: true }));
  const context = await b.newContext({ viewport: MOBILE_VIEWPORT });

  let overflowOk = 0;
  let valuePages = 0;
  let valueElements = 0;
  let pairPages = 0;
  let pairElements = 0;

  try {
    for (const cfg of sample) {
      const page = await context.newPage();
      try {
        const response = await page.goto(`${baseUrl}${cfg.path}`, {
          waitUntil: "networkidle",
          timeout: 60000,
        });
        if (response && response.status() >= 400) {
          errors.push(`mobile ${cfg.path}: HTTP ${response.status()}`);
          continue;
        }

        if (cfg.ready) {
          try {
            await page.waitForSelector(cfg.ready.selector, {
              timeout: cfg.ready.timeout ?? 30000,
            });
          } catch {
            errors.push(
              `mobile ${cfg.path}: island never rendered — "${cfg.ready.selector}" absent after ${cfg.ready.timeout ?? 30000}ms (cannot measure an empty page)`
            );
            continue;
          }
        }
        // Some affordances are measured in the state the page's own copy
        // sends the reader to (see /flow/): open every <details> first.
        if (cfg.openDetails) {
          await page.evaluate(() => {
            for (const d of document.querySelectorAll("details")) d.open = true;
          });
          await page.waitForTimeout(200);
        }

        // One frame for fonts/layout to settle after hydration.
        await page.waitForTimeout(300);

        const m = await page.evaluate(measureInPage, {
          cfg,
          tolerance: OVERFLOW_TOLERANCE_PX,
          cap: MEASURE_CAP,
        });

        // ── (m1) page-level horizontal overflow ──────────────────────────
        if (m.overflowPx > OVERFLOW_TOLERANCE_PX) {
          const w = m.widest
            ? ` — widest offender <${m.widest.tag} class="${m.widest.cls}"> right=${Math.round(m.widest.right)}px "${m.widest.text}"`
            : "";
          errors.push(
            `mobile ${cfg.path} (${cfg.label}): page scrolls horizontally at ${MOBILE_VIEWPORT.width}px — documentElement.scrollWidth ${m.docScrollWidth} > clientWidth ${m.docClientWidth} (+${m.overflowPx}px)${w}`
          );
        } else {
          overflowOk += 1;
        }

        // ── (m2) the primary value is on screen ──────────────────────────
        if (cfg.value) {
          const v = cfg.value;
          valuePages += 1;

          if (v.rowSelector && (m.rows ?? 0) < v.minRows) {
            errors.push(
              `mobile ${cfg.path}: only ${m.rows ?? 0} row(s) matched "${v.rowSelector}" (need >= ${v.minRows}) — the sample is vacuous`
            );
          }
          const shown = m.resolvedSelector ?? v.selector;
          if (m.measured < v.min) {
            errors.push(
              `mobile ${cfg.path}: only ${m.measured} ${v.describe}(s) matched "${shown}" (need >= ${v.min}) — the sample is vacuous`
            );
          }
          if (v.first && v.rowSelector && m.emptyRows > 0) {
            errors.push(
              `mobile ${cfg.path}: ${m.emptyRows} row(s) carry no ${v.describe} ("${shown}") — every row must state its value`
            );
          }
          valueElements += m.measured;

          if (m.offScreen.length > 0) {
            const sampleTxt = m.offScreen
              .slice(0, 3)
              .map(
                (o) =>
                  `row ${o.i}: "${o.text}" left=${o.left} right=${o.right} > viewport ${m.innerWidth}`
              )
              .join(" | ");
            errors.push(
              `mobile ${cfg.path} (${cfg.label}): ${m.offScreen.length}/${m.measured} ${v.describe}(s) are outside the ${m.innerWidth}px viewport — ${sampleTxt}`
            );
          } else if (m.measured > 0) {
            notes.push(
              `mobile ${cfg.path}: ${m.measured} ${v.describe}(s) fully on screen ✓`
            );
          }
        }

        // ── (m3) label never painted across its value ────────────────────
        if (cfg.pairs) {
          const p = cfg.pairs;
          pairPages += 1;
          if ((m.pairRows ?? 0) < (p.minRows ?? 5)) {
            errors.push(
              `mobile ${cfg.path}: only ${m.pairRows ?? 0} row(s) matched "${p.rowSelector}" for the ${p.describe} check — the sample is vacuous`
            );
          }
          if (m.pairsMeasured < (p.min ?? 5)) {
            errors.push(
              `mobile ${cfg.path}: only ${m.pairsMeasured} ${p.describe} pair(s) resolved both "${p.labelSelector}" and "${p.valueSelector}" (need >= ${p.min ?? 5}) — the sample is vacuous`
            );
          }
          pairElements += m.pairsMeasured;
          if (m.collisions.length > 0) {
            const s = m.collisions
              .slice(0, 3)
              .map(
                (c) =>
                  `"${c.label}" overprints "${c.value}" by ${c.overlapX}x${c.overlapY}px`
              )
              .join(" | ");
            errors.push(
              `mobile ${cfg.path} (${cfg.label}): ${m.collisions.length}/${m.pairsMeasured} ${p.describe} pair(s) collide — text is painted over the money — ${s}`
            );
          } else if (m.pairsMeasured > 0) {
            notes.push(
              `mobile ${cfg.path}: ${m.pairsMeasured} ${p.describe} pair(s) with no label/value collision ✓`
            );
          }
        }
      } catch (e) {
        errors.push(`mobile ${cfg.path}: navigation/measure failed: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    if (ownBrowser) await b.close();
  }

  // ── (m4) the site's own navigation is usable at 390 ────────────────────
  await runNavLeg({ baseUrl, browser: b, errors, notes });

  // ── (m5) no page-level horizontal overflow in the 768–1023 tablet band ──
  await runTabletOverflowLeg({ baseUrl, browser: b, errors, notes });

  notes.push(
    `mobile leg: ${overflowOk}/${sample.length} pages free of page-level horizontal overflow; ${valueElements} value element(s) measured across ${valuePages} value-bearing page(s); ${pairElements} label/value pair(s) checked for collision across ${pairPages} page(s)`
  );

  return { pass: errors.length === 0, errors, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// (m4) MOBILE NAVIGATION — the one control every page depends on
// ─────────────────────────────────────────────────────────────────────────────
//
// Below md the hamburger IS the site's navigation: nine destinations, on every
// page, with no other way to reach them. It shipped broken and no gate saw it.
//
// The panel is `absolute left-0 top-14 w-full`, and the span wrapping the
// trigger in layout.tsx carried `relative` — so that 32px span became the
// panel's containing block and `w-full` resolved to 32px. Every link rendered
// in a 24px box pinned to the right edge, clipped to "Pro", "Com", "Dis"…, and
// opening the menu widened the document past the viewport. Two of three
// round-3 judges independently called it the largest defect at 390.
//
// The legs (m1-m3) could not see it because they measure the page at REST;
// this one is only true after a click. So: open the menu, and require that
// every link is inside the viewport, wide enough to read, and not truncated
// (scrollWidth <= clientWidth on the link's own text box), and that opening it
// does not introduce horizontal overflow.
//
// Vacuity guard: the trigger must exist, the panel must appear, and it must
// carry at least MIN_NAV_LINKS links — a menu that renders nothing passes
// every geometric test ever written.
const MIN_NAV_LINKS = 5;
/** A link narrower than this cannot be showing its label. */
const MIN_NAV_LINK_WIDTH_PX = 64;

async function runNavLeg({ baseUrl, browser, errors, notes }) {
  const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(300);

    const trigger = await page.$('button[aria-controls="mobile-nav-panel"]');
    if (!trigger) {
      errors.push(
        'mobile nav: no button[aria-controls="mobile-nav-panel"] at 390 — the site has no mobile navigation to check',
      );
      return;
    }
    const beforeWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    await trigger.click();
    // Settled, not mid-animation: two judges checked at 2.5s, so does this.
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      const panel = document.getElementById("mobile-nav-panel");
      if (!panel) return { panel: false };
      const pr = panel.getBoundingClientRect();
      const links = [...panel.querySelectorAll("a")].map((a) => {
        const r = a.getBoundingClientRect();
        return {
          text: (a.textContent || "").trim(),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          // A label clipped by its own box: the text is wider than the box.
          clipped: a.scrollWidth > a.clientWidth + 1,
        };
      });
      return {
        panel: true,
        panelLeft: Math.round(pr.left),
        panelWidth: Math.round(pr.width),
        docScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        links,
      };
    });

    if (!m.panel) {
      errors.push("mobile nav: the trigger was clicked but #mobile-nav-panel never rendered");
      return;
    }
    if (m.links.length < MIN_NAV_LINKS) {
      errors.push(
        `mobile nav is VACUOUS: the open panel holds ${m.links.length} link(s), fewer than ${MIN_NAV_LINKS} — nothing to measure`,
      );
      return;
    }
    if (m.docScrollWidth > beforeWidth + OVERFLOW_TOLERANCE_PX) {
      errors.push(
        `mobile nav: opening the menu widens the document from ${beforeWidth}px to ${m.docScrollWidth}px — the panel is outside the viewport`,
      );
    }
    const offscreen = m.links.filter((l) => l.left < -OVERFLOW_TOLERANCE_PX || l.right > m.innerWidth + OVERFLOW_TOLERANCE_PX);
    if (offscreen.length > 0) {
      errors.push(
        `mobile nav: ${offscreen.length}/${m.links.length} link(s) fall outside the ${m.innerWidth}px viewport — ` +
          offscreen.slice(0, 3).map((l) => `"${l.text}" left=${l.left} right=${l.right}`).join(" | "),
      );
    }
    const narrow = m.links.filter((l) => l.width < MIN_NAV_LINK_WIDTH_PX);
    if (narrow.length > 0) {
      errors.push(
        `mobile nav: ${narrow.length}/${m.links.length} link(s) are under ${MIN_NAV_LINK_WIDTH_PX}px wide (panel is ${m.panelWidth}px at left=${m.panelLeft}) — ` +
          narrow.slice(0, 3).map((l) => `"${l.text}" ${l.width}px`).join(" | "),
      );
    }
    const clipped = m.links.filter((l) => l.clipped);
    if (clipped.length > 0) {
      errors.push(
        `mobile nav: ${clipped.length}/${m.links.length} link label(s) are clipped by their own box — ` +
          clipped.slice(0, 3).map((l) => `"${l.text}"`).join(" | "),
      );
    }
    if (offscreen.length === 0 && narrow.length === 0 && clipped.length === 0) {
      notes.push(
        `mobile nav: ${m.links.length} link(s) in a ${m.panelWidth}px panel, all on screen, none clipped ✓`,
      );
    }
  } catch (e) {
    errors.push(`mobile nav: check failed: ${e.message}`);
  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (m5) TABLET-BAND HORIZONTAL OVERFLOW — 768, 900, 1000px
// ─────────────────────────────────────────────────────────────────────────────
//
// Sprint C Task C6 (ROADMAP #65). Tailwind's `container` utility clamps
// max-width to the CURRENT breakpoint (768 at md, 1024 at lg, …), not to
// the viewport width, so any `container` row whose content needs more room
// than that clamp allows overflows the document for the ENTIRE span between
// one breakpoint and the next — concretely 768–1023px, where `container` is
// pinned to 768px right up until the viewport reaches 1024. The site header
// hit exactly this: nine nav links + search + receipts toggle needed more
// than 768px, the right-hand cluster is `shrink-0` so nothing gave way, and
// `documentElement.scrollWidth` measured +167px past `clientWidth` at 768,
// +101px at 900, +51px at 1000 — clean again at 1024, where `container`
// itself widens to match.
//
// (m1) runs only at 390×844 — strictly below this band — so it could not
// have caught this, and neither could (m4), which opens the mobile nav (a
// 390-only affordance) rather than measuring the header at rest. This leg
// is (m1)'s same assertion — document.documentElement.scrollWidth <=
// clientWidth (+1px rounding) — re-run at three widths inside the band that
// was actually broken.
//
// PAGE SAMPLE. Reuses buildMobileSample()'s page list (every page class
// carrying a table or a wide chart, plus templated program/company/filing
// instances) rather than a bespoke list — the header markup is shared
// layout-wide, so any page trips the same defect, and reusing the existing,
// already-curated sample avoids a second list to keep in sync. Only the
// `path`/`ready`/`openDetails` fields are used; `value`/`pairs` are
// 390-specific and not relevant to a page-level overflow check.
//
// NON-VACUITY. If the page sample resolves to zero pages (the upstream
// sidecars are empty/missing), this leg FAILS outright rather than passing
// on nothing measured.
const TABLET_WIDTHS = [768, 900, 1000];

/**
 * In-page measurement — the same overflow computation as (m1)'s block in
 * measureInPage above, but standalone: page.evaluate() serializes this
 * function's own source and re-runs it inside the browser, so it cannot
 * close over anything else defined in this module. Duplicated rather than
 * shared for that reason (see measureInPage's near-identical (m1) block).
 */
function measureTabletOverflow({ tolerance }) {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const overflowPx = de.scrollWidth - de.clientWidth;
  const out = {
    innerWidth: vw,
    docScrollWidth: de.scrollWidth,
    docClientWidth: de.clientWidth,
    overflowPx,
    widest: null,
  };
  if (overflowPx > tolerance) {
    let worst = null;
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= vw + tolerance) continue;
      // Ignore elements that overflow INSIDE a deliberately scrollable
      // ancestor — those do not push the document wide.
      let a = el.parentElement;
      let contained = false;
      while (a && a !== de) {
        if (a.scrollWidth > a.clientWidth + 1) {
          contained = true;
          break;
        }
        a = a.parentElement;
      }
      if (contained) continue;
      if (!worst || r.right > worst.right) {
        worst = {
          right: r.right,
          tag: el.tagName.toLowerCase(),
          cls: String(el.getAttribute("class") ?? "").slice(0, 70),
          text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        };
      }
    }
    out.widest = worst;
  }
  return out;
}

async function runTabletOverflowLeg({ baseUrl, browser, errors, notes }) {
  const instances = computeMobileInstancePages();
  const pages = buildMobileSample(instances).map((s) => ({
    path: s.path,
    label: s.label,
    ready: s.ready,
    openDetails: s.openDetails,
  }));

  if (pages.length === 0) {
    errors.push(
      "mobile (m5) tablet-band overflow: page sample resolved to 0 pages — non-vacuity floor tripped, nothing was measured",
    );
    return;
  }

  let checksOk = 0;
  let checksTotal = 0;

  for (const width of TABLET_WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      for (const cfg of pages) {
        checksTotal += 1;
        const page = await context.newPage();
        try {
          const response = await page.goto(`${baseUrl}${cfg.path}`, {
            waitUntil: "networkidle",
            timeout: 60000,
          });
          if (response && response.status() >= 400) {
            errors.push(`mobile (m5) ${width}px ${cfg.path}: HTTP ${response.status()}`);
            continue;
          }
          if (cfg.ready) {
            try {
              await page.waitForSelector(cfg.ready.selector, {
                timeout: cfg.ready.timeout ?? 30000,
              });
            } catch {
              errors.push(
                `mobile (m5) ${width}px ${cfg.path}: island never rendered — "${cfg.ready.selector}" absent (cannot measure an empty page)`,
              );
              continue;
            }
          }
          if (cfg.openDetails) {
            await page.evaluate(() => {
              for (const d of document.querySelectorAll("details")) d.open = true;
            });
            await page.waitForTimeout(200);
          }
          await page.waitForTimeout(300);

          const m = await page.evaluate(measureTabletOverflow, {
            tolerance: OVERFLOW_TOLERANCE_PX,
          });

          if (m.overflowPx > OVERFLOW_TOLERANCE_PX) {
            const w = m.widest
              ? ` — widest offender <${m.widest.tag} class="${m.widest.cls}"> right=${Math.round(m.widest.right)}px "${m.widest.text}"`
              : "";
            errors.push(
              `mobile (m5) ${cfg.path} (${cfg.label}) scrolls horizontally at ${width}px (tablet band): documentElement.scrollWidth ${m.docScrollWidth} > clientWidth ${m.docClientWidth} (+${m.overflowPx}px)${w}`,
            );
          } else {
            checksOk += 1;
          }
        } catch (e) {
          errors.push(`mobile (m5) ${width}px ${cfg.path}: navigation/measure failed: ${e.message}`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }

  notes.push(
    `mobile (m5) tablet-band overflow: ${checksOk}/${checksTotal} page×width check(s) free of horizontal overflow across [${TABLET_WIDTHS.join(", ")}]px on ${pages.length} page(s)`,
  );
}
