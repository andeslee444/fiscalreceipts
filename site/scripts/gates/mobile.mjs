/**
 * gate 3 — render-live, MOBILE-VIEWPORT LEG (390×844)
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
 * TWO ASSERTIONS, and the second is the one that matters:
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
    { path: "/", label: "home" },
    { path: "/programs/", label: "programs index" },
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
        selector: "td[data-col]",
        first: true,
        minRows: 50,
        min: 50,
        describe: "first fiscal-year amount cell",
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
      path: "/flow/",
      label: "flow-down Sankey",
      ready: { selector: '[data-testid="flow-chart"]', timeout: 45000 },
    },
    { path: "/feed/", label: "feed" },
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
          if (m.measured < v.min) {
            errors.push(
              `mobile ${cfg.path}: only ${m.measured} ${v.describe}(s) matched "${v.selector}" (need >= ${v.min}) — the sample is vacuous`
            );
          }
          if (v.first && v.rowSelector && m.emptyRows > 0) {
            errors.push(
              `mobile ${cfg.path}: ${m.emptyRows} row(s) carry no ${v.describe} ("${v.selector}") — every row must state its value`
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

  notes.push(
    `mobile leg: ${overflowOk}/${sample.length} pages free of page-level horizontal overflow; ${valueElements} value element(s) measured across ${valuePages} value-bearing page(s)`
  );

  return { pass: errors.length === 0, errors, notes };
}
