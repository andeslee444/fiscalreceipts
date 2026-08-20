/**
 * gate 23 — basis_gate (PM-review Sprint 1, spec docs/superpowers/specs/2026-07-30-pm-review.md)
 *
 * "One label, one basis" — every rendered figure carries
 * (entity, fiscal_year, measure, basis, edition); two figures on a page
 * sharing (entity, fiscal_year, measure) but differing in basis MUST either
 * render identical values or render inside a declared reconciliation
 * component. Three legs (§Systemic Fix):
 *
 * LEG (a) — intra-page one-label-one-basis (out/program/*\/index.html):
 *   a1 ATTRIBUTE PRESENCE (permanent contract, Tasks 2-3 implement): every
 *      [data-amount] on a program page must carry data-basis, data-fy, and
 *      data-measure. Reported as counts + first 10 offenders (today NONE
 *      carry them — the designed pre-failure).
 *   a2 COLLISION (permanent path): group attribute-carrying figures by
 *      (data-entity || page's PE from the path, data-fy, data-measure);
 *      within a group, >1 distinct displayed value (rendered text parsed and
 *      normalized to dollars; two values "agree" iff they round to the same
 *      3-significant-digit figure) → FAIL unless EVERY member of the group
 *      sits inside a [data-reconciliation] ancestor.
 *   a2-BOOTSTRAP (heuristic, /program/ATA000/ ONLY — proves the gate catches
 *      P0-1 on TODAY'S build, before the attributes exist): label context for
 *      each [data-amount] is its table row text + column-header text (when in
 *      a table) or its nearest compact card ancestor's text; figures whose
 *      context matches /FY\s*(20)?24/i AND /actual/i are one (fy, measure)
 *      group. >1 distinct normalized value → FAIL. The card climb stops at
 *      ancestors holding >1 [data-amount] (a multi-figure container is a
 *      layout region, not a label), so sibling cards and multi-figure prose
 *      never cross-contaminate the label. The attribute path is the
 *      permanent contract; this heuristic retires once a1 passes.
 *
 * LEG (b) — summary/detail agreement (P0-2):
 *   The summary-card region is section[data-section="figures"] (the Budget
 *   Figures cards; section[data-section="answer-strip"] is also summary).
 *   Detail figures are every [data-amount] outside those two sections, plus
 *   the machine-labeled [data-decade-cell="{measure}-{year}"] cells and
 *   FY-labeled table columns (thead th ↔ td column mapping).
 *   b1 NUMERIC CARDS: a card value with ≥1 same-FY detail figure must agree
 *      (same 3-sig-digit normalization) with at least one of them.
 *   b2 ABSENCE CARDS: a card rendering "—" (or an absence label) must have
 *      NO non-null detail figure for a matching fiscal year; a change card
 *      "FY{a}→{b}" rendering "—" fails when BOTH endpoint years have detail
 *      figures. (Permanent contract: absence cards gain [data-absence]
 *      [data-fy][data-measure][data-absence-reason]; matching then runs on
 *      (fy, measure). Bootstrap matches on the FY token in the card label.)
 *
 * LEG (c) — footnote completeness (P0-3, golden files):
 *   Golden fixtures live in scripts/gates/goldens/footnotes/:
 *     {pdf,workbook,derived}.input.json  — formatter inputs (REAL facts:
 *        pdf bb54b1658b2746cb, workbook 5b532c52d3ebb4c2, derived
 *        cde21cb5a87292ec — all resolve in citations.json)
 *     {pdf,workbook,derived}.txt         — the expected footnote line
 *   The goldens are self-validated against the per-tier required-field
 *   manifest (program, fiscal year, row/field name, value WITH unit,
 *   document title, locator, sha256 [pdf/workbook], retrieved date, and a
 *   https://fiscalreceipts.com/fact/ permalink; derived tier: formula +
 *   input-fact permalinks in place of document/locator/sha).
 *   Then the unified formatter module site/src/lib/footnote.ts (Task 4's
 *   deliverable — does NOT exist yet) is imported and formatFootnote(input)
 *   must reproduce each golden EXACTLY. Until the module exists the leg
 *   FAILS with "footnote formatter module missing" — the honest pre-failure.
 *   CONTRACT for Task 4: site/src/lib/footnote.ts must export
 *   formatFootnote(input) and be directly importable by Node's native
 *   type-stripping (erasable TS only: no enums/namespaces, no "@/…" path
 *   aliases, type-only or relative imports).
 *
 * LEG (d) — entity totals reproduce, and mean the period they name
 *   (PM Sprint 3 Task 5b; recompute helper entitytotals-recompute.py):
 *   d1 every entity total_obligation citation's published query_body, run
 *      verbatim against the warehouse, must return its published
 *      recorded_value.
 *   d2 the leading fiscal-year window over which the crosswalk's own
 *      total_obligation column reproduces the award lake must END at the
 *      declared fy_max. The shipped defect satisfied no reproduction check
 *      of the first kind and would have satisfied a naive one: the figures
 *      were internally consistent with a crosswalk built before the
 *      FY2020-FY2026 partitions existed, and wrong only about the period
 *      they claimed. Labels are checked against data, not against copy.
 *   d3 entity_xwalk.parquet must be newer than every award partition it
 *      reads — the cheap check that would have caught it on day one.
 *   See runEntityTotalsLeg's own block at the bottom.
 *
 * LEG (e) — cross-page one label, one basis (Sprint 3 round 3):
 *   Legs a/b are INTRA-page and structurally could not see the shipped
 *   defect: /programs/ rendered F-35 "FY24 actual $5.25B" (P-40 J-book
 *   detail) while /program/ATA000/ and /years/ rendered $5.57B (P-1 TOA),
 *   and no single page held both. Leg e reads the DECLARED index surfaces
 *   (CROSS_PAGE_INDEXES), joins each figure to /program/{entity}/ by
 *   (entity, fy, measure), and requires the page to publish that label on
 *   the same basis at the same value.
 *   e1 the declaration must be complete (basis + fy + measure), in the chip
 *      vocabulary, and VISIBLE — an attribute a reader cannot see is what
 *      this leg exists to prevent;
 *   e2 the value must agree with the program page on that basis, and the
 *      page must publish that basis for the label at all;
 *   e3 vacuity: a surface that contributes no figures, or a figure set that
 *      joins to no program page, FAILS.
 *   The contract is the property, not a choice of basis: an index may
 *   publish either basis as long as it says which.
 *
 * LEG (f) — exhibit agreement (#48; NOTE ON THE LETTER — the task that
 *   prescribed this leg called it "(d)". By the time this leg was written,
 *   (d) already named the entity-totals leg below (PM Sprint 3 Task 5b,
 *   shipped and in the pre-failure record under that letter) — reusing it
 *   here would silently overwrite an existing, working leg's identity. The
 *   next unused letter is (f); the substitution is recorded here, in
 *   docs/superpowers/reviews/5c-gates-pre-failure.txt, and in the commit
 *   message, per the "gather evidence, disclose the substitution" rule):
 *
 *   A TOA basis chip that names a SINGLE exhibit (starts "R-1" or "P-1 ",
 *   never "P-1/") must match the exhibit its own program's row reports in
 *   programs.json's `exhibit_family` field. This is the direct regression
 *   check for the defect this task fixes: site/src/lib/basis.ts hardcoded
 *   "P-1 TOA" for every TOA chip regardless of exhibit, so 1,077 of 1,741
 *   corpus programs (the RDT&E ones) rendered a P-1 claim on an R-1 line.
 *
 *   f1 AGREEMENT — for every rendered basis-chip span on a program page whose
 *      text resolves to a single-exhibit claim (rdte/procurement), that claim
 *      must equal programs.json's exhibit_family for the page's own pe_bli.
 *   f2 UNEXPLAINED MIXED — a chip rendering the both-exhibits "P-1/R-1 TOA"
 *      form on a single-program page is allowed ONLY inside a
 *      [data-reconciliation] ancestor (the two-basis reconciliation strip) or
 *      a [data-basis-declared] ancestor (an aggregate surface's own
 *      declaration point, same attribute /agency/* and /programs/ use) —
 *      a program page otherwise has exactly one exhibit and should be able to
 *      name it, not fall back to the honest-but-uninformative mixed form.
 *   f3 NON-VACUITY — fewer than 100 resolved chips FAILS: the chip selector
 *      or the exhibit map silently matching nothing is exactly the failure
 *      mode that let the original defect ship past a gate suite that never
 *      looked at label CORRECTNESS, only number↔citation agreement.
 *
 * LEG (g) — FY2026 discretionary/reconciliation split (#50; letter checked
 *   free against a/b/c/d/e/f above before use):
 *
 *   The FY2026 "Request" figure is disc + reconciliation with no visible
 *   seam — $89.01B of the $385.27B FY2026 corpus total is one-time
 *   reconciliation-bill money. Long Range Kill Chains (PE 1203154SF) — the
 *   #1 row on /programs/ and the #1 homepage item — headlined "+3052.9%" on
 *   $1,916k of actual discretionary money, a like-for-like -99.2%.
 *
 *   g1 CHIP PRESENCE — every program page whose sidecar (program_details/
 *      {pe}.json's fy26_split) reports recon_share > 0 must render a
 *      [data-fy26-recon-chip] marker.
 *   g2 CHANGE ACCOMPANIMENT — a page rendering the COMBINED FY25→FY26
 *      percentage (the "change" summary card's pct, read from the same
 *      sidecar's summary.cards) on a reconciliation-affected program must
 *      ALSO render [data-fy26-disc-pct-change] — the discretionary-only,
 *      like-for-like rate is never optional once the combined one is shown.
 *   g3 NON-VACUITY — fewer than 100 resolved (recon_share > 0) pages FAILS.
 *
 *   g4 (#54) WIDENS g PAST /program/*\/ TO /feed/: a yoy_swing feed card
 *      whose PE has fy26_split.has_reconciliation (read from feed.json
 *      itself, not a program_details sidecar — a feed event's pe_bli need
 *      not have a page) must ALSO render [data-fy26-recon-chip] (g4a).
 *      Fewer than 20 resolved qualifying cards FAILS as vacuous (g4b; the
 *      live corpus carries 31). See runFeedFy26SplitLeg below.
 *
 * Export: runBasisGate() → { pass, errors, notes }
 * Helpers (unit-tested in __tests__/basis.test.mjs): normalizeAmount,
 * valuesAgree, fyTokensFromLabel, validateGoldenFootnote, chipExhibitClaim,
 * isBasisChipClassName.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(siteRoot, "..");
const outDir = path.resolve(siteRoot, "out");
const goldensDir = path.resolve(__dirname, "goldens", "footnotes");
const footnoteModulePath = path.resolve(siteRoot, "src", "lib", "footnote.ts");

const BOOTSTRAP_COLLISION_PAGE = "ATA000";
const MAX_LISTED = 10;

// ── Leg (e) — cross-page "one label, one basis" ──────────────────────────────
//
// Legs a/b are INTRA-page: they cannot see that /programs/ said $5.25B for
// F-35 FY24 actuals while /program/ATA000/ and /years/ said $5.57B, because
// no single page held both. That is the shape the reader actually meets — an
// index and the pages it indexes — and it is how the shipped defect survived
// Sprint 1's ~80k basis attributes: the /programs/ money columns carried no
// basis at all, so nothing joined them to anything.
//
// The contract this leg enforces is the property, not a particular choice:
// an index may publish a figure on ANY declared basis, but it must DECLARE
// that basis, visibly, and the value must be the one the program page
// publishes on that same basis. Switching a column's basis is legal; showing
// one label with two values and no explanation is not.
//
// Two declaration forms, because the surfaces differ:
//   TABLE — table[data-basis-table], thead th[data-basis][data-fy]
//           [data-measure], tbody tr[data-entity]. The basis is a property of
//           the COLUMN (every cell comes from one field), so it is declared
//           once instead of on each of 3,482 figures — /programs/ has 168 KB
//           of headroom under its §P2-1 weight ceiling and per-figure
//           attributes would eat ~157 KB of it.
//   FIGURE — a [data-amount] carrying data-basis + data-fy + data-measure +
//           data-entity itself. Used by /agency/{org}/, which is a list.
// Either way the page must ALSO carry a [data-basis-declared] element whose
// text names the basis — a machine-readable attribute a reader cannot see is
// exactly what this leg exists to prevent.
const CROSS_PAGE_INDEXES = [
  { label: "/programs/", file: "programs/index.html" },
  { label: "/agency/*/", dir: "agency" },
];

