/**
 * gate 2 — render_static_gate
 *
 * Parses EVERY out/**\/\*.html (via node-html-parser):
 *
 * (a) POSITIVE: every [data-amount] matches exactly one of the three Cite states:
 *       A: data-fact-id={id} where id resolves in citations.json
 *       B: data-citation-kind="xml-path" AND data-xml-path is non-empty
 *       C: data-uncited="true"
 *     Any element with data-amount that matches none → FAIL.
 *
 * (b) NEGATIVE: text nodes containing currency pattern
 *       $[\d,]+(\.\d+)?\s*[BMK]?  (comma-grouped dollars)
 *     OUTSIDE [data-amount] subtrees → FAIL (listing page + snippet).
 *     Exceptions: content inside <script>, <style>, JSON-LD <script> tags.
 *     Allowlist (prose-allowlist.json) consulted for known prose mentions.
 *
 * (c) DATASET LEDGER (Phase 5B-3 — binding evaluator design):
 *     Reads site_meta.json's uncited_datasets ledger. Every [data-amount]
 *     element MUST carry data-dataset; then:
 *       - state C ([data-uncited]) with a dataset NOT on the ledger → FAIL
 *         (flipped datasets may no longer render ⁂)
 *       - state A ([data-fact-id]) with a dataset still ON the ledger → FAIL
 *         (a dataset cannot be both 'citation pending' and cited)
 *       - missing/empty data-dataset on ANY [data-amount] → FAIL
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");
const allowlistPath = path.resolve(__dirname, "prose-allowlist.json");

// Currency pattern: $X,XXX(.XX)? optionally followed by B/M/K
// Must be in a text node (not a URL/href)
const CURRENCY_RE = /\$[\d,]+(\.\d+)?\s*[BMK]?/g;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function* walkHtmlFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtmlFiles(fullPath);
    } else if (entry.name.endsWith(".html")) {
      yield fullPath;
    }
  }
}

export async function runRenderStaticGate() {
  const errors = [];
  const notes = [];

  // ── Load citations ────────────────────────────────────────────────────────
  const citations = readJson(path.join(jsonDir, "citations.json"));
  const citationKeys = new Set(Object.keys(citations));

  // ── Load the dataset ledger (site_meta.uncited_datasets) ─────────────────
  const siteMeta = readJson(path.join(jsonDir, "site_meta.json"));
  const uncitedDatasets = new Set(siteMeta.uncited_datasets || []);
  notes.push(`dataset ledger: [${[...uncitedDatasets].join(", ")}]`);

  // ── Load prose allowlist ──────────────────────────────────────────────────
  let allowlist = [];
  try {
    allowlist = readJson(allowlistPath);
  } catch {
    // allowlist is optional
  }
  const allowedPatterns = allowlist.map((e) => e.pattern);

  // ── Collect all HTML files ────────────────────────────────────────────────
  const htmlFiles = [...walkHtmlFiles(outDir)];
  notes.push(`scanning ${htmlFiles.length} HTML files`);

  let positiveErrors = 0;
  let negativeErrors = 0;
  let ledgerErrors = 0;
  const positiveFailures = [];
  const negativeFailures = [];
  const ledgerFailures = [];

  for (const filePath of htmlFiles) {
    const relPath = path.relative(outDir, filePath);
    let html;
    try {
      html = fs.readFileSync(filePath, "utf8");
    } catch {
      errors.push(`failed to read ${relPath}`);
      continue;
    }

    let root;
    try {
      root = parse(html, { comment: false });
    } catch (e) {
      errors.push(`failed to parse ${relPath}: ${e.message}`);
      continue;
    }

    // ── (a) Positive: data-amount elements ──────────────────────────────────
    const amountEls = root.querySelectorAll("[data-amount]");
    for (const el of amountEls) {
      const factId = el.getAttribute("data-fact-id");
      const citationKind = el.getAttribute("data-citation-kind");
      const xmlPath = el.getAttribute("data-xml-path");
      const uncited = el.getAttribute("data-uncited");
      const dataset = el.getAttribute("data-dataset");

      // ── (c) Dataset ledger enforcement ─────────────────────────────────
      // Missing data-dataset on ANY [data-amount] → FAIL.
      if (!dataset || dataset.trim() === "") {
        ledgerErrors++;
        ledgerFailures.push({
          file: relPath,
          issue: `[data-amount] missing data-dataset attribute`,
          attrs: el.rawAttrs?.slice(0, 200),
        });
      } else if (uncited === "true" && !uncitedDatasets.has(dataset)) {
        // State C with a dataset NOT on the ledger — the dataset has a
        // citation tier, so it may no longer render ⁂.
        ledgerErrors++;
        ledgerFailures.push({
          file: relPath,
          issue: `state-C (uncited) span for dataset "${dataset}" which is NOT on the uncited ledger — must be flipped to a cited state`,
        });
      } else if (factId && uncitedDatasets.has(dataset)) {
        // State A with a dataset still ON the ledger — contradiction.
        ledgerErrors++;
        ledgerFailures.push({
          file: relPath,
          issue: `state-A (cited) span for dataset "${dataset}" which IS on the uncited ledger — ledger and citations disagree`,
        });
      }

      let stateMatch = false;

      // State A: data-fact-id resolves in citations.json
      if (factId) {
        if (citationKeys.has(factId)) {
          stateMatch = true;
        } else {
          positiveErrors++;
          positiveFailures.push({
            file: relPath,
            issue: `data-fact-id="${factId}" not found in citations.json`,
          });
          continue;
        }
      }

      // State B: data-citation-kind="xml-path" with non-empty data-xml-path
      if (!stateMatch && citationKind === "xml-path") {
        if (xmlPath && xmlPath.trim() !== "") {
          stateMatch = true;
        } else {
          positiveErrors++;
          positiveFailures.push({
            file: relPath,
            issue: `data-citation-kind="xml-path" but data-xml-path is empty/missing`,
          });
          continue;
        }
      }

      // State C: data-uncited="true"
      if (!stateMatch && uncited === "true") {
        stateMatch = true;
      }

      if (!stateMatch) {
        positiveErrors++;
        positiveFailures.push({
          file: relPath,
          issue: `[data-amount] matches no valid cite state (no fact-id, no xml-path, no uncited)`,
          attrs: el.rawAttrs?.slice(0, 200),
        });
      }
    }

    // ── (b) Negative: currency patterns outside [data-amount] ──────────────
    // Strip <script> and <style> content from the raw HTML before parsing
    // to avoid false positives from JS literals, JSON-LD, CSS values.
    const strippedHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    let stripped;
    try {
      stripped = parse(strippedHtml, { comment: false });
    } catch {
      stripped = root; // fallback to original on parse error
    }

    // Walk text nodes and check for currency patterns not inside [data-amount]
    //
    // Skip conditions (in addition to [data-amount]):
    //   - data-source-text: element contains quoted source text (e.g. J-book
    //     narrative prose), block-cited at the xml_path level — dollar strings
    //     are from the source document, not site-computed figures.
    //   - data-program-name: element renders a program title label (e.g.
    //     "ORDNANCE ITEMS <$5M") — the dollar string is part of the official
    //     program name, not a site-computed figure.
    //   - <head>: page metadata (title, meta descriptions) may contain program
    //     names or descriptions with dollar strings; these are not rendered
    //     figure text and should not be scanned.
    function walkText(node, insideAmount) {
      if (node.nodeType === 3) {
        // text node
        const text = node.rawText || "";
        if (!insideAmount) {
          const matches = text.match(CURRENCY_RE);
          if (matches) {
            for (const m of matches) {
              // Check allowlist
              const mTrimmed = m.trim();
              const allowed = allowedPatterns.some((p) => mTrimmed === p.trim());
              if (!allowed) {
                negativeErrors++;
                const snippet = text.trim().slice(0, 120);
                negativeFailures.push({
                  file: relPath,
                  match: m,
                  snippet,
                });
                if (negativeFailures.length >= 50) return; // cap
              }
            }
          }
        }
        return;
      }
      // node-html-parser returns `undefined` (NOT null) for missing
      // attributes — a strict `!== null` check is ALWAYS true, which made
      // every element count as data-amount and the negative currency scan
      // vacuous. Loose `!= null` matches both null and undefined.
      const isAmount = node.getAttribute && node.getAttribute("data-amount") != null;
      // Skip subtrees containing quoted source text (narrative prose, program names)
      // or the <head> element (page metadata is not rendered figure text).
      const isSourceText = node.getAttribute && node.getAttribute("data-source-text") != null;
      const isProgramName = node.getAttribute && node.getAttribute("data-program-name") != null;
      const isHead = node.tagName && node.tagName.toLowerCase() === "head";
      const nowInside = insideAmount || isAmount || isSourceText || isProgramName || isHead;
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walkText(child, nowInside);
          if (negativeFailures.length >= 50) return;
        }
      }
    }
    walkText(stripped, false);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (positiveErrors > 0) {
    errors.push(
      `${positiveErrors} [data-amount] elements fail Cite-state contract:`
    );
    for (const f of positiveFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue}${f.attrs ? ` [${f.attrs}]` : ""}`);
    }
    if (positiveFailures.length > 10) {
      errors.push(`  ... and ${positiveFailures.length - 10} more`);
    }
  } else {
    notes.push(`positive scan: all [data-amount] elements match Cite-state contract ✓`);
  }

  if (negativeErrors > 0) {
    errors.push(
      `${negativeErrors} currency patterns found OUTSIDE [data-amount] (first 10):`
    );
    for (const f of negativeFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: "${f.match}" in "${f.snippet}"`);
    }
    if (negativeFailures.length > 10) {
      errors.push(`  ... and ${negativeFailures.length - 10} more`);
    }
  } else {
    notes.push(`negative scan: no unattributed currency patterns ✓`);
  }

  if (ledgerErrors > 0) {
    errors.push(
      `${ledgerErrors} [data-amount] elements violate the dataset ledger (first 10):`
    );
    for (const f of ledgerFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue}${f.attrs ? ` [${f.attrs}]` : ""}`);
    }
    if (ledgerFailures.length > 10) {
      errors.push(`  ... and ${ledgerFailures.length - 10} more`);
    }
  } else {
    notes.push(`dataset ledger: all [data-amount] elements consistent with uncited_datasets ✓`);
  }

  return { pass: errors.length === 0, errors, notes };
}
