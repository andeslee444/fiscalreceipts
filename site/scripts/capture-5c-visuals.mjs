#!/usr/bin/env node
/**
 * capture-5c-visuals.mjs — throwaway script for Phase 5C visual judge screenshots.
 *
 * Usage: node scripts/capture-5c-visuals.mjs
 *
 * Starts the static server on 4173, captures screenshots via Playwright,
 * writes PNGs to docs/superpowers/reviews/5c-visual/.
 */

import { startServer } from "./serve-static.mjs";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(siteRoot, "..", "docs", "superpowers", "reviews", "5c-visual");
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = "http://127.0.0.1:4173";
const SETTLE_MS = 600;

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
];

async function waitSettle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    // timeout OK — just continue
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function gotoAndSettle(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitSettle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
}

async function capture(page, filePath, fullPage = false) {
  const shot = await page.screenshot({ fullPage, type: "png" });
  fs.writeFileSync(filePath, shot);
  const stat = fs.statSync(filePath);
  console.log(`  wrote ${path.basename(filePath)} (${stat.size} bytes)`);
  return stat.size;
}

/**
 * Fire all scroll-triggered <Reveal> animations before a fullPage capture.
 *
 * fullPage screenshots (CDP captureBeyondViewport) do NOT scroll the page,
 * so IntersectionObserver never fires for below-fold .reveal-armed sections
 * — they'd be captured parked at opacity:0, rendering as a large blank band
 * (seen on home-1440-full: everything below the stats strip was blank).
 * That is a screenshot artifact of the once-reveal motion system, NOT a
 * site bug: real users scroll, sections reveal once, and stay visible.
 * Scrolling through the document first fires every observer; then return
 * to the top so the capture reflects the post-reveal steady state.
 */
async function preRevealFullPage(page) {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight * 0.8, 200);
    const maxY = document.body.scrollHeight;
    for (let y = 0; y <= maxY; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
  });
  await page.waitForTimeout(500); // let reveal transitions finish
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

async function main() {
  const { close } = await startServer(4173);
  console.log("Server started at", BASE_URL);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    // ── Pages config ──────────────────────────────────────────────────────
    const pages = [
      { slug: "home", url: "/" },
      { slug: "program-flow", url: "/program/0601101E/" },
      { slug: "program-plain", url: "/program/0201MC12/" },
      { slug: "feed", url: "/feed/" },
      { slug: "district", url: "/district/" },
    ];

    // ── Standard captures: all pages × all widths ─────────────────────────
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      const pg = await ctx.newPage();

      for (const pageDef of pages) {
        const label = `${pageDef.slug}-${vp.name}`;
        console.log(`\nCapturing ${label} ...`);
        try {
          await gotoAndSettle(pg, BASE_URL + pageDef.url);

          const filePath = path.join(outDir, `${label}.png`);
          const size = await capture(pg, filePath, false);
          results.push({ file: `${label}.png`, width: vp.width, height: vp.height, size, ok: true });

          // home at 1440: also capture full-page (pre-reveal first — see
          // preRevealFullPage: fullPage capture doesn't scroll, so armed
          // .reveal sections would otherwise screenshot at opacity:0)
          if (pageDef.slug === "home" && vp.name === "1440") {
            await preRevealFullPage(pg);
            const fullPath = path.join(outDir, `home-1440-full.png`);
            const fullSize = await capture(pg, fullPath, true);
            results.push({ file: "home-1440-full.png", width: vp.width, height: "full", size: fullSize, ok: true });
          }

          // feed at 1440: also capture scrolled
          if (pageDef.slug === "feed" && vp.name === "1440") {
            await pg.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
            await pg.waitForTimeout(SETTLE_MS);
            const scrolledPath = path.join(outDir, `feed-1440-scrolled.png`);
            const scrolledSize = await capture(pg, scrolledPath, false);
            results.push({ file: "feed-1440-scrolled.png", width: 1440, height: 900, size: scrolledSize, ok: true });
            // scroll back to top for any next iteration
            await pg.evaluate(() => window.scrollTo(0, 0));
          }
        } catch (err) {
          console.error(`  ERROR on ${label}: ${err.message}`);
          results.push({ file: `${label}.png`, ok: false, error: err.message });
        }
      }

      await pg.close();
      await ctx.close();
    }

    // ── panel-open: 1440 + 390 only ───────────────────────────────────────
    for (const vp of VIEWPORTS.filter((v) => v.name === "1440" || v.name === "390")) {
      const label = `panel-open-${vp.name}`;
      console.log(`\nCapturing ${label} ...`);
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      const pg = await ctx.newPage();

      try {
        await gotoAndSettle(pg, BASE_URL + "/");

        // Find the receipt-moment cite element
        // Try: [data-testid="receipt-moment"] [data-fact-id]
        let citeTrigger = pg.locator('[data-testid="receipt-moment"] [data-fact-id]').first();
        let count = await citeTrigger.count();
        if (count === 0) {
          // Fallback: .Cite span or any element with data-fact-id
          citeTrigger = pg.locator('[data-fact-id]').first();
          count = await citeTrigger.count();
        }

        if (count === 0) {
          throw new Error("No data-fact-id element found on home page");
        }

        // Scroll the element into view and click
        await citeTrigger.scrollIntoViewIfNeeded();
        await pg.waitForTimeout(200);
        await citeTrigger.click();

        // Wait for citation panel + PDF canvas ready
        // Try canvas.pdf-page-fade.is-ready with generous timeout
        try {
          await pg.waitForSelector("canvas.pdf-page-fade.is-ready", { timeout: 20000 });
        } catch (_) {
          // Panel may not have PDF canvas — try just waiting for a panel/aside element
          try {
            await pg.waitForSelector('[data-testid="citation-panel"], aside, [role="complementary"]', { timeout: 5000 });
          } catch (__) {
            // just settle
          }
        }
        await pg.waitForTimeout(SETTLE_MS);

        const filePath = path.join(outDir, `${label}.png`);
        const size = await capture(pg, filePath, false);
        results.push({ file: `${label}.png`, width: vp.width, height: vp.height, size, ok: true });
      } catch (err) {
        console.error(`  ERROR on ${label}: ${err.message}`);
        results.push({ file: `${label}.png`, ok: false, error: err.message });
      }

      await pg.close();
      await ctx.close();
    }
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
  } else {
    console.log("\nNo errors.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
