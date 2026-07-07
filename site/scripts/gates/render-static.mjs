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
 *     svg <desc> (a11y-only text) is NOT exempt wholesale: each currency
 *     token in a <desc> must have an identical normalized twin inside a
 *     [data-amount] element within the same component subtree (the svg's
 *     parent node — e.g. the sparkline legend Cites sit adjacent). A desc
 *     may never introduce a dollar value absent from its cited siblings.
 *
 * (c) DATASET LEDGER (Phase 5B-3 — binding evaluator design):
 *     Reads site_meta.json's uncited_datasets ledger. Every [data-amount]
 *     element MUST carry data-dataset; then:
 *       - state C ([data-uncited]) with a dataset NOT on the ledger → FAIL
 *         (flipped datasets may no longer render ⁂)
 *       - state A ([data-fact-id]) with a dataset still ON the ledger → FAIL
 *         (a dataset cannot be both 'citation pending' and cited)
 *       - missing/empty data-dataset on ANY [data-amount] → FAIL
 *
 * (a1) PROSE CITES (Phase 5F §2c): every [data-prose-cite] element (a dollar
 *      token inside quoted source text, rendered as a state-A-style cite)
 *      MUST carry a data-fact-id that resolves in citations.json AND must
 *      NOT carry data-amount (the a0 contract keeps computed figures out of
 *      source-text subtrees — prose cites are the sanctioned alternative).
 *
 * (c2) EXPECTED LEDGER (regression arm): the ledger was cleared to [] when
 *      dim_geography, fct_budget_to_awards, and dim_lobbyists gained citation
 *      tiers. Any dataset appearing on the manifest ledger that is NOT in
 *      EXPECTED_UNCITED_DATASETS → FAIL. This keeps the gate armed: a future
 *      export regression that silently drops a citation tier (re-growing the
 *      ledger) fails the build instead of quietly re-legalizing ⁂ renders.
 *      Growing EXPECTED_UNCITED_DATASETS requires a deliberate, reviewed edit.
 *
 * (inf) INFERRED-LINEAGE HONESTY (program-lineage Task 7): every element
 *      marked [data-inferred="true"] (an inferred lineage edge — a candidate
 *      connection with NO stated-source citation) must carry, in its OWN
 *      subtree text, a "candidate" or "unverified" label. An inferred edge
 *      rendered without the honesty label reads as an asserted fact → FAIL.
 *      This keeps the inferred/stated distinction visible in the static HTML
 *      itself, not just the styling.
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

