#!/usr/bin/env node
/**
 * screenshots.mjs — visual gate harness for phases 5B-2 and 5B-3.
 *
 * Captures 11 states × 3 viewports (390/768/1440px wide) = 33 screenshots.
 * Output: GovBudget/docs/superpowers/reviews/5b3-visual/
 *
 * Phase 5B-2 states:
 *   1. home
 *   2. program with citation panel open
 *   3. program with receipts mode ON
 *   4. company page
 *   5. /data/ page
 *   6. search palette open (⌘K)
 *
 * Phase 5B-3 states (new):
 *   7.  feed page (/feed/)
 *   8.  district index (/district/)
 *   9.  district detail (/district/VA-08/)
 *   10. filing page (first filing with mentions)
 *   11. program with dossier hero (top-50 category program)
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:4173
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(siteRoot, "..");
const outDir = path.resolve(
  repoRoot,
  "docs",
  "superpowers",
  "reviews",
  "5b3-visual"
);
const jsonDir = path.resolve(repoRoot, "data", "site", "json");

const BASE_URL = process.argv[2] ?? "http://127.0.0.1:4173";
const VIEWPORTS = [390, 768, 1440];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function getSampleProgram() {
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const citations = readJson(path.join(jsonDir, "citations.json"));
  const programDetailsDir = path.join(jsonDir, "program_details");
  // Find first program with a clickable jbook_pdf citation
  for (const p of programs.sort((a, b) => a.pe_bli.localeCompare(b.pe_bli))) {
    const detPath = path.join(programDetailsDir, `${p.pe_bli}.json`);
    if (!fs.existsSync(detPath)) continue;
    try {
      const det = readJson(detPath);
      for (const d of det.details || []) {
        if (d.fact_id && citations[d.fact_id]?.kind === "jbook_pdf") {
          return { pbl: p.pe_bli, factId: d.fact_id };
        }
      }
    } catch {
      // skip
    }
  }
  return { pbl: programs[0]?.pe_bli ?? "0601101E", factId: null };
}

function getSampleCompany() {
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  return entities[0]?.slug ?? "lockheed-martin";
}

function getSampleDistrict() {
  try {
    const index = readJson(path.join(jsonDir, "districts", "index.json"));
    const districts = index.districts ?? [];
    // Prefer a district likely to have data (Virginia, California)
    const preferred = districts.find(
      (d) => d.pop_district === "VA-08" || d.pop_district === "CA-30"
    );
    return (preferred ?? districts[0])?.pop_district ?? "VA-08";
  } catch {
    return "VA-08";
  }
}

function getSampleFilingWithMentions() {
  try {
    const index = readJson(path.join(jsonDir, "filings_index.json"));
    const withMentions = (index.filings ?? []).filter((f) => f.has_mentions);
    return withMentions[0]?.filing_uuid ?? null;
  } catch {
    return null;
  }
}

function getTop50Program() {
  try {
    const categoriesCsv = path.resolve(
      repoRoot,
      "data-seeds",
      "program_categories.csv"
    );
    if (!fs.existsSync(categoriesCsv)) return null;
    const lines = fs.readFileSync(categoriesCsv, "utf8").split("\n");
    const header = lines[0] ?? "";
    const peIdx = header.split(",").findIndex((h) =>
      h.trim().toLowerCase().startsWith("pe")
    );
    if (peIdx < 0) return null;
    const first = lines[1]?.split(",")[peIdx]?.trim();
    return first ?? null;
  } catch {
    return null;
  }
}

async function capture(page, filePath, label) {
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  ✓ ${label} → ${path.relative(repoRoot, filePath)}`);
}

async function main() {
  console.log("screenshots.mjs — capturing 11 states × 3 viewports");
  console.log(`base URL: ${BASE_URL}`);
  console.log(`output: ${outDir}`);
  console.log("");

  fs.mkdirSync(outDir, { recursive: true });

  const { pbl: samplePbl, factId: sampleFactId } = getSampleProgram();
  const sampleCompany = getSampleCompany();
  const sampleDistrict = getSampleDistrict();
  const sampleFilingUuid = getSampleFilingWithMentions();
  const top50Pbl = getTop50Program() ?? samplePbl;

  const browser = await chromium.launch({ headless: true });

  for (const width of VIEWPORTS) {
    console.log(`\n── viewport ${width}px ──`);
    const context = await browser.newContext({
      viewport: { width, height: Math.round(width * 0.75) },
      javaScriptEnabled: true,
    });

    // ── 1. Home ────────────────────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
      await capture(page, path.join(outDir, `home-${width}.png`), `home-${width}`);
      await page.close();
    }

    // ── 2. Program with panel open ─────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/program/${samplePbl}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      if (sampleFactId) {
        const el = await page.$(`[data-fact-id="${sampleFactId}"]`).catch(() => null);
        if (el) {
          await el.click();
          await page
            .waitForSelector('[data-testid="citation-panel"]', { timeout: 8000 })
            .catch(() => null);
          await page.waitForTimeout(1000);
        }
      }
      await capture(
        page,
        path.join(outDir, `program-panel-${width}.png`),
        `program-panel-${width}`
      );
      await page.close();
    }

    // ── 3. Program with receipts mode ON ────────────────────────────────────
    {
      const page = await context.newPage();
      // Set receipts-mode in localStorage before navigating so it loads ON
      await page.goto(`${BASE_URL}/program/${samplePbl}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Activate receipts mode via localStorage (works at any viewport width)
      await page.evaluate(() => {
        try { window.localStorage.setItem("receipts-mode", "1"); } catch { /* ignore */ }
      });
      // Reload to pick up the localStorage value
      await page.reload({ waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(300);
      await capture(
        page,
        path.join(outDir, `program-receipts-${width}.png`),
        `program-receipts-${width}`
      );
      await page.close();
    }

    // ── 4. Company page ────────────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/company/${sampleCompany}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `company-${width}.png`),
        `company-${width}`
      );
      await page.close();
    }

    // ── 5. /data/ page ─────────────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/data/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `data-${width}.png`),
        `data-${width}`
      );
      await page.close();
    }

    // ── 6. Search palette open ─────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
      const trigger = await page
        .$('[data-testid="search-trigger"]')
        .catch(() => null);
      if (trigger) {
        await trigger.click();
      } else {
        await page.keyboard.press("Meta+k");
      }
      await page
        .waitForSelector(
          'input[placeholder*="search" i], [data-testid="search-input"]',
          { timeout: 5000 }
        )
        .catch(() => null);
      await page.waitForTimeout(500);
      await capture(
        page,
        path.join(outDir, `search-open-${width}.png`),
        `search-open-${width}`
      );
      await page.close();
    }

    // ── 7. Feed page ────────────────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/feed/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `feed-${width}.png`),
        `feed-${width}`
      );
      await page.close();
    }

    // ── 8. District index ──────────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/district/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `district-index-${width}.png`),
        `district-index-${width}`
      );
      await page.close();
    }

    // ── 9. District detail ─────────────────────────────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/district/${sampleDistrict}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `district-detail-${width}.png`),
        `district-detail-${width}`
      );
      await page.close();
    }

    // ── 10. Filing page (with mentions) ────────────────────────────────────
    if (sampleFilingUuid) {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/filing/${sampleFilingUuid}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `filing-${width}.png`),
        `filing-${width}`
      );
      await page.close();
    }

    // ── 11. Dossier hero program (top-50 category) ─────────────────────────
    {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/program/${top50Pbl}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await capture(
        page,
        path.join(outDir, `program-hero-${width}.png`),
        `program-hero-${width}`
      );
      await page.close();
    }

    await context.close();
  }

  await browser.close();
  const screenshotCount = sampleFilingUuid ? 33 : 30;
  console.log(`\n  ${screenshotCount} screenshots saved to ${outDir}`);
}

main().catch((e) => {
  console.error("screenshots: error:", e);
  process.exit(1);
});
