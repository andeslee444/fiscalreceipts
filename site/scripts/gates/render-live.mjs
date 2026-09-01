/**
 * gate 3 — render_live_gate (Playwright chromium)
 *
 * Stratified page set: home, /programs/, /companies/, /data/, /downloads/,
 * /methodology/, 1 agency page, 4 program pages (deterministic: zero-amount-chip,
 * no-trajectory, heaviest 0606301D8Z, unique-resolution), 2 company pages
 * (incl. one with mentions).
 *
 * Per page: zero console errors; JSON-LD parses; title+description non-empty.
 * On /data/: click first canned query → await [data-testid=query-results] rows >0.
 *
 * MOBILE-VIEWPORT LEG (PM Sprint 3 Task 1 / backlog #31) — see gates/mobile.mjs.
 * This gate already owns the question "does every page class actually render in
 * a real browser", and it already owns the server + chromium harness, so the
 * 390×844 pass is a second width of the same question rather than a 25th gate.
 * Its errors are this gate's errors: gate 3 goes red when the money leaves the
 * phone screen.
 *
 * LAYOUT-SPINE LEG (ROADMAP #42) — see gates/spine.mjs. Same argument at the
 * other end of the range: 1440 and 1920, asserting that the content column
 * starts on one declared left edge across every route the app declares, and
 * that no line of prose in it runs past 80 characters. Unlike every other leg
 * in the suite it is a property of the SITE rather than of a page — the six
 * different left edges it caught were each individually fine.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { runMobileLeg } from "./mobile.mjs";
import { runSpineLeg } from "./spine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Compute deterministic page set from sidecars */
function computePageSet() {
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  const agencies = readJson(path.join(jsonDir, "agencies.json"));

  // 1 agency (first alphabetically)
  const agencyOrg = agencies[0]?.org ?? "DARPA";

  // Program pages (deterministic):
  // a) zero-amount-chip: lowest pe_bli with a zero_amount detail
  // b) no-trajectory: lowest pe_bli with trajectory == null
  // c) heaviest: 0606301D8Z
  // d) unique-resolution: lowest pe_bli with unique resolution detail

  const programDetailsDir = path.join(jsonDir, "program_details");

  let zeroAmountPbl = null;
  let noTrajectoryPbl = programs.find((p) => p.trajectory === null)?.pe_bli ?? null;
  let uniqueResPbl = null;

  const programsSorted = [...programs].sort((a, b) =>
    a.pe_bli.localeCompare(b.pe_bli)
  );

  for (const p of programsSorted) {
    if (zeroAmountPbl && uniqueResPbl) break;
    const detailsPath = path.join(programDetailsDir, `${p.pe_bli}.json`);
    if (!fs.existsSync(detailsPath)) continue;
    let details;
    try {
      details = readJson(detailsPath);
    } catch {
      continue;
    }
    const rows = details.details || [];
    if (!zeroAmountPbl && rows.some((r) => r.resolution === "zero_amount")) {
      zeroAmountPbl = p.pe_bli;
    }
    if (!uniqueResPbl && rows.some((r) => r.resolution === "unique")) {
      uniqueResPbl = p.pe_bli;
    }
  }

  // Deduplicate program pages
  const programSet = new Set([
    zeroAmountPbl,
    noTrajectoryPbl,
    "0606301D8Z",
    uniqueResPbl,
  ].filter(Boolean));

  // 2 company pages: top company + one with mentions
  const topSlug = entities[0]?.slug ?? "lockheed-martin";
  let mentionSlug = null;
  const entityDetailsDir = path.join(jsonDir, "entity_details");
  for (const e of entities) {
    const detPath = path.join(entityDetailsDir, `${e.slug}.json`);
    if (!fs.existsSync(detPath)) continue;
    try {
      const ed = readJson(detPath);
      if ((ed.mentions || []).length > 0) {
        if (e.slug !== topSlug) {
          mentionSlug = e.slug;
          break;
        }
      }
    } catch {
      // skip
    }
  }

  return {
    agencyOrg,
    programPages: [...programSet],
    companyPages: [topSlug, mentionSlug].filter(Boolean),
    topSlug,
    zeroAmountPbl,
    noTrajectoryPbl,
    uniqueResPbl,
  };
}

