#!/usr/bin/env node
/**
 * capture-5f-visuals.mjs — throwaway script for Phase 5F visual judge screenshots.
 *
 * Usage: node scripts/capture-5f-visuals.mjs
 *
 * Follows the capture-5d-visuals.mjs serve+capture pattern.  Does NOT touch
 * prior outputs.  Starts the static server on 4173, captures via Playwright,
 * writes PNGs to docs/superpowers/reviews/5f-visual/:
 *
 *   rollup-program-390.png
 *       Rollup-tier program (0604776F — AF PE, trajectory data) at mobile
 *       viewport, top fold: header + skeleton visible, service J-book note.
 *
 *   rollup-program-1440.png
 *       Same page at 1440 px — wider view showing header + answer-strip +
 *       trajectory card + service J-book note in Description section.
 *
 *   rollup-program-1440-full.png
 *       fullPage of 0604776F at 1440 px — all 12 skeleton sections including
 *       empty states.  pre-reveal scroll fires IntersectionObserver first.
 *
 *   full-program-1440.png
 *       Full-tier program (0602025E — DARPA, has prose amount links) top fold
 *       at 1440 px, showing header + trajectory card.
 *
 *   prose-cites-1440.png
 *       0602025E at 1440 px — viewport scrolled so the "Quantum Benchmarking
 *       Initiative" accomplishment paragraph is visible with its in-prose
 *       "$250,000 thousand" link (data-prose-cite) AND the paragraph's
 *       "source" chip (data-narrative-chip).
 *
 *   narrative-panel-1440.png
 *       Same page — click the source chip on the QBI accomplishment, wait for
 *       the jbook-narrative-card to render (pdf canvas ready + passage
 *       highlight), screenshot the open panel at 1440 px.
 *
 *   narrative-panel-ambiguous-1440.png
 *       0602025E — click the source chip on the "HAPPI" accomplishment whose
 *       fact_id (a325efbba5c9c0a4) resolves as ambiguous_first; wait for
 *       [data-testid="ambiguous-badge"] to be visible, capture the amber note.
 *       If the badge is not found within the timeout the shot is still saved
 *       (the panel itself is evidence) and a WARNING is emitted.
 *
 *   pe-links-1440.png
 *       0602025E — viewport scrolled to the "MAKING, MAINTAINING, SUPPLY
 *       CHAIN and LOGISTICS" mission narrative paragraph which contains
 *       three in-prose PE token links (0602715E, 0602716E, 0602303E).
 *       Captures the paragraph section at 1440 px.
 *
 * Data constants (verified from data/site/json/program_details/):
 *
 *   ROLLUP_PE          0604776F  AF rollup-tier, trajectory row, 9 budget_lines
 *   FULL_PE            0602025E  DARPA full-tier, prose amount links, PE links
 *   PROSE_CITE_FID     301e86920095037e  QBI accomplishment paragraph narrative
 *   PROSE_AMOUNT_FID   9ac031152f33ed32  "$250,000 thousand" in-prose link
 *   AMBIGUOUS_FID      a325efbba5c9c0a4  HAPPI accomplishment, ambiguous_first
 */

import { startServer } from "./serve-static.mjs";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(siteRoot, "..", "docs", "superpowers", "reviews", "5f-visual");
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = "http://127.0.0.1:4173";
const SETTLE_MS = 700;

// ── Constants ──────────────────────────────────────────────────────────────────

/** AF rollup-tier program with trajectory row (FY24→FY26). */
const ROLLUP_PE = "0604776F";

/** DARPA full-tier program with prose amount links and PE token links. */
const FULL_PE = "0602025E";

/**
 * "Quantum Benchmarking Initiative (QBI)" accomplishment paragraph.
 * Carries the in-prose "$250,000 thousand" link + the "source" chip.
 */
const PROSE_CITE_FID = "301e86920095037e";

/** The in-prose "$250,000 thousand" Cite target inside the QBI paragraph. */
const PROSE_AMOUNT_FID = "9ac031152f33ed32";

