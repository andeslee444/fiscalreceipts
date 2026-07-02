/**
 * gate — answerfold_gate (Phase 5C, G6)
 *
 * Goal 5 contract: program pages answer three questions ABOVE THE FOLD —
 * what is this / what changed / who gets the money.
 *
 * Checks (live, Playwright):
 * 1. Sample 10 program slugs from out/program/: the first 5 (sorted) plus 5
 *    crosswalked programs that have a flows sidecar (data/site/json/flows).
 * 2. For each sampled page, at BOTH 1440×900 and 390×844, all three
 *    [data-testid^="answer-"] elements (answer-what / answer-changed /
 *    answer-who) must be present, visible, and fully inside the initial
 *    viewport: boundingBox().y + height < viewport.height (no scrolling).
 *
 * Export: runAnswerfoldGate({ baseUrl }) → { pass, errors, notes }
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outProgramDir = path.resolve(siteRoot, "out", "program");
const flowsDir = path.resolve(siteRoot, "..", "data", "site", "json", "flows");

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

const TESTIDS = ["answer-what", "answer-changed", "answer-who"];

/**
 * Sample 10 program slugs: first 5 sorted from out/program/ plus the first 5
 * flow-sidecar slugs (sorted) that have built pages and aren't already in
 * the first set.
 */
function sampleSlugs() {
  const built = fs
    .readdirSync(outProgramDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const first5 = built.slice(0, 5);

  let flowSlugs = [];
  if (fs.existsSync(flowsDir)) {
    flowSlugs = fs
      .readdirSync(flowsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort();
  }
  const builtSet = new Set(built);
  const flow5 = flowSlugs
    .filter((s) => builtSet.has(s) && !first5.includes(s))
    .slice(0, 5);

  return [...first5, ...flow5];
}

export async function runAnswerfoldGate({ baseUrl }) {
  const errors = [];
  const notes = [];

  if (!fs.existsSync(outProgramDir)) {
    errors.push("answerfold_gate: out/program/ not found — build the site first");
    return { pass: false, errors, notes };
  }

  const slugs = sampleSlugs();
  if (slugs.length < 10) {
    notes.push(`only ${slugs.length} sample slugs available (expected 10)`);
  }
  notes.push(`sampled slugs: ${slugs.join(", ")}`);

  const browser = await chromium.launch({ headless: true });

  try {
    for (const vp of VIEWPORTS) {
      const vpLabel = `${vp.width}x${vp.height}`;
      const context = await browser.newContext({ viewport: vp });
      const page = await context.newPage();
      let okCount = 0;

      for (const slug of slugs) {
        try {
          await page.goto(`${baseUrl}/program/${slug}/`, {
            waitUntil: "load",
            timeout: 30000,
          });
          // The strip is SSR'd — wait for the first testid to exist.
          await page.waitForSelector('[data-testid="answer-what"]', {
            timeout: 10000,
          });

          let pageOk = true;
          for (const tid of TESTIDS) {
            const el = page.locator(`[data-testid="${tid}"]`).first();
            const count = await el.count();
            if (count === 0) {
              errors.push(`${vpLabel} program/${slug}: [data-testid="${tid}"] missing`);
              pageOk = false;
              continue;
            }
            const box = await el.boundingBox();
            if (!box) {
              errors.push(`${vpLabel} program/${slug}: [data-testid="${tid}"] not visible (no bounding box)`);
              pageOk = false;
              continue;
            }
            const bottom = box.y + box.height;
            if (bottom >= vp.height) {
              errors.push(
                `${vpLabel} program/${slug}: [data-testid="${tid}"] below the fold — bottom=${bottom.toFixed(0)}px >= viewport ${vp.height}px`
              );
              pageOk = false;
            }
          }
          if (pageOk) okCount++;
        } catch (e) {
          errors.push(`${vpLabel} program/${slug}: ${e.message.split("\n")[0]}`);
        }
      }

      notes.push(`${vpLabel}: ${okCount}/${slugs.length} pages have all three answers above the fold`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