export async function runRenderLiveGate(baseUrl) {
  const errors = [];
  const notes = [];

  const pageSet = computePageSet();
  notes.push(
    `page set: agency=${pageSet.agencyOrg}, programs=[${pageSet.programPages.join(",")}], companies=[${pageSet.companyPages.join(",")}]`
  );

  // All pages to visit
  const staticPages = [
    `${baseUrl}/`,
    `${baseUrl}/programs/`,
    `${baseUrl}/companies/`,
    `${baseUrl}/data/`,
    `${baseUrl}/downloads/`,
    `${baseUrl}/methodology/`,
    `${baseUrl}/agency/${pageSet.agencyOrg}/`,
  ];
  const programUrls = pageSet.programPages.map(
    (pbl) => `${baseUrl}/program/${pbl}/`
  );
  const companyUrls = pageSet.companyPages.map(
    (slug) => `${baseUrl}/company/${slug}/`
  );

  const allPages = [...staticPages, ...programUrls, ...companyUrls];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    javaScriptEnabled: true,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  try {
    for (const pageUrl of allPages) {
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(`pageerror: ${err.message}`);
      });

      try {
        const response = await page.goto(pageUrl, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        const relUrl = pageUrl.replace(baseUrl, "");

        // ── Check HTTP status ──────────────────────────────────────────────
        if (response && response.status() >= 400) {
          errors.push(`${relUrl}: HTTP ${response.status()}`);
          await page.close();
          continue;
        }

        // ── Console errors ─────────────────────────────────────────────────
        if (consoleErrors.length > 0) {
          errors.push(
            `${relUrl}: ${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join("; ")}`
          );
        }

        // ── Title ──────────────────────────────────────────────────────────
        const title = await page.title();
        if (!title || title.trim() === "") {
          errors.push(`${relUrl}: empty <title>`);
        }

        // ── Meta description ───────────────────────────────────────────────
        const metaDesc = await page
          .$eval('meta[name="description"]', (el) => el.content)
          .catch(() => "");
        if (!metaDesc || metaDesc.trim() === "") {
          errors.push(`${relUrl}: missing/empty meta description`);
        }

        // ── JSON-LD parses ─────────────────────────────────────────────────
        const jsonLdTexts = await page.$$eval(
          'script[type="application/ld+json"]',
          (els) => els.map((el) => el.textContent)
        );
        for (const text of jsonLdTexts) {
          try {
            JSON.parse(text);
          } catch (e) {
            errors.push(`${relUrl}: invalid JSON-LD: ${e.message}`);
          }
        }

        // ── /data/ special: run canned query ──────────────────────────────
        if (relUrl === "/data/") {
          try {
            // Click the first canned query button
            const cannedBtn = await page.waitForSelector(
              '[data-testid="canned-query"]',
              { timeout: 10000 }
            );
            if (!cannedBtn) {
              errors.push(`/data/: no [data-testid=canned-query] buttons found`);
            } else {
              await cannedBtn.click();
              // Wait for results
              await page.waitForSelector('[data-testid="query-results"]', {
                timeout: 60000,
              });
              const rowCount = await page.$$eval(
                '[data-testid="query-results"] tr',
                (rows) => rows.length
              );
              if (rowCount <= 1) {
                // 1 = header only
                errors.push(
                  `/data/: canned query returned 0 data rows (WASM/parquet issue)`
                );
              } else {
                notes.push(`/data/ canned query: ${rowCount - 1} result rows ✓`);
              }
            }
          } catch (e) {
            errors.push(`/data/: canned query check failed: ${e.message}`);
          }
        }

        notes.push(
          `${relUrl}: OK (title="${title.slice(0, 40)}"${consoleErrors.length ? `, ${consoleErrors.length} console errors` : ""})`
        );
      } catch (e) {
        errors.push(`${relUrl}: navigation failed: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  // ── Mobile-viewport leg (390×844), reusing this gate's browser ───────────
  try {
    const mobile = await runMobileLeg({ baseUrl, browser });
    errors.push(...mobile.errors);
    notes.push(...mobile.notes);
  } catch (e) {
    errors.push(`mobile leg: crashed: ${e.message}`);
  }

  // ── Layout-spine leg (1440 and 1920), same browser ───────────────────────
  try {
    const spine = await runSpineLeg({ baseUrl, browser });
    errors.push(...spine.errors);
    notes.push(...spine.notes);
  } catch (e) {
    errors.push(`spine leg: crashed: ${e.message}`);
  } finally {
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
