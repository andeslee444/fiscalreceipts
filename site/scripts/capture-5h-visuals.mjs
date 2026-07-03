#!/usr/bin/env node
/**
 * capture-5h-visuals.mjs — throwaway script for Phase 5H visual judge screenshots.
 *
 * Usage: node scripts/capture-5h-visuals.mjs
 *
 * Follows the capture-5f-visuals.mjs serve+capture pattern. Starts the static
 * server on 4173, captures /flow/ via Playwright, writes PNGs to
 * docs/superpowers/reviews/5h-visual/:
 *
 *   flow-1440.png
 *       Full /flow/ page (fullPage) at 1440 px — shell, experimental banner,
 *       unit statements, bridge coverage note, both rivers.
 *
 *   flow-390.png
 *       Full /flow/ page (fullPage) at 390 px — mobile layout; the chart
 *       scrolls horizontally inside its own container (the /years/ precedent).
 *
 *   flow-1440-competition.png
 *       Viewport scrolled to the spend river: competition legend
 *       ([data-testid="flow-competition-legend"]) + class-colored ribbons.
 *
 *   flow-1440-drilldown.png
 *       An "Other (N)" node ([data-flow-other]) clicked open — the
 *       [data-testid="flow-drilldown"] dialog with [data-drill-member] rows.
 *
 *   flow-node-panel-1440.png
 *       A named flow node ([data-flow-node]) clicked — the citation panel
 *       ([data-testid="citation-panel"]) open with the derived fact card.
 *
 *   flow-fy-switch-1440.png
 *       Spend river after switching the FY selector to a non-default year
 *       (FY2020; default is FY2025) — river remounted for that year.
 */

import { startServer } from "./serve-static.mjs";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(siteRoot, "..", "docs", "superpowers", "reviews", "5h-visual");
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = "http://127.0.0.1:4173";
const SETTLE_MS = 700;

/** Non-default FY for the switch shot (default_fy is 2025). */
const SWITCH_FY = "2020";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitSettle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    // timeout OK — continue
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function gotoFlow(page) {
  await page.goto(`${BASE_URL}/flow/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitSettle(page);
  // The chart island fetches flow_chart.json — wait for the rendered chart.
  await page.waitForSelector('[data-testid="flow-chart"]', { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

async function capture(page, filePath, fullPage = false) {
  const shot = await page.screenshot({ fullPage, type: "png" });
  fs.writeFileSync(filePath, shot);
  const stat = fs.statSync(filePath);
  console.log(`  wrote ${path.basename(filePath)} (${stat.size} bytes)`);
  return stat.size;
}

/** Scroll so the spend river section sits near the top of the viewport. */
async function scrollToSpendRiver(page, offsetPx = 90) {
  await page.evaluate((offsetPx) => {
    const el = document.querySelector('[data-flow-river="spend"]');
    if (!el) return;
    const absTop = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, absTop - offsetPx));
  }, offsetPx);
  await page.waitForTimeout(200);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Preflight: /flow/ must be in out/
  const flowHtml = path.join(siteRoot, "out", "flow", "index.html");
  if (!fs.existsSync(flowHtml)) {
    throw new Error("preflight: /flow/ missing from out/ — run next build first");
  }

  const { close } = await startServer(4173);
  console.log("Server started at", BASE_URL);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  const shoot = async (label, width, height, fn, fullPage = false) => {
    console.log(`\nCapturing ${label} ...`);
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    const pg = await ctx.newPage();
    try {
      await fn(pg);
      const size = await capture(pg, path.join(outDir, `${label}.png`), fullPage);
      results.push({ file: `${label}.png`, width, height, size, ok: true });
    } catch (err) {
      console.error(`  ERROR on ${label}: ${err.message}`);
      results.push({ file: `${label}.png`, ok: false, error: err.message });
    }
    await pg.close();
    await ctx.close();
  };

  try {
    // ── flow-1440 — full page, both rivers ────────────────────────────────
    await shoot(
      "flow-1440",
      1440,
      900,
      async (pg) => {
        await gotoFlow(pg);
      },
      true,
    );

    // ── flow-390 — mobile full page ───────────────────────────────────────
    await shoot(
      "flow-390",
      390,
      844,
      async (pg) => {
        await gotoFlow(pg);
      },
      true,
    );

    // ── flow-1440-competition — legend + colored spend ribbons ────────────
    await shoot("flow-1440-competition", 1440, 900, async (pg) => {
      await gotoFlow(pg);
      await pg.waitForSelector('[data-testid="flow-competition-legend"]', { timeout: 10000 });
      await scrollToSpendRiver(pg);
    });

    // ── flow-1440-drilldown — Other node expanded ──────────────────────────
    await shoot("flow-1440-drilldown", 1440, 900, async (pg) => {
      await gotoFlow(pg);
      await scrollToSpendRiver(pg);
      const other = pg.locator("[data-flow-other]").first();
      await other.click();
      await pg.waitForSelector('[data-testid="flow-drilldown"]', { timeout: 10000 });
      await pg.waitForSelector("[data-drill-member]", { timeout: 10000 });
      await pg.waitForTimeout(350);
    });

    // ── flow-node-panel-1440 — citation panel from a node ──────────────────
    await shoot("flow-node-panel-1440", 1440, 900, async (pg) => {
      await gotoFlow(pg);
      const node = pg.locator("[data-flow-node]").first();
      await node.scrollIntoViewIfNeeded();
      await node.click();
      await pg.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });
      // let the lazy cite-shard fact card render
      await pg.waitForTimeout(1200);
    });

    // ── flow-fy-switch-1440 — non-default FY selected ──────────────────────
    await shoot("flow-fy-switch-1440", 1440, 900, async (pg) => {
      await gotoFlow(pg);
      await pg.selectOption('[data-testid="flow-fy-select"]', SWITCH_FY);
      await pg.waitForTimeout(600);
      const got = await pg
        .locator('[data-flow-river="spend"]')
        .first()
        .getAttribute("data-fy");
      if (got !== SWITCH_FY) {
        throw new Error(`FY switch failed: spend river data-fy=${got}, wanted ${SWITCH_FY}`);
      }
      await scrollToSpendRiver(pg);
    });
  } finally {
    await browser.close();
    await close();
  }

  console.log("\n── Results ──");
  let ok = true;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.file} (${r.width}x${r.height}, ${r.size} bytes)`);
    } else {
      console.log(`  ✗ ${r.file}: ${r.error}`);
      ok = false;
    }
  }
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error("capture-5h-visuals: fatal:", e);
  process.exitCode = 1;
});