/**
 * Human basis labels — MIRRORS BASIS_LABEL in src/lib/basis.ts, which is what
 * <Cite>'s chip and the /programs/ column label both render. Change one,
 * change both; the leg fails loudly on an unknown basis rather than skipping
 * it, so a new basis token cannot slip past unlabelled.
 *
 * §48: toa's mirror value updated from "P-1 TOA" to "P-1/R-1 TOA" alongside
 * src/lib/basis.ts's BASIS_LABEL.toa — the cross-page index surfaces (leg e)
 * declare "mixed" explicitly now, so their visible text is the both-exhibits
 * form, not the old single-exhibit constant. Leg (f) below is the finer-
 * grained check: it reads the PROGRAM PAGE'S OWN chip, which is exhibit-
 * qualified per row, against this same vocabulary.
 */
const BASIS_LABEL = {
  toa: "P-1/R-1 TOA",
  "jbook-detail": "P-40 detail",
};

// ── Value normalization ──────────────────────────────────────────────────────

const SUFFIX_MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * Parse a rendered figure ("$5.25B", "$4,972,514", "$5,247.07") to dollars.
 * Returns null when the text is not a single parseable currency figure
 * (absence dashes, empty cells, prose).
 */
export function normalizeAmount(text) {
  if (typeof text !== "string") return null;
  const t = text.replace(/ /g, " ").trim();
  const m = t.match(/^\$\s*([\d,]+(?:\.\d+)?)\s*([KMBT])?$/i);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const mult = m[2] ? SUFFIX_MULT[m[2].toUpperCase()] : 1;
  return base * mult;
}

/**
 * Two displayed values "agree" iff they are within the rounding granularity
 * of a 3-significant-digit display: |a−b| ≤ 0.5·10^(floor(log10(max))−2).
 * ($5.25B vs $5,247.07M agree — the former is the latter rounded;
 *  $5.25B vs $5.57B do NOT.)
 */
export function valuesAgree(a, b) {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const mag = Math.max(Math.abs(a), Math.abs(b));
  if (mag === 0) return true;
  const granularity = 0.5 * Math.pow(10, Math.floor(Math.log10(mag)) - 2);
  return Math.abs(a - b) <= granularity;
}

/**
 * Fiscal-year tokens in a card label. "FY24 Actuals" → { years: [2024],
 * change: false }; "FY25→26 Change" → { years: [2025, 2026], change: true }.
 * Returns { years: [], change: false } when no FY token is present.
 */
export function fyTokensFromLabel(label) {
  const norm = (s) => {
    const n = Number(s);
    return n >= 100 ? n : 2000 + n;
  };
  const change = label.match(/FY\s*(\d{2,4})\s*(?:→|->)\s*(?:FY\s*)?(\d{2,4})/i);
  if (change) {
    return { years: [norm(change[1]), norm(change[2])], change: true };
  }
  const single = label.match(/FY\s*(\d{2,4})/i);
  if (single) return { years: [norm(single[1])], change: false };
  return { years: [], change: false };
}

// ── Leg (f) helpers — exhibit-chip classification ───────────────────────────
//
// The rendered basis chip has no data-* marker of its own (it is a plain
// <span> — see cite.tsx's Cite/CiteChips). What DOES uniquely identify it is
// the exact inline utility-class signature both call sites render it with;
// verified (grep) to appear at exactly those two spots in src/components/
// cite.tsx and nowhere else — the fact-id chip is a NAMED class
// (.cite-id-chip in globals.css), not this raw utility-class combination.
const CHIP_CLASS_TOKENS = [
  "rounded",
  "bg-muted",
  "leading-none",
  "no-underline",
  "text-muted-foreground",
];

/** True when a rendered element's `class` attribute is the basis chip's. */
export function isBasisChipClassName(className) {
  const tokens = (className || "").split(/\s+/).filter(Boolean);
  return CHIP_CLASS_TOKENS.every((t) => tokens.includes(t));
}

/**
 * Classify a rendered chip's text against the exhibit vocabulary
 * (TOA_LABEL_BY_EXHIBIT in src/lib/basis.ts — mirror, change one change
 * both): 'rdte' for "R-1 …", 'procurement' for "P-1 …" (the space matters —
 * "P-1/R-1 …" is the combined form, checked FIRST so it is never
 * misread as a procurement claim), 'mixed' for "P-1/R-1 …". Returns null for
 * chip text this leg has no opinion about (non-TOA chips like "P-40 detail",
 * or plain prose that happens to match the class signature but not the
 * vocabulary — defensive, should not occur).
 */
export function chipExhibitClaim(text) {
  const t = (text || "").trim();
  if (t.startsWith("P-1/")) return "mixed";
  if (t.startsWith("R-1 ")) return "rdte";
  if (t.startsWith("P-1 ")) return "procurement";
  return null;
}

// ── Golden footnote field manifest ───────────────────────────────────────────

/**
 * Validate one golden footnote line against the per-tier required-field
 * manifest, using its fixture for the concrete expected values.
 * Returns an array of missing-field descriptions (empty = valid).
 */
export function validateGoldenFootnote(fixture, text) {
  const missing = [];
  const has = (needle) => text.includes(needle);

  if (!has("Fiscal Receipts")) missing.push("site attribution ('Fiscal Receipts')");
  if (!has(fixture.program.name)) missing.push(`program name (${fixture.program.name})`);
  if (!has(`(${fixture.program.code})`)) missing.push(`program code ((${fixture.program.code}))`);
  if (!new RegExp(`FY\\s*${fixture.fiscalYear}`).test(text))
    missing.push(`fiscal year (FY${fixture.fiscalYear})`);
  if (!has(fixture.rowName)) missing.push(`row/field name (${fixture.rowName})`);
  if (!has(fixture.valueText)) missing.push(`value with unit (${fixture.valueText})`);
  if (!/(million|thousand|billion|USD)/i.test(fixture.valueText))
    missing.push("fixture valueText carries no unit word");
  if (!/retrieved \d{4}-\d{2}-\d{2}/i.test(text))
    missing.push("retrieved date (retrieved YYYY-MM-DD)");
  if (!has(fixture.permalink)) missing.push(`fact permalink (${fixture.permalink})`);
  if (!/https:\/\/fiscalreceipts\.com\/fact\/[0-9a-f]{8}/.test(text))
    missing.push("fact permalink shape (https://fiscalreceipts.com/fact/{id8})");

  if (fixture.tier === "pdf" || fixture.tier === "workbook") {
    if (!has(fixture.docTitle)) missing.push(`document title (${fixture.docTitle})`);
    if (fixture.publisher && !has(fixture.publisher))
      missing.push(`publisher (${fixture.publisher})`);
    if (!new RegExp(`SHA-256 ${fixture.sha256.slice(0, 8)}`).test(text))
      missing.push(`sha256 (SHA-256 ${fixture.sha256.slice(0, 8)}…)`);
  }
  if (fixture.tier === "pdf") {
    if (!/p\.\s*\d+/.test(text)) missing.push("page locator (p. N)");
  }
  if (fixture.tier === "workbook") {
    if (!has(fixture.locator.sheet)) missing.push(`sheet locator (${fixture.locator.sheet})`);
    if (!has(fixture.locator.cells)) missing.push(`cells locator (${fixture.locator.cells})`);
  }
  if (fixture.tier === "derived") {
    if (!has(fixture.formula)) missing.push("derivation formula");
    for (const fid of fixture.inputFactIds) {
      const link = `https://fiscalreceipts.com/fact/${fid.slice(0, 8)}`;
      if (!has(link)) missing.push(`input fact permalink (${link})`);
    }
  }
  return missing;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function hasAncestorWith(node, predicate) {
  let cur = node.parentNode;
  while (cur) {
    if (cur.getAttribute && predicate(cur)) return true;
    cur = cur.parentNode;
  }
  return false;
}

function insideReconciliation(el) {
  return (
    el.getAttribute("data-reconciliation") != null ||
    hasAncestorWith(el, (a) => a.getAttribute("data-reconciliation") != null)
  );
}

function sectionOf(el) {
  let cur = el;
  while (cur) {
    const s = cur.getAttribute && cur.getAttribute("data-section");
    if (s) return s;
    cur = cur.parentNode;
  }
  return null;
}

/** Element children only (node-html-parser: nodeType 1). */
function elementChildren(node) {
  return (node.childNodes || []).filter((c) => c.nodeType === 1);
}

/**
 * Label context for a [data-amount] element (BOOTSTRAP heuristic):
 *  - inside a table row: the row's text plus the same-index column-header
 *    text (thead th), so both row-labeled and column-labeled tables resolve;
 *  - otherwise: the largest ancestor whose total text stays compact
 *    (≤ 160 chars) AND that holds no OTHER [data-amount] — a container with
 *    several figures (the card grid, a prose sentence comparing figures) is
 *    a layout region, not this figure's label.
 */
function labelContext(el) {
  const row = el.closest ? el.closest("tr") : null;
  if (row) {
    let ctx = row.text || "";
    const cell = el.closest("td,th");
    const table = row.closest ? row.closest("table") : null;
    if (cell && table) {
      const cells = elementChildren(row).filter((c) =>
        ["td", "th"].includes((c.tagName || "").toLowerCase()),
      );
      const idx = cells.indexOf(cell);
      const headRow = table.querySelector("thead tr");
      if (idx >= 0 && headRow) {
        const ths = elementChildren(headRow).filter((c) =>
          ["td", "th"].includes((c.tagName || "").toLowerCase()),
        );
        if (ths[idx]) ctx += " " + (ths[idx].text || "");
      }
    }
    return ctx;
  }
  let best = el;
  let cur = el.parentNode;
  while (
    cur &&
    typeof cur.text === "string" &&
    cur.text.length <= 160 &&
    cur.querySelectorAll &&
    cur.querySelectorAll("[data-amount]").length <= 1
  ) {
    best = cur;
    cur = cur.parentNode;
  }
  return best.text || "";
}

/**
 * Every declared cross-page index surface, as { label, htmlPath }.
 * A `dir` entry expands to every built index.html one level down.
 */
function crossPageIndexFiles() {
  const out = [];
  for (const entry of CROSS_PAGE_INDEXES) {
    if (entry.file) {
      const p = path.join(outDir, entry.file);
      if (fs.existsSync(p)) out.push({ label: entry.label, htmlPath: p });
      continue;
    }
    const dir = path.join(outDir, entry.dir);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(dir, d.name, "index.html");
      if (fs.existsSync(p)) {
        out.push({ label: `/${entry.dir}/${d.name}/`, htmlPath: p });
      }
    }
  }
  return out;
}

/**
 * Read the figures a cross-page index surface DECLARES, in either form.
 *
 * Returns { figures, declaredLabels, columnIssues }:
 *   figures        [{ entity, fy, measure, basis, value, text, where }]
 *   declaredLabels the set of basis labels the page states VISIBLY, from its
 *                  [data-basis-declared] elements
 *   columnIssues   structural problems (a money column with no basis, a
 *                  declared column whose cells cannot be read)
 *
 * Absence cells ("—") are skipped, not flagged: an index that has no figure
 * for a program is making no claim about it.
 */