// (c2) Expected uncited ledger — EMPTY since the ledger-clearance work minted
// citation tiers for dim_geography (derived place-of-performance rows),
// fct_budget_to_awards (derived crosswalk-link rows), and dim_lobbyists
// (lda_filing disclosing-filing rows). A manifest ledger entry outside this
// set is an export REGRESSION (a citation tier silently disappeared) and
// fails the gate. Extend this set only with a deliberate, reviewed edit.
const EXPECTED_UNCITED_DATASETS = new Set([]);

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

  // ── (c2) Expected-ledger regression check ─────────────────────────────────
  const unexpectedLedgerEntries = [...uncitedDatasets].filter(
    (d) => !EXPECTED_UNCITED_DATASETS.has(d)
  );
  if (unexpectedLedgerEntries.length > 0) {
    errors.push(
      `uncited ledger REGRESSION: [${unexpectedLedgerEntries.join(", ")}] on ` +
        `the manifest ledger but not in EXPECTED_UNCITED_DATASETS — a citation ` +
        `tier disappeared from the export (or a new dataset shipped uncited). ` +
        `Fix the export; extending the expected set requires a reviewed edit.`
    );
  } else {
    notes.push(
      `expected ledger: manifest ⊆ expected (${EXPECTED_UNCITED_DATASETS.size} allowed) ✓`
    );
  }

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
  let proseCiteCount = 0;
  let inferredCount = 0;
  let inferredErrors = 0;
  const positiveFailures = [];
  const negativeFailures = [];
  const ledgerFailures = [];
  const titleFailures = [];
  const inferredFailures = [];

  // (inf) An inferred-lineage element is honest iff its own subtree text names
  // the connection as a candidate / unverified — never asserted as fact.
  const INFERRED_HONESTY_RE = /candidate|unverified/i;

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

    // ── (t) title-template doubling: the layout template appends
    //        "| Fiscal Receipts" to every page title, so a page metadata title
    //        that includes the site name itself renders "… | Fiscal Receipts
    //        | Fiscal Receipts". Any title with the site name twice is a bug.
    const titleEl = root.querySelector("title");
    if (titleEl) {
      const titleText = titleEl.text;
      const siteNameCount = titleText.split("Fiscal Receipts").length - 1;
      if (siteNameCount > 1) {
        titleFailures.push({ file: relPath, title: titleText });
      }
    }

    // ── (a0) data-source-text constraint: every data-source-text element must
    //        carry a citation anchor — data-xml-path (block-cited narrative
    //        prose) OR data-cite-fact-id / data-cite-url (claim-cited dossier
    //        text) — AND contain NO [data-amount] descendants (computed
    //        figures may not hide inside source text).
    const sourceTextEls = root.querySelectorAll("[data-source-text]");
    for (const stEl of sourceTextEls) {
      const anchor =
        stEl.getAttribute("data-xml-path") ||
        stEl.getAttribute("data-cite-fact-id") ||
        stEl.getAttribute("data-cite-url");
      if (!anchor || anchor.trim() === "") {
        positiveErrors++;
        positiveFailures.push({
          file: relPath,
          issue: `[data-source-text] element missing citation anchor (data-xml-path, data-cite-fact-id, or data-cite-url required)`,
          attrs: stEl.rawAttrs?.slice(0, 200),
        });
      }
      const amountDescendants = stEl.querySelectorAll("[data-amount]");
      if (amountDescendants.length > 0) {
        positiveErrors++;
        positiveFailures.push({
          file: relPath,
          issue: `[data-source-text] subtree contains ${amountDescendants.length} [data-amount] descendant(s) — computed figures may not be nested inside source text`,
        });
      }
    }

    // ── (a1) Prose cites (Phase 5F §2c): fact_id must resolve; never
    //         double-marked as data-amount. ─────────────────────────────────
    for (const pcEl of root.querySelectorAll("[data-prose-cite]")) {
      proseCiteCount++;
      const factId = pcEl.getAttribute("data-fact-id");
      if (!factId || !citationKeys.has(factId)) {
        positiveErrors++;
        positiveFailures.push({
          file: relPath,
          issue: `[data-prose-cite] fact_id ${factId ? `"${factId}" does not resolve in citations.json` : "missing"}`,
          attrs: pcEl.rawAttrs?.slice(0, 200),
        });
      }
      if (pcEl.getAttribute("data-amount") != null) {
        positiveErrors++;
        positiveFailures.push({
          file: relPath,
          issue: `[data-prose-cite] element also carries data-amount — prose cites must never be amount-marked (a0)`,
        });
      }
    }

    // ── (inf) Inferred-lineage honesty (program-lineage Task 7) ─────────────
    // Every [data-inferred="true"] element must name itself a candidate /
    // unverified connection in its own subtree text. An inferred edge without
    // the label reads as an asserted fact → FAIL.
    for (const infEl of root.querySelectorAll('[data-inferred="true"]')) {
      inferredCount++;
      const text = infEl.text ?? "";
      if (!INFERRED_HONESTY_RE.test(text)) {
        inferredErrors++;
        inferredFailures.push({
          file: relPath,
          issue: `[data-inferred="true"] element without a "candidate"/"unverified" honesty label`,
          snippet: text.trim().slice(0, 100),
        });
      }
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

    // Normalize a currency token for desc↔sibling comparison (whitespace-free)
    const normToken = (s) => s.replace(/\s+/g, "");

    // svg <desc> is never rendered (a11y-only description text, e.g.
    // sparkline point values "FY24: $280.5M"). It may ECHO currency values,
    // but only values that already exist Cite-wrapped beside the SVG: every
    // desc token must have an identical normalized twin in a [data-amount]
    // element within the nearest ancestor containing the <svg> (its parent
    // node — the sparkline legend Cites sit adjacent). Divergent desc
    // values FAIL the negative scan.
    function checkDescCurrency(descNode) {
      const descText = descNode.text || "";
      const matches = descText.match(CURRENCY_RE);
      if (!matches) return;
      // Walk up to the containing <svg>, then take its parent — the nearest
      // ancestor holding both the svg and its adjacent cited legend.
      let svg = descNode.parentNode;
      while (svg && !(svg.tagName && svg.tagName.toLowerCase() === "svg")) {
        svg = svg.parentNode;
      }
      const scope =
        (svg && svg.parentNode) || svg || descNode.parentNode || descNode;
      const citedTokens = new Set();
      for (const amtEl of scope.querySelectorAll("[data-amount]")) {
        const amtMatches = (amtEl.text || "").match(CURRENCY_RE);
        if (amtMatches) {
          for (const t of amtMatches) citedTokens.add(normToken(t));
        }
      }
      for (const m of matches) {
        if (!citedTokens.has(normToken(m))) {
          negativeErrors++;
          negativeFailures.push({
            file: relPath,
            match: m,
            snippet: `svg <desc> "${descText.trim().slice(0, 80)}" — token has no identical [data-amount] twin in the svg's parent subtree`,
          });
          if (negativeFailures.length >= 50) return;
        }
      }
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
      // svg <desc> gets the TIGHTENED check (not a wholesale skip): each of
      // its currency tokens must match a [data-amount] twin in the svg's
      // parent subtree — see checkDescCurrency above. Handled here, so the
      // generic per-text-node scan does not recurse into the desc.
      if (!insideAmount && node.tagName && node.tagName.toLowerCase() === "desc") {
        checkDescCurrency(node);
        return;
      }
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
    notes.push(`prose cites: ${proseCiteCount} [data-prose-cite] element(s), all resolving ✓`);
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

  if (inferredErrors > 0) {
    errors.push(
      `${inferredErrors} [data-inferred] element(s) lack a candidate/unverified honesty label (first 10):`
    );
    for (const f of inferredFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue} — "${f.snippet}"`);
    }
    if (inferredFailures.length > 10) {
      errors.push(`  ... and ${inferredFailures.length - 10} more`);
    }
  } else {
    notes.push(
      `inferred-lineage honesty: ${inferredCount} [data-inferred] element(s), all labelled candidate/unverified ✓`
    );
  }

  if (titleFailures.length > 0) {
    errors.push(
      `${titleFailures.length} pages render the site name twice in <title> ` +
        `(page metadata includes "Fiscal Receipts" while the layout template ` +
        `appends it again — drop the manual suffix; first 10):`
    );
    for (const f of titleFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: "${f.title}"`);
    }
    if (titleFailures.length > 10) {
      errors.push(`  ... and ${titleFailures.length - 10} more`);
    }
  } else {
    notes.push(`title template: no doubled site-name suffixes ✓`);
  }

  return { pass: errors.length === 0, errors, notes };
}