/**
 * "HAPPI" accomplishment paragraph — resolution: ambiguous_first.
 * Panel should show [data-testid="ambiguous-badge"].
 */
const AMBIGUOUS_FID = "a325efbba5c9c0a4";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitSettle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    // timeout OK — continue
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
 * Same pattern as capture-5c-visuals.mjs — fullPage (CDP captureBeyondViewport)
 * does not scroll the page, so IntersectionObserver never fires for below-fold
 * .reveal-armed sections.
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
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

/**
 * Scroll the viewport so that [data-fact-id="<fid>"] is visually centered.
 * Returns the element's bounding rect top (after scroll) for diagnostics.
 */
async function scrollToFactId(page, fid, offsetPx = 200) {
  return page.evaluate(
    ({ fid, offsetPx }) => {
      const el = document.querySelector(`[data-fact-id="${fid}"]`);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const absTop = rect.top + window.scrollY;
      window.scrollTo(0, Math.max(0, absTop - offsetPx));
      return rect.top;
    },
    { fid, offsetPx },
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Preflight: verify the key programs exist in out/
  for (const pe of [ROLLUP_PE, FULL_PE]) {
    const p = path.join(siteRoot, "out", "program", pe, "index.html");
    if (!fs.existsSync(p)) {
      throw new Error(`preflight: /program/${pe}/ missing from out/ — run next build first`);
    }
  }

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
    // ── rollup-program-390 / rollup-program-1440 ──────────────────────────
    // Top-fold capture of the rollup-tier AF program: header + answer-strip +
    // trajectory card + service J-book honesty note in Description.
    for (const [label, width, height] of [
      ["rollup-program-390", 390, 844],
      ["rollup-program-1440", 1440, 900],
    ]) {
      await shoot(label, width, height, async (pg) => {
        await gotoAndSettle(pg, `${BASE_URL}/program/${ROLLUP_PE}/`);
        // Scroll to show top of page (header + first 2-3 sections)
        await pg.evaluate(() => window.scrollTo(0, 0));
        await pg.waitForTimeout(150);
      });
    }

    // ── rollup-program-1440-full ──────────────────────────────────────────
    // fullPage of the rollup program: all 12 skeleton sections visible
    // including empty states.  pre-reveal required to fire IntersectionObserver.
    // Uses inline logic (not shoot()) because shoot() only does viewport captures.
    {
      const label = "rollup-program-1440-full";
      console.log(`\nCapturing ${label} ...`);
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      const pg = await ctx.newPage();
      try {
        await gotoAndSettle(pg, `${BASE_URL}/program/${ROLLUP_PE}/`);
        await preRevealFullPage(pg);
        const size = await capture(pg, path.join(outDir, `${label}.png`), true);
        results.push({ file: `${label}.png`, width: 1440, height: "full", size, ok: true });
      } catch (err) {
        console.error(`  ERROR on ${label}: ${err.message}`);
        results.push({ file: `${label}.png`, ok: false, error: err.message });
      }
      await pg.close();
      await ctx.close();
    }

    // ── full-program-1440 ─────────────────────────────────────────────────
    // Full-tier DARPA program top fold: header + trajectory + first narrative.
    await shoot("full-program-1440", 1440, 900, async (pg) => {
      await gotoAndSettle(pg, `${BASE_URL}/program/${FULL_PE}/`);
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.waitForTimeout(150);
    });

    // ── prose-cites-1440 ─────────────────────────────────────────────────
    // Scroll to the QBI accomplishment paragraph that contains the in-prose
    // "$250,000 thousand" Cite link AND the "source" chip.  Both must be
    // visible in the same viewport shot.
    await shoot("prose-cites-1440", 1440, 900, async (pg) => {
      await gotoAndSettle(pg, `${BASE_URL}/program/${FULL_PE}/`);

      // Open the accomplishment <details> that contains the QBI paragraph.
      // The chip (data-narrative-chip) is inside the summary; the amount link
      // (data-prose-cite / data-fact-id on PROSE_AMOUNT_FID) is in the body.
      // First expand the <details> that wraps the QBI narrative.
      const opened = await pg.evaluate((fid) => {
        // Find the narrative chip whose fact-id is the QBI paragraph
        const chip = document.querySelector(`[data-narrative-chip][data-fact-id="${fid}"]`);
        if (!chip) return false;
        // Walk up to find the enclosing <details> (if any — primary narratives
        // are not collapsible, but accomplishments are)
        let el = chip;
        while (el && el.tagName !== "DETAILS") {
          el = el.parentElement;
        }
        if (el && !el.open) {
          el.open = true;
        }
        return true;
      }, PROSE_CITE_FID);

      if (!opened) {
        throw new Error(
          `[data-narrative-chip][data-fact-id="${PROSE_CITE_FID}"] not found on /program/${FULL_PE}/`,
        );
      }
      await pg.waitForTimeout(300);

      // Scroll so the source chip AND the prose amount link are in viewport.
      // Use the narrative chip's position as the anchor.
      const scrolled = await pg.evaluate(
        ({ chipFid, amountFid }) => {
          const chip = document.querySelector(`[data-narrative-chip][data-fact-id="${chipFid}"]`);
          const amountEl = document.querySelector(`[data-fact-id="${amountFid}"]`);
          if (!chip && !amountEl) return "none";
          const anchor = chip || amountEl;
          const rect = anchor.getBoundingClientRect();
          const absTop = rect.top + window.scrollY;
          // Show roughly 100 px above the chip so the section heading is visible.
          window.scrollTo(0, Math.max(0, absTop - 120));
          return "ok";
        },
        { chipFid: PROSE_CITE_FID, amountFid: PROSE_AMOUNT_FID },
      );

      if (scrolled === "none") {
        throw new Error(
          `Neither narrative chip ${PROSE_CITE_FID} nor amount cite ${PROSE_AMOUNT_FID} found on /program/${FULL_PE}/`,
        );
      }
      await pg.waitForTimeout(SETTLE_MS);
    });

    // ── narrative-panel-1440 ─────────────────────────────────────────────
    // Click the source chip on the QBI paragraph; wait for the jbook-narrative
    // card to render (canvas ready = pdf-highlight present OR panel settled).
    await shoot("narrative-panel-1440", 1440, 900, async (pg) => {
      await gotoAndSettle(pg, `${BASE_URL}/program/${FULL_PE}/`);

      // Expand the QBI accomplishment <details> first.
      await pg.evaluate((fid) => {
        const chip = document.querySelector(`[data-narrative-chip][data-fact-id="${fid}"]`);
        if (!chip) return;
        let el = chip;
        while (el && el.tagName !== "DETAILS") el = el.parentElement;
        if (el) el.open = true;
      }, PROSE_CITE_FID);
      await pg.waitForTimeout(200);

      // Scroll chip into view before clicking (avoids click-on-hidden-element).
      await pg.evaluate((fid) => {
        const chip = document.querySelector(`[data-narrative-chip][data-fact-id="${fid}"]`);
        if (chip) chip.scrollIntoView({ block: "center" });
      }, PROSE_CITE_FID);
      await pg.waitForTimeout(150);

      // Click the source chip.
      const chip = pg.locator(`[data-narrative-chip][data-fact-id="${PROSE_CITE_FID}"]`).first();
      if ((await chip.count()) === 0) {
        throw new Error(`source chip ${PROSE_CITE_FID} not found on /program/${FULL_PE}/`);
      }
      await chip.click();

      // Wait for citation panel to open.
      await pg.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });

      // Wait for jbook-narrative-card and then for the canvas/highlight to render.
      // pdf-highlight may take a few seconds (PDF render + canvas draw).
      await pg.waitForSelector('[data-testid="jbook-narrative-card"]', { timeout: 15000 });

      // Try to wait for the highlight but don't fail if it doesn't appear
      // (some envs lack the PDF render worker).
      try {
        await pg.waitForSelector('[data-testid="pdf-highlight"]', { timeout: 12000 });
      } catch (_) {
        console.warn(
          "  WARNING: pdf-highlight not visible within 12s — capturing panel without highlight",
        );
      }

      await pg.waitForTimeout(SETTLE_MS);
    });

    // ── narrative-panel-ambiguous-1440 ───────────────────────────────────
    // Same pattern but for the HAPPI accomplishment (ambiguous_first) —
    // expect [data-testid="ambiguous-badge"] to appear inside the panel.
    await shoot("narrative-panel-ambiguous-1440", 1440, 900, async (pg) => {
      await gotoAndSettle(pg, `${BASE_URL}/program/${FULL_PE}/`);

      // Expand the HAPPI accomplishment <details>.
      await pg.evaluate((fid) => {
        const chip = document.querySelector(`[data-narrative-chip][data-fact-id="${fid}"]`);
        if (!chip) return;
        let el = chip;
        while (el && el.tagName !== "DETAILS") el = el.parentElement;
        if (el) el.open = true;
      }, AMBIGUOUS_FID);
      await pg.waitForTimeout(200);

      // Scroll into view.
      await pg.evaluate((fid) => {
        const chip = document.querySelector(`[data-narrative-chip][data-fact-id="${fid}"]`);
        if (chip) chip.scrollIntoView({ block: "center" });
      }, AMBIGUOUS_FID);
      await pg.waitForTimeout(150);

      // Click the source chip.
      const chip = pg.locator(`[data-narrative-chip][data-fact-id="${AMBIGUOUS_FID}"]`).first();
      if ((await chip.count()) === 0) {
        throw new Error(`HAPPI source chip ${AMBIGUOUS_FID} not found on /program/${FULL_PE}/`);
      }
      await chip.click();

      // Wait for panel + jbook-narrative-card.
      await pg.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });
      await pg.waitForSelector('[data-testid="jbook-narrative-card"]', { timeout: 15000 });

      // Try to wait for the ambiguous-badge (amber note).
      try {
        await pg.waitForSelector('[data-testid="ambiguous-badge"]', { timeout: 12000 });
        console.log("  ambiguous-badge found — amber note visible");
      } catch (_) {
        console.warn(
          "  WARNING: ambiguous-badge not visible within 12s — capturing panel without amber badge",
        );
      }

      await pg.waitForTimeout(SETTLE_MS);
    });

    // ── pe-links-1440 ────────────────────────────────────────────────────
    // Scroll to the mission narrative paragraph that contains in-prose PE
    // token links: 0602715E, 0602716E, 0602303E inside the
    // "MAKING, MAINTAINING, SUPPLY CHAIN and LOGISTICS" narrative.
    // The mission paragraphs are primary (not inside <details>).
    await shoot("pe-links-1440", 1440, 900, async (pg) => {
      await gotoAndSettle(pg, `${BASE_URL}/program/${FULL_PE}/`);

      // Locate a PE link anchor that links to /program/0602715E/ in the
      // narrative prose region (data-source-text="narrative").
      const scrolled = await pg.evaluate(() => {
        // PE links in NarrativeBody render as <a href="/program/0602715E/">
        // inside [data-source-text="narrative"].
        const peLink = document.querySelector(
          '[data-source-text="narrative"] a[href="/program/0602715E/"]',
        );
        if (!peLink) return "none";
        const rect = peLink.getBoundingClientRect();
        const absTop = rect.top + window.scrollY;
        // Center the paragraph in viewport with a bit of heading above it.
        window.scrollTo(0, Math.max(0, absTop - 180));
        return "ok";
      });

      if (scrolled === "none") {
        // Fallback: try the section#description anchor.
        await pg.evaluate(() => {
          const el = document.getElementById("description");
          if (el) el.scrollIntoView({ block: "start" });
        });
        console.warn(
          "  WARNING: PE link for 0602715E not found in narrative prose — scrolled to #description",
        );
      }

      await pg.waitForTimeout(SETTLE_MS);
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
    const h = r.height === "full" ? "full" : r.height;
    console.log(`  ${r.file}  ${r.width}×${h}  ${(r.size / 1024).toFixed(0)} KB`);
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
