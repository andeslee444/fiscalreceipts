#!/usr/bin/env node
/**
 * capture-5e-visuals.mjs — Phase 5E visual judge evidence pack.
 *
 * Usage: node docs/superpowers/reviews/5e-visual/capture-5e-visuals.mjs
 *
 * Serves site/out exactly the way the gate suite does (imports the gates'
 * own startServer from site/scripts/serve-static.mjs — /config.json is
 * answered with { assetBaseUrl: "/assets" } and ../data/site is mounted at
 * /assets/ with Range support), then captures via Playwright at
 * deviceScaleFactor 2. PNGs land in this directory.
 *
 *   years-1440.png            /years/ default 12-column decade view, top of
 *                             table + edition-tagged headers + legend + controls
 *   years-1440-expanded.png   one org section (DARPA) open, one program's
 *                             J-book project sub-rows expanded
 *   years-1440-picker.png     column picker clip — Decade | PB2026 detail groups
 *   years-1440-filtered.png   text filter "missile" narrowing the rows
 *   years-768.png             default view, tablet
 *   years-390.png             default view, mobile, grid mid-horizontal-scroll
 *                             (sticky first column must be holding)
 *   program-decade-1440.png   /program/0607136A/ (full tier) decade section:
 *                             sparkline with an FY2023 gap + asked-vs-spent
 *                             strip + value grid
 *   program-decade-rollup-1440.png
 *                             /program/0605625A/ (rollup tier) same section
 *   program-decade-cite-1440.png
 *                             a decade grid value clicked → citation panel open
 *   feed-rva-1440.png         /feed/ request-vs-actuals gap section, cards visible
 */

import { startServer } from "../../../../site/scripts/serve-static.mjs";
import { chromium } from "../../../../site/node_modules/playwright/index.mjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const siteRoot = path.join(repoRoot, "site");
const outDir = __dirname; // PNGs live next to the rubric

// 4179, not the gates' default 4173 — the gate suite (scripts/verify.mjs)
// may hold 4173 concurrently; startServer(port) keeps the exact same
// serving convention (out/ + /assets/ + hermetic /config.json) either way.
const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 700;

/** Filter query for years-1440-filtered (25 matches at time of writing). */
const FILTER_QUERY = "missile";

