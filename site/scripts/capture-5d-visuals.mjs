#!/usr/bin/env node
/**
 * capture-5d-visuals.mjs — throwaway script for Phase 5D visual judge screenshots.
 *
 * Usage: node scripts/capture-5d-visuals.mjs
 *
 * Follows the capture-5c-visuals.mjs serve+capture pattern (does NOT touch the
 * 5C outputs). Starts the static server on 4173, captures via Playwright,
 * writes PNGs to docs/superpowers/reviews/5d-visual/:
 *
 *   years-390.png / years-768.png / years-1440.png
 *       /years/ top fold, default (collapsed) state.
 *   years-1440-expanded.png
 *       All org sections collapsed except one (DARPA), with one program's
 *       J-book project sub-rows expanded.
 *   years-1440-filtered.png
 *       Text filter narrowing 462 programs to a handful ("hypersonic").
 *   years-390-scrolled.png
 *       Grid horizontally scrolled to mid-position — sticky first column holds.
 *   breakdown-inline-1440.png
 *       A Δ cell's citation panel with the inline 2-row breakdown table.
 *   breakdown-overlay-1440.png
 *       /agency/OSD/ FY24 total (123 line items) — full-screen breakdown
 *       overlay with the filter box.
 *
 * All /years/ captures wait for [data-testid="years-matrix"] (the island
 * fetches years_matrix.json client-side — networkidle alone is not enough
 * while the loading skeleton is up). Viewport captures only — no fullPage —
 * so the IntersectionObserver pre-reveal scroll from the 5C script is not
 * needed here (and /years/ has no below-fold <Reveal> sections anyway).
 */

import { startServer } from "./serve-static.mjs";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(siteRoot, "..", "docs", "superpowers", "reviews", "5d-visual");
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = "http://127.0.0.1:4173";
const SETTLE_MS = 600;

/** Filter query that narrows 462 programs to a handful (3 at time of writing). */
const FILTER_QUERY = "hypersonic";

/**
 * /agency/OSD/ FY24 total — sum over 108 programs, 123 breakdown line items
 * (> FILTER_ROW_THRESHOLD=25, so the overlay shows the filter box).
 * Verified present in out/json/breakdowns/ before capture.
 */
const OVERLAY_FACT_ID = "4464cd83a01e6bdb";
const OVERLAY_PAGE = "/agency/OSD/";

async function waitSettle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    // timeout OK — just continue
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function gotoYears(page) {
  await page.goto(BASE_URL + "/years/", { waitUntil: "domcontentloaded", timeout: 30000 });
  // The matrix island fetches its sidecar client-side — wait for the real table.
  await page.waitForSelector('[data-testid="years-matrix"]', { timeout: 20000 });
  await waitSettle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
}

async function capture(page, filePath) {
  const shot = await page.screenshot({ fullPage: false, type: "png" });
  fs.writeFileSync(filePath, shot);
  const stat = fs.statSync(filePath);
  console.log(`  wrote ${path.basename(filePath)} (${stat.size} bytes)`);
  return stat.size;
}

/** Scroll the window so the grid's scroll container sits near the viewport top. */
async function scrollGridIntoView(page, topOffset = 90) {
  await page.evaluate((off) => {
    const c = document.querySelector('[data-testid="years-matrix"]').parentElement;
    const top = c.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - off));
  }, topOffset);
  await page.waitForTimeout(150);
}

/**
 * Pick the Δ-cell fact_id for the inline-breakdown shot: the first program
 * (document order) whose fy2526_change cite has a 2-row breakdown sidecar.
 */
function pickDeltaFactId() {
  const matrix = JSON.parse(
    fs.readFileSync(path.join(siteRoot, "out", "json", "years_matrix.json"), "utf8"),
  );
  for (const org of matrix.orgs) {
    for (const program of org.programs) {
      const fid = program.cells?.fy2526_change?.fid;
      if (!fid) continue;
      const bPath = path.join(siteRoot, "out", "json", "breakdowns", `${fid}.json`);
      if (!fs.existsSync(bPath)) continue;
      const breakdown = JSON.parse(fs.readFileSync(bPath, "utf8"));
      if (breakdown.rows.length === 2) {
        console.log(
          `Δ target: ${org.org} ${program.pe_bli} (${program.title}) fid=${fid} — 2-row breakdown`,
        );
        return fid;
      }
    }
  }
  throw new Error("no Δ cell with a 2-row breakdown found in years_matrix.json");
}

