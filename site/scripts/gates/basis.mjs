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
 * Export: runBasisGate() → { pass, errors, notes }
 * Helpers (unit-tested in __tests__/basis.test.mjs): normalizeAmount,
 * valuesAgree, fyTokensFromLabel, validateGoldenFootnote.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const goldensDir = path.resolve(__dirname, "goldens", "footnotes");
const footnoteModulePath = path.resolve(siteRoot, "src", "lib", "footnote.ts");

const BOOTSTRAP_COLLISION_PAGE = "ATA000";
const MAX_LISTED = 10;

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

  return { pass: errors.length === 0, errors, notes };
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
