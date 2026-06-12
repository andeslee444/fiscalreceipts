/**
 * gate 6 — a11y_gate
 *
 * @axe-core/playwright on:
 *   - home
 *   - a program page WITH citation panel open
 *   - a company page
 *   - /data/
 *   - search palette open
 *
 * Requirement: zero serious/critical violations.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function getSampleProgram() {
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const programDetailsDir = path.join(jsonDir, "program_details");
  // Find first program with a jbook_pdf citation
  const citations = readJson(path.join(jsonDir, "citations.json"));
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
  return { pbl: programs[0]?.pe_bli, factId: null };
}

function getSampleCompany() {
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  return entities[0]?.slug ?? "lockheed-martin";
}

export async function runA11yGate(baseUrl) {
  const errors = [];
  const notes = [];

  const { pbl: samplePbl, factId: sampleFactId } = getSampleProgram();
  const sampleCompany = getSampleCompany();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: true });

  const testCases = [
    {
      label: "home",
      url: `${baseUrl}/`,
      setup: null,
    },
    {
      label: "program with panel open",
      url: `${baseUrl}/program/${samplePbl}/`,
      setup: async (page) => {
        if (sampleFactId) {
          const el = await page
            .$(`[data-fact-id="${sampleFactId}"]`)
            .catch(() => null);
          if (el) {
            await el.click();
            await page
              .waitForSelector('[data-testid="citation-panel"]', {
                timeout: 8000,
              })
              .catch(() => null);
            await page.waitForTimeout(500);
          }
        }
      },
    },
    {
      label: "company page",
      url: `${baseUrl}/company/${sampleCompany}/`,
      setup: null,
    },
    {
      label: "/data/",
      url: `${baseUrl}/data/`,
      setup: null,
    },
    {
      label: "search palette open",
      url: `${baseUrl}/`,
      setup: async (page) => {
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
        await page.waitForTimeout(300);
      },
    },
  ];

  try {
    for (const tc of testCases) {
      const page = await context.newPage();
      try {
        await page.goto(tc.url, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        if (tc.setup) {
          await tc.setup(page);
        }

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        const critical = results.violations.filter(
          (v) => v.impact === "critical"
        );
        const serious = results.violations.filter(
          (v) => v.impact === "serious"
        );

        const totalViolations = critical.length + serious.length;
        if (totalViolations > 0) {
          errors.push(
            `a11y ${tc.label}: ${critical.length} critical + ${serious.length} serious violations:`
          );
          for (const v of [...critical, ...serious].slice(0, 5)) {
            errors.push(
              `  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`
            );
          }
          if (critical.length + serious.length > 5) {
            errors.push(
              `  ... and ${critical.length + serious.length - 5} more`
            );
          }
        } else {
          const minor = results.violations.filter(
            (v) => !["critical", "serious"].includes(v.impact)
          );
          notes.push(
            `a11y ${tc.label}: 0 critical/serious (${minor.length} minor) ✓`
          );
        }
      } catch (e) {
        errors.push(`a11y ${tc.label}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
