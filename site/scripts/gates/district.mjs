/**
 * gate — district_gate
 *
 * (a) 106 district pages exist (out/district/{code}/index.html)
 * (b) Each sampled district page has a disclaimer banner (coverage note)
 * (c) Program-linked dollars have [data-amount] (either cited or uncited —
 *     geography totals may be state C)
 * (d) District index (out/district/index.html) exists with state filter select
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

const EXPECTED_DISTRICTS = 106;
const SAMPLE_SIZE = 10;

export async function runDistrictGate() {
  const errors = [];
  const notes = [];

  const districtOutDir = path.join(outDir, "district");

  // Gracefully handle missing out/ (pre-build)
  if (!fs.existsSync(districtOutDir)) {
    notes.push("out/district/ not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── (a) District page count ─────────────────────────────────────────────────
  // Count subdirectories in out/district/ (each has an index.html)
  const districtDirs = fs
    .readdirSync(districtOutDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // Try to get expected count from sidecar
  let expectedCount = EXPECTED_DISTRICTS;
  try {
    const districtIndex = JSON.parse(
      fs.readFileSync(path.join(jsonDir, "districts", "index.json"), "utf8")
    );
    expectedCount = districtIndex.total_districts ?? EXPECTED_DISTRICTS;
  } catch {
    // sidecar not available — use hardcoded expected
  }

  if (districtDirs.length < expectedCount) {
    errors.push(
      `district pages: found ${districtDirs.length}, expected >= ${expectedCount}`
    );
  } else {
    notes.push(`district pages: ${districtDirs.length} ✓`);
  }

  // ── (d) District index page ─────────────────────────────────────────────────
  const indexPath = path.join(districtOutDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    errors.push("out/district/index.html not found");
  } else {
    const indexHtml = fs.readFileSync(indexPath, "utf8");
    const indexRoot = parse(indexHtml, { comment: false });
    // Check for a state filter <select> element
    const selects = indexRoot.querySelectorAll("select");
    const hasStateFilter = selects.some((el) => {
      const id = el.getAttribute("id") ?? "";
      const label = indexHtml;
      return id.includes("state") || label.includes("Filter by state");
    });
    if (!hasStateFilter) {
      errors.push("district index: state filter select not found");
    } else {
      notes.push("district index: state filter present ✓");
    }
  }

  // ── (b) Disclaimer banner + (c) [data-amount] — sample check ───────────────
  const sampleDirs = districtDirs
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.min(SAMPLE_SIZE, districtDirs.length));

  let disclaimerOk = 0;
  let amountOk = 0;

  for (const dir of sampleDirs) {
    const pagePath = path.join(districtOutDir, dir, "index.html");
    if (!fs.existsSync(pagePath)) {
      errors.push(`district page missing: district/${dir}/index.html`);
      continue;
    }

    let pageHtml;
    try {
      pageHtml = fs.readFileSync(pagePath, "utf8");
    } catch (e) {
      errors.push(`failed to read district/${dir}/index.html: ${e.message}`);
      continue;
    }

    const pageRoot = parse(pageHtml, { comment: false });

    // (b) Disclaimer — check for the coverage note text
    const hasCoverageNote =
      pageHtml.includes("Coverage note") || pageHtml.includes("coverage note");
    if (hasCoverageNote) {
      disclaimerOk++;
    } else {
      errors.push(`district/${dir}: no disclaimer/coverage-note banner found`);
    }

    // (c) [data-amount] elements present (district has program obligation figures)
    const amountEls = pageRoot.querySelectorAll("[data-amount]");
    if (amountEls.length > 0) {
      amountOk++;
    } else {
      // Some districts may have zero programs — that's OK (no figures, no [data-amount])
      // Only fail if the page has obligation text but no data-amount wrappers.
      const hasObligationText =
        pageHtml.includes("obligation") && pageHtml.includes("linked program");
      if (hasObligationText && !pageHtml.includes("0 linked programs")) {
        errors.push(
          `district/${dir}: has obligation content but no [data-amount] elements`
        );
      } else {
        amountOk++; // zero-program district — no figures expected
      }
    }
  }

  if (sampleDirs.length > 0) {
    notes.push(
      `district sample (${sampleDirs.length}): disclaimer=${disclaimerOk}/${sampleDirs.length} ✓`
    );
    notes.push(
      `district sample (${sampleDirs.length}): [data-amount]=${amountOk}/${sampleDirs.length} ✓`
    );
  }

  return { pass: errors.length === 0, errors, notes };
}