export function readIndexFigures(root, label) {
  const figures = [];
  const columnIssues = [];

  const declaredLabels = new Set();
  for (const el of root.querySelectorAll("[data-basis-declared]")) {
    const text = (el.text || "").replace(/\s+/g, " ");
    for (const [token, human] of Object.entries(BASIS_LABEL)) {
      if (text.includes(human)) declaredLabels.add(token);
    }
  }

  // ── TABLE form ──
  for (const table of root.querySelectorAll("table[data-basis-table]")) {
    const name = table.getAttribute("data-basis-table") || "(unnamed)";
    const headRow = table.querySelector("thead tr");
    if (!headRow) {
      columnIssues.push(
        `${label}: table[data-basis-table="${name}"] has no thead row — a column-scoped basis needs a column to sit on`,
      );
      continue;
    }
    const ths = elementChildren(headRow).filter((c) =>
      ["td", "th"].includes((c.tagName || "").toLowerCase()),
    );
    const cols = new Map(); // index → {basis, fy, measure}
    ths.forEach((th, i) => {
      const basis = th.getAttribute("data-basis");
      const fy = th.getAttribute("data-fy");
      const measure = th.getAttribute("data-measure");
      if (!basis && !fy && !measure) return; // not a declared money column
      if (!basis || !fy || !measure) {
        columnIssues.push(
          `${label}: table "${name}" column "${(th.text || "").trim().slice(0, 24)}" ` +
            `declares a partial basis (basis=${basis ?? "—"}, fy=${fy ?? "—"}, measure=${measure ?? "—"})`,
        );
        return;
      }
      if (!BASIS_LABEL[basis]) {
        columnIssues.push(
          `${label}: table "${name}" declares unknown basis "${basis}" — add it to BASIS_LABEL in src/lib/basis.ts and here, or the chip renders nothing`,
        );
        return;
      }
      // The declaration has to be VISIBLE in this column's own header.
      const headerText = (th.text || "").replace(/\s+/g, " ");
      if (!headerText.includes(BASIS_LABEL[basis])) {
        columnIssues.push(
          `${label}: table "${name}" column "${headerText.slice(0, 40)}" declares basis=${basis} ` +
            `in an attribute but never says "${BASIS_LABEL[basis]}" where a reader can see it`,
        );
      }
      cols.set(i, { basis, fy, measure });
    });
    if (cols.size === 0) {
      columnIssues.push(
        `${label}: table[data-basis-table="${name}"] declares no money columns — the marker claims a contract the table does not keep`,
      );
      continue;
    }
    for (const row of table.querySelectorAll("tbody tr")) {
      const entity = row.getAttribute("data-entity");
      if (!entity) continue;
      const cells = elementChildren(row).filter((c) =>
        ["td", "th"].includes((c.tagName || "").toLowerCase()),
      );
      for (const [i, col] of cols) {
        const cell = cells[i];
        if (!cell) continue;
        const amountEl = cell.querySelector("[data-amount]");
        if (!amountEl) continue; // absence cell — no claim made
        const text = (amountEl.text || "").trim();
        const value = normalizeAmount(text);
        if (value == null) continue;
        figures.push({
          entity,
          fy: col.fy,
          measure: col.measure,
          basis: col.basis,
          value,
          text,
          where: `${label} table "${name}"`,
        });
      }
    }
  }

  // ── FIGURE form ──
  for (const el of root.querySelectorAll("[data-amount][data-entity]")) {
    const basis = el.getAttribute("data-basis");
    const fy = el.getAttribute("data-fy");
    const measure = el.getAttribute("data-measure");
    const entity = el.getAttribute("data-entity");
    if (!basis || !fy || !measure || !entity) continue;
    if (!BASIS_LABEL[basis]) continue; // non-budget basis: no chip vocabulary
    const text = (el.text || "").trim();
    const value = normalizeAmount(text);
    if (value == null) continue;
    if (!declaredLabels.has(basis)) {
      columnIssues.push(
        `${label}: figure "${text}" declares basis=${basis} in an attribute but the page never says "${BASIS_LABEL[basis]}" where a reader can see it`,
      );
    }
    figures.push({
      entity,
      fy,
      measure,
      basis,
      value,
      text,
      where: label,
    });
  }

  return { figures, declaredLabels, columnIssues };
}

