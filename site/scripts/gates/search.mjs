/**
 * gate 5 — search_gate (Playwright)
 *
 * Drives the search palette (⌘K / search trigger), runs all cases from
 * evals/search_eval.yaml, asserts expected URL in top-3 (tier: quick) /
 * top-5 (tier: deep).
 *
 * Gate requirement: ≥90% overall AND 100% of typo-tagged cases.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");

// Absolute path to eval file per plan spec
// siteRoot = GovBudget/site; eval lives at GovBudget/evals/
const EVAL_PATH = path.resolve(siteRoot, "..", "evals", "search_eval.yaml");

/** Minimal YAML parser for the search_eval.yaml structure.
 *  Supports scalar keys and nested lists of objects with scalar values.
 *  Only handles the subset used by search_eval.yaml.
 */
function parseSimpleYaml(text) {
  const lines = text.split("\n");
  const result = { cases: [] };
  let currentCase = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Skip comments and blank lines
    if (trimmed.startsWith("#") || trimmed.trim() === "") continue;

    // Top-level "cases:" marker
    if (trimmed === "cases:") continue;

    // List item start: "  - key: value"
    const listItemMatch = trimmed.match(/^  - (\w+):\s*(.*)/);
    if (listItemMatch) {
      if (currentCase) result.cases.push(currentCase);
      currentCase = {};
      const key = listItemMatch[1];
      let val = listItemMatch[2].replace(/^["']|["']$/g, "");
      currentCase[key] = val;
      continue;
    }

    // Continuation key: "    key: value"
    const contMatch = trimmed.match(/^    (\w+):\s*(.*)/);
    if (contMatch && currentCase) {
      const key = contMatch[1];
      let val = contMatch[2].replace(/^["']|["']$/g, "");
      // Handle quoted strings with embedded quotes
      if (
        (contMatch[2].startsWith('"') && contMatch[2].endsWith('"')) ||
        (contMatch[2].startsWith("'") && contMatch[2].endsWith("'"))
      ) {
        val = contMatch[2].slice(1, -1);
      }
      currentCase[key] = val;
      continue;
    }
  }
  if (currentCase) result.cases.push(currentCase);
  return result;
}

function loadEvalCases() {
  if (!fs.existsSync(EVAL_PATH)) {
    throw new Error(
      `search_eval.yaml not found at ${EVAL_PATH} — expected at GovBudget/evals/search_eval.yaml`
    );
  }
  const text = fs.readFileSync(EVAL_PATH, "utf8");
  const parsed = parseSimpleYaml(text);
  return parsed.cases || [];
}

export async function runSearchGate(baseUrl) {
  const errors = [];
  const notes = [];

  let cases;
  try {
    cases = loadEvalCases();
  } catch (e) {
    return { pass: false, errors: [e.message], notes };
  }
  notes.push(`loaded ${cases.length} eval cases from ${EVAL_PATH}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: true });
  const page = await context.newPage();

  let passed = 0;
  let failed = 0;
  let typoPassed = 0;
  let typoFailed = 0;
  const failedCases = [];
  const typoFailedCases = [];

  try {
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    for (const c of cases) {
      const {
        query,
        tier,
        note,
        expect_url_top3,
        expect_url_top5,
      } = c;
      const expectedUrl = expect_url_top3 || expect_url_top5;
      const topN = tier === "deep" ? 5 : 3;
      const isTypo = note && note.toLowerCase().startsWith("typo");

      if (!expectedUrl || !query) continue;

      try {
        // Open search palette — try ⌘K first, then search button
        const searchTrigger = await page
          .$('[data-testid="search-trigger"]')
          .catch(() => null);
        const searchBtn = await page
          .$('button[aria-label*="search" i], button[aria-label*="Search" i]')
          .catch(() => null);

        if (searchTrigger) {
          await searchTrigger.click();
        } else if (searchBtn) {
          await searchBtn.click();
        } else {
          // Try ⌘K keyboard shortcut
          await page.keyboard.press("Meta+k");
        }

        // Wait for search input
        const searchInput = await page
          .waitForSelector(
            'input[placeholder*="search" i], input[type="search"], [data-testid="search-input"]',
            { timeout: 5000 }
          )
          .catch(() => null);

        if (!searchInput) {
          failed++;
          if (isTypo) typoFailed++;
          failedCases.push({ query, reason: "search input not found" });
          if (isTypo) typoFailedCases.push({ query, reason: "search input not found" });
          continue;
        }

        // Clear + type query
        await searchInput.click({ clickCount: 3 });
        await searchInput.fill(query);
        await page.waitForTimeout(800); // debounce

        // Collect result URLs
        const resultUrls = await page
          .$$eval(
            '[data-testid="search-result"] a, [role="option"] a, [data-testid="search-results"] a',
            (els) => els.map((el) => el.getAttribute("href") || "")
          )
          .catch(() => []);

        // If no typed results, try clicking a "Search all" or deep button
        let urls = resultUrls;
        if (tier === "deep" && resultUrls.length === 0) {
          // Try pagefind deep search button
          const deepBtn = await page
            .$('[data-testid="deep-search"], button:text("Search all")')
            .catch(() => null);
          if (deepBtn) {
            await deepBtn.click();
            await page.waitForTimeout(1500);
            urls = await page
              .$$eval("a[href]", (els) =>
                els
                  .map((el) => el.getAttribute("href") || "")
                  .filter((h) => h.startsWith("/"))
              )
              .catch(() => []);
          }
        }

        // Check if expected URL is in top-N
        const topUrls = urls.slice(0, topN);
        const found = topUrls.some(
          (u) =>
            u === expectedUrl ||
            u.replace(/\/$/, "") === expectedUrl.replace(/\/$/, "")
        );

        if (found) {
          passed++;
          if (isTypo) typoPassed++;
        } else {
          failed++;
          if (isTypo) {
            typoFailed++;
            typoFailedCases.push({
              query,
              expected: expectedUrl,
              got: topUrls.slice(0, 3),
            });
          }
          failedCases.push({
            query,
            expected: expectedUrl,
            got: topUrls.slice(0, 3),
          });
        }

        // Close palette (Escape)
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      } catch (e) {
        failed++;
        if (isTypo) typoFailed++;
        failedCases.push({ query, reason: e.message });
      }
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  const total = passed + failed;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  notes.push(`search results: ${passed}/${total} (${pct}%) — typo: ${typoPassed}/${typoPassed + typoFailed}`);

  if (pct < 90) {
    errors.push(`search gate: ${pct}% overall (need ≥90%). Failed cases:`);
    for (const f of failedCases.slice(0, 10)) {
      errors.push(
        `  "${f.query}" → expected "${f.expected || "?"}", got [${(f.got || []).slice(0,3).join(", ")}]${f.reason ? ` (${f.reason})` : ""}`
      );
    }
  }

  if (typoFailed > 0) {
    errors.push(
      `search gate: typo cases NOT 100% (${typoPassed}/${typoPassed + typoFailed}):`
    );
    for (const f of typoFailedCases) {
      errors.push(
        `  "${f.query}" → expected "${f.expected || "?"}", got [${(f.got || []).slice(0,3).join(", ")}]`
      );
    }
  }

  if (errors.length === 0) {
    notes.push(`search: ${pct}% ≥ 90% AND all typo cases pass ✓`);
  }

  return { pass: errors.length === 0, errors, notes };
}
