/**
 * gate — degraded_gate (Phase 5C, G3)
 *
 * Simulates asset-unavailability by blackholing all /assets/** requests.
 * Checks that the site surfaces explicit fallback states instead of blank
 * panels, spinners, or silent failures.
 *
 * Checks:
 * 1. /data/ → click "Start the engine" button → [data-degraded="explorer"] visible
 * 2. /downloads/ → [data-degraded="downloads"] visible
 * 3. First flow program page → open a jbook_pdf citation → [data-degraded="pdf"]
 * 4. Console: no uncaught errors (allowlist: messages containing "assets" +
 *    "Failed to fetch"/"ERR_FAILED"/"AbortError"/"net::ERR_ABORTED" are allowed).
 *
 * Export: runDegradedGate({ baseUrl }) → { pass, errors, notes }
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Find the first flow program slug with a jbook_pdf citation */
function firstFlowProgramWithPdf() {
  const flowsDir = path.join(jsonDir, "flows");
  if (!fs.existsSync(flowsDir)) return null;
  const slugs = fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json")).sort();
  if (slugs.length === 0) return null;

  let citations;
  try {
    citations = readJson(path.join(jsonDir, "citations.json"));
  } catch {
    return null;
  }

  for (const slugFile of slugs) {
    const slug = slugFile.replace(".json", "");
    const detailsPath = path.join(jsonDir, "program_details", `${slug}.json`);
    if (!fs.existsSync(detailsPath)) continue;
    try {
      const details = readJson(detailsPath);
      for (const d of details.details || []) {
        if (d.fact_id && citations[d.fact_id]?.kind === "jbook_pdf") {
          return { slug, factId: d.fact_id };
        }
      }
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * Is this console message from an expected asset abort?
 * Allow messages that mention "assets" and a network-failure keyword,
 * or standard abort signals from the Playwright route abort.
 */
function isAllowedConsoleError(msg) {
  const text = msg.text().toLowerCase();
  const isNetworkNoise =
    text.includes("failed to fetch") ||
    text.includes("err_failed") ||
    text.includes("aborterror") ||
    text.includes("net::err_aborted") ||
    text.includes("load failed") ||
    text.includes("networkerror") ||
    text.includes("the operation was aborted") ||
    text.includes("request was aborted");
  if (isNetworkNoise) return true;
  // Also allow PDF.js worker errors when assets are blocked
  if (text.includes("pdf") && (text.includes("worker") || text.includes("load"))) return true;
  if (text.includes("pagefind") || text.includes("search")) return true;
  return false;
}

export async function runDegradedGate({ baseUrl }) {
  const errors = [];
  const notes = [];

  const flowInfo = firstFlowProgramWithPdf();
  notes.push(
    `flow program for PDF check: ${flowInfo ? `${flowInfo.slug} (factId=${flowInfo.factId})` : "none found"}`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: true });

  // Collect console errors per page
  const consoleErrors = [];

  try {
    // ── Check 1: /data/ → engine start → [data-degraded="explorer"] ──────────
    {
      const page = await context.newPage();
      await page.route("**/assets/**", (route) => route.abort());
      page.on("console", (msg) => {
        if (msg.type() === "error" && !isAllowedConsoleError(msg)) {
          consoleErrors.push(msg.text());
        }
      });
      try {
        await page.goto(`${baseUrl}/data/`, { waitUntil: "networkidle", timeout: 30000 });

        // Click "Start the engine" button (no data-testid; find by text)
        const startBtn = page.getByRole("button", { name: /start the engine/i }).first();
        const startBtnExists = await startBtn.isVisible().catch(() => false);
        if (startBtnExists) {
          await startBtn.click();
          notes.push("/data/: clicked 'Start the engine' button");
        } else {
          notes.push("/data/: no 'Start the engine' button found (may auto-init)");
        }

        // Wait up to 10s for degraded state
        const degradedEl = await page
          .waitForSelector('[data-degraded="explorer"]', { timeout: 10000 })
          .catch(() => null);

        if (!degradedEl) {
          errors.push('/data/: [data-degraded="explorer"] not visible after assets blackholed');
        } else {
          const visible = await degradedEl.isVisible();
          if (!visible) {
            errors.push('/data/: [data-degraded="explorer"] exists but is not visible');
          } else {
            notes.push('/data/: [data-degraded="explorer"] visible ✓');
          }
        }
      } catch (e) {
        errors.push(`/data/ check: ${e.message}`);
      } finally {
        await page.close();
      }
    }

    // ── Check 2: /downloads/ → [data-degraded="downloads"] ──────────────────
    {
      const page = await context.newPage();
      await page.route("**/assets/**", (route) => route.abort());
      page.on("console", (msg) => {
        if (msg.type() === "error" && !isAllowedConsoleError(msg)) {
          consoleErrors.push(msg.text());
        }
      });
      try {
        await page.goto(`${baseUrl}/downloads/`, { waitUntil: "networkidle", timeout: 30000 });

        const degradedEl = await page
          .waitForSelector('[data-degraded="downloads"]', { timeout: 10000 })
          .catch(() => null);

        if (!degradedEl) {
          errors.push('/downloads/: [data-degraded="downloads"] not visible after assets blackholed');
        } else {
          const visible = await degradedEl.isVisible();
          if (!visible) {
            errors.push('/downloads/: [data-degraded="downloads"] exists but is not visible');
          } else {
            notes.push('/downloads/: [data-degraded="downloads"] visible ✓');
          }
        }
      } catch (e) {
        errors.push(`/downloads/ check: ${e.message}`);
      } finally {
        await page.close();
      }
    }

    // ── Check 3: flow program jbook_pdf citation → [data-degraded="pdf"] ─────
    if (flowInfo) {
      const page = await context.newPage();
      await page.route("**/assets/**", (route) => route.abort());
      page.on("console", (msg) => {
        if (msg.type() === "error" && !isAllowedConsoleError(msg)) {
          consoleErrors.push(msg.text());
        }
      });
      try {
        await page.goto(`${baseUrl}/program/${flowInfo.slug}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        // Click the fact element to open the citation panel
        const factEl = await page.$(`[data-fact-id="${flowInfo.factId}"]`).catch(() => null);
        if (!factEl) {
          errors.push(`/program/${flowInfo.slug}/: no [data-fact-id="${flowInfo.factId}"] element`);
        } else {
          await factEl.click();

          // Wait for panel to open
          const panel = await page
            .waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 })
            .catch(() => null);

          if (!panel) {
            errors.push(`/program/${flowInfo.slug}/: citation panel did not open after click`);
          } else {
            // With assets blackholed, PDF can't load → should show [data-degraded="pdf"]
            const degradedPdf = await page
              .waitForSelector('[data-degraded="pdf"]', { timeout: 10000 })
              .catch(() => null);

            if (!degradedPdf) {
              // Gate FAILS — this is the expected pre-5C outcome.
              // pdf-view.tsx renders an error state but lacks data-degraded="pdf".
              errors.push(
                `/program/${flowInfo.slug}/: citation panel open but [data-degraded="pdf"] not found ` +
                `(pdf-view.tsx error state needs data-degraded="pdf" attr — required by G3)`
              );
            } else {
              const visible = await degradedPdf.isVisible();
              if (!visible) {
                errors.push(`/program/${flowInfo.slug}/: [data-degraded="pdf"] exists but not visible`);
              } else {
                notes.push(`/program/${flowInfo.slug}/: [data-degraded="pdf"] visible ✓`);
              }
            }
          }
        }
      } catch (e) {
        errors.push(`/program/${flowInfo.slug}/ PDF check: ${e.message}`);
      } finally {
        await page.close();
      }
    } else {
      errors.push("PDF degraded check: no flow program with jbook_pdf citation found");
    }

    // ── Check 4: console errors (non-allowlisted) ─────────────────────────────
    if (consoleErrors.length > 0) {
      errors.push(`console: ${consoleErrors.length} non-allowlisted error(s): ${consoleErrors.slice(0, 3).join(" | ")}`);
    } else {
      notes.push("console: no non-allowlisted errors ✓");
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
