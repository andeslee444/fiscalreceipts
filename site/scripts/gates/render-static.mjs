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
 *     [data-source-text] subtrees are skipped ONLY for the marker kinds that
 *     earn it (source-text-kinds.mjs — backlog #38). The attribute's mere
 *     presence used to switch this scan off wholesale, so /methodology/ wrapped
 *     its whole container and became unscannable; the marker now grants the
 *     CITATION exemption (a0) to everything it marks and the CURRENCY
 *     exemption only to prose genuinely quoted from a source document.
 *     [data-prose-cite] subtrees ALSO satisfy this leg (backlog #44). That is
 *     not a second escape hatch: the anchor this leg is really asking for is a
 *     citation affordance, and a prose cite is the STRICTER of the two — (a1)
 *     below requires its data-fact-id to resolve in citations.json, which
 *     [data-amount] does not (a Cite may legitimately render state B or C with
 *     no fact at all). It exists because (a0) forbids [data-amount] inside a
 *     [data-source-text] subtree, so a headline dollar token has exactly one
 *     legal way to be anchored, and this is it.
 *     Allowlist (prose-allowlist.json) consulted for known prose mentions —
 *     PAGE-SCOPED via its `pages` field, with dead patterns and stale
 *     (matched-nothing) entries failing the gate.
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
 * (a2) FEED HEADLINE RECEIPTS (ROADMAP backlog #44): feed.json's
 *      headline_segments must re-join to each card's flat `headline` exactly;
 *      every currency token in a flat headline must be covered by an amount
 *      segment (the non-vacuity arm — a segmentation that degraded to one
 *      text run fails here, not silently); every amount segment's fact id
 *      must resolve; and /feed/ must render exactly as many headline
 *      [data-prose-cite] elements as the sidecar declares amount segments.
 *      Binds render to exporter in both directions, so neither can drop the
 *      affordance while the other still claims it.
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
 *
 * (st) STATED-LINEAGE POSITIVE LEG (Fix F, 2026-07-28): every element marked
 *      [data-lineage-stated] (a stated lineage rail card) must CONTAIN a
 *      [data-lineage-cite][data-fact-id] marker with a non-empty fact id —
 *      a stated edge rendered bare (no clickable citation) → FAIL.
 *      Non-vacuity (both lineage legs): the emitted program_details sidecars
 *      are the count expectation. If the sidecars carry stated rail entries
 *      but ZERO [data-lineage-stated] elements render site-wide, the leg is
 *      vacuous → FAIL. If the sidecars carry inferred rail entries but ZERO
 *      [data-inferred] elements render site-wide, WARN LOUDLY (still pass —
 *      the (inf) leg is per-element and cannot see what never rendered).
 *
 * (ch) CHART CONTRACT (PM Sprint 3 §P2-3) — the static half of the svg-desc
 *      rule, which until now only policed currency tokens INSIDE a <desc>.
 *      It now also polices whether a <desc> is there at all, and what sits
 *      beside it:
 *        - every svg[role="img"] that is not inside an [aria-hidden="true"]
 *          subtree is a CHART. It must carry a non-empty accessible name
 *          (aria-label / aria-labelledby) AND a non-empty <desc>, and it
 *          must live inside a [data-chart] figure;
 *        - every [data-chart] must carry a [data-chart-desc] of ≥ 60
 *          characters that is NOT a restatement of the accessible name or of
 *          the figure's own heading (normalised equality / containment), and
 *          a table[data-chart-table] with a non-empty <caption> and at least
 *          one [data-amount] inside it — the chart's numbers reachable as
 *          text, carrying the same citation affordance as the rest of the
 *          site.
 *      Non-vacuity: zero charts site-wide FAILS (the program pages render
 *      two or three each; a template that stops rendering them must not pass
 *      as "no violations").
 *
 * (nk) NOTE REGISTERS + H1 ORDER (PM Sprint 3 §P2-6). The site used ONE
 *      amber treatment for honest scope disclosure and for caution about a
 *      specific number, which trains readers to ignore both:
 *        - every [data-note-kind] is "scope" or "caution"; every caution note
 *          carries role="note" so the register is in the semantics, not only
 *          in the palette (the colour half is asserted live, gate 6);
 *        - NO [data-note-kind] and no [data-coverage] block may precede the
 *          page's <h1> in document order — /district/CO-05/ opened with a
 *          warning before the reader knew what page they were on;
 *        - a page carrying a note must have an <h1> at all.
 *      Non-vacuity: ≥1 scope AND ≥1 caution note must render site-wide.
 *
 * (tc) COMPANY DISPLAY NAMES + PROVENANCE (PM Sprint 3 §P2-4). Registry
 *      strings are cased for display, so the gate re-runs the rule and
 *      compares:
 *        - every [data-company-name] carries the raw registry string as its
 *          own value, non-empty;
 *        - its rendered text equals displayCompanyName(that value).display —
 *          computed HERE from the attribute, so a page that hand-cased a
 *          name, or a rule that quietly changed, both fail;
 *        - the raw string is never DISCARDED: on a /company/ page (whose
 *          subject IS one registry name) the visible [data-registry-note]
 *          must carry it verbatim whenever the display differs.
 *      Non-vacuity: zero [data-company-name] elements site-wide FAILS.
 *
 * (dv) DERIVATION STRIPS REPRODUCE (§P2-8). "The PB2024 book requested $5.28B
 *      … $5.57B … — $286.5M above the request" is right and does not add up:
 *      the inputs are rounded and the result is not, so the reader who checks
 *      the site's arithmetic against the site's own numbers finds a
 *      discrepancy. Every [data-derivation] element must therefore contain
 *      either a [data-derivation-exact] equation or a [data-derivation-
 *      rounding] statement; and every [data-derivation-exact] equation is
 *      PARSED and RE-COMPUTED here — `a ± b ± … = c` must hold exactly at the
 *      precision printed. A strip that does not add up is worse than no
 *      strip, so an unbalanced equation fails rather than warns.
 *      Non-vacuity: zero [data-derivation-exact] equations site-wide FAILS.
 *
 * (sp) JSX SPACE-EATEN TEXT (§B3 sweep). `{SITE_NAME}` on one line and prose
 *      on the next renders "Fiscal Receiptsshows": JSX drops a whitespace-only
 *      text child that contains a newline, so the space the author typed does
 *      not exist. The defect is invisible in source review AND unfindable in
 *      the built HTML (the glued words are ordinary letters), so this leg
 *      reads the SOURCE — scripts/gates/jsx-glue.mjs parses every src/**\/*.tsx
 *      with the TypeScript compiler, applies React's own JSXText cleaner, and
 *      reports every expression/text pair the renderer glues where the author
 *      wrote a line break. Affixes ({n !== 1 ? "s" : ""}), explicit {" "},
 *      punctuation edges and FY-style prefixes are not glue.
 *      Non-vacuity: zero .tsx files scanned FAILS.
 *
 * (t) REQUEST/ENACTED VOCABULARY (backlog #47). FY2026 is a REQUEST in every
 *      edition this site ships — the source workbook has no FY2026 enacted
 *      column, and /methodology/, /years/ (column header FY26R) and every
 *      program page say so. This is a claim-level check, not a
 *      number↔citation one: the figure beside the wrong word is correctly
 *      cited, which is exactly why leg (a)/(b) cannot see the defect.
 *      Runs on each page's script/style-stripped HTML (the same string leg
 *      (b)'s currency sweep already built for the page).
 *
 *      A first draft matched "FY2026" and "enacted" anywhere within ~60
 *      characters of each other, on the theory that the two terms in the same
 *      clause is already the tell. Proof-can-fail against the real build
 *      falsified that theory before it shipped: it hit 1,581 pages / 3,172
 *      instances, ~3,158 of them the decade-trajectory chart legend ("a line
 *      through the actuals … with the enacted … and request … markers"),
 *      which names three marker types and asserts nothing about FY2026
 *      specifically. Worse, it also fired on the CORRECT comparison sentence
 *      this very fix installs ("FY2025 enacted and the FY2026 request") and
 *      on the dossier narrative's own correct pattern ("requested for
 *      FY2026, down from $X thousand enacted in FY2025") — a proximity
 *      window cannot tell "enacted describes FY2026" from "enacted describes
 *      a different, correctly-named year sitting in the same sentence."
 *
 *      The leg instead requires "FY2026" and "enacted" to be DIRECTLY
 *      adjacent — separated only by whitespace or a short run of punctuation
 *      (colon, parens, hyphen, a trailing possessive's) — in either order.
 *      That is precisely the shape of a mislabel ("FY2026 enacted",
 *      "FY2026/enacted"), and precisely NOT the shape of a legitimate
 *      multi-year comparison, which always has other words (year names,
 *      "down from", "and the", "not") between the two terms. Verified
 *      against every one of the 14 distinct phrasings this leg's first draft
 *      surfaced site-wide: adjacency catches exactly the 2 real mislabels
 *      (this page, and methodology's "FY2025 and FY2026 enacted/requested")
 *      and none of the other 12.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";
import { displayCompanyName } from "../../src/lib/company-name.mjs";
import { findGlueSites } from "./jsx-glue.mjs";
import {
  isKnownSourceTextKind,
  exemptFromCurrencyScan,
} from "./source-text-kinds.mjs";
import { makeProseAllowlist, pagePathFromRelPath } from "./prose-allowlist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");
const allowlistPath = path.resolve(__dirname, "prose-allowlist.json");

// Currency pattern: $X,XXX(.XX)? optionally followed by B/M/K
// Must be in a text node (not a URL/href)
const CURRENCY_RE = /\$[\d,]+(\.\d+)?\s*[BMK]?/g;

/**
 * LEG (t) — request/enacted vocabulary (#47).
 *
 * FY2026 is a REQUEST in every edition this site ships; the source workbook
 * has no FY2026 enacted column. This is a claim-level check: the figures
 * beside these words are correctly cited, which is exactly why no other leg
 * can see it.
 *
 * DIRECT ADJACENCY ONLY (see the file-header leg (t) note for the
 * proof-can-fail history): "FY2026" and "enacted" must sit next to each
 * other — only whitespace, or a short run of punctuation, between them, in
 * either order. A wider proximity window matched thousands of correct
 * sentences that merely mention both terms (a chart legend naming three
 * marker types; "requested for FY2026, down from $X enacted in FY2025") and
 * even matched this leg's own prescribed fix text. Tight adjacency is what a
 * mislabel actually looks like ("FY2026 enacted", "FY2026/enacted") and a
 * multi-year comparison never does.
 */
const ENACTED_FY26_RE =
  /\bFY\s*2026\b['’]?s?[\s:()-]{1,4}enacted\b|\benacted\b[\s:()-]{1,4}\bFY\s*2026\b/i;

function checkRequestEnactedVocabulary(pageText, relPath) {
  const hit = pageText.match(ENACTED_FY26_RE);
  if (!hit) return null;
  return `${relPath}: prose couples FY2026 with "enacted" — FY2026 is a request in every shipped edition: ${JSON.stringify(hit[0].slice(0, 120))}`;
}

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

/**
 * (dv) Parse and re-compute a printed derivation equation.
 *
 * Accepts `a ± b ± … = c` where every operand is a grouped decimal. The
 * comparison is EXACT at the printed precision: operands are scaled to
 * integers by the widest decimal count present, so no float slop can hide a
 * strip that does not add up. Minus signs may be ASCII "-", U+2212 or the
 * HTML-entity minus the pages render.
 *
 * Returns {ok:true} when it closes, {ok:false, why} when it does not, and
 * {ok:null} when the text is not an equation at all (a caller that marked a
 * non-equation as exact is caught by the missing-equation branch instead).
 */
export function checkEquation(rawText) {
  const text = (rawText ?? "")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const eq = text.split("=");
  if (eq.length !== 2) return { ok: null };
  const lhs = eq[0].trim();
  const rhsMatch = /^-?[\d,]+(?:\.\d+)?/.exec(eq[1].trim());
  if (!rhsMatch) return { ok: null };

  const terms = [];
  const termRe = /([+-]?)\s*(-?[\d,]+(?:\.\d+)?)/g;
  let m;
  let first = true;
  while ((m = termRe.exec(lhs))) {
    const sign = m[1] === "-" ? -1 : 1;
    if (!first && m[1] === "") return { ok: null }; // two numbers, no operator
    terms.push({ sign, raw: m[2] });
    first = false;
  }
  if (terms.length < 2) return { ok: null };

  const all = [...terms.map((t) => t.raw), rhsMatch[0]];
  const decimals = Math.max(
    ...all.map((r) => (r.split(".")[1] ?? "").length),
  );
  const scale = 10 ** decimals;
  const toInt = (r) => Math.round(Number(r.replace(/,/g, "")) * scale);
  const sum = terms.reduce((acc, t) => acc + t.sign * toInt(t.raw), 0);
  const rhs = toInt(rhsMatch[0]);
  if (sum !== rhs) {
    return {
      ok: false,
      why: `left side sums to ${(sum / scale).toFixed(decimals)}, right side reads ${(rhs / scale).toFixed(decimals)}`,
    };
  }
  return { ok: true };
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
  // Page-SCOPED since backlog #38: the `pages` field shipped in the JSON from
  // the start and the gate ignored it, matching every pattern site-wide. It is
  // honoured now, and the file's own hygiene (dead patterns, stale entries) is
  // gate-enforced — see prose-allowlist.mjs.
  let allowlist = [];
  try {
    allowlist = readJson(allowlistPath);
  } catch {
    // allowlist is optional
  }
  const proseAllowlist = makeProseAllowlist(allowlist);
  for (const e of proseAllowlist.shapeErrors) errors.push(e);

  // ── Collect all HTML files ────────────────────────────────────────────────
  const htmlFiles = [...walkHtmlFiles(outDir)];
  notes.push(`scanning ${htmlFiles.length} HTML files`);

  let positiveErrors = 0;
  let negativeErrors = 0;
  let ledgerErrors = 0;
  let proseCiteCount = 0;
  let inferredCount = 0;
  let inferredErrors = 0;
  let statedCount = 0;
  let statedErrors = 0;
  const positiveFailures = [];
  const negativeFailures = [];
  const ledgerFailures = [];
  const titleFailures = [];
  const inferredFailures = [];
  const statedFailures = [];
  const requestEnactedFailures = [];

  // ── (st)/(inf) non-vacuity expectation from the emitted sidecars ─────────
  // Count stated / inferred rail entries across data/site/json/program_details
  // — the payloads the program pages render from. These are the DOM-count
  // expectations: sidecar entries exist but zero corresponding elements
  // site-wide means the leg is scanning nothing.
  let sidecarStatedEntries = 0;
  let sidecarInferredEntries = 0;
  try {
    const detDir = path.join(jsonDir, "program_details");
    for (const name of fs.readdirSync(detDir)) {
      if (!name.endsWith(".json")) continue;
      let doc;
      try {
        doc = readJson(path.join(detDir, name));
      } catch {
        continue; // unreadable sidecars are verify-lineage leg (d)'s problem
      }
      const rail = doc?.lineage?.rail;
      if (!rail) continue;
      for (const e of [...(rail.predecessors ?? []), ...(rail.successors ?? [])]) {
        if (e?.confidence === "stated") sidecarStatedEntries++;
        else if (e?.confidence === "inferred") sidecarInferredEntries++;
      }
    }
  } catch {
    // program_details dir missing — verify-lineage leg (d) fails that case;
    // here the expectation simply stays 0 (no vacuity claim can be made).
  }

  // (inf) An inferred-lineage element is honest iff its own subtree text names
  // the connection as a candidate / unverified — never asserted as fact.
  const INFERRED_HONESTY_RE = /candidate|unverified/i;

  // ── (ch)/(nk) counters ───────────────────────────────────────────────────
  let chartCount = 0;
  let chartSvgCount = 0;
  const chartFailures = [];
  let scopeNoteCount = 0;
  let cautionNoteCount = 0;
  const noteFailures = [];

  // ── (tc)/(dv) counters ───────────────────────────────────────────────────
  let companyNameCount = 0;
  const companyNameFailures = [];
  let derivationCount = 0;
  let derivationExactCount = 0;
  const derivationFailures = [];

  /** Minimum useful length of a chart description, in characters. */
  const CHART_DESC_MIN = 60;
  const NOTE_KINDS = new Set(["scope", "caution"]);
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

  /** Nearest ancestor matching a predicate (node-html-parser has no closest). */
  function ancestor(el, pred) {
    for (let n = el.parentNode; n; n = n.parentNode) {
      if (n.getAttribute && pred(n)) return n;
    }
    return null;
  }

  for (const filePath of htmlFiles) {
    const relPath = path.relative(outDir, filePath);
    const pagePath = pagePathFromRelPath(relPath);
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

    // ── title-template doubling: the layout template appends
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
      // (a0k) backlog #38 — the marker's VALUE must be classified in
      // source-text-kinds.mjs, which is where the two FORMATTING exemptions
      // (currency scan, notation sweep) are granted per kind. An unclassified
      // value used to buy silence from both sweeps just by existing; now it
      // buys nothing and fails here, so adding one is a reviewed edit that has
      // to say whose prose it is.
      const kind = stEl.getAttribute("data-source-text");
      if (!isKnownSourceTextKind(kind)) {
        positiveErrors++;
        positiveFailures.push({
          file: relPath,
          issue:
            `[data-source-text=${JSON.stringify(kind)}] is not a classified ` +
            `source-text kind — add it to scripts/gates/source-text-kinds.mjs ` +
            `with the exemptions it earns and why, or stop marking this prose`,
        });
      }
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

    // ── (st) Stated-lineage positive leg (Fix F, 2026-07-28) ────────────────
    // Every stated rail card must contain its clickable sentence-citation
    // marker: [data-lineage-cite] with a non-empty data-fact-id. A stated
    // edge rendered bare asserts a transfer with no reachable source → FAIL.
    for (const stEl of root.querySelectorAll("[data-lineage-stated]")) {
      statedCount++;
      const cite = stEl.querySelector("[data-lineage-cite]");
      const factId = cite ? cite.getAttribute("data-fact-id") : null;
      if (!cite || !factId || factId.trim() === "") {
        statedErrors++;
        statedFailures.push({
          file: relPath,
          issue: cite
            ? `[data-lineage-stated] card's [data-lineage-cite] marker has an empty data-fact-id`
            : `[data-lineage-stated] card renders BARE — no [data-lineage-cite][data-fact-id] marker inside`,
          snippet: (stEl.text ?? "").trim().slice(0, 100),
        });
      }
    }

    // ── (ch) Chart contract (§P2-3) ─────────────────────────────────────────
    // A CHART is an svg[role="img"] that is not decorative. Decorative art
    // (the category heroes) sits inside an [aria-hidden="true"] wrapper and
    // is exempt; icons carry aria-hidden on the <svg> itself and never
    // role="img", so they never enter this scan.
    for (const svg of root.querySelectorAll('svg[role="img"]')) {
      if (
        svg.getAttribute("aria-hidden") === "true" ||
        ancestor(svg, (n) => n.getAttribute("aria-hidden") === "true")
      ) {
        continue;
      }
      chartSvgCount++;
      const name =
        svg.getAttribute("aria-label") ??
        (svg.getAttribute("aria-labelledby")
          ? (root.querySelector(`#${svg.getAttribute("aria-labelledby")}`)?.text ?? "")
          : "");
      if (norm(name) === "") {
        chartFailures.push({
          file: relPath,
          issue: `chart <svg role="img"> has no accessible name (aria-label / aria-labelledby)`,
          attrs: svg.rawAttrs?.slice(0, 160),
        });
      }
      const descEl = svg.querySelector("desc");
      if (!descEl || norm(descEl.text) === "") {
        chartFailures.push({
          file: relPath,
          issue: `chart <svg role="img"> ("${norm(name).slice(0, 50)}") carries no non-empty <desc>`,
        });
      }
      const fig = ancestor(svg, (n) => n.getAttribute("data-chart") != null);
      if (!fig) {
        chartFailures.push({
          file: relPath,
          issue: `chart <svg role="img"> ("${norm(name).slice(0, 50)}") is not inside a [data-chart] figure — no description, no table view`,
        });
      }
    }

    for (const fig of root.querySelectorAll("[data-chart]")) {
      chartCount++;
      const chartId = fig.getAttribute("data-chart") || "(unnamed)";
      const svg = fig.querySelector('svg[role="img"]');
      const name = svg ? (svg.getAttribute("aria-label") ?? "") : "";
      const descEl = fig.querySelector("[data-chart-desc]");
      const descText = norm(descEl?.text);
      if (!descEl || descText === "") {
        chartFailures.push({
          file: relPath,
          issue: `[data-chart="${chartId}"] has no [data-chart-desc] — a chart needs a short description of what it shows and what to take from it`,
        });
      } else {
        if (descText.length < CHART_DESC_MIN) {
          chartFailures.push({
            file: relPath,
            issue: `[data-chart="${chartId}"] description is ${descText.length} chars (<${CHART_DESC_MIN}) — "${descText.slice(0, 60)}"`,
          });
        }
        const nameNorm = norm(name);
        if (nameNorm !== "" && (descText === nameNorm || descText.startsWith(nameNorm))) {
          chartFailures.push({
            file: relPath,
            issue: `[data-chart="${chartId}"] description restates the accessible name instead of saying what the chart shows — "${descText.slice(0, 70)}"`,
          });
        }
      }
      const table = fig.querySelector("table[data-chart-table]");
      if (!table) {
        chartFailures.push({
          file: relPath,
          issue: `[data-chart="${chartId}"] has no table[data-chart-table] — the chart's data is not reachable as text`,
        });
        continue;
      }
      const caption = table.querySelector("caption");
      if (!caption || norm(caption.text) === "") {
        chartFailures.push({
          file: relPath,
          issue: `[data-chart="${chartId}"] table view has no non-empty <caption>`,
        });
      }
      if (table.querySelectorAll("[data-amount]").length === 0) {
        chartFailures.push({
          file: relPath,
          issue: `[data-chart="${chartId}"] table view carries no [data-amount] figure — the table view must carry the same citation affordance as the rest of the site`,
        });
      }
    }

    // ── (nk) Note registers + <h1> order (§P2-6) ────────────────────────────
    for (const noteEl of root.querySelectorAll("[data-note-kind]")) {
      const kind = noteEl.getAttribute("data-note-kind");
      if (!NOTE_KINDS.has(kind)) {
        noteFailures.push({
          file: relPath,
          issue: `data-note-kind="${kind}" is not one of scope|caution`,
        });
        continue;
      }
      if (kind === "scope") scopeNoteCount++;
      else cautionNoteCount++;
      if (kind === "caution" && noteEl.getAttribute("role") !== "note") {
        noteFailures.push({
          file: relPath,
          issue: `caution note has no role="note" — the register must be in the semantics, not only the palette`,
        });
      }
    }

    // Document order via the serialized body: the first <h1> must come before
    // the first note/coverage block. String indices are exactly DOM order in
    // a serialized document, and cost nothing over 5k files.
    // A BANNER is anything that reads as a caveat block: our own note and
    // coverage markers, an alert region, or a raw amber panel (the treatment
    // §P2-6 is retiring — matched by class token so nobody can reintroduce
    // one above the heading by hand-rolling the palette).
    {
      const bodyAt = html.indexOf("<body");
      const body = bodyAt >= 0 ? html.slice(bodyAt) : html;
      const h1At = body.search(/<h1[\s>]/);
      const BANNER_MARKERS = [
        ["note", "data-note-kind="],
        ["coverage", "data-coverage="],
        ["alert", 'role="alert"'],
        ["raw amber panel", "bg-amber-"],
        ["raw amber panel", "border-amber-"],
      ];
      let firstBanner = -1;
      let firstKind = null;
      for (const [kind, marker] of BANNER_MARKERS) {
        const at = body.indexOf(marker);
        if (at < 0) continue;
        if (firstBanner < 0 || at < firstBanner) {
          firstBanner = at;
          firstKind = kind;
        }
      }
      if (firstBanner >= 0) {
        if (h1At < 0) {
          noteFailures.push({
            file: relPath,
            issue: `page renders a ${firstKind} block but has no <h1> at all`,
          });
        } else if (firstBanner < h1At) {
          noteFailures.push({
            file: relPath,
            issue: `a ${firstKind} block precedes the page's <h1> — the page opens with a caveat before the reader knows what page they are on`,
          });
        }
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
    //   - data-source-text WHOSE KIND EARNS IT (backlog #38): the marker's
    //     mere presence used to switch this scan off for a whole subtree, so
    //     /methodology/ — the site's own prose, quoted from nothing — wrapped
    //     its entire container and went unscanned. Now only the kinds declared
    //     quotedFigures in source-text-kinds.mjs are skipped: prose whose
    //     dollar strings really are the source document's and therefore
    //     CANNOT be <Cite>-wrapped. Site-authored prose is scanned like any
    //     other page, and its handful of non-figure dollar tokens are
    //     enumerated per page in prose-allowlist.json.
    //   - data-prose-cite (backlog #44): the sanctioned anchor for a dollar
    //     token that cannot be [data-amount] because it sits inside a
    //     [data-source-text] subtree, where (a0) forbids nested amounts. This
    //     is a STRICTER anchor than data-amount, not a looser one — (a1)
    //     requires every prose cite's fact id to resolve in citations.json,
    //     and a bare data-amount need carry no fact at all. Feed headlines
    //     are the reason it is here: their ~40 dollar tokens were exempt
    //     wholesale until #44 and are individually cited now.
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
              // Check the page-scoped prose allowlist
              const allowed = proseAllowlist.isAllowed(pagePath, m);
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
      const isSourceText =
        node.getAttribute &&
        exemptFromCurrencyScan(node.getAttribute("data-source-text"));
      // (a1) proves this element's fact id resolves — see the leg (b) note.
      const isProseCite =
        node.getAttribute && node.getAttribute("data-prose-cite") != null;
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
      const nowInside =
        insideAmount || isAmount || isSourceText || isProseCite ||
        isProgramName || isHead;
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walkText(child, nowInside);
          if (negativeFailures.length >= 50) return;
        }
      }
    }
    walkText(stripped, false);

    // ── (t) request/enacted vocabulary (#47) ────────────────────────────────
    // Runs against strippedHtml — the same script/style-stripped per-page
    // string leg (b) just built above — reused rather than re-parsed. See
    // ENACTED_FY26_RE's own comment for why this checks direct adjacency
    // rather than same-clause proximity.
    {
      const enactedHit = checkRequestEnactedVocabulary(strippedHtml, relPath);
      if (enactedHit) requestEnactedFailures.push(enactedHit);
    }

    // ── (tc) company display names carry their registry string ─────────────
    for (const el of root.querySelectorAll("[data-company-name]")) {
      companyNameCount += 1;
      const registry = el.getAttribute("data-company-name");
      if (!registry) {
        companyNameFailures.push({
          file: relPath,
          issue: `[data-company-name] "${el.text.trim().slice(0, 40)}" carries no registry string — the display casing replaced the provenance instead of standing beside it`,
        });
        continue;
      }
      const want = displayCompanyName(registry).display;
      const got = el.text.replace(/\s+/g, " ").trim();
      if (got !== want) {
        companyNameFailures.push({
          file: relPath,
          issue: `renders ${JSON.stringify(got)} for registry ${JSON.stringify(registry)}; the rule says ${JSON.stringify(want)}`,
        });
      }
    }
    // The /company/ page's subject IS a registry name, so it must show the
    // raw string visibly rather than only on hover.
    if (/^company\/[^/]+\/index\.html$/.test(relPath)) {
      const h1 = root.querySelector("h1 [data-company-name]");
      if (h1) {
        const registry = h1.getAttribute("data-company-name") ?? "";
        const shown = displayCompanyName(registry).display !== registry;
        const note = root.querySelector("[data-registry-note]");
        if (shown && (!note || !note.text.includes(registry))) {
          companyNameFailures.push({
            file: relPath,
            issue: `h1 displays a cased name but no visible [data-registry-note] carries ${JSON.stringify(registry)}`,
          });
        }
      }
    }

    // ── (dv) derivation strips reproduce ───────────────────────────────────
    for (const el of root.querySelectorAll("[data-derivation]")) {
      derivationCount += 1;
      const hasExact = el.querySelector("[data-derivation-exact]");
      const hasRounding = el.querySelector("[data-derivation-rounding]");
      if (!hasExact && !hasRounding) {
        derivationFailures.push({
          file: relPath,
          issue: `[data-derivation="${el.getAttribute("data-derivation")}"] shows a derived figure beside its inputs with neither a [data-derivation-exact] equation nor a [data-derivation-rounding] statement`,
        });
      }
    }
    for (const el of root.querySelectorAll("[data-derivation-exact]")) {
      derivationExactCount += 1;
      const check = checkEquation(el.text);
      if (check.ok === false) {
        derivationFailures.push({
          file: relPath,
          issue: `equation does not close: ${check.why} — "${el.text.replace(/\s+/g, " ").trim().slice(0, 90)}"`,
        });
      }
    }
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

  // ── (a2) FEED HEADLINE FIGURES CARRY THEIR RECEIPT (backlog #44) ─────────
  //
  // Leg (b) now sweeps [data-source-text="headline"] and would fail an
  // unanchored dollar token there — but it would pass a feed that simply
  // stopped printing money, which is the shape this defect had for months.
  // This leg binds the RENDER to the EXPORTER, in both directions:
  //
  //   a2-i   every card's segments re-join to its flat `headline` exactly
  //          (the flat string still ships in RSS/Atom/JSON and to search; a
  //          headline that says two different things is worse than the gap);
  //   a2-ii  every currency token in a flat headline is covered by an amount
  //          segment — the NON-VACUITY arm. A segmentation that silently
  //          degraded to one text run fails here even though leg (b) would
  //          also catch it, and it fails with the reason;
  //   a2-iii every amount segment's fact id resolves in citations.json;
  //   a2-iv  /feed/ renders exactly as many headline prose cites as the
  //          sidecar declares amount segments (it renders every card once),
  //          so a page that drops the affordance fails even while the data
  //          still carries it.
  let feedSidecar = null;
  try {
    feedSidecar = readJson(path.join(jsonDir, "feed.json"));
  } catch (e) {
    errors.push(`(a2) feed.json unreadable — cannot verify headline receipts: ${e.message}`);
  }
  if (feedSidecar) {
    const cards = feedSidecar.cards ?? [];
    let declaredAmountSegs = 0;
    let flatHeadlineTokens = 0;
    const a2Failures = [];
    for (const card of cards) {
      const headline = card.headline ?? "";
      flatHeadlineTokens += (headline.match(CURRENCY_RE) ?? []).length;
      const segs = card.headline_segments;
      if (!Array.isArray(segs) || segs.length === 0) {
        a2Failures.push(
          `card ${card.event_type}/${card.pe_bli ?? card.family_key} has no ` +
            `headline_segments — its dollar tokens cannot carry anchors ` +
            `(export predates backlog #44, or stopped emitting them)`
        );
        continue;
      }
      const joined = segs.map((s) => s.text ?? s.amount ?? "").join("");
      if (joined !== headline) {
        a2Failures.push(
          `card ${card.event_type}/${card.pe_bli ?? card.family_key}: ` +
            `segments re-join to ${JSON.stringify(joined)} but headline is ` +
            `${JSON.stringify(headline)}`
        );
      }
      for (const s of segs) {
        if (s.amount === undefined) continue;
        declaredAmountSegs += 1;
        if (!s.fact_id || !citationKeys.has(s.fact_id)) {
          a2Failures.push(
            `card ${card.event_type}/${card.pe_bli ?? card.family_key}: ` +
              `headline amount ${JSON.stringify(s.amount)} cites ` +
              `${s.fact_id ? `"${s.fact_id}", which does not resolve` : "nothing"}`
          );
        }
      }
    }
    if (flatHeadlineTokens !== declaredAmountSegs) {
      a2Failures.push(
        `${flatHeadlineTokens} currency token(s) in flat headlines but ` +
          `${declaredAmountSegs} amount segment(s) — every dollar figure a ` +
          `headline prints must be a segment carrying its fact id`
      );
    }
    const feedHtmlPath = path.join(outDir, "feed", "index.html");
    if (!fs.existsSync(feedHtmlPath)) {
      a2Failures.push(`built /feed/ missing at ${feedHtmlPath}`);
    } else {
      const feedRoot = parse(fs.readFileSync(feedHtmlPath, "utf8"));
      let rendered = 0;
      for (const h of feedRoot.querySelectorAll('[data-source-text="headline"]')) {
        rendered += h.querySelectorAll("[data-prose-cite]").length;
      }
      if (rendered !== declaredAmountSegs) {
        a2Failures.push(
          `/feed/ renders ${rendered} headline prose cite(s) but the sidecar ` +
            `declares ${declaredAmountSegs} amount segment(s) — every ` +
            `headline figure must reach the reader with its receipt`
        );
      }
    }
    if (a2Failures.length > 0) {
      errors.push(
        `(a2) ${a2Failures.length} feed-headline receipt failure(s) (first 10):`
      );
      for (const f of a2Failures.slice(0, 10)) errors.push(`  ${f}`);
    } else {
      notes.push(
        `feed headlines: ${declaredAmountSegs} dollar token(s) across ` +
          `${cards.length} card(s), each a cited segment and each rendered ` +
          `as a prose cite on /feed/ ✓`
      );
    }
  }

  // (b2) Stale prose-allowlist entries (backlog #38). An exemption that
  // matched nothing in the whole build is still switched on, and that is how
  // an escape hatch grows unnoticed. It is also this leg's NON-VACUITY proof
  // for /methodology/: the entries scoped only to that page can be used only
  // if the negative scan actually reaches it.
  const staleAllowlist = proseAllowlist.unusedErrors();
  if (staleAllowlist.length > 0) {
    for (const e of staleAllowlist) errors.push(e);
  } else {
    notes.push(
      `prose allowlist: ${allowlist.length} page-scoped entr(ies), all in use ✓`
    );
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
  } else if (inferredCount === 0 && sidecarInferredEntries > 0) {
    // Zero-count honesty (Fix F, 2026-07-28): the per-element check above is
    // vacuous when nothing rendered. The sidecars expect inferred cards —
    // WARN LOUDLY (still pass; the per-element leg has nothing to fail on).
    notes.push(
      `WARNING — inferred-lineage leg is VACUOUS: 0 [data-inferred] elements ` +
        `site-wide, but the program_details sidecars carry ` +
        `${sidecarInferredEntries} inferred rail entr${sidecarInferredEntries === 1 ? "y" : "ies"}. ` +
        `Verify non-vacuity: the inferred disclosure may have stopped rendering.`
    );
  } else {
    notes.push(
      `inferred-lineage honesty: ${inferredCount} [data-inferred] element(s) ` +
        `(sidecars expect ${sidecarInferredEntries} entries), all labelled candidate/unverified ✓`
    );
  }

  // ── (st) stated-lineage summary ──────────────────────────────────────────
  if (statedErrors > 0) {
    errors.push(
      `${statedErrors} [data-lineage-stated] card(s) render without a [data-lineage-cite][data-fact-id] marker (first 10):`
    );
    for (const f of statedFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue} — "${f.snippet}"`);
    }
    if (statedFailures.length > 10) {
      errors.push(`  ... and ${statedFailures.length - 10} more`);
    }
  } else if (statedCount === 0 && sidecarStatedEntries > 0) {
    // The positive leg found nothing to check while the sidecars carry stated
    // entries — the leg is vacuous, which for STATED cards is a hard FAIL:
    // a cited-edge rail that silently stopped rendering must not pass.
    errors.push(
      `stated-lineage leg is VACUOUS: 0 [data-lineage-stated] elements site-wide, ` +
        `but the program_details sidecars carry ${sidecarStatedEntries} stated rail ` +
        `entries — the stated rail (or its gate marker) stopped rendering.`
    );
  } else {
    notes.push(
      `stated-lineage cites: ${statedCount} [data-lineage-stated] card(s) ` +
        `(sidecars expect ${sidecarStatedEntries} entries), every one carries its cite marker ✓`
    );
  }

  // ── (ch) chart-contract summary ──────────────────────────────────────────
  if (chartFailures.length > 0) {
    errors.push(
      `${chartFailures.length} chart-contract violation(s) — §P2-3 accessible name + description + table view (first 10):`
    );
    for (const f of chartFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue}${f.attrs ? ` [${f.attrs}]` : ""}`);
    }
    if (chartFailures.length > 10) {
      errors.push(`  ... and ${chartFailures.length - 10} more`);
    }
  } else if (chartSvgCount === 0 || chartCount === 0) {
    errors.push(
      `chart contract leg is VACUOUS: ${chartSvgCount} non-decorative svg[role="img"] and ` +
        `${chartCount} [data-chart] figure(s) site-wide — the program pages render two or ` +
        `three charts each, so zero means the charts (or their markers) stopped rendering.`
    );
  } else {
    notes.push(
      `chart contract: ${chartCount} [data-chart] figure(s) over ${chartSvgCount} ` +
        `non-decorative chart svg(s) — every one named, described, and readable as a cited table ✓`
    );
  }

  // ── (nk) note-register summary ───────────────────────────────────────────
  if (noteFailures.length > 0) {
    errors.push(
      `${noteFailures.length} note-register / <h1>-order violation(s) — §P2-6 (first 10):`
    );
    for (const f of noteFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue}`);
    }
    if (noteFailures.length > 10) {
      errors.push(`  ... and ${noteFailures.length - 10} more`);
    }
  } else if (scopeNoteCount === 0 || cautionNoteCount === 0) {
    errors.push(
      `note-register leg is VACUOUS: ${scopeNoteCount} scope and ${cautionNoteCount} caution ` +
        `note(s) site-wide — both registers must exist for the distinction to mean anything.`
    );
  } else {
    notes.push(
      `note registers: ${scopeNoteCount} scope + ${cautionNoteCount} caution note(s), ` +
        `every caution semantically marked, every page's <h1> before its first note ✓`
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

  // ── (t) request/enacted vocabulary summary (#47) ─────────────────────────
  if (requestEnactedFailures.length > 0) {
    errors.push(
      `${requestEnactedFailures.length} page(s) couple FY2026 with "enacted" ` +
        `— FY2026 is a request in every shipped edition (first 10):`
    );
    for (const f of requestEnactedFailures.slice(0, 10)) {
      errors.push(`  ${f}`);
    }
    if (requestEnactedFailures.length > 10) {
      errors.push(`  ... and ${requestEnactedFailures.length - 10} more`);
    }
  } else {
    notes.push(`request/enacted vocabulary: no page couples FY2026 with "enacted" ✓`);
  }

  // ── (tc) company display names summary ───────────────────────────────────
  if (companyNameFailures.length > 0) {
    errors.push(
      `${companyNameFailures.length} company-name violation(s) — §P2-4 (first 10):`
    );
    for (const f of companyNameFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue}`);
    }
    if (companyNameFailures.length > 10) {
      errors.push(`  ... and ${companyNameFailures.length - 10} more`);
    }
  } else if (companyNameCount === 0) {
    errors.push(
      `company-name leg is VACUOUS: 0 [data-company-name] elements site-wide — ` +
        `either the display rule stopped rendering or the registry provenance was dropped.`
    );
  } else {
    notes.push(
      `company names: ${companyNameCount} [data-company-name] element(s), each ` +
        `matching displayCompanyName() of its own registry string ✓`
    );
  }

  // ── (dv) derivation-strip summary ────────────────────────────────────────
  if (derivationFailures.length > 0) {
    errors.push(
      `${derivationFailures.length} derivation-strip violation(s) — §P2-8 (first 10):`
    );
    for (const f of derivationFailures.slice(0, 10)) {
      errors.push(`  ${f.file}: ${f.issue}`);
    }
    if (derivationFailures.length > 10) {
      errors.push(`  ... and ${derivationFailures.length - 10} more`);
    }
  } else if (derivationExactCount === 0) {
    errors.push(
      `derivation leg is VACUOUS: ${derivationCount} [data-derivation] strip(s) but ` +
        `0 [data-derivation-exact] equations site-wide — nothing was re-computed.`
    );
  } else {
    notes.push(
      `derivations: ${derivationCount} strip(s), ${derivationExactCount} printed ` +
        `equation(s), all closing exactly at their printed precision ✓`
    );
  }

  // ── (sp) JSX space-eaten text ────────────────────────────────────────────
  {
    const srcDir = path.resolve(siteRoot, "src");
    const { hits, filesScanned } = findGlueSites(srcDir);
    if (filesScanned === 0) {
      errors.push(
        `jsx-glue leg is VACUOUS: 0 .tsx files scanned under ${srcDir}`
      );
    } else if (hits.length > 0) {
      errors.push(
        `${hits.length} JSX site(s) where the renderer eats the space the author ` +
          `wrote — the "Fiscal Receiptsshows" class (first 10):`
      );
      for (const h of hits.slice(0, 10)) {
        errors.push(
          `  ${h.file}:${h.line}: …${h.left}⟦no space⟧${h.right}… — put the two on one line or add {" "}`
        );
      }
      if (hits.length > 10) errors.push(`  ... and ${hits.length - 10} more`);
    } else {
      notes.push(
        `jsx glue: ${filesScanned} .tsx file(s) scanned, 0 space-eaten expression/text joins ✓`
      );
    }
  }

  return { pass: errors.length === 0, errors, notes };
}