function* walkProgramPages() {
  const programDir = path.join(outDir, "program");
  if (!fs.existsSync(programDir)) return;
  // Debug hook (fix-task loop aid): BASIS_PAGE_FILTER=ATA000 scopes the scan
  // to one PE. Never set in CI — the gate's verdict is the full-corpus run.
  const only = process.env.BASIS_PAGE_FILTER || null;
  for (const entry of fs.readdirSync(programDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (only && entry.name !== only) continue;
    const htmlPath = path.join(programDir, entry.name, "index.html");
    if (fs.existsSync(htmlPath)) yield { pe: entry.name, htmlPath };
  }
}

// ── The gate ─────────────────────────────────────────────────────────────────

export async function runBasisGate() {
  const errors = [];
  const notes = [];

  const pages = [...walkProgramPages()];
  if (pages.length === 0) {
    return {
      pass: false,
      errors: ["no out/program/*/index.html pages found — build the site first"],
      notes,
    };
  }
  notes.push(`scanning ${pages.length} program pages`);

  // ── Leg (a) accumulators ──
  let totalAmounts = 0;
  let missingAttrCount = 0;
  const missingAttrSamples = [];
  const attrCollisions = [];
  let attributedFigures = 0;
  const bootstrapCollisions = [];

  // ── Leg (b) accumulators ──
  const b1Failures = [];
  const b2Failures = [];
  let cardsSeen = 0;
  let absenceCardsSeen = 0;

  // ── Leg (e): read the INDEX surfaces first, so the program-page scan below
  //    only has to remember the (entity, fy, measure) keys an index asks
  //    about. 1,993 pages × ~40 figures is not a map worth building blind.
  const indexFigures = [];
  const indexIssues = [];
  const indexSurfaces = crossPageIndexFiles();
  for (const { label, htmlPath } of indexSurfaces) {
    let root;
    try {
      root = parse(fs.readFileSync(htmlPath, "utf8"), { comment: false });
    } catch (e) {
      indexIssues.push(`${label}: failed to parse (${e.message})`);
      continue;
    }
    const r = readIndexFigures(root, label);
    indexFigures.push(...r.figures);
    indexIssues.push(...r.columnIssues);
  }
  const wantedKeys = new Set(
    indexFigures.map((f) => `${f.entity}|${f.fy}|${f.measure}`),
  );
  /** key → [{ value, basis, text }] as the PROGRAM PAGE publishes them. */
  const pageFigures = new Map();

  for (const { pe, htmlPath } of pages) {
    const relPath = path.relative(outDir, htmlPath);
    let root;
    try {
      root = parse(fs.readFileSync(htmlPath, "utf8"), { comment: false });
    } catch (e) {
      errors.push(`failed to read/parse ${relPath}: ${e.message}`);
      continue;
    }

    const amountEls = root.querySelectorAll("[data-amount]");

    // ── (a1) attribute presence ──
    const attributed = [];
    for (const el of amountEls) {
      totalAmounts++;
      const basis = el.getAttribute("data-basis");
      const fy = el.getAttribute("data-fy");
      const measure = el.getAttribute("data-measure");
      if (!basis || !fy || !measure) {
        missingAttrCount++;
        if (missingAttrSamples.length < MAX_LISTED) {
          const absent = [
            !basis && "data-basis",
            !fy && "data-fy",
            !measure && "data-measure",
          ]
            .filter(Boolean)
            .join(", ");
          missingAttrSamples.push(
            `${relPath}: "${(el.text || "").trim().slice(0, 20)}" ` +
              `(fact ${el.getAttribute("data-fact-id") ?? "—"}) missing ${absent}`,
          );
        }
      } else {
        attributed.push({ el, basis, fy, measure });
      }
    }

    // ── (e) collect the keys the index surfaces asked about ──
    for (const f of attributed) {
      const entity = f.el.getAttribute("data-entity") || pe;
      const key = `${entity}|${f.fy}|${f.measure}`;
      if (!wantedKeys.has(key)) continue;
      const v = normalizeAmount((f.el.text || "").trim());
      if (v == null) continue;
      if (!pageFigures.has(key)) pageFigures.set(key, []);
      pageFigures.get(key).push({
        value: v,
        basis: f.basis,
        text: (f.el.text || "").trim(),
      });
    }

    // ── (a2) collision — permanent attribute path ──
    attributedFigures += attributed.length;
    const groups = new Map();
    for (const f of attributed) {
      const entity = f.el.getAttribute("data-entity") || pe;
      const key = `${entity}|${f.fy}|${f.measure}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const values = members.map((m) => ({
        v: normalizeAmount((m.el.text || "").trim()),
        text: (m.el.text || "").trim(),
        basis: m.basis,
        reconciled: insideReconciliation(m.el),
      }));
      const distinct = [];
      for (const val of values) {
        if (val.v == null) continue;
        if (!distinct.some((d) => valuesAgree(d.v, val.v))) distinct.push(val);
      }
      if (distinct.length > 1 && !values.every((v) => v.reconciled)) {
        attrCollisions.push(
          `${relPath}: (${key}) renders ${distinct.length} distinct values ` +
            `[${distinct.map((d) => `${d.text} (basis=${d.basis})`).join(" vs ")}] ` +
            `outside a [data-reconciliation] component`,
        );
      }
    }

    // ── (a2-BOOTSTRAP) heuristic collision — /program/ATA000/ only ──
    if (pe === BOOTSTRAP_COLLISION_PAGE) {
      const fy24Actuals = [];
      for (const el of amountEls) {
        const ctx = labelContext(el);
        if (/FY\s*(20)?24/i.test(ctx) && /actual/i.test(ctx)) {
          const v = normalizeAmount((el.text || "").trim());
          if (v != null && !insideReconciliation(el)) {
            fy24Actuals.push({
              v,
              text: (el.text || "").trim(),
              fid: el.getAttribute("data-fact-id") ?? "—",
              ctx: ctx.trim().replace(/\s+/g, " ").slice(0, 60),
            });
          }
        }
      }
      const distinct = [];
      for (const f of fy24Actuals) {
        const bucket = distinct.find((d) => valuesAgree(d[0].v, f.v));
        if (bucket) bucket.push(f);
        else distinct.push([f]);
      }
      if (distinct.length > 1) {
        bootstrapCollisions.push(
          `${relPath} [BOOTSTRAP heuristic — P0-1]: "FY24 actuals" resolves to ` +
            `${distinct.length} distinct values with no reconciliation: ` +
            distinct
              .map(
                (bucket) =>
                  `${bucket[0].text} (fact ${bucket[0].fid}, label "${bucket[0].ctx}")`,
              )
              .join(" vs "),
        );
      }
    }

    // ── Leg (b) — summary/detail agreement ──
    const figuresSection = root.querySelector('[data-section="figures"]');
    if (!figuresSection) continue;

    // Detail figures: [data-amount] outside the summary sections.
    const detailFigures = [];
    for (const el of amountEls) {
      const sec = sectionOf(el);
      if (sec === "figures" || sec === "answer-strip") continue;
      const v = normalizeAmount((el.text || "").trim());
      if (v != null) detailFigures.push({ el, v, text: (el.text || "").trim() });
    }

    // FY-labeled detail evidence: decade cells + FY-labeled table columns.
    const fyEvidence = new Map(); // year → [{label, text}]
    const addEvidence = (year, label, text) => {
      if (!fyEvidence.has(year)) fyEvidence.set(year, []);
      fyEvidence.get(year).push({ label, text });
    };
    for (const cell of root.querySelectorAll("[data-decade-cell]")) {
      const key = cell.getAttribute("data-decade-cell") || "";
      const m = key.match(/^(.+)-(\d{4})$/);
      if (!m) continue;
      const v = normalizeAmount((cell.text || "").trim());
      if (v != null) addEvidence(Number(m[2]), `decade ${key}`, (cell.text || "").trim());
    }
    for (const table of root.querySelectorAll("table")) {
      const headRow = table.querySelector("thead tr");
      if (!headRow) continue;
      const ths = elementChildren(headRow).filter((c) =>
        ["td", "th"].includes((c.tagName || "").toLowerCase()),
      );
      const fyCols = new Map();
      ths.forEach((th, i) => {
        const { years } = fyTokensFromLabel(th.text || "");
        if (years.length === 1) fyCols.set(i, { year: years[0], label: (th.text || "").trim() });
      });
      if (fyCols.size === 0) continue;
      for (const row of table.querySelectorAll("tbody tr")) {
        const cells = elementChildren(row).filter((c) =>
          ["td", "th"].includes((c.tagName || "").toLowerCase()),
        );
        for (const [i, col] of fyCols) {
          if (!cells[i]) continue;
          const v = normalizeAmount((cells[i].text || "").trim());
          if (v != null)
            addEvidence(col.year, `table column "${col.label}"`, (cells[i].text || "").trim());
        }
      }
    }

    // Cards: element children of the grid inside the figures section.
    const grid = figuresSection
      .querySelectorAll("div")
      .find((d) => ((d.getAttribute("class") || "").split(/\s+/)).includes("grid"));
    if (!grid) continue;
    for (const card of elementChildren(grid)) {
      const labelEl = card.querySelector("div");
      const label = labelEl ? (labelEl.text || "").trim() : "";
      const { years, change } = fyTokensFromLabel(label);
      const amountEl = card.querySelector("[data-amount]");

      if (amountEl) {
        // ── (b1) numeric card ──
        cardsSeen++;
        const v = normalizeAmount((amountEl.text || "").trim());
        if (v == null || years.length !== 1) continue;
        const sameFy = (fyEvidence.get(years[0]) || []).map((e) =>
          normalizeAmount(e.text),
        );
        const agreesSomewhere =
          detailFigures.some((d) => valuesAgree(d.v, v)) ||
          sameFy.some((dv) => valuesAgree(dv, v));
        if (sameFy.length > 0 && !agreesSomewhere) {
          b1Failures.push(
            `${relPath}: summary card "${label}" = ${(amountEl.text || "").trim()} ` +
              `matches NO detail figure (same-FY detail values: ` +
              `${(fyEvidence.get(years[0]) || []).map((e) => e.text).join(", ")})`,
          );
        }
      } else if (/[—–]/.test(card.text || "")) {
        // ── (b2) absence card ──
        absenceCardsSeen++;
        if (years.length === 0) continue;
        const present = years.map((y) => fyEvidence.get(y) || []);
        const failing = change
          ? present.every((list) => list.length > 0) // both endpoints published
          : present[0].length > 0; // the year itself is published
        if (failing) {
          const evidence = years
            .map(
              (y, i) =>
                `FY${y}: ${present[i]
                  .slice(0, 3)
                  .map((e) => `${e.text} (${e.label})`)
                  .join(", ")}`,
            )
            .join(" | ");
          b2Failures.push(
            `${relPath}: summary card "${label}" renders "—" (absence) while the ` +
              `detail sections publish values — ${evidence}`,
          );
        }
      }
    }
  }

  // ── Leg (a) verdicts ──
  if (missingAttrCount > 0) {
    errors.push(
      `leg a1 basis-attrs: ${missingAttrCount}/${totalAmounts} [data-amount] figures on ` +
        `program pages missing data-basis/data-fy/data-measure (first ${MAX_LISTED}):`,
    );
    for (const s of missingAttrSamples) errors.push(`  ${s}`);
    if (missingAttrCount > MAX_LISTED)
      errors.push(`  ... and ${missingAttrCount - MAX_LISTED} more`);
  } else {
    notes.push(`leg a1: all ${totalAmounts} program-page figures carry basis attrs ✓`);
  }

  if (attrCollisions.length > 0) {
    errors.push(
      `leg a2 collision (attribute path): ${attrCollisions.length} unreconciled ` +
        `(entity, fy, measure) collisions (first ${MAX_LISTED}):`,
    );
    for (const c of attrCollisions.slice(0, MAX_LISTED)) errors.push(`  ${c}`);
    if (attrCollisions.length > MAX_LISTED)
      errors.push(`  ... and ${attrCollisions.length - MAX_LISTED} more`);
  } else if (attributedFigures === 0) {
    notes.push(
      `leg a2 (attribute path): VACUOUS — 0 attribute-carrying figures to group ` +
        `(a1 must pass before this path has teeth)`,
    );
  } else {
    notes.push(`leg a2 (attribute path): no unreconciled collisions ✓`);
  }

  if (bootstrapCollisions.length > 0) {
    errors.push(
      `leg a2 collision (BOOTSTRAP heuristic on /program/${BOOTSTRAP_COLLISION_PAGE}/):`,
    );
    for (const c of bootstrapCollisions) errors.push(`  ${c}`);
  } else {
    notes.push(
      `leg a2 (bootstrap): no FY24-actuals collision detected on /program/${BOOTSTRAP_COLLISION_PAGE}/`,
    );
  }

  // ── Leg (b) verdicts ──
  if (b1Failures.length > 0) {
    errors.push(
      `leg b1 summary/detail value agreement: ${b1Failures.length} summary card(s) ` +
        `contradict every same-FY detail figure (first ${MAX_LISTED}):`,
    );
    for (const f of b1Failures.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (b1Failures.length > MAX_LISTED)
      errors.push(`  ... and ${b1Failures.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg b1: ${cardsSeen} numeric summary cards agree with detail figures ✓`);
  }

  if (b2Failures.length > 0) {
    errors.push(
      `leg b2 false-absence: ${b2Failures.length} summary card(s) render "—" while ` +
        `detail sections publish the value (first ${MAX_LISTED}):`,
    );
    for (const f of b2Failures.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (b2Failures.length > MAX_LISTED)
      errors.push(`  ... and ${b2Failures.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg b2: ${absenceCardsSeen} absence cards, none contradicted by details ✓`);
  }

  // ── Leg (c) — footnote completeness (goldens) ──
  const tiers = ["pdf", "workbook", "derived"];
  const fixtures = new Map();
  let goldensOk = true;
  for (const tier of tiers) {
    const inputPath = path.join(goldensDir, `${tier}.input.json`);
    const goldenPath = path.join(goldensDir, `${tier}.txt`);
    if (!fs.existsSync(inputPath) || !fs.existsSync(goldenPath)) {
      errors.push(`leg c: golden fixture missing for tier "${tier}" (${goldenPath})`);
      goldensOk = false;
      continue;
    }
    const fixture = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const golden = fs.readFileSync(goldenPath, "utf8").trim();
    const missing = validateGoldenFootnote(fixture, golden);
    if (missing.length > 0) {
      goldensOk = false;
      errors.push(
        `leg c: golden ${tier}.txt fails its own field manifest: ${missing.join("; ")}`,
      );
    }
    fixtures.set(tier, { fixture, golden });
  }
  if (goldensOk) {
    notes.push(`leg c: ${tiers.length} golden fixtures self-validate (field manifest) ✓`);
  }

  if (!fs.existsSync(footnoteModulePath)) {
    errors.push(
      `leg c footnote-formatter: footnote formatter module missing ` +
        `(${path.relative(siteRoot, footnoteModulePath)}) — P0-3 unified formatter ` +
        `not yet implemented; the goldens in scripts/gates/goldens/footnotes/ are ` +
        `the contract it must reproduce`,
    );
  } else {
    try {
      const mod = await import(pathToFileURL(footnoteModulePath).href);
      if (typeof mod.formatFootnote !== "function") {
        errors.push(
          `leg c footnote-formatter: ${path.relative(siteRoot, footnoteModulePath)} ` +
            `exports no formatFootnote(input) function`,
        );
      } else {
        for (const [tier, { fixture, golden }] of fixtures) {
          let out;
          try {
            out = mod.formatFootnote(fixture);
          } catch (e) {
            errors.push(`leg c: formatFootnote threw on ${tier} fixture: ${e.message}`);
            continue;
          }
          if (typeof out !== "string" || out.trim() !== golden) {
            errors.push(
              `leg c: ${tier} footnote diverges from golden:\n` +
                `    expected: ${golden}\n` +
                `    actual:   ${String(out).trim()}`,
            );
          } else {
            notes.push(`leg c: ${tier} footnote matches golden ✓`);
          }
        }
      }
    } catch (e) {
      errors.push(
        `leg c footnote-formatter: module exists but could not be imported ` +
          `(${e.message}) — it must be erasable TS (no enums/namespaces) with no ` +
          `"@/…" path-alias imports so Node's type stripping can load it`,
      );
    }
  }

  // ── Leg (e) — cross-page "one label, one basis" ────────────────────────────
  runCrossPageLeg(
    { indexSurfaces, indexFigures, indexIssues, pageFigures },
    errors,
    notes,
  );

  // ── Leg (d) — entity totals: reproduce, and mean the period they name ──────
  runEntityTotalsLeg(errors, notes);

  // ── Leg (f) — exhibit agreement (#48) ──────────────────────────────────────
  runExhibitAgreementLeg(pages, errors, notes);

  // ── Leg (g) — FY2026 discretionary/reconciliation split (#50) ─────────────
  runFy26SplitLeg(pages, errors, notes);

  // ── Leg (g4) — same split, widened past /program/*\/ to /feed/ (#54) ──────
  runFeedFy26SplitLeg(errors, notes);

  // ── Leg (h) — account-collision fused rows (#56) ───────────────────────────
  runAccountCollisionLeg(pages, errors, notes);

  // ── Leg (i) — agency reconciliation disclosure (#59) ───────────────────────
  runAgencyReconciliationLeg(errors, notes);

  return { pass: errors.length === 0, errors, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG (e) — CROSS-PAGE ONE-LABEL-ONE-BASIS (Sprint 3 round 3)
// ─────────────────────────────────────────────────────────────────────────────
//
// The shipped defect this closes: /programs/ rendered F-35 "FY24 actual
// $5.25B" (the P-40 J-book detail figure) while /years/ and /program/ATA000/
// rendered $5.57B (the canonical P-1 TOA figure). Both numbers were real and
// both were cited. What was missing was any statement of WHICH measurement
// each column was — Sprint 1 put basis attributes on ~80k figures and this
// index's two money columns were not among them, so nothing could join the
// index to the pages it indexes.
//
// Three checks, in the order a reader would notice them:
//
//   e1 STRUCTURE — a declared surface must actually declare: a money column
//      needs basis + fy + measure, the basis must be in the chip vocabulary,
//      and the declaration must appear in text a reader can see, not only in
//      an attribute. (Half a declaration is worse than none: it looks
//      checked.)
//   e2 AGREEMENT — for each (entity, fy, measure) the index publishes, the
//      program page must publish that label on the SAME basis, at the SAME
//      value. Two ways to fail: the page states that basis and disagrees
//      (one label, two values), or the page never states that basis at all
//      (the index is quoting a measurement its own detail page does not
//      make).
//   e3 VACUITY — every declared surface must contribute figures, and the set
//      must actually join to program pages. A leg that silently matches
//      nothing is the failure mode that let this ship in the first place.
//
// NOTE ON SCOPE: /years/ is not listed. Its grid is fetched and rendered
// client-side from years_matrix.json, so its static HTML holds no figures for
// a static gate to read. Gate 24's yearsmatrix leg recomputes that payload
// against the parquet lake instead, which is the stronger check for it.
function runCrossPageLeg(
  { indexSurfaces, indexFigures, indexIssues, pageFigures },
  errors,
  notes,
) {
  if (indexSurfaces.length === 0) {
    errors.push(
      "leg e is VACUOUS: none of the declared cross-page index surfaces was built " +
        `(${CROSS_PAGE_INDEXES.map((c) => c.label).join(", ")})`,
    );
    return;
  }

  // e1 — structure
  if (indexIssues.length > 0) {
    errors.push(
      `leg e1 index basis declaration: ${indexIssues.length} problem(s) (first ${MAX_LISTED}):`,
    );
    for (const i of indexIssues.slice(0, MAX_LISTED)) errors.push(`  ${i}`);
    if (indexIssues.length > MAX_LISTED)
      errors.push(`  ... and ${indexIssues.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg e1: ${indexSurfaces.length} index surface(s) declare basis, fy and measure — visibly ✓`,
    );
  }

  // e2 — agreement with the page the row links to
  // Counts are totals; the arrays hold only what is printed. (The first cut
  // capped both together, so a full-column regression reported "20" — the cap
  // — rather than the real number, which is exactly the kind of understated
  // failure a gate must not produce about itself.)
  const disagreements = [];
  const missingBasis = [];
  let disagreementCount = 0;
  let missingBasisCount = 0;
  let joined = 0;
  for (const f of indexFigures) {
    const key = `${f.entity}|${f.fy}|${f.measure}`;
    const onPage = pageFigures.get(key);
    // No program page for this entity, or the page publishes nothing under
    // this label: not a contradiction, so not this leg's business.
    if (!onPage || onPage.length === 0) continue;
    joined++;
    const sameBasis = onPage.filter((p) => p.basis === f.basis);
    if (sameBasis.length === 0) {
      missingBasisCount++;
      if (missingBasis.length < MAX_LISTED) {
        missingBasis.push(
          `${f.where}: ${f.entity} FY${f.fy} ${f.measure} = ${f.text} on basis "${f.basis}", ` +
            `but /program/${f.entity}/ publishes that label only on ` +
            `[${[...new Set(onPage.map((p) => p.basis))].join(", ")}]`,
        );
      }
      continue;
    }
    if (!sameBasis.some((p) => valuesAgree(p.value, f.value))) {
      disagreementCount++;
      if (disagreements.length < MAX_LISTED) {
        disagreements.push(
          `${f.where}: ${f.entity} FY${f.fy} ${f.measure} (basis ${f.basis}) reads ${f.text}, ` +
            `but /program/${f.entity}/ reads ` +
            `[${sameBasis.map((p) => p.text).join(", ")}] under the same label and basis`,
        );
      }
    }
  }

  if (disagreementCount > 0) {
    errors.push(
      `leg e2 cross-page collision: ${disagreementCount} index figure(s) contradict the ` +
        `program page they link to, under one label and one declared basis (first ${MAX_LISTED}):`,
    );
    for (const d of disagreements) errors.push(`  ${d}`);
    if (disagreementCount > disagreements.length)
      errors.push(`  ... and ${disagreementCount - disagreements.length} more`);
  }
  if (missingBasisCount > 0) {
    errors.push(
      `leg e2 undeclared basis: ${missingBasisCount} index figure(s) claim a basis their own ` +
        `program page never publishes for that label (first ${MAX_LISTED}):`,
    );
    for (const m of missingBasis) errors.push(`  ${m}`);
    if (missingBasisCount > missingBasis.length)
      errors.push(`  ... and ${missingBasisCount - missingBasis.length} more`);
  }

  // e3 — vacuity
  if (indexFigures.length === 0) {
    errors.push(
      "leg e is VACUOUS: the declared index surfaces contributed 0 basis-carrying figures",
    );
  } else if (joined === 0) {
    errors.push(
      `leg e is VACUOUS: ${indexFigures.length} index figure(s) read, but not one joined to a ` +
        `program page — the (entity, fy, measure) keys do not line up, so nothing is being compared`,
    );
  } else if (disagreementCount === 0 && missingBasisCount === 0) {
    notes.push(
      `leg e2: ${joined} of ${indexFigures.length} index figures joined to their program page; ` +
        `every one agrees under one label and one basis ✓`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG (d) — ENTITY TOTALS (PM Sprint 3, Task 5b)
// ─────────────────────────────────────────────────────────────────────────────
//
// The headline figure on /companies/ and all 200 /company/{slug}/ pages.  Two
// checks, because the shipped defect passed the first kind of scrutiny and
// failed the second:
//
//   d1 REPRODUCTION — every entity total_obligation citation publishes a
//      query_body next to its recorded_value.  Run it.  They must agree.
//      This is the site's core contract; for these 228 facts it was false.
//
//   d2 DECLARED-WINDOW TRUTH — the lesson, and the half worth having.  The
//      crosswalk behind those totals was built before the FY2020-FY2026
//      partitions were ingested, so it summed FY2017-FY2019 and was perfectly
//      self-consistent while every page labelled it "FY2017–FY2026".  A stale
//      derived artifact does not contradict itself; it contradicts its label.
//      So: find the leading FY window over which the crosswalk's own total
//      column reproduces the lake, and require it to END at the declared
//      fy_max.  Any earlier end means the pages name a period the numbers do
//      not cover.
//
//   d3 FRESHNESS — the cheap version of d2 that would have caught this on day
//      one: a derived parquet older than a partition it reads is stale by
//      construction.  Advisory in the sense that d2 is the real proof, but it
//      fails the gate too, because there is no benign reason for it.
function runEntityTotalsLeg(errors, notes) {
  const script = path.join(__dirname, "entitytotals-recompute.py");
  if (!fs.existsSync(script)) {
    errors.push(`leg d: recompute helper missing at ${script}`);
    return;
  }
  const res = spawnSync("uv", ["run", "python", script], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    errors.push(
      `leg d: entitytotals-recompute.py failed (status ${res.status}): ` +
        `${(res.stderr || res.error?.message || "").slice(0, 400)}`,
    );
    return;
  }
  let truth;
  try {
    truth = JSON.parse(res.stdout);
  } catch (e) {
    errors.push(`leg d: recompute produced non-JSON output (${e.message})`);
    return;
  }
  if (truth.__error__) {
    errors.push(`leg d: recompute could not run — ${truth.__error__}`);
    return;
  }

  const { fy_min: fyMin, fy_max: fyMax, label } = truth.declared;
  const usd = (n) =>
    n === null || n === undefined ? "null" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  // d0 — the projection the statements ran against must be the warehouse
  for (const [table, f] of Object.entries(truth.projection_fidelity || {})) {
    if (f.projected_rows !== f.warehouse_rows) {
      errors.push(
        `leg d0: the ${table} projection the query bodies ran against has ` +
          `${f.projected_rows} rows but the warehouse table has ${f.warehouse_rows} — ` +
          `the recompute is not reading the published data`,
      );
    }
    // RELATIVE tolerance, not absolute. The projection is sorted (that is what
    // makes ~1,900 verbatim statements finish in seconds instead of minutes),
    // and summing 40M doubles in a different order lands 9.5 cents away from
    // the same sum in the original order — float addition is not associative.
    // 1e-9 relative is ~$3,900 on this corpus: far below any real divergence
    // (a single dropped partition is billions) and far above the ~2.5e-14
    // reordering noise.
    if (
      f.warehouse_sum !== undefined &&
      Math.abs(f.projected_sum - f.warehouse_sum) >
        Math.abs(f.warehouse_sum) * 1e-9
    ) {
      errors.push(
        `leg d0: the ${table} projection totals ${usd(f.projected_sum)} but the ` +
          `warehouse table totals ${usd(f.warehouse_sum)} (difference ` +
          `${usd(f.projected_sum - f.warehouse_sum)})`,
      );
    }
  }

  // d1 — reproduction, reported per surface (both publish a "sum over
  // entity_xwalk" claim; a failure in either is a figure contradicting its
  // own receipt)
  const failures = truth.reproduce_failures || [];
  const bySurface = truth.n_by_surface || {};
  if (!truth.n_facts) {
    errors.push(
      "leg d1: no entity_xwalk-derived citations found — the entity tier must " +
        "not silently vanish from the citation set",
    );
  } else if (failures.length > 0) {
    const counted = failures.reduce(
      (a, f) => ((a[f.surface] = (a[f.surface] || 0) + 1), a),
      {},
    );
    errors.push(
      `leg d1: ${failures.length} of ${truth.n_facts} entity_xwalk-derived fact(s) ` +
        `do not reproduce — the published query_body disagrees with the published ` +
        `recorded_value (` +
        Object.entries(counted)
          .map(([s, n]) => `${s} ${n}/${bySurface[s] ?? "?"}`)
          .join(", ") +
        `; first ${Math.min(MAX_LISTED, failures.length)}):`,
    );
    for (const f of failures.slice(0, MAX_LISTED)) {
      errors.push(
        `  [${f.surface}] ${f.fact_id} ${f.family_key ?? "?"}: page says ` +
          `${usd(f.recorded_value)}, its own query returns ` +
          `${f.error ? `ERROR ${f.error}` : usd(f.query_value)}`,
      );
    }
    if (failures.length > MAX_LISTED) {
      errors.push(`  ... and ${failures.length - MAX_LISTED} more`);
    }
  } else {
    notes.push(
      `leg d1: all ${truth.n_facts} entity_xwalk-derived facts reproduce from their ` +
        `own query_body (entity ${bySurface.entity ?? 0}, feed ${bySurface.feed ?? 0}) ✓`,
    );
  }

  // d2 — declared-window truth
  const end = truth.xwalk_window_end;
  if (end === null || end === undefined) {
    const near = truth.closest_window_end;
    errors.push(
      `leg d2: the entity crosswalk's total_obligation column matches NO leading ` +
        `fiscal-year window in the declared range ${label} — closest is ` +
        `FY${fyMin}–FY${near} (off by ` +
        `${(100 * (truth.closest_window_rel_error ?? 0)).toFixed(2)}%). ` +
        `The crosswalk totals ${usd(truth.xwalk_total)}; the lake over ${label} ` +
        `totals ${usd(truth.window_fit?.[String(fyMax)])}. Every /company/ page ` +
        `labels these figures ${label}.`,
    );
  } else if (end !== fyMax) {
    errors.push(
      `leg d2: the entity crosswalk covers FY${fyMin}–FY${end}, but every ` +
        `/company/ page labels its total ${label}. The figures are internally ` +
        `consistent and wrong about their period: crosswalk ${usd(truth.xwalk_total)} ` +
        `vs ${usd(truth.window_fit?.[String(fyMax)])} over the declared window ` +
        `(${(truth.window_fit?.[String(fyMax)] / truth.xwalk_total).toFixed(2)}×). ` +
        `Rebuild the crosswalk (govbudget entity-graph) — do not relabel the page.`,
    );
  } else {
    notes.push(
      `leg d2: the crosswalk's own totals reproduce the lake over exactly ` +
        `FY${fyMin}–FY${end}, the window the pages label (${label}) ✓`,
    );
  }
  if (truth.lake_fy_max !== undefined && truth.lake_fy_max !== fyMax) {
    errors.push(
      `leg d2: the lake carries awards through FY${truth.lake_fy_max} but ` +
        `site_meta declares ${label} — the label is derived, so a disagreement ` +
        `means the export and the lake have drifted`,
    );
  }

  // d3 — freshness
  const fresh = truth.freshness || {};
  const newest = fresh.newest_input || {};
  if (fresh.xwalk_mtime && newest.mtime && fresh.xwalk_mtime < newest.mtime) {
    const iso = (t) => new Date(t * 1000).toISOString();
    errors.push(
      `leg d3: data/parquet/entities/entity_xwalk.parquet was written ` +
        `${iso(fresh.xwalk_mtime)} but ${newest.path} — a partition it reads — ` +
        `was written ${iso(newest.mtime)}. A derived artifact older than its ` +
        `inputs is stale by construction; rebuild it.`,
    );
  } else if (fresh.xwalk_mtime) {
    notes.push(
      `leg d3: entity_xwalk.parquet is newer than every award partition it reads ✓`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG (f) — EXHIBIT AGREEMENT (#48)
// ─────────────────────────────────────────────────────────────────────────────
//
// The shipped defect: site/src/lib/basis.ts hardcoded BASIS_LABEL.toa =
// "P-1 TOA" for every TOA figure on the site. P-1 is the procurement
// exhibit; R-1 is RDT&E. Measured against the shipped warehouse:
// programs.json carries exhibit_family "rdte" on 1,077 of 1,741 corpus
// programs and "procurement" on the other 664 — so 62% of program pages were
// stamping a procurement label on an RDT&E line, while their own citation
// records (workbook `sheet`) said "Exhibit R-1" and the /program/ page's own
// budget-line table correctly grouped rows under "Exhibit R-1".
//
// This leg reads programs.json's exhibit_family (the ground truth the fix
// threads through as `exhibitFamily`) and walks every rendered basis-chip
// span on every /program/{pe}/ page, checking that a single-exhibit claim
// (starts "R-1 " or "P-1 ") matches the page's own row.
/** programs.json's pe_bli → exhibit_family, or null if the file is missing. */
function readExhibitFamilyMap() {
  const p = path.join(repoRoot, "data", "site", "json", "programs.json");
  if (!fs.existsSync(p)) return null;
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const map = new Map();
  for (const row of rows) {
    if (row && typeof row.pe_bli === "string") {
      map.set(row.pe_bli, row.exhibit_family ?? null);
    }
  }
  return map;
}

const MIN_CHIPS_RESOLVED = 100;

function runExhibitAgreementLeg(pages, errors, notes) {
  const exhibitByPe = readExhibitFamilyMap();
  if (!exhibitByPe) {
    errors.push(
      "leg f exhibit agreement: could not read data/site/json/programs.json — " +
        "cannot verify a single chip against the corpus's own exhibit_family",
    );
    return;
  }

  let resolved = 0;
  let agreed = 0;
  let rowsUnlabelled = 0;
  const mismatches = [];
  const unexplainedMixed = [];

  for (const { pe, htmlPath } of pages) {
    const relPath = path.relative(outDir, htmlPath);
    let root;
    try {
      root = parse(fs.readFileSync(htmlPath, "utf8"), { comment: false });
    } catch {
      continue; // already reported by the leg (a) read loop above
    }
    const rowExhibit = exhibitByPe.get(pe);

    for (const el of root.querySelectorAll("span")) {
      if (!isBasisChipClassName(el.getAttribute("class"))) continue;
      const chipText = (el.text || "").trim();
      const claim = chipExhibitClaim(chipText);
      if (claim == null) continue; // not a TOA chip (e.g. "P-40 detail")
      resolved++;

      if (claim === "mixed") {
        const exempt =
          hasAncestorWith(el, (a) => a.getAttribute("data-reconciliation") != null) ||
          hasAncestorWith(el, (a) => a.getAttribute("data-basis-declared") != null);
        if (!exempt) {
          unexplainedMixed.push(
            `${relPath}: chip "${chipText}" renders the both-exhibits form with no ` +
              `[data-reconciliation] or [data-basis-declared] ancestor — a single ` +
              `program page has ONE exhibit (this one is "${rowExhibit ?? "unlabelled"}") ` +
              `and should be able to name it`,
          );
        }
        continue;
      }

      if (rowExhibit == null) {
        rowsUnlabelled++; // e.g. a rollup-tier page absent from programs.json
        continue;
      }
      if (claim !== rowExhibit) {
        mismatches.push(
          `${relPath}: chip reads "${chipText}" (claims ${claim}) but programs.json's ` +
            `exhibit_family for pe_bli "${pe}" is "${rowExhibit}"`,
        );
      } else {
        agreed++;
      }
    }
  }

  if (mismatches.length > 0) {
    errors.push(
      `leg f1 exhibit agreement: ${mismatches.length} basis chip(s) name an exhibit ` +
        `that disagrees with their own program's exhibit_family (first ${MAX_LISTED}):`,
    );
    for (const m of mismatches.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (mismatches.length > MAX_LISTED)
      errors.push(`  ... and ${mismatches.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg f1: ${agreed} single-exhibit basis chips agree with their program's ` +
        `exhibit_family (${rowsUnlabelled} chip(s) on rows absent from programs.json skipped) ✓`,
    );
  }

  if (unexplainedMixed.length > 0) {
    errors.push(
      `leg f2 unexplained mixed chip: ${unexplainedMixed.length} chip(s) render ` +
        `"P-1/R-1 TOA" on a single-program page outside any declared-aggregate or ` +
        `reconciliation context (first ${MAX_LISTED}):`,
    );
    for (const m of unexplainedMixed.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (unexplainedMixed.length > MAX_LISTED)
      errors.push(`  ... and ${unexplainedMixed.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg f2: no unexplained "P-1/R-1" chip on any program page ✓`);
  }

  if (resolved < MIN_CHIPS_RESOLVED) {
    errors.push(
      `leg f3 is VACUOUS: only ${resolved} basis chip(s) resolved to an exhibit claim ` +
        `across ${pages.length} program pages (need ≥ ${MIN_CHIPS_RESOLVED}) — the chip ` +
        `selector or exhibitFamily threading is not matching the built pages`,
    );
  } else {
    notes.push(`leg f3: ${resolved} basis chips resolved — non-vacuous ✓`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG (g) — FY2026 DISCRETIONARY/RECONCILIATION SPLIT (#50)
// ─────────────────────────────────────────────────────────────────────────────
//
// The shipped defect: the FY2026 "Request" figure is disc + reconciliation
// with no visible seam — $89.01B of the $385.27B FY2026 corpus total is
// one-time reconciliation-bill money, folded silently into every "Request"
// label and every FY25→FY26 percentage change. Long Range Kill Chains (PE
// 1203154SF) — the #1 row on /programs/ and the #1 homepage item — headlined
// "+3052.9%" on $1,916k of actual discretionary money, a like-for-like
// -99.2%. Both numbers are true; only the unlabelled one was a false claim.
//
// This leg reads EVERY program page's own program_details/{pe}.json sidecar
// (the ground truth export_site.py's build_fy26_split threads through as
// fy26_split) and checks the corresponding BUILT PAGE:
//
//   g1 CHIP PRESENCE — any page whose sidecar reports fy26_split.recon_share
//      > 0 must render a [data-fy26-recon-chip] marker (program-figures.tsx's
//      Fy26SplitNote, beside the FY2026 card). A true reconciliation share
//      with no rendered disclosure is exactly the defect.
//   g2 CHANGE ACCOMPANIMENT — a page renders a COMBINED FY25→FY26 percentage
//      (the "change" summary card's parenthetical, sourced from the same
//      sidecar's summary.cards) on a reconciliation-affected program (both
//      recon_share > 0 and the sidecar's own disc_pct_change is computable)
//      must ALSO render [data-fy26-disc-pct-change] — the discretionary-only,
//      like-for-like rate. The combined change is never deleted (it is true);
//      it must not stand alone, unlabelled.
//   g3 NON-VACUITY — fewer than 100 resolved (recon_share > 0) program pages
//      FAILS: the sidecar field or the chip selector silently matching
//      nothing is exactly the failure mode a number↔citation-only gate suite
//      let ship past it in the first place.
//
// #54 WIDENED this leg past /program/*\/: g1-g3 below scan program pages
// only, which is exactly the scope gap #54 was filed to close (a yoy_swing
// /feed/ card headlines the SAME combined percentage, unlabelled). See
// runFeedFy26SplitLeg (g4a/g4b) below, called separately from runBasisGate
// — kept as its own function rather than folded into this one because its
// ground truth (feed.json) and its page (out/feed/index.html) are both
// singular, unlike the per-page loop g1-g3 run.
const FY26_SPLIT_MIN_RESOLVED = 100;

function runFy26SplitLeg(pages, errors, notes) {
  let resolved = 0;
  const missingChip = [];
  const missingDiscRate = [];

  for (const { pe, htmlPath } of pages) {
    const sidecarPath = path.join(
      repoRoot, "data", "site", "json", "program_details", `${pe}.json`,
    );
    if (!fs.existsSync(sidecarPath)) continue;
    let sidecar;
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch (e) {
      missingChip.push(`/program/${pe}/: sidecar failed to parse (${e.message})`);
      continue;
    }
    const split = sidecar.fy26_split;
    if (!split || !(split.recon_share > 0)) continue;
    resolved++;

    const relPath = path.relative(outDir, htmlPath);
    let root;
    try {
      root = parse(fs.readFileSync(htmlPath, "utf8"), { comment: false });
    } catch (e) {
      missingChip.push(`${relPath}: failed to parse (${e.message})`);
      continue;
    }

    // g1 — the chip
    if (!root.querySelector("[data-fy26-recon-chip]")) {
      missingChip.push(
        `/program/${pe}/: sidecar fy26_split.recon_share = ` +
          `${(split.recon_share * 100).toFixed(1)}% but the built page renders ` +
          `no [data-fy26-recon-chip]`,
      );
    }

    // g2 — the combined change, if rendered, must not stand alone
    const changeCard = (sidecar.summary?.cards || []).find(
      (c) => c.key === "change",
    );
    if (
      changeCard && changeCard.pct != null && split.disc_pct_change != null &&
      !root.querySelector("[data-fy26-disc-pct-change]")
    ) {
      missingDiscRate.push(
        `/program/${pe}/: renders a combined FY25→FY26 change of ` +
          `${changeCard.pct}% with no [data-fy26-disc-pct-change] disclosure ` +
          `of the discretionary-only rate (${split.disc_pct_change}%)`,
      );
    }
  }

  if (missingChip.length > 0) {
    errors.push(
      `leg g1 fy26-split chip: ${missingChip.length} program page(s) with ` +
        `recon_share > 0 render no reconciliation chip (first ${MAX_LISTED}):`,
    );
    for (const m of missingChip.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (missingChip.length > MAX_LISTED)
      errors.push(`  ... and ${missingChip.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg g1: every program page with fy26_split.recon_share > 0 renders a ` +
        `[data-fy26-recon-chip] ✓`,
    );
  }

  if (missingDiscRate.length > 0) {
    errors.push(
      `leg g2 fy26-split discretionary rate: ${missingDiscRate.length} program ` +
        `page(s) render a combined FY25→FY26 change with no discretionary-rate ` +
        `disclosure (first ${MAX_LISTED}):`,
    );
    for (const m of missingDiscRate.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (missingDiscRate.length > MAX_LISTED)
      errors.push(`  ... and ${missingDiscRate.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg g2: every rendered combined FY25→FY26 change on a reconciliation` +
        `-affected program is accompanied by the discretionary rate ✓`,
    );
  }

  if (resolved < FY26_SPLIT_MIN_RESOLVED) {
    errors.push(
      `leg g3 is VACUOUS: only ${resolved} program page(s) resolved ` +
        `fy26_split.recon_share > 0 (need ≥ ${FY26_SPLIT_MIN_RESOLVED}) — the ` +
        `sidecar field or the chip selector is not matching the built pages`,
    );
  } else {
    notes.push(
      `leg g3: ${resolved} FY2026 figures resolved with recon_share > 0 — ` +
        `non-vacuous ✓`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG (g4) — WIDENED PAST /program/*\/ TO /feed/ (#54)
// ─────────────────────────────────────────────────────────────────────────────
//
// g1-g3 above enforce #50's disclosure on /program/*\/ only. #54 named the
// gap left open by that scoping: the SAME combined FY25→FY26 percentage a
// yoy_swing feed card headlines — Long Range Kill Chains' own +3052.9% is
// the #1 /feed/ card — still rendered there unlabelled, even once its own
// program page explained the split. This leg widens leg (g) past
// /program/*\/ to /feed/, exactly as the ROADMAP entry instructs ("the fix
// is to widen leg (g) past /program/*\/ once those surfaces carry the
// split") — a new sub-leg under the SAME letter, not a new one (checked for
// collisions: g/g1/g2/g3 are the only occupants of this space).
//
// Ground truth is data/site/json/feed.json itself, not program_details
// sidecars — a yoy_swing event can reference a pe_bli with NO program page
// at all (fct_budget_trajectory covers more pe_blis than dim_programs), so
// the sidecar is not guaranteed to exist for every qualifying card. feed.json
// cards.*.fy26_split, threaded by _emit_feed_sidecar (#54, from the SAME
// fy26_split_by_pe index g1-g3 already trust), is authoritative for what
// SHOULD render. A qualifying card is a yoy_swing event whose
// fy26_split.has_reconciliation is true.
//
//   g4a CHIP PRESENCE — every qualifying card's [data-feed-card] wrapper
//       (matched via its headline's data-xml-path="site:feed/yoy_swing/
//       {pe_bli}", which carries the raw pe_bli regardless of any
//       title-swap the display layer does) must render a
//       [data-fy26-recon-chip] — the SAME marker g1 requires on
//       /program/*\/, from the SAME <Fy26SplitNote> component (exported
//       from program-figures.tsx and imported into feed/page.tsx rather
//       than re-implemented, so the wording cannot drift).
//   g4b NON-VACUITY — fewer than FEED_FY26_SPLIT_MIN_RESOLVED (20; the live
//       corpus carries 31 measured 2026-08-19) qualifying cards actually
//       located on the built /feed/ page FAILS — the same "field or
//       selector silently matches nothing" failure mode g3 guards against,
//       applied to this surface. This is what proves the leg fails on the
//       pre-fix build: before _emit_feed_sidecar threads fy26_split,
//       feed.json's cards carry no such field, qualifying is empty, and 0
//       < 20 fails honestly rather than vacuously passing.
const FEED_FY26_SPLIT_MIN_RESOLVED = 20;

function runFeedFy26SplitLeg(errors, notes) {
  const feedJsonPath = path.join(repoRoot, "data", "site", "json", "feed.json");
  const feedHtmlPath = path.join(outDir, "feed", "index.html");

  if (!fs.existsSync(feedJsonPath)) {
    errors.push(
      `leg g4: ${path.relative(repoRoot, feedJsonPath)} not found — export the site first`,
    );
    return;
  }
  if (!fs.existsSync(feedHtmlPath)) {
    errors.push("leg g4: out/feed/index.html not found — build the site first");
    return;
  }

  let feedJson;
  try {
    feedJson = JSON.parse(fs.readFileSync(feedJsonPath, "utf8"));
  } catch (e) {
    errors.push(`leg g4: feed.json failed to parse (${e.message})`);
    return;
  }

  const qualifying = (feedJson.cards || []).filter(
    (c) =>
      c.event_type === "yoy_swing" && c.pe_bli && c.fy26_split?.has_reconciliation,
  );

  let root;
  try {
    root = parse(fs.readFileSync(feedHtmlPath, "utf8"), { comment: false });
  } catch (e) {
    errors.push(`leg g4: out/feed/index.html failed to parse (${e.message})`);
    return;
  }

  const cardEls = root.querySelectorAll("[data-feed-card]");
  let resolved = 0;
  const missing = [];

  for (const card of qualifying) {
    const headlineSel = `[data-xml-path="site:feed/yoy_swing/${card.pe_bli}"]`;
    const cardEl = cardEls.find((el) => el.querySelector(headlineSel));
    if (!cardEl) {
      missing.push(
        `${card.pe_bli}: feed.json carries a qualifying yoy_swing card but no ` +
          `/feed/ [data-feed-card] matches its headline's data-xml-path`,
      );
      continue;
    }
    resolved++;
    if (!cardEl.querySelector("[data-fy26-recon-chip]")) {
      missing.push(
        `${card.pe_bli}: feed.json fy26_split.recon_share = ` +
          `${(card.fy26_split.recon_share * 100).toFixed(1)}% but its /feed/ ` +
          `card renders no [data-fy26-recon-chip]`,
      );
    }
  }

  if (missing.length > 0) {
    errors.push(
      `leg g4 /feed/ fy26-split disclosure: ${missing.length} yoy_swing card(s) ` +
        `whose PE carries reconciliation money render no disclosure on /feed/ ` +
        `(first ${MAX_LISTED}):`,
    );
    for (const m of missing.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (missing.length > MAX_LISTED)
      errors.push(`  ... and ${missing.length - MAX_LISTED} more`);
  } else if (resolved > 0) {
    notes.push(
      `leg g4a: every qualifying /feed/ yoy_swing card renders the ` +
        `[data-fy26-recon-chip] disclosure ✓`,
    );
  }

  if (resolved < FEED_FY26_SPLIT_MIN_RESOLVED) {
    errors.push(
      `leg g4b is VACUOUS: only ${resolved} qualifying /feed/ yoy_swing card(s) ` +
        `resolved (need ≥ ${FEED_FY26_SPLIT_MIN_RESOLVED}; feed.json carries ` +
        `${qualifying.length} qualifying cards total) — the sidecar field or ` +
        `the card-matching selector is not matching the built page`,
    );
  } else {
    notes.push(
      `leg g4b: ${resolved} /feed/ yoy_swing cards resolved with reconciliation ` +
        `money — non-vacuous ✓`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG (h) — ACCOUNT-COLLISION (#56)
// ─────────────────────────────────────────────────────────────────────────────
//
// The shipped defect: /program/3010/ rendered $2.62B under the title
// "Shipboard Tactical Communications" (a $20.9M Other Procurement, Navy
// line) — the $2.62B was LPD Flight II's Shipbuilding & Conversion, Navy
// reconciliation funding, fused into the same row because '3010' happens to
// be BOTH accounts' pe_bli/BLI code. Every constituent cell was correctly
// cited and the row's own arithmetic was internally consistent (a genuine
// SUM of two real cited numbers) — no existing basis-gate leg is within-row
// arithmetic and would ever see this: it is a defect in the GROUPING KEY,
// not a number that disagrees with its own citation.
//
// This leg: no rendered program row or program page may aggregate figures
// whose citation records name more than one account_title. Concretely, a
// program's own budget_lines already carry account_title per row (each row
// is correctly single-account, always was — the defect was only ever in
// the AGGREGATE cards built on top of them). For every program page whose
// own budget_lines span >1 distinct account_title within a single
// amount_type (a same-moment collision — see dbt/tests/
// assert_program_key_unique.sql for why this is the right grain, not
// (pe_bli, fiscal_year) alone, which would flag 1045/COLUMBIA Class
// Submarine's cross-time account rename as a false positive):
//
//   h1 NO FUSED CARD — every numeric summary card (fy2024/fy2025/fy2026)
//      whose own (fy, measure) maps to a colliding amount_type must equal
//      ONE account's own contribution (recomputed from budget_lines),
//      never their sum. This is the recompute the shipped defect fails:
//      pre-fix, fct_budget_trajectory summed both accounts (3010's
//      fy2024_actuals card read 528,574 — neither account's real figure).
//   h2 NO FUSED-SOURCE DATASET — no such card may cite dataset
//      "fct_decade_series": that mart is not account-scoped (a separate
//      Phase 5E model spanning ten PB editions, out of this fix's blast
//      radius) and would silently re-serve the fused figure even after
//      fct_budget_trajectory itself is corrected.
//
// Read from the program_details/{pe}.json sidecar rather than parsed
// [data-cite-fact-id] chains: citations.json's own workbook records carry
// sheet/cell provenance but no account_title field, so the sidecar (which
// already threads account_title onto every budget_lines row for the page)
// is the more precise instrument — and it is exactly what page.tsx renders
// the card values FROM, so a mismatch caught here is a mismatch the page
// will show.
//
// Non-vacuity: fail if fewer than 100 program pages resolve a sidecar (this
// leg must actually walk the corpus, not just the ~6 known collision
// pages — the whole point is catching a NEW collision nobody has looked
// for yet).

const MIN_ACCOUNT_PAGES_RESOLVED = 100;

// summary card key → the budget_lines amount_type it is sourced from when
// the card's dataset is fct_budget_trajectory or fct_program_trajectory —
// MIRRORS _TRAJ_METRIC_BY_SLOT in src/govbudget/export_site.py. Change one,
// change both.
const CARD_KEY_TO_AMOUNT_TYPE = {
  fy2024: "fy_2024_actuals",
  fy2025: "fy_2025_total",
  fy2026: "fy_2026_total",
};

function runAccountCollisionLeg(pages, errors, notes) {
  let resolved = 0;
  const fusedCardMismatches = [];
  const fusedSourceDataset = [];

  for (const { pe } of pages) {
    const sidecarPath = path.join(
      repoRoot, "data", "site", "json", "program_details", `${pe}.json`,
    );
    if (!fs.existsSync(sidecarPath)) continue;
    let sidecar;
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch {
      continue;
    }
    resolved++;

    const budgetLines = Array.isArray(sidecar.budget_lines) ? sidecar.budget_lines : [];
    // amount_type → account_title → summed amount_thousands
    const perSlot = new Map();
    for (const bl of budgetLines) {
      if (!bl || bl.account_title == null || bl.amount_type == null) continue;
      if (typeof bl.amount_thousands !== "number") continue;
      if (!perSlot.has(bl.amount_type)) perSlot.set(bl.amount_type, new Map());
      const m = perSlot.get(bl.amount_type);
      m.set(bl.account_title, (m.get(bl.account_title) || 0) + bl.amount_thousands);
    }
    const collisionSlots = new Set(
      [...perSlot.entries()].filter(([, m]) => m.size > 1).map(([at]) => at),
    );
    if (collisionSlots.size === 0) continue;

    const cards = Array.isArray(sidecar.summary?.cards) ? sidecar.summary.cards : [];
    for (const card of cards) {
      const amountType = CARD_KEY_TO_AMOUNT_TYPE[card.key];
      if (!amountType || !collisionSlots.has(amountType)) continue;

      // h2 — a card on a colliding slot may never cite the non-account-
      // scoped mart, no matter what value it holds.
      if (card.dataset === "fct_decade_series") {
        fusedSourceDataset.push(
          `/program/${pe}/: summary card "${card.key}" cites dataset ` +
            `"fct_decade_series" on a page whose own budget_lines span >1 ` +
            `account_title for ${amountType} (${[...perSlot.get(amountType).keys()].join(" | ")})`,
        );
        continue;
      }
      if (card.dataset !== "fct_budget_trajectory" && card.dataset !== "fct_program_trajectory") {
        continue; // a budget_lines/jbook_details single-row card is already single-account
      }
      if (typeof card.value !== "number") continue;

      // h1 — the card's value must equal ONE account's own contribution.
      const perAccount = perSlot.get(amountType);
      const matchesOne = [...perAccount.values()].some(
        (v) => Math.abs(v - card.value) < 0.5,
      );
      if (!matchesOne) {
        const breakdown = [...perAccount.entries()]
          .map(([acct, v]) => `${acct}=${v}`)
          .join(", ");
        fusedCardMismatches.push(
          `/program/${pe}/: summary card "${card.key}" = ${card.value} ` +
            `(dataset ${card.dataset}) matches NEITHER account's own ` +
            `${amountType} figure (${breakdown}) — looks like a cross-account sum`,
        );
      }
    }
  }

  if (fusedCardMismatches.length > 0) {
    errors.push(
      `leg h1 account-collision fused card: ${fusedCardMismatches.length} summary ` +
        `card(s) on a shared-key program page aggregate figures across >1 account ` +
        `(first ${MAX_LISTED}):`,
    );
    for (const m of fusedCardMismatches.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (fusedCardMismatches.length > MAX_LISTED)
      errors.push(`  ... and ${fusedCardMismatches.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg h1: every summary card on a shared-key program page matches exactly ` +
        `one account's own figure — no cross-account sum ✓`,
    );
  }

  if (fusedSourceDataset.length > 0) {
    errors.push(
      `leg h2 account-collision fused-source dataset: ${fusedSourceDataset.length} ` +
        `summary card(s) on a shared-key program page cite fct_decade_series, which ` +
        `is not account-scoped (first ${MAX_LISTED}):`,
    );
    for (const m of fusedSourceDataset.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (fusedSourceDataset.length > MAX_LISTED)
      errors.push(`  ... and ${fusedSourceDataset.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg h2: no shared-key program page cites fct_decade_series ✓`);
  }

  if (resolved < MIN_ACCOUNT_PAGES_RESOLVED) {
    errors.push(
      `leg h3 is VACUOUS: only ${resolved} program page(s) resolved a ` +
        `program_details sidecar (need ≥ ${MIN_ACCOUNT_PAGES_RESOLVED}) — the ` +
        `sidecar path is not matching the built pages`,
    );
  } else {
    notes.push(`leg h3: ${resolved} program pages resolved — non-vacuous ✓`);
  }

  runCoverageDisclosureLeg(errors, notes);
}

// #56 leg h4 — the disclosure must be COMPLETE, not just "currently
// nothing is undisclosed". Re-keying dim_programs / fct_budget_trajectory
// to stop FUSING two accounts' money (h1/h2/h3 above) has a silent failure
// mode of its own: a program can simply be DROPPED from the published
// corpus instead of fused — h1/h2/h3 would report clean (there is no fused
// card to catch), the index total honestly shrinks (backlog #49's own
// coverage math), but the specific program that vanished is never named
// anywhere a reader can see. Ten real programs (Tomahawk, LPD Flight II,
// Naval Strike Missile, and seven more — $5.74B combined) shipped exactly
// this way in an earlier build of this fix.
//
// Delegates the actual recompute to a Python helper (same pattern as leg d's
// entitytotals-recompute.py): this needs to read fct_budget_lines directly
// from the DUCKDB WAREHOUSE, independent of programs.json's and
// programs_excluded.json's own upstream reasoning — reading only those two
// shipped artifacts (as plain membership sets, never their logic) would make
// the gate tautological, confirming only that the exporter agrees with
// itself. Non-vacuity requires resolving all 10 known #56 keys — the
// disclosure completeness this leg exists to prove, not just an absence of
// counterexamples.
const KNOWN_COLLISION_KEYS_H4 = [
  "0145", "1350", "2101", "2210", "2292", "3010", "3050", "3215", "3302", "4217",
];

function runCoverageDisclosureLeg(errors, notes) {
  const script = path.join(__dirname, "programs-excluded-recompute.py");
  if (!fs.existsSync(script)) {
    errors.push(`leg h4: recompute helper missing at ${script}`);
    return;
  }
  const res = spawnSync("uv", ["run", "python", script], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    errors.push(
      `leg h4: programs-excluded-recompute.py failed (status ${res.status}): ` +
        `${(res.stderr || res.error?.message || "").slice(0, 400)}`,
    );
    return;
  }
  let truth;
  try {
    truth = JSON.parse(res.stdout);
  } catch (e) {
    errors.push(`leg h4: recompute produced non-JSON output (${e.message})`);
    return;
  }
  if (truth.__error__) {
    errors.push(`leg h4: recompute could not run — ${truth.__error__}`);
    return;
  }

  const undisclosed = truth.undisclosed || [];
  if (undisclosed.length > 0) {
    errors.push(
      `leg h4 coverage disclosure: ${undisclosed.length} program(s) with FY2026 ` +
        `money in fct_budget_lines are absent from programs.json AND not named ` +
        `in programs_excluded.json (first ${MAX_LISTED}):`,
    );
    for (const u of undisclosed.slice(0, MAX_LISTED)) {
      errors.push(
        `  ${u.pe_bli} "${u.title}" ($${Math.round(u.amount_thousands).toLocaleString()}K) — ${u.why}`,
      );
    }
    if (undisclosed.length > MAX_LISTED)
      errors.push(`  ... and ${undisclosed.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg h4: every program with FY2026 money absent from programs.json is ` +
        `named in programs_excluded.json (${truth.n_disclosed} disclosed, ` +
        `${truth.n_universe_pairs} universe pairs checked) ✓`,
    );
  }

  const resolvedKnown = new Set(truth.resolved_known_keys || []);
  const missingKnown = KNOWN_COLLISION_KEYS_H4.filter((k) => !resolvedKnown.has(k));
  if (missingKnown.length > 0) {
    errors.push(
      `leg h4 is VACUOUS on the known #56 set: ${missingKnown.length}/` +
        `${KNOWN_COLLISION_KEYS_H4.length} known collision key(s) were not ` +
        `independently confirmed disclosed by the recompute: ${missingKnown.join(", ")} ` +
        `— the check is not actually exercising the case it exists to catch`,
    );
  } else {
    notes.push(
      `leg h4: non-vacuous — all ${KNOWN_COLLISION_KEYS_H4.length} known #56 ` +
        `collision keys independently confirmed correctly disclosed ✓`,
    );
  }
}

// LEG (i) — AGENCY RECONCILIATION DISCLOSURE (#59; letter checked free
// against a/b/c/d/e/f/g/h[1-4] above before use)
// ─────────────────────────────────────────────────────────────────────────────
//
// Program pages already disclose the P-40-vs-TOA divergence per program
// (ReconciliationStrip, [data-reconciliation]; the fully_reconciled badge
// in program-header.tsx). Agency rollups sum those same P-40 figures
// (agencies.json's fy2024_total_millions, rendered on /agency/{org}/) and
// said nothing — the same divergence, netted across an org's programs,
// undisclosed at the level a reader actually lands on first (a program
// page is usually reached FROM the agency page, not before it).
//
//   i1 COMPLETENESS — every /agency/{org}/ page whose sidecar
//      (data/site/json/agencies.json's fy2024_not_reconciled_count) reports
//      ≥1 non-reconciling program must render
//      [data-agency-reconciliation-note], and that marker's own
//      data-not-reconciled-count must equal the sidecar's count — a
//      rendered number that silently drifted from its source would be
//      exactly the "true figure, false label" defect class this sprint
//      exists to close, just relocated into the disclosure itself.
//   i2 NO SPURIOUS RENDER — an org whose sidecar reports 0 (or omits the
//      field) must NOT render the marker: "render it only when the agency
//      actually has a non-reconciling program" is not an honest contract
//      unless it is checked in both directions.
//   i3 NON-VACUITY — fewer than 20 agency pages RESOLVED (built HTML found
//      AND joined to an agencies.json sidecar row) FAILS.
//
//      NOTE ON THE NUMBER (evidence, not a guess): the task brief's own
//      prescribed non-vacuity floor was "20 agency pages" — but read as
//      "20 pages that RENDER the disclosure" it is unsatisfiable by the
//      site's own true data. Confirmed against the shipped build,
//      2026-08-11: only 4 of the 23 agency PAGES (A, F, N, OSD) have any
//      FY2024 P-40-vs-TOA divergence at all — 140 programs, $7,992.573M
//      corpus-wide, dim_programs-scoped (see export_site.py's #59
//      SUBSTITUTION comment; a 5th ORG, DHA, has a phantom gap from two
//      trajectory-only synthesized programs with no dim_programs row, and
//      correctly ships NO /agency/ page at all — so it was never a 5th
//      candidate for this leg to resolve in the first place).
//      Requiring 20 disclosure RENDERS would fail this leg on a
//      fully-correct build — the exact "grain-mismatched fail-proof"
//      failure mode this sprint's own instructions name and forbid
//      shipping. "Never weaken a gate to make something pass" cuts the
//      other way too: a floor that cannot be met by true data was never
//      tight, it was broken, and leaving it in place would either fail
//      forever (useless) or get quietly loosened later by someone who
//      never re-derives why it's there.
//
//      leg h3 sets the precedent this leg follows instead: "resolves" =
//      the leg successfully walked and joined real pages to real sidecar
//      rows (there, proving the gate scans the whole corpus and not just
//      the ~6 known collision pages; here, proving it scans real agency
//      pages and not a token handful of the 23 that ship) — NOT "found N
//      examples of the specific defect condition" (that is what leg g3
//      does instead, because leg g's condition — FY2026 recon_share > 0 —
//      is common enough for a large floor to be a meaningful, achievable
//      bar; #59's condition is rare by construction, so h3's convention is
//      the one that applies here). i1/i2 above are what actually check the
//      defect, on EVERY resolved page, unconditionally — so keeping the
//      floor at the task's own number (20 of 23 resolved, ~87% corpus
//      coverage) is still a real, non-trivial requirement, just aimed at
//      the right target. Also requires ≥1 resolved org with count > 0 —
//      otherwise i1's own check would never actually run.

const MIN_AGENCY_PAGES_RESOLVED = 20;

function runAgencyReconciliationLeg(errors, notes) {
  const agenciesPath = path.join(repoRoot, "data", "site", "json", "agencies.json");
  if (!fs.existsSync(agenciesPath)) {
    errors.push(`leg i: agencies.json not found at ${agenciesPath}`);
    return;
  }
  let agencies;
  try {
    agencies = JSON.parse(fs.readFileSync(agenciesPath, "utf8"));
  } catch (e) {
    errors.push(`leg i: agencies.json failed to parse (${e.message})`);
    return;
  }
  const sidecarByOrg = new Map(agencies.map((a) => [a.org, a]));

  const agencyDir = path.join(outDir, "agency");
  if (!fs.existsSync(agencyDir)) {
    errors.push(`leg i: out/agency/ not found — build the site first`);
    return;
  }

  let resolved = 0;
  let resolvedWithGap = 0;
  const missingNote = [];
  const spuriousNote = [];
  const countMismatch = [];

  for (const entry of fs.readdirSync(agencyDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const org = entry.name;
    const sidecar = sidecarByOrg.get(org);
    if (!sidecar) continue; // a built page with no sidecar row is not this leg's join
    const htmlPath = path.join(agencyDir, org, "index.html");
    if (!fs.existsSync(htmlPath)) continue;
    let root;
    try {
      root = parse(fs.readFileSync(htmlPath, "utf8"), { comment: false });
    } catch (e) {
      errors.push(`leg i: failed to parse out/agency/${org}/index.html (${e.message})`);
      continue;
    }
    resolved++;

    const expectedCount = Number(sidecar.fy2024_not_reconciled_count || 0);
    const noteEl = root.querySelector("[data-agency-reconciliation-note]");

    if (expectedCount > 0) {
      resolvedWithGap++;
      if (!noteEl) {
        missingNote.push(
          `/agency/${org}/: sidecar reports fy2024_not_reconciled_count=` +
            `${expectedCount} but the page renders no ` +
            `[data-agency-reconciliation-note]`,
        );
        continue;
      }
      const renderedCount = Number(
        noteEl.getAttribute("data-not-reconciled-count"),
      );
      if (renderedCount !== expectedCount) {
        countMismatch.push(
          `/agency/${org}/: [data-agency-reconciliation-note] declares ` +
            `data-not-reconciled-count=${renderedCount} but the sidecar says ` +
            `${expectedCount}`,
        );
      }
    } else if (noteEl) {
      spuriousNote.push(
        `/agency/${org}/: sidecar reports fy2024_not_reconciled_count=0 (or ` +
          `absent) but the page renders [data-agency-reconciliation-note] anyway`,
      );
    }
  }

  if (missingNote.length > 0) {
    errors.push(
      `leg i1 agency-reconciliation completeness: ${missingNote.length} agency ` +
        `page(s) with a non-reconciling program render no disclosure (first ` +
        `${MAX_LISTED}):`,
    );
    for (const m of missingNote.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (missingNote.length > MAX_LISTED)
      errors.push(`  ... and ${missingNote.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg i1: every resolved agency page with a non-reconciling program ` +
        `renders the disclosure ✓`,
    );
  }

  if (countMismatch.length > 0) {
    errors.push(
      `leg i1 agency-reconciliation count drift: ${countMismatch.length} page(s) ` +
        `render a not-reconciled count that disagrees with their own sidecar ` +
        `(first ${MAX_LISTED}):`,
    );
    for (const m of countMismatch.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (countMismatch.length > MAX_LISTED)
      errors.push(`  ... and ${countMismatch.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg i1: every rendered count matches its sidecar ✓`);
  }

  if (spuriousNote.length > 0) {
    errors.push(
      `leg i2 agency-reconciliation spurious render: ${spuriousNote.length} ` +
        `page(s) render the disclosure with no non-reconciling program (first ` +
        `${MAX_LISTED}):`,
    );
    for (const m of spuriousNote.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (spuriousNote.length > MAX_LISTED)
      errors.push(`  ... and ${spuriousNote.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg i2: no agency page renders the disclosure without cause ✓`);
  }

  if (resolved < MIN_AGENCY_PAGES_RESOLVED) {
    errors.push(
      `leg i3 is VACUOUS: only ${resolved} agency page(s) resolved a sidecar ` +
        `(need ≥ ${MIN_AGENCY_PAGES_RESOLVED}) — the join is not matching the ` +
        `built pages`,
    );
  } else if (resolvedWithGap === 0) {
    errors.push(
      `leg i3 is VACUOUS: ${resolved} agency pages resolved but NONE report a ` +
        `non-reconciling program — leg i1's completeness check never actually ran`,
    );
  } else {
    notes.push(
      `leg i3: ${resolved} agency pages resolved, ${resolvedWithGap} with ≥1 ` +
        `non-reconciling program — non-vacuous ✓`,
    );
  }
}

// ── Direct run: node scripts/gates/basis.mjs ─────────────────────────────────
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await runBasisGate();
  console.log(`gate 23 basis: ${result.notes.slice(0, 3).join("; ")} → ${result.pass ? "PASS" : "FAIL"}`);
  for (const n of result.notes) console.log(`  note: ${n}`);
  for (const e of result.errors) console.log(`  ✗ ${e}`);
  process.exit(result.pass ? 0 : 1);
}