async function main() {
  // Fail fast if the overlay target vanished from the data.
  const overlayPath = path.join(siteRoot, "out", "json", "breakdowns", `${OVERLAY_FACT_ID}.json`);
  if (!fs.existsSync(overlayPath)) {
    throw new Error(`overlay breakdown ${OVERLAY_FACT_ID}.json missing from out/json/breakdowns/`);
  }
  const overlayRows = JSON.parse(fs.readFileSync(overlayPath, "utf8")).rows.length;
  console.log(`overlay target: ${OVERLAY_PAGE} fid=${OVERLAY_FACT_ID} — ${overlayRows} line items`);
  const deltaFactId = pickDeltaFactId();

  const { close } = await startServer(4173);
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
      await fn(pg);
      const size = await capture(pg, path.join(outDir, `${label}.png`));
      results.push({ file: `${label}.png`, width, height, size, ok: true });
    } catch (err) {
      console.error(`  ERROR on ${label}: ${err.message}`);
      results.push({ file: `${label}.png`, ok: false, error: err.message });
    }
    await pg.close();
    await ctx.close();
  };

  try {
    // ── years top fold, default state, three widths ───────────────────────
    for (const [name, width, height] of [
      ["years-390", 390, 844],
      ["years-768", 768, 1024],
      ["years-1440", 1440, 900],
    ]) {
      await shoot(name, width, height, async (pg) => {
        await gotoYears(pg);
      });
    }

    // ── years-1440-expanded: one org section + one program's projects ─────
    await shoot("years-1440-expanded", 1440, 900, async (pg) => {
      await gotoYears(pg);
      // Collapse every org section, then re-expand DARPA (every one of its
      // 24 programs has J-book project sub-rows).
      await pg.evaluate(() => {
        const toggles = [
          ...document.querySelectorAll('tr[data-org-row] button[aria-expanded]'),
        ];
        for (const btn of toggles) {
          if (btn.getAttribute("aria-expanded") === "true") btn.click();
        }
      });
      await pg.waitForTimeout(200);
      await pg.evaluate(() => {
        const darpa = [
          ...document.querySelectorAll('tr[data-org-row] button[aria-expanded]'),
        ].find((btn) => btn.textContent.includes("DARPA"));
        if (!darpa) throw new Error("DARPA org toggle not found");
        darpa.click();
      });
      await pg.waitForTimeout(200);
      // Expand the first visible program caret (a DARPA program).
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

    // ── years-1440-filtered: narrow to a handful of rows ──────────────────
    await shoot("years-1440-filtered", 1440, 900, async (pg) => {
      await gotoYears(pg);
      await pg.locator('[data-testid="years-filter"]').fill(FILTER_QUERY);
      await pg.waitForTimeout(400);
    });

    // ── years-390-scrolled: horizontal mid-scroll, sticky first column ────
    await shoot("years-390-scrolled", 390, 844, async (pg) => {
      await gotoYears(pg);
      await scrollGridIntoView(pg, 60);
      await pg.evaluate(() => {
        const c = document.querySelector('[data-testid="years-matrix"]').parentElement;
        c.scrollLeft = Math.round((c.scrollWidth - c.clientWidth) / 2);
      });
      await pg.waitForTimeout(SETTLE_MS);
    });

    // ── breakdown-inline-1440: Δ cell panel with the 2-row breakdown ──────
    await shoot("breakdown-inline-1440", 1440, 900, async (pg) => {
      await gotoYears(pg);
      const cite = pg.locator(`[data-fact-id="${deltaFactId}"]`).first();
      if ((await cite.count()) === 0) {
        throw new Error(`no [data-fact-id="${deltaFactId}"] Δ cite on /years/`);
      }
      await cite.click();
      await pg.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });
      await pg.waitForSelector('[data-testid="breakdown-table"]', { timeout: 10000 });
      await waitSettle(pg);
    });

    // ── breakdown-overlay-1440: agency FY24 total, 123 rows + filter ──────
    await shoot("breakdown-overlay-1440", 1440, 900, async (pg) => {
      await pg.goto(BASE_URL + OVERLAY_PAGE, { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitSettle(pg);
      const cite = pg.locator(`[data-fact-id="${OVERLAY_FACT_ID}"]`).first();
      if ((await cite.count()) === 0) {
        throw new Error(`no [data-fact-id="${OVERLAY_FACT_ID}"] cite on ${OVERLAY_PAGE}`);
      }
      await cite.scrollIntoViewIfNeeded();
      await pg.waitForTimeout(200);
      await cite.click();
      await pg.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });
      // The derived card fetches the breakdown lazily → "View all N line items →".
      await pg.locator('[data-testid="breakdown-open"]').click({ timeout: 10000 });
      await pg.waitForSelector('[data-testid="breakdown-overlay"]', { timeout: 10000 });
      await pg.waitForSelector('[data-testid="breakdown-filter"]', { timeout: 5000 });
      await waitSettle(pg);
    });
  } finally {
    await browser.close();
    await close();
  }

  // ── Report ────────────────────────────────────────────────────────────────
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