/** Full-tier PE: FY2015–FY2024 actuals with an FY2023 gap + asked-vs-spent. */
const FULL_PE = "0607136A"; // Blackhawk Product Improvement Program (Army)
/** Rollup-tier PE: 9 actuals with an FY2017 gap + a large asked-vs-spent. */
const ROLLUP_PE = "0605625A"; // Manned Ground Vehicle (Army, R-1/P-1 summary)

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitSettle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    // timeout OK — continue
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function gotoYears(page) {
  await page.goto(`${BASE_URL}/years/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  // The matrix island fetches years_matrix.json client-side — wait for the table.
  await page.waitForSelector('[data-testid="years-matrix"]', { timeout: 20000 });
  await waitSettle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

async function gotoProgram(page, pe) {
  await page.goto(`${BASE_URL}/program/${pe}/`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await waitSettle(page);
  await page.waitForSelector('[data-testid="decade-trajectory"]', { timeout: 15000 });
}

/** Scroll the window so the decade card (incl. its heading) fills the fold. */
async function scrollToDecade(page, offsetPx = 170) {
  await page.evaluate((off) => {
    const el = document.querySelector('[data-testid="decade-trajectory"]');
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - off));
  }, offsetPx);
  // .decade-draw is a load-time opacity animation (~2×--motion-story) — let
  // it reach its final frame before the screenshot.
  await page.waitForTimeout(1000);
}

/** Scroll the window so the /years/ grid container sits near the top. */
async function scrollGridIntoView(page, topOffset = 90) {
  await page.evaluate((off) => {
    const c = document.querySelector('[data-testid="years-matrix"]').parentElement;
    const top = c.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - off));
  }, topOffset);
  await page.waitForTimeout(150);
}

async function capture(page, filePath, options = {}) {
  const shot = await page.screenshot({ fullPage: false, type: "png", ...options });
  fs.writeFileSync(filePath, shot);
  const stat = fs.statSync(filePath);
  console.log(`  wrote ${path.basename(filePath)} (${stat.size} bytes)`);
  return stat.size;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Preflight: the built pages this pack depends on.
  for (const rel of [
    "out/years/index.html",
    `out/program/${FULL_PE}/index.html`,
    `out/program/${ROLLUP_PE}/index.html`,
    "out/feed/index.html",
    "out/json/years_matrix.json",
  ]) {
    if (!fs.existsSync(path.join(siteRoot, rel))) {
      throw new Error(`preflight: ${rel} missing — build out/ first`);
    }
  }
  const matrix = JSON.parse(
    fs.readFileSync(path.join(siteRoot, "out", "json", "years_matrix.json"), "utf8"),
  );
  const nDefault = (matrix.decade_default_columns ?? []).length;
  if (nDefault !== 12) {
    throw new Error(`preflight: expected 12 decade default columns, got ${nDefault}`);
  }
  console.log(`preflight ok — ${nDefault} decade default columns; PEs ${FULL_PE}, ${ROLLUP_PE}`);

  const { close } = await startServer(PORT);
  console.log("Server started at", BASE_URL);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  const shoot = async (label, width, height, fn) => {
    console.log(`\nCapturing ${label} ...`);
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    const pg = await ctx.newPage();
    try {
      const captureOptions = (await fn(pg)) ?? {};
      const size = await capture(pg, path.join(outDir, `${label}.png`), captureOptions);
      results.push({ file: `${label}.png`, width, height, size, ok: true });
    } catch (err) {
      console.error(`  ERROR on ${label}: ${err.message}`);
      results.push({ file: `${label}.png`, ok: false, error: err.message });
    }
    await pg.close();
    await ctx.close();
  };

  try {
    // ── 1 · years-1440 — default decade view, headers + legend + controls ──
    await shoot("years-1440", 1440, 900, async (pg) => {
      await gotoYears(pg);
      // The intro block above the grid can push the column headers below the
      // fold; if so, park the controls near the top so headers + edition
      // tags + legend + controls are all in frame.
      await pg.evaluate(() => {
        const thead = document.querySelector('[data-testid="years-matrix"] thead');
        if (thead.getBoundingClientRect().bottom > window.innerHeight - 300) {
          const controls = document.querySelector('[data-testid="years-filter"]')
            .parentElement;
          const top = controls.getBoundingClientRect().top + window.scrollY;
          window.scrollTo(0, Math.max(0, top - 16));
        }
      });
      await pg.waitForTimeout(200);
    });

    // ── 2 · years-1440-expanded — DARPA open, one program's projects out ──
    await shoot("years-1440-expanded", 1440, 900, async (pg) => {
      await gotoYears(pg);
      // Collapse every org section, then re-expand DARPA (its programs all
      // carry J-book project sub-rows).
      await pg.evaluate(() => {
        const toggles = [
          ...document.querySelectorAll("tr[data-org-row] button[aria-expanded]"),
        ];
        for (const btn of toggles) {
          if (btn.getAttribute("aria-expanded") === "true") btn.click();
        }
      });
      await pg.waitForTimeout(200);
      await pg.evaluate(() => {
        const darpa = [
          ...document.querySelectorAll("tr[data-org-row] button[aria-expanded]"),
        ].find((btn) => btn.textContent.includes("DARPA"));
        if (!darpa) throw new Error("DARPA org toggle not found");
        darpa.click();
      });
      await pg.waitForTimeout(200);
      await pg.locator("[data-expand]").first().click();
      await pg.waitForTimeout(300);
      // Park the DARPA section just under the sticky header inside the grid.
      await pg.evaluate(() => {
        const c = document.querySelector('[data-testid="years-matrix"]').parentElement;
        const darpaRow = [...document.querySelectorAll("tr[data-org-row]")].find((r) =>
          r.textContent.includes("DARPA"),
        );
        c.scrollTop = Math.max(0, darpaRow.offsetTop - 44);
      });
      await scrollGridIntoView(pg);
      await pg.waitForTimeout(SETTLE_MS);
    });

    // ── 3 · years-1440-picker — Decade | PB2026 detail grouping clip ──────
    await shoot("years-1440-picker", 1440, 900, async (pg) => {
      await gotoYears(pg);
      // The picker is an always-visible chip group; clip from the controls
      // row through the honesty legend so both group labels ("Decade",
      // "PB2026 detail") and the edition legend are in frame.
      const clip = await pg.evaluate(() => {
        const controls = document.querySelector('[data-testid="years-filter"]')
          .parentElement;
        const cite = document.querySelector('[data-testid="cite-legend"]');
        const legend = document.querySelector('[data-testid="edition-legend"]');
        const topRect = controls.getBoundingClientRect();
        const bottomRect = (cite ?? legend).getBoundingClientRect();
        return {
          x: Math.max(0, topRect.left - 8),
          y: Math.max(0, topRect.top - 8),
          width: Math.min(topRect.width + 16, window.innerWidth),
          height: bottomRect.bottom - topRect.top + 16,
        };
      });
      return { clip };
    });

    // ── 4 · years-1440-filtered — "missile" narrows the rows ──────────────
    await shoot("years-1440-filtered", 1440, 900, async (pg) => {
      await gotoYears(pg);
      await pg.locator('[data-testid="years-filter"]').fill(FILTER_QUERY);
      await pg.waitForTimeout(400);
    });

    // ── 5a · years-768 — default view, tablet ─────────────────────────────
    await shoot("years-768", 768, 1024, async (pg) => {
      await gotoYears(pg);
    });

    // ── 5b · years-390 — mobile, grid mid-horizontal-scroll ───────────────
    await shoot("years-390", 390, 844, async (pg) => {
      await gotoYears(pg);
      await scrollGridIntoView(pg, 60);
      await pg.evaluate(() => {
        const c = document.querySelector('[data-testid="years-matrix"]').parentElement;
        c.scrollLeft = Math.round((c.scrollWidth - c.clientWidth) / 2);
      });
      await pg.waitForTimeout(SETTLE_MS);
    });

    // ── 6 · program-decade-1440 — full tier: gap + asked-vs-spent + grid ──
    await shoot("program-decade-1440", 1440, 900, async (pg) => {
      await gotoProgram(pg, FULL_PE);
      await pg.waitForSelector('[data-testid="asked-vs-spent"]', { timeout: 10000 });
      await scrollToDecade(pg);
    });

    // ── 7 · program-decade-rollup-1440 — rollup tier, same section ────────
    await shoot("program-decade-rollup-1440", 1440, 900, async (pg) => {
      await gotoProgram(pg, ROLLUP_PE);
      await pg.waitForSelector('[data-testid="asked-vs-spent"]', { timeout: 10000 });
      await scrollToDecade(pg);
    });

    // ── 8 · program-decade-cite-1440 — decade value → citation panel ──────
    await shoot("program-decade-cite-1440", 1440, 900, async (pg) => {
      await gotoProgram(pg, FULL_PE);
      await scrollToDecade(pg);
      const cell = pg
        .locator('[data-decade-cell] [data-amount][data-fact-id]')
        .first();
      if ((await cell.count()) === 0) {
        throw new Error("no state-A decade cite found in the value grid");
      }
      await cell.click();
      await pg.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });
      // The panel resolves the fact lazily from cite-shards — let the source
      // card render before shooting.
      await pg.waitForTimeout(1400);
    });

    // ── 9 · feed-rva-1440 — request-vs-actuals gap section ────────────────
    await shoot("feed-rva-1440", 1440, 900, async (pg) => {
      await pg.goto(`${BASE_URL}/feed/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await waitSettle(pg);
      await pg.evaluate(() => {
        const el = document.getElementById("feed-request_vs_actuals_gap");
        if (!el) throw new Error("feed-request_vs_actuals_gap anchor missing");
        const top = el.getBoundingClientRect().top + window.scrollY;
        // 96px clears the sticky header so the section h2 stays visible.
        window.scrollTo(0, Math.max(0, top - 96));
      });
      await pg.waitForTimeout(SETTLE_MS);
    });
  } finally {
    await browser.close();
    await close();
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("CAPTURE REPORT");
  console.log("═══════════════════════════════════════════════════════");
  const ok = results.filter((r) => r.ok);
  const errors = results.filter((r) => !r.ok);

  console.log(`\nFiles written (${ok.length}):`);
  for (const r of ok) {
    console.log(`  ${r.file}  ${r.width}×${r.height}  ${(r.size / 1024).toFixed(0)} KB`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const r of errors) {
      console.log(`  ${r.file}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log("\nNo errors.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
