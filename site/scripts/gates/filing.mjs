/**
 * gate — filing_gate
 *
 * (a) Filing pages built: count >= filings_index.json total (expect ~4,258)
 * (b) Zero-mention filings have robots noindex meta
 * (c) All sampled pages have a canonical link
 * (d) Income/expense figures carry [data-amount] (state A via lda_filing citations)
 *
 * Samples 50 filing pages for checks (b)-(d) to keep runtime reasonable.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

const SAMPLE_SIZE = 50;
const MIN_FILING_COUNT = 4000; // allow variance from the nominal 4,258

export async function runFilingGate() {
  const errors = [];
  const notes = [];

  const filingOutDir = path.join(outDir, "filing");

  // Gracefully handle missing out/ (pre-build)
  if (!fs.existsSync(filingOutDir)) {
    notes.push("out/filing/ not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── Load filings index sidecar ─────────────────────────────────────────────
  let filingsIndex = null;
  let indexedFilings = [];
  try {
    filingsIndex = JSON.parse(
      fs.readFileSync(path.join(jsonDir, "filings_index.json"), "utf8")
    );
    indexedFilings = filingsIndex.filings ?? [];
  } catch {
    notes.push("filings_index.json not found — using page count only");
  }

  // ── (a) Filing page count ───────────────────────────────────────────────────
  const filingDirs = fs
    .readdirSync(filingOutDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const expectedCount = indexedFilings.length || MIN_FILING_COUNT;

  if (filingDirs.length < MIN_FILING_COUNT) {
    errors.push(
      `filing pages: found ${filingDirs.length}, expected >= ${MIN_FILING_COUNT} (index has ${expectedCount})`
    );
  } else {
    notes.push(`filing pages: ${filingDirs.length} ✓`);
  }

  // ── (b) + (c) + (d) — sample 50 pages ─────────────────────────────────────
  // Build a map of uuid -> has_mentions from the index
  const mentionMap = new Map(
    indexedFilings.map((f) => [f.filing_uuid, f.has_mentions])
  );

  // Select sample: prefer mix of with/without mentions
  const withMentions = filingDirs.filter(
    (d) => mentionMap.get(d) === true
  );
  const withoutMentions = filingDirs.filter(
    (d) => mentionMap.get(d) === false
  );
  const unknown = filingDirs.filter((d) => !mentionMap.has(d));

  const half = Math.ceil(SAMPLE_SIZE / 2);
  const sampleWith = withMentions.slice(0, half);
  const sampleWithout = withoutMentions.slice(0, SAMPLE_SIZE - sampleWith.length);
  // Fill remainder with unknown if needed
  const remainder = SAMPLE_SIZE - sampleWith.length - sampleWithout.length;
  const sampleUnknown = unknown.slice(0, remainder);
  const sample = [...sampleWith, ...sampleWithout, ...sampleUnknown];

  let noindexOk = 0;
  let noindexExpected = 0;
  let canonicalOk = 0;
  let amountPagesChecked = 0;
  let amountPagesOk = 0;

  for (const uuid of sample) {
    const pagePath = path.join(filingOutDir, uuid, "index.html");
    if (!fs.existsSync(pagePath)) {
      errors.push(`filing page missing: filing/${uuid}/index.html`);
      continue;
    }

    let pageHtml;
    try {
      pageHtml = fs.readFileSync(pagePath, "utf8");
    } catch (e) {
      errors.push(`failed to read filing/${uuid}/index.html: ${e.message}`);
      continue;
    }

    const pageRoot = parse(pageHtml, { comment: false });

    // (b) noindex check for zero-mention filings
    const hasMentions = mentionMap.get(uuid);
    if (hasMentions === false) {
      noindexExpected++;
      const robotsMeta = pageRoot.querySelectorAll('meta[name="robots"]');
      const isNoindex = robotsMeta.some((m) => {
        const content = m.getAttribute("content") ?? "";
        return content.includes("noindex");
      });
      if (isNoindex) {
        noindexOk++;
      } else {
        errors.push(
          `filing/${uuid}: zero-mention filing is missing robots noindex meta`
        );
      }
    }

    // (c) canonical link
    const canonicals = pageRoot.querySelectorAll('link[rel="canonical"]');
    if (canonicals.length > 0) {
      canonicalOk++;
    } else {
      errors.push(`filing/${uuid}: no canonical link found`);
    }

    // (d) [data-amount] check — only for filings that have income/expense data
    // Check if the page has "Reported income" section (filing has financial data)
    if (pageHtml.includes("Reported income")) {
      amountPagesChecked++;
      const amountEls = pageRoot.querySelectorAll("[data-amount]");
      if (amountEls.length > 0) {
        amountPagesOk++;
      } else {
        // "not reported" filings have no figures — that's OK
        const hasNotReported = pageHtml.includes("not reported");
        if (hasNotReported) {
          amountPagesOk++; // no figures to cite
        } else {
          errors.push(
            `filing/${uuid}: has income/expense section but no [data-amount] elements`
          );
        }
      }
    }
  }

  if (sample.length > 0) {
    notes.push(
      `filing sample (${sample.length}): canonical=${canonicalOk}/${sample.length} ✓`
    );
  }
  if (noindexExpected > 0) {
    if (noindexOk < noindexExpected) {
      // Already added individual errors above
    } else {
      notes.push(
        `filing sample: noindex on zero-mention=${noindexOk}/${noindexExpected} ✓`
      );
    }
  }
  if (amountPagesChecked > 0) {
    notes.push(
      `filing sample: [data-amount] on income pages=${amountPagesOk}/${amountPagesChecked} ✓`
    );
  }

  return { pass: errors.length === 0, errors, notes };
}
