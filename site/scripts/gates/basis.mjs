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
 * LEG (j) — curated alias routing (#55; letter checked free against
 *   a/b/c/d/e/f/g/h/i above before use):
 *
 *   Since #52 a curated alias is the only SINGLE word the matcher trusts on
 *   its own — `evidence_kind='alias'` rows exist because a person confirmed
 *   the mapping and for no other reason. `JASSM` was seeded to `0603000D8Z`
 *   *Joint Munitions Advanced Technology* (OSD) and put ten alias-tier
 *   filings on that page, while `0207325F` *Joint Air-to-Surface Standoff
 *   Missile (JASSM)* got three weaker `multi_token` rows. Real filings,
 *   really saying "JASSM", correctly counted, on the wrong program: every
 *   number↔citation gate in the suite passed throughout.
 *
 *   j1 SEED AGREEMENT — dbt/seeds/program_aliases.csv must map every ratified
 *      alias to exactly its ratified pe_bli set (RATIFIED_ALIASES, transcribed
 *      from the #55 curation worksheet — a second, independent record, because
 *      a seed compared with itself agrees with itself).
 *   j2 EVIDENCE ROUTING — every `evidence_kind='alias'` row in
 *      fct_program_lobbying whose matched_term is ratified must sit on a
 *      ratified pe_bli. The leg that reads RED on JASSM.
 *   j3 TARGET RESOLVES — every ratified pe_bli exists in dim_programs and
 *      ships out/program/{pe}/index.html.
 *   j4 NOTHING UNRATIFIED IS SEEDED — the reverse direction: a seeded alias
 *      must be ratified or on the owner's pending list.
 *   j5 NON-VACUITY — the ratified table must be complete, and the warehouse
 *      must carry alias-tier rows at all.
 *   j6 EXPORT FIDELITY — the routing check re-asked of the SHIPPED artifact:
 *      no program_details sidecar may publish a ratified alias's alias-tier
 *      rows on another program. j1-j5 read the seed and the warehouse; a
 *      warehouse fix does not rewrite the sidecars, and without j6 the leg
 *      would go green while the page still carried the defect.
 *
 *   Warehouse facts come from scripts/gates/aliasrouting-resolve.py, the same
 *   spawn-a-helper shape leg (d) uses.
 *
 * LEG (k) — the reconciliation BADGE must mean what the data says
 *   (tri-persona review Wave 2; letter checked free against a-j above):
 *
 *   dim_programs.fully_reconciled was bool_and(reconciled) over EVERY J-book
 *   scenario, including AllPriorYears — which reconcile.scenario_map() issues
 *   no check for, so its rows are 0-of-3,267 reconciled by construction. The
 *   badge read that flag, so 1,310 programs whose every checked scenario ties
 *   wore the same "Partial Reconciliation" warning as the 87 with a real
 *   failure, and the term was defined neither on the page nor in /glossary/.
 *
 *   k1 VERDICT AGREEMENT — the badge a page RENDERS (read from its own text,
 *      so the leg reads a pre-fix build honestly) equals the verdict the
 *      warehouse supports, per reconbadge-recompute.py — which takes its scope
 *      from reconcile.scenario_map() itself, never from the mart under test.
 *   k2 TERM DEFINED — every rendered badge term appears in the built
 *      /glossary/, and the badge links there.
 *   k3 STATE DECLARED — every badge carries data-reconciliation-badge.
 *   k4 NON-VACUITY — structural: the population is every program page
 *      rendering a known badge, every full-tier one must join to a verdict,
 *      and both the pass and the fail verdicts must actually occur.
 *   See runReconciliationBadgeLeg at the bottom of this file.
 *
 * Export: runBasisGate() → { pass, errors, notes }
 * Helpers (unit-tested in __tests__/basis.test.mjs): normalizeAmount,
 * valuesAgree, fyTokensFromLabel, validateGoldenFootnote, chipExhibitClaim,
 * isBasisChipClassName, parseCsv.
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

/** USD thousands → a short $M/$B string, for gate ERROR MESSAGES only. */
function fmtK(thousands) {
  const n = Number(thousands);
  if (!Number.isFinite(n)) return String(thousands);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}B`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}M`;
  return `$${n.toFixed(1)}K`;
}

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
  // ROADMAP #29(c). /lineage/ publishes one FY2026 request figure per
  // identity in its table view — the same (entity, fy, measure) label the
  // program pages publish, on a surface that holds 84 of them at once. That
  // is exactly the shape leg (e) exists for: the P0 it was built after was
  // an index publishing a program's figure on a basis the program page did
  // not, with no single page holding both.
  { label: "/lineage/", file: "lineage/index.html" },
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

  // ── Leg (j) — curated alias routing (#55) ─────────────────────────────────
  runAliasRoutingLeg(errors, notes);

  // ── Leg (k) — the reconciliation badge must mean what the data says ───────
  runReconciliationBadgeLeg(pages, errors, notes);

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
//
// LEG (g5) — THE RECONCILIATION STRIP MUST NOT CREDIT THE GAP TO ADVANCE
// PROCUREMENT (§P0-3, added 2026-08-28).
//
// The shipped defect, on /program/834130/: the strip stated a TOA↔J-book gap
// of $698.2M and explained it, via its shared mechanism sentence, as "budget
// rows (such as advance procurement)". The warehouse says 834130 is disc
// $294.7M + RECONCILIATION $698.2M. A [data-fy26-recon-chip] roughly 100px
// above on the same screen read "$698.2M one-time reconciliation" — the same
// number, two contradictory causes, one screen, both cited.
//
// Measured across the shipped sidecars: of 158 FY2026 rows this strip
// renders, 151 have a gap fully accounted for by the reconciliation
// appropriation and exactly ONE (B-21, B02100) is a genuine mix of $2,099.1M
// reconciliation and $862.0M advance procurement. FY24 and FY25 rows close on
// advance procurement exactly, which is why the defect was invisible: the
// explanation is right in every year that has no reconciliation money.
//
// This leg checks the RENDERED PROSE, not the component's own branch
// attribute. The truth is recomputed here from the sidecar's
// summary.reconciliation delta and fy26_split.recon_k — and then the check is
// against what a reader can actually see, because "the attribute says
// reconciliation while the sentence says advance procurement" is precisely
// the failure a mirror-the-component gate would wave through.
const FY26_SPLIT_MIN_RESOLVED = 100;

/** Minimum g5 resolutions before the leg is treated as VACUOUS. */
const RECON_CAUSE_MIN_RESOLVED = 100;

function runFy26SplitLeg(pages, errors, notes) {
  let resolved = 0;
  let causeResolved = 0;
  const missingChip = [];
  const missingDiscRate = [];
  const wrongCause = [];

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

    // g5 — the reconciliation strip's FY2026 row must name the cause it has.
    // Truth, recomputed here from the sidecar rather than read off the
    // component's own branch attribute:
    const fy26Entry = (sidecar.summary?.reconciliation || []).find(
      (r) => r.fy === 2026 && r.measure === "request",
    );
    const reconK = Number(split.recon_k) || 0;
    if (fy26Entry && reconK > 0) {
      causeResolved++;
      const remainderK = Number(fy26Entry.delta_thousands) - reconK;
      // Does advance procurement genuinely explain any of this gap? Only when
      // the reconciliation money falls short of it (B-21 is the one page).
      const apIsReal = remainderK > 0.5;

      // NOT [data-reconciliation]: Cite stamps that attribute on INDIVIDUAL
      // figures whose (fy, measure) is a declared collision (cite.tsx), so
      // that selector matches a single "$992.9M" span and the leg would read
      // 8 characters of text and pass everything. Caught by running it. The
      // strip's own root is the testid.
      const strip = root.querySelector('[data-testid="reconciliation-strip"]');
      if (!strip) {
        wrongCause.push(
          `/program/${pe}/: sidecar has an FY2026 reconciliation row but the ` +
            `built page renders no reconciliation strip`,
        );
      } else {
        // THE ROW, not the strip. The first draft of this leg scanned the
        // whole strip for "advance procurement" — which fails the CORRECTION,
        // because the shared mechanism sentence legitimately explains that TOA
        // includes AP rows in an ordinary year. Scanning the strip cannot tell
        // "explains the mechanism" from "credits THIS gap to it".
        //
        // Replacing that check with a ROW-LEVEL one is a strengthening, not a
        // relaxation, and the pre-fix artifact proves it: the recorded FAIL
        // shows the pre-fix strip never contained the token "reconciliation"
        // ANYWHERE (152 pages, "without once naming"), and the row is a subset
        // of the strip — so a pre-fix row could not have named it either.
        // Requiring the ROW to name it is therefore satisfied by strictly
        // fewer artifacts than requiring the strip to.
        const row = strip
          .querySelectorAll("[data-reconciliation-fy]")
          .find(
            (r) =>
              r.getAttribute("data-reconciliation-fy") === "2026" &&
              r.getAttribute("data-reconciliation-measure") === "request",
          );
        if (!row) {
          wrongCause.push(
            `/program/${pe}/: the strip renders no FY2026 request row, but the ` +
              `sidecar carries one — the gap cannot state its cause`,
          );
        } else {
          const rowText = (row.text ?? "").replace(/\s+/g, " ");
          if (!/reconciliation/i.test(rowText)) {
            wrongCause.push(
              `/program/${pe}/: the FY2026 row states a ${fmtK(fy26Entry.delta_thousands)} ` +
                `gap without naming the ${fmtK(reconK)} reconciliation ` +
                `appropriation that accounts for it — the same number the ` +
                `[data-fy26-recon-chip] on this page calls reconciliation`,
            );
          }
          // "not advance procurement" is the CORRECTION, so the credit test
          // has to be negation-aware — the same lookbehind discipline gate 14
          // leg (cv) needed for "NOT a limit of what the Department publishes".
          const credits = rowText.match(/(?<!not )advance procurement/i);
          if (!apIsReal && credits) {
            wrongCause.push(
              `/program/${pe}/: the FY2026 row credits advance procurement for a ` +
                `gap of ${fmtK(fy26Entry.delta_thousands)} that the ` +
                `${fmtK(reconK)} reconciliation appropriation accounts for in ` +
                `full (remainder ${fmtK(remainderK)})`,
            );
          }
        }
      }
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

  if (wrongCause.length > 0) {
    errors.push(
      `leg g5 reconciliation cause: ${wrongCause.length} program page(s) ` +
        `explain an FY2026 TOA↔J-book gap as advance procurement when the ` +
        `reconciliation appropriation accounts for it (first ${MAX_LISTED}):`,
    );
    for (const m of wrongCause.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (wrongCause.length > MAX_LISTED)
      errors.push(`  ... and ${wrongCause.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg g5: ${causeResolved} FY2026 reconciliation strip row(s) name the ` +
        `cause the sidecar actually carries ✓`,
    );
  }

  if (causeResolved < RECON_CAUSE_MIN_RESOLVED) {
    errors.push(
      `leg g5 is VACUOUS: only ${causeResolved} page(s) resolved an FY2026 ` +
        `reconciliation strip row with recon_k > 0 (need ≥ ` +
        `${RECON_CAUSE_MIN_RESOLVED}) — the selector or the sidecar field is ` +
        `not matching the built pages`,
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
    // amount_type → "account_title||organization" → summed amount_thousands.
    //
    // ROADMAP #45: the composite key (not account_title alone) is what
    // extends this leg to organization collisions ('20'/'30'/'500') without
    // a new letter. The 8 Sprint E keys collide on account_title with a
    // constant organization; the 3 ROADMAP #45 keys collide on organization
    // with a constant account_title — either way, >1 distinct composite key
    // within one amount_type IS a fused slot, and the same recompute below
    // (h1: a card must equal exactly ONE composite's own contribution) and
    // dataset check (h2) apply unchanged to both shapes. A hypothetical key
    // colliding on BOTH dimensions at once would also be caught (>1 distinct
    // composite), though none exists in the shipped PB2026 warehouse.
    const perSlot = new Map();
    for (const bl of budgetLines) {
      if (!bl || bl.account_title == null || bl.amount_type == null) continue;
      if (typeof bl.amount_thousands !== "number") continue;
      if (!perSlot.has(bl.amount_type)) perSlot.set(bl.amount_type, new Map());
      const m = perSlot.get(bl.amount_type);
      const compositeKey = `${bl.account_title}||${bl.organization ?? ""}`;
      m.set(compositeKey, (m.get(compositeKey) || 0) + bl.amount_thousands);
    }
    const collisionSlots = new Set(
      [...perSlot.entries()].filter(([, m]) => m.size > 1).map(([at]) => at),
    );
    if (collisionSlots.size === 0) continue;

    const cards = Array.isArray(sidecar.summary?.cards) ? sidecar.summary.cards : [];
    for (const card of cards) {
      const amountType = CARD_KEY_TO_AMOUNT_TYPE[card.key];
      if (!amountType || !collisionSlots.has(amountType)) continue;

      // h2 — a card on a colliding slot may never cite the non-scoped
      // mart, no matter what value it holds.
      if (card.dataset === "fct_decade_series") {
        fusedSourceDataset.push(
          `/program/${pe}/: summary card "${card.key}" cites dataset ` +
            `"fct_decade_series" on a page whose own budget_lines span >1 ` +
            `account_title/organization for ${amountType}` +
            ` (${[...perSlot.get(amountType).keys()].join(" | ")})`,
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
          .map(([compositeKey, v]) => `${compositeKey.replace("||", " / ")}=${v}`)
          .join(", ");
        fusedCardMismatches.push(
          `/program/${pe}/: summary card "${card.key}" = ${card.value} ` +
            `(dataset ${card.dataset}) matches NEITHER account/org's own ` +
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
  runTitleCoverageLeg(pages, errors, notes);
}

// #69 leg h5 — A PAGE MAY NOT BE NAMED AFTER A MINORITY OF ITS OWN MONEY
// ─────────────────────────────────────────────────────────────────────────────
//
// h1-h4 above catch a page whose money spans >1 ACCOUNT (#56/#67) or >1
// ORGANIZATION (#45). They are structurally blind to a third axis: ONE
// (account, organization) slot whose FY2026 money spans >1 distinct
// BUDGET-LINE TITLE. h1's per-slot recompute keys on
// `account_title||organization`, which is CONSTANT across such a page, so
// its collisionSlots set is empty and every check below it is skipped.
//
// This is not the same defect as #45/#56/#67 and must not be fixed the same
// way. Thirteen PB2026 keys carry FY2026 money in >1 budget activity within
// one (account, organization) — F-15EX in BA01/BA05/BA07, B-52 and C-17A and
// F-15 and KC-46A in two each, six RDT&E PEs likewise. Eleven of the
// thirteen carry the IDENTICAL title in every activity, so the page's single
// title honestly names all of its money and summing the activities is the
// program's real total. Two do not, because the Air Force gave the BA-07
// sub-line its own label: HCMC00 published $383,072K under the title of its
// $17,986K "HC/MC-130 Post Prod" sub-line, and JSE000 $46,509K under its
// $28,524K one. Splitting those two pages would fragment one program on an
// axis the other eleven share, and would not even be expressible before
// PB2026 (both HCMC00 lines are titled "HC/MC-130 Modifications" in the
// PB2024 and PB2025 editions — the title only diverged when the label
// changed). So the contract is disclosure, not separation:
//
//   h5a DISCLOSED — a page whose own fy_2026_total budget_lines carry >1
//      distinct title must ship fy26_split.lines naming EVERY one of those
//      titles, each with its own fact_id, and the disclosed amounts must sum
//      to the page's own FY2026 total. Silence is the shipped defect.
//   h5b NOT MINORITY-TITLED — the page's own title (programs.json, produced
//      by dim_programs) must be the LARGEST of its constituents. A $383M
//      page titled after its $18M sub-line is a true number carrying a false
//      name, the species of defect Sprint 3 found three of.
//
// Reads the sidecar's per-row `title` (already threaded onto every
// budget_lines row since #56) against programs.json's page title — two
// independently produced artifacts (fct_budget_lines vs dim_programs), so a
// mismatch is a real disagreement, not the exporter agreeing with itself.
const KNOWN_MULTI_TITLE_KEYS_H5 = ["HCMC00", "JSE000"];
const H5_TOL = 0.5; // USD thousands — float accumulation only

function runTitleCoverageLeg(pages, errors, notes) {
  const programsPath = path.join(
    repoRoot, "data", "site", "json", "programs.json",
  );
  const titleBySlug = new Map();
  if (fs.existsSync(programsPath)) {
    try {
      for (const p of JSON.parse(fs.readFileSync(programsPath, "utf8"))) {
        titleBySlug.set(p.slug ?? p.pe_bli, p.title);
      }
    } catch {
      // falls through to the empty-map guard below
    }
  }
  if (titleBySlug.size === 0) {
    errors.push(
      "leg h5: programs.json is missing, unreadable or empty — the page " +
        "titles this leg checks against their own money cannot be resolved",
    );
    return;
  }

  const undisclosed = [];
  const minorityTitled = [];
  const checkedKnown = new Set();
  let multiTitlePages = 0;

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

    const perTitle = new Map();
    for (const bl of Array.isArray(sidecar.budget_lines) ? sidecar.budget_lines : []) {
      if (!bl || bl.amount_type !== "fy_2026_total") continue;
      if (typeof bl.amount_thousands !== "number") continue;
      const t = bl.title ?? "";
      perTitle.set(t, (perTitle.get(t) || 0) + bl.amount_thousands);
    }
    if (perTitle.size < 2) continue;
    multiTitlePages++;
    if (KNOWN_MULTI_TITLE_KEYS_H5.includes(pe)) checkedKnown.add(pe);

    const pageTotal = [...perTitle.values()].reduce((a, b) => a + b, 0);
    const breakdown = [...perTitle.entries()]
      .map(([t, v]) => `"${t}"=${v}`)
      .join(", ");

    // h5a — the constituents must be disclosed, completely and cited.
    const lines = sidecar.fy26_split?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      undisclosed.push(
        `/program/${pe}/: FY2026 money spans ${perTitle.size} budget-line ` +
          `titles (${breakdown}) summing to ${pageTotal}, but the sidecar ` +
          `carries no fy26_split.lines disclosure — the page publishes the ` +
          `sum under one line's name`,
      );
    } else {
      const named = new Set(lines.map((l) => l?.title ?? ""));
      const missing = [...perTitle.keys()].filter((t) => !named.has(t));
      if (missing.length > 0) {
        undisclosed.push(
          `/program/${pe}/: fy26_split.lines omits ${missing.length} of the ` +
            `page's own FY2026 titles (${missing.map((t) => `"${t}"`).join(", ")})`,
        );
      }
      const uncited = lines.filter(
        (l) => !l || typeof l.fid !== "string" || l.fid.length === 0,
      );
      if (uncited.length > 0) {
        undisclosed.push(
          `/program/${pe}/: ${uncited.length} of ${lines.length} ` +
            `fy26_split.lines entries carry no fact_id — an uncited receipt`,
        );
      }
      const disclosedTotal = lines.reduce(
        (a, l) => a + (typeof l?.v === "number" ? l.v : NaN), 0,
      );
      if (!(Math.abs(disclosedTotal - pageTotal) < H5_TOL)) {
        undisclosed.push(
          `/program/${pe}/: fy26_split.lines sums to ${disclosedTotal} but ` +
            `the page's own FY2026 budget_lines sum to ${pageTotal} ` +
            `(${breakdown})`,
        );
      }
    }

    // h5b — the page's name must be its largest constituent.
    const pageTitle = titleBySlug.get(pe);
    if (pageTitle != null) {
      let best = null;
      let bestV = -Infinity;
      for (const [t, v] of [...perTitle.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      )) {
        if (v > bestV) {
          bestV = v;
          best = t;
        }
      }
      if (pageTitle !== best) {
        minorityTitled.push(
          `/program/${pe}/: page title "${pageTitle}" ` +
            `(${perTitle.get(pageTitle) ?? 0}) is NOT the largest of its ` +
            `${perTitle.size} FY2026 budget-line titles — "${best}" is ` +
            `(${bestV}) — yet the page publishes ${pageTotal}`,
        );
      }
    }
  }

  if (undisclosed.length > 0) {
    errors.push(
      `leg h5a title-coverage disclosure: ${undisclosed.length} program ` +
        `page(s) aggregate >1 budget-line title without a complete, cited ` +
        `fy26_split.lines disclosure (first ${MAX_LISTED}):`,
    );
    for (const m of undisclosed.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (undisclosed.length > MAX_LISTED)
      errors.push(`  ... and ${undisclosed.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg h5a: all ${multiTitlePages} multi-title program page(s) disclose ` +
        `every constituent budget line, cited, summing to the page total ✓`,
    );
  }

  if (minorityTitled.length > 0) {
    errors.push(
      `leg h5b minority-titled page: ${minorityTitled.length} program page(s) ` +
        `are named after a budget line that is not their largest (first ` +
        `${MAX_LISTED}):`,
    );
    for (const m of minorityTitled.slice(0, MAX_LISTED)) errors.push(`  ${m}`);
    if (minorityTitled.length > MAX_LISTED)
      errors.push(`  ... and ${minorityTitled.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg h5b: no program page is named after a minority of its own money ✓`,
    );
  }

  const missingKnown = KNOWN_MULTI_TITLE_KEYS_H5.filter((k) => !checkedKnown.has(k));
  if (missingKnown.length > 0) {
    errors.push(
      `leg h5 is VACUOUS on the known #69 set: ${missingKnown.length}/` +
        `${KNOWN_MULTI_TITLE_KEYS_H5.length} known multi-title key(s) were ` +
        `never exercised: ${missingKnown.join(", ")} — the check is not ` +
        `reaching the case it exists to catch`,
    );
  } else {
    notes.push(
      `leg h5: non-vacuous — ${multiTitlePages} multi-title page(s) checked, ` +
        `including all ${KNOWN_MULTI_TITLE_KEYS_H5.length} known #69 keys ✓`,
    );
  }
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

  // ROADMAP #69 — the converse of `undisclosed`, on the same recompute:
  // nothing declared absent from the index may in fact be published by it.
  const falselyDisclosed = truth.falsely_disclosed || [];
  if (falselyDisclosed.length > 0) {
    errors.push(
      `leg h4 false exclusion: ${falselyDisclosed.length} line(s) named in ` +
        `programs_excluded.json as absent from the index are in fact ` +
        `published by it (first ${MAX_LISTED}):`,
    );
    for (const u of falselyDisclosed.slice(0, MAX_LISTED)) {
      errors.push(
        `  ${u.pe_bli} "${u.title}" ($${Math.round(u.amount_thousands).toLocaleString()}K) — ${u.why}`,
      );
    }
    if (falselyDisclosed.length > MAX_LISTED)
      errors.push(`  ... and ${falselyDisclosed.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg h4: nothing disclosed as absent from the index is in fact ` +
        `published by it ✓`,
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

  runCoverageScopeLeg(truth, errors, notes);
}

// LEG (h6) — A COVERAGE PERCENTAGE MUST NAME THE UNIVERSE IT IS A PERCENTAGE
// OF (§P0-4, added 2026-08-28)
// ─────────────────────────────────────────────────────────────────────────────
//
// /programs/ shipped: "$228.7B of the $385.3B FY2026 request (59.4%)". Both
// dollar figures are real <Cite>s, both resolve to real workbook facts, and
// 228.7/385.3 really is 59.4%. The sentence is still false, because that
// $385.3B is P-1 ($205.01B) + R-1 ($180.26B) and nothing else — procurement
// and RDT&E. The FY2026 DoD request is roughly twice it. So a reader is told
// the site covers 59.4% of "the FY2026 request" when it covers 59.4% of about
// a quarter of defense spending, and the site's most prominent self-assessment
// overstates its own reach by a factor of two.
//
// The general form, which is what makes this leg worth having: a percentage is
// a claim about its DENOMINATOR, and a denominator that names a scope it does
// not have is a false claim no number-vs-citation check can see — both numbers
// are right and the ratio between them is right.
//
// Truth comes from universe_by_exhibit in the recompute above, read from
// fct_budget_lines. Neither side hardcodes which exhibits exist: if an O&M or
// MilPers family is ever ingested, the recompute grows a row and this leg
// starts requiring the page to say so.

/** exhibit code → the words a reader would recognise it by. */
const EXHIBIT_WORDS = {
  "P-1": [/procurement/i],
  "R-1": [/RDT&(amp;)?E|research,? development/i],
};

function runCoverageScopeLeg(truth, errors, notes) {
  const universe = truth.universe_by_exhibit || [];
  if (universe.length === 0) {
    errors.push(
      "leg h6: the recompute returned no universe_by_exhibit rows — the scope " +
        "of the /programs/ denominator cannot be checked",
    );
    return;
  }

  const pagePath = path.join(outDir, "programs", "index.html");
  if (!fs.existsSync(pagePath)) {
    notes.push("leg h6: out/programs/index.html not found (SKIP)");
    return;
  }
  let scopeEl;
  try {
    const root = parse(fs.readFileSync(pagePath, "utf8"), { comment: false });
    scopeEl = root.querySelector("[data-programs-coverage-pct]");
  } catch (e) {
    errors.push(`leg h6: failed to parse /programs/ (${e.message})`);
    return;
  }
  if (!scopeEl) {
    errors.push(
      "leg h6: /programs/ renders no [data-programs-coverage-pct] element — " +
        "the dollar-denominated coverage claim has no hook to check",
    );
    return;
  }

  const text = (scopeEl.text ?? "").replace(/\s+/g, " ").trim();
  const totalK = universe.reduce((a, r) => a + r.amount_thousands, 0);
  const composition = universe
    .map((r) => `${r.exhibit} $${(r.amount_thousands / 1e6).toFixed(2)}B`)
    .join(" + ");

  // Every exhibit family the denominator is built from has to be nameable in
  // the sentence, IN WORDS A READER KNOWS.
  //
  // Deliberately NOT satisfied by the bare exhibit code. The first draft of
  // this leg accepted `text.includes("P-1")` as a fallback, and the pre-fix
  // page passed the P-1 half of the check on the incidental clause "absent
  // even when they are large and even when they are P-1" — a sentence about
  // what is MISSING, being read as a statement of what the denominator IS.
  // A reader who does not already know that P-1 means procurement learns
  // nothing from the code, which is the entire point of the correction.
  const unnamed = universe.filter((r) => {
    const pats = EXHIBIT_WORDS[r.exhibit];
    // An exhibit family with no reader-facing words registered here can only
    // be matched by its code — better than nothing, and it fails loudly the
    // first time a new family appears, which is when someone should look.
    if (!pats) return !new RegExp(r.exhibit.replace("-", "[- ]?"), "i").test(text);
    return !pats.some((p) => p.test(text));
  });

  if (unnamed.length > 0) {
    errors.push(
      `leg h6 coverage scope: /programs/ denominates its coverage against a ` +
        `$${(totalK / 1e6).toFixed(1)}B universe that is exactly ${composition}, ` +
        `but the sentence never names ${unnamed
          .map((r) => r.exhibit)
          .join(", ")} — so "the FY2026 request" reads as the whole defense ` +
        `request, which is roughly twice this. Rendered: "${text.slice(0, 220)}"`,
    );
  } else {
    notes.push(
      `leg h6 coverage scope: /programs/ names all ${universe.length} exhibit ` +
        `families behind its $${(totalK / 1e6).toFixed(1)}B denominator ` +
        `(${composition}) ✓`,
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

// ─────────────────────────────────────────────────────────────────────────────
// LEG (j) — CURATED ALIAS ROUTING (#55; letter checked free against
// a/b/c/d/e/f/g[1-4]/h[1-5]/i above before use)
// ─────────────────────────────────────────────────────────────────────────────
//
// Since #52, a curated alias is the ONLY single word the matcher trusts on
// its own: `evidence_kind='alias'` rows exist because a person confirmed the
// mapping, and nothing else. That makes the seed the one place in the corpus
// where one human keystroke silently republishes another company's lobbying
// under a program's name — a true, cited, correctly-counted number carrying a
// false claim, which is the defect species this sprint keeps closing.
//
// The shipped defect this leg was written against: `JASSM` was seeded to
// `0603000D8Z` *Joint Munitions Advanced Technology* — a defence-wide
// munitions science-and-technology line in OSD that is not JASSM — and put
// TEN alias-tier filings on that program's page, while `0207325F` *Joint
// Air-to-Surface Standoff Missile (JASSM)*, the program element that carries
// the name in its own title, got three weaker `multi_token` rows. Every
// number↔citation gate passed: the ten rows are real filings, really saying
// "JASSM", correctly counted, on the wrong program.
//
// So the check cannot be "does the seed agree with itself" — it did. It has
// to be "does the seed agree with the RATIFIED record", and the ratified
// record has to live somewhere the seed is not.
// RATIFIED_ALIASES below is that record, transcribed from
// docs/curation/roadmap-55-flagship-alias-worksheet.csv (`pick`) and
// docs/curation/roadmap-55-ratification.md. Two independent files must say
// the same thing, and the warehouse must route the evidence there.
//
//   j1 SEED AGREEMENT — for every ratified alias, dbt/seeds/program_aliases.csv
//      must map it to EXACTLY the ratified pe_bli set: no missing row (the
//      curation did not ship), no extra row (a target nobody ratified).
//   j2 EVIDENCE ROUTING — every `evidence_kind='alias'` row in
//      fct_program_lobbying whose matched_term is a ratified alias must sit
//      on a ratified pe_bli for that alias. This is the leg that reads RED on
//      JASSM today.
//   j3 TARGET RESOLVES — every ratified pe_bli must exist in dim_programs AND
//      ship a program page at out/program/{pe}/index.html. An alias whose
//      target has no row is inert (`_load_aliases` drops unknown pe_blis
//      without a word); an alias whose target has no page routes a reader to
//      a 404. Both are silent, so both are checked.
//   j4 NOTHING UNRATIFIED IS SEEDED — every alias in the seed must be either
//      ratified or listed in PENDING_RATIFICATION (the terms the ratification
//      doc hands to the owner). An unratified alias is worse than no alias:
//      it produces a confident wrong answer. This is the direction that stops
//      the next JASSM being added rather than only re-detecting this one.
//   j5 NON-VACUITY — fewer than MIN_RATIFIED_ALIASES ratified aliases checked,
//      or zero alias-tier rows observed anywhere in the warehouse, FAILS. A
//      seed loader that silently returns {} is not hypothetical here: it did
//      exactly that corpus-wide until 2026-08-08, when `parents[4]` was found
//      resolving one level above the project root.
//   j6 EXPORT FIDELITY — the same routing check, re-asked of what the site
//      actually SHIPS: no data/site/json/program_details/{pe}.json may publish
//      an `evidence_kind:"alias"` mention whose matched_term is ratified for
//      some OTHER program. j1-j5 all read the seed and the warehouse; the
//      sidecars are a separate, exporter-written artifact that a warehouse fix
//      does not touch. Without j6 this leg would go green the moment the seed
//      and the mart agreed, while /program/0603000D8Z/ went on publishing ten
//      JASSM filings to a reader — gated-green and still wrong on the page,
//      which is the same shape as the defect it is here to fix.
//
// Why the ratified table is transcribed rather than parsed out of the
// worksheet: 20 of the 42 ratified terms resolve to a program element that is
// NOT one of the worksheet's substring candidates (Sentinel's ICBM has no
// "Sentinel" in any title; GBSD matches zero titles at all), so their answer
// lives only in `curator_notes` prose as `OFF-WORKSHEET PE: <pe>`. A gate
// that greps English prose for its own expected values is a gate that goes
// green when the prose is reworded. The values are copied here, once, where
// changing one is an edit to the gate.

/**
 * The ratified flagship aliases (#55), alias → ratified pe_bli list.
 *
 * Sources, per term:
 *   - `pick == 'y'` in roadmap-55-flagship-alias-worksheet.csv (23 terms), or
 *   - `pick == 'n'` + `OFF-WORKSHEET PE: <pe>` in the same file's
 *     curator_notes (20 terms) — the correct program element was simply not
 *     among the substring candidates, so there was no row to tick.
 *
 * 42, not 43: `Sentinel` was ratified to 0605238F (Ground Based Strategic
 * Deterrent EMD — LGM-35A Sentinel is the renamed GBSD) and is deliberately
 * NOT seeded. The LDA corpus holds a third distinct Sentinel: Rolls-Royce's
 * 2025 filing on "additional Sentinel Class Fast Response Cutters" (Coast
 * Guard Authorization Act of 2025). Seeding the string would have attributed
 * a Coast Guard cutter filing to a $4.15B Air Force ICBM — one filing
 * matched, one of them false. `GBSD`, the same program's unambiguous name,
 * carries the mapping instead (9 filings, all NDAA/appropriations lines).
 * Same disposition, and same reason, as `TOW` in the ratification doc's §5.
 *
 * The 13 terms a human still has to choose are in PENDING_RATIFICATION.
 */
const RATIFIED_ALIASES = {
  // ── worksheet pick == 'y' ──
  "Tomahawk": ["0204229N"],
  "Standard Missile": ["0604366N"],
  "Sidewinder": ["M09HAI"],
  "Next Generation Jammer": ["0604274N"],
  "F/A-18": ["0204136N"],
  "Apache": ["0607145A"],
  "CH-47": ["6775A05101"],
  "T-7A": ["APT000"],
  "E-7": ["0604007F"],
  "V-22": ["0604262N"],
  "B-21": ["B02100"],
  "Triton": ["0305220N"],
  "Hellfire": ["1338C70000"],
  "JASSM": ["0207325F"], // corrects the live defect (was 0603000D8Z)
  "HIMARS": ["6200C02901"],
  "JADC2": ["0604122D8Z"],
  "C2BMC": ["0603896C"],
  "THAAD": ["MD07"],
  "Aegis": ["0603892C"], // corrects the live seed (was MD09, no FY25/FY26 line)
  "Iron Dome": ["MD83"],
  "SBX": ["0603907C"],
  "CV-22": ["0401318F"], // corrects the live seed (was 1000CV2200, a Mods line)
  "F-35": ["ATA000"], // ratified UNCHANGED
  // ── off-worksheet (curator_notes `OFF-WORKSHEET PE:`) ──
  "SM-6": ["0604366N"],
  "StormBreaker": ["SDB002"],
  "SPY-6": ["0604522N"],
  "JSOW": ["0604727N"],
  "AH-64": ["0607145A"],
  "Chinook": ["6775A05101"],
  "P-8": ["0605500N"],
  "Poseidon": ["0605500N"],
  "JDAM": ["353620"],
  "MQ-25": ["0605414N"],
  "Wedgetail": ["0604007F"],
  "Osprey": ["0604262N"],
  "GBSD": ["0605238F"],
  "Global Hawk": ["0305220F"],
  "E-2D": ["0604234N"],
  "IBCS": ["9280BZ5075"],
  "AARGM": ["0205601N"],
  "GBI": ["MD08"], // existing seed, ratified unchanged
  "JSF": ["ATA000"], // existing seed, ratified unchanged
  // ── owner ratification, 2026-08-27 (roadmap-55-ratification.md §1 and §2) ──
  // §1's nine terms are ONE program funded on a procurement line and an RDT&E
  // program element, neither subordinate to the other. The owner took "seed
  // every line listed". `_load_aliases` returns {pe_bli: [alias, ...]}, so an
  // alias may key under more than one PE; a filing naming the program then
  // emits one mention row per seeded PE, each on its own program page.
  // Seeding only the larger line would hide the other half of the money from
  // anyone reading the smaller page.
  "AMRAAM": ["MAMRA0", "0207163F", "0207163N"],
  "Javelin": ["0648CC0007", "0604611A"],
  "KC-46": ["KC046A", "0401221F"],
  "B-52": ["B05200", "0101113F"],
  "C-17": ["C01700", "0401130F"],
  "F-15EX": ["F015EX", "0207146F"],
  "GMLRS": ["6005C64400", "0205778A"],
  "LTAMDS": ["7265C12000", "0604114A"],
  "Small Diameter Bomb": ["SDB000", "0207327F", "0604329N"],
  // §2 one-offs.
  "MQ-9": ["0205219F", "1108MQ9"], // seed both, same logic as §1
  "C-130J": ["0401132F"], // was 2012C130J "AC/MC-130J", the SOCOM gunship and
  // special-operations variants. Moves 17 live alias rows. The corpus
  // corroborates: all 17 are Lockheed filings saying "C-130J procurement" /
  // "(F-35, C-130J)" — the baseline airlifter, not the AC-130J gunship.
};

/**
 * Terms still awaiting an owner decision. EMPTY as of 2026-08-27: the owner
 * ruled on all 13 that roadmap-55-ratification.md put to them — 11 moved into
 * RATIFIED_ALIASES above, and Patriot and PAC-3 were dropped (below).
 *
 * Deliberately kept rather than deleted. j4's contract is "a seeded alias is
 * ratified or explicitly pending", and the next curation round needs a place
 * to park a term that is seeded-but-undecided without the gate going red.
 * Empty means the strongest form of j4 is in force: everything in the seed
 * has an answer.
 */
const PENDING_RATIFICATION = new Set([]);

/**
 * Terms REFUSED as aliases, with the reason. Not an oversight list — a
 * decision list, and j4 reports a seeded one differently from a merely
 * unknown one so nobody re-adds these by reflex in six months.
 *
 * Four reasons (roadmap-55-ratification.md §5, plus this task's own findings):
 *   - no line exists in the corpus at all: NASAMS, Paveway, Griffin, Maverick,
 *     F135, F119, SLAM-ER, Trident — and, contrary to how they look, ESSM and
 *     RAM. RAM's 89 "candidates" are every title containing the substring
 *     inside the word PROGRAM; ESSM's 8 are inside ASSESSMENT.
 *   - only a derivative line exists: Stinger (Stinger Mods), Harpoon (Harpoon
 *     Support Equipment, $209K).
 *   - only a rollup exists: Excalibur (ARTILLERY PROJECTILE, 155MM, All
 *     Types), Coyote (COUNTER-SMALL UNMANNED AERIAL SYSTEM, multi-vendor).
 *     Aliasing a rollup attributes the whole rollup to one product.
 *   - the alias STRING is unsafe under a case-insensitive word-boundary
 *     regex: TOW fires on the English word "tow"; Super Hornet's only
 *     F/A-18E/F line is pe_bli 0145, which dim_programs shares with General
 *     Purpose Bombs; Sentinel matches Rolls-Royce's Coast Guard filing on
 *     "Sentinel Class Fast Response Cutters" (GBSD carries that program
 *     instead). Patriot and PAC-3 are the owner's 2026-08-27 drops: no base
 *     Patriot line exists in the corpus (both candidates are Mods /
 *     Product Improvement), and no title anywhere contains "PAC-3".
 */
const DROPPED_ALIASES = new Set([
  "ESSM", "RAM", "Stinger", "TOW", "Excalibur", "NASAMS", "Coyote", "Paveway",
  "Griffin", "Maverick", "F135", "F119", "Super Hornet", "SLAM-ER", "Harpoon",
  "Trident", "Sentinel", "Patriot", "PAC-3",
]);

// 53 ratified terms; the floor is the whole set, because the set IS the
// curation and a partial transcription is the failure to catch.
const MIN_RATIFIED_ALIASES = 53;

/** Minimal RFC4180 reader — the seed's `notes` column carries commas and quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function runAliasRoutingLeg(errors, notes) {
  const seedPath = path.join(repoRoot, "dbt", "seeds", "program_aliases.csv");
  if (!fs.existsSync(seedPath)) {
    errors.push(`leg j: alias seed not found at ${seedPath}`);
    return;
  }
  let seedRows;
  try {
    seedRows = parseCsv(fs.readFileSync(seedPath, "utf8"));
  } catch (e) {
    errors.push(`leg j: program_aliases.csv failed to parse (${e.message})`);
    return;
  }

  /** alias (as written) → Set(pe_bli), keyed case-insensitively like the matcher. */
  const seeded = new Map();
  for (const r of seedRows) {
    const alias = (r.alias || "").trim();
    const pe = (r.pe_bli || "").trim();
    if (!alias || !pe) {
      errors.push(
        `leg j: program_aliases.csv row with empty alias or pe_bli ` +
          `(alias="${alias}", pe_bli="${pe}") — _load_aliases drops it silently`,
      );
      continue;
    }
    const key = alias.toUpperCase();
    if (!seeded.has(key)) seeded.set(key, { alias, pes: new Set() });
    seeded.get(key).pes.add(pe);
  }

  const script = path.join(__dirname, "aliasrouting-resolve.py");
  if (!fs.existsSync(script)) {
    errors.push(`leg j: resolve helper missing at ${script}`);
    return;
  }
  const res = spawnSync("uv", ["run", "python", script], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    errors.push(
      `leg j: aliasrouting-resolve.py failed (status ${res.status}): ` +
        `${(res.stderr || res.error?.message || "").slice(0, 400)}`,
    );
    return;
  }
  let truth;
  try {
    truth = JSON.parse(res.stdout);
  } catch (e) {
    errors.push(`leg j: resolve helper produced non-JSON output (${e.message})`);
    return;
  }
  if (truth.__error__) {
    errors.push(`leg j: resolve helper could not run — ${truth.__error__}`);
    return;
  }

  const programs = truth.programs || {};
  const ratifiedKeys = new Map(
    Object.entries(RATIFIED_ALIASES).map(([a, pes]) => [a.toUpperCase(), { alias: a, pes }]),
  );

  // ── j1 SEED AGREEMENT ──
  const j1 = [];
  for (const [key, { alias, pes }] of ratifiedKeys) {
    const got = seeded.get(key);
    if (!got) {
      j1.push(`"${alias}" ratified → ${pes.join(", ")} but has no row in the seed`);
      continue;
    }
    const want = new Set(pes);
    const missing = pes.filter((p) => !got.pes.has(p));
    const extra = [...got.pes].filter((p) => !want.has(p));
    if (missing.length > 0 || extra.length > 0) {
      const parts = [];
      if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
      for (const p of extra) {
        const t = programs[p];
        parts.push(`seeded to ${p}${t ? ` "${t}"` : " (not in dim_programs)"}, not ratified`);
      }
      j1.push(
        `"${alias}" ratified → ${pes
          .map((p) => `${p}${programs[p] ? ` "${programs[p]}"` : ""}`)
          .join(", ")}: ${parts.join("; ")}`,
      );
    }
  }
  if (j1.length > 0) {
    errors.push(
      `leg j1 seed-agreement: ${j1.length} ratified alias(es) the seed does not ` +
        `carry as ratified (first ${MAX_LISTED}):`,
    );
    for (const f of j1.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (j1.length > MAX_LISTED) errors.push(`  ... and ${j1.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg j1: all ${ratifiedKeys.size} ratified aliases seeded as ratified ✓`);
  }

  // ── j2 EVIDENCE ROUTING ──
  const aliasRows = truth.alias_mentions || [];
  const j2 = [];
  let ratifiedRowsSeen = 0;
  for (const [term, pe, n] of aliasRows) {
    const key = String(term || "").toUpperCase();
    const ratified = ratifiedKeys.get(key);
    if (!ratified) continue; // pending-ratification terms are j4's business
    if (ratified.pes.includes(pe)) {
      ratifiedRowsSeen += n;
      continue;
    }
    j2.push(
      `"${ratified.alias}": ${n} alias-tier filing row(s) land on ${pe} ` +
        `"${programs[pe] || "(not in dim_programs)"}" — ratified target is ` +
        ratified.pes
          .map((p) => `${p} "${programs[p] || "(not in dim_programs)"}"`)
          .join(", "),
    );
  }
  if (j2.length > 0) {
    errors.push(
      `leg j2 evidence-routing: ${j2.length} ratified alias(es) route alias-tier ` +
        `lobbying evidence to an unratified program (first ${MAX_LISTED}):`,
    );
    for (const f of j2.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (j2.length > MAX_LISTED) errors.push(`  ... and ${j2.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg j2: ${ratifiedRowsSeen} alias-tier filing row(s) from ratified aliases, ` +
        `all on their ratified program ✓`,
    );
  }

  // ── j3 TARGET RESOLVES ──
  const j3 = [];
  const ratifiedPes = new Set(Object.values(RATIFIED_ALIASES).flat());
  for (const pe of [...ratifiedPes].sort()) {
    if (!(pe in programs)) {
      j3.push(`${pe}: no row in dim_programs — _load_aliases drops the alias silently`);
      continue;
    }
    const pagePath = path.join(outDir, "program", pe, "index.html");
    if (!fs.existsSync(pagePath)) {
      j3.push(`${pe} "${programs[pe]}": no page at out/program/${pe}/index.html`);
    }
  }
  if (j3.length > 0) {
    errors.push(
      `leg j3 target-resolves: ${j3.length} ratified alias target(s) a reader ` +
        `cannot reach (first ${MAX_LISTED}):`,
    );
    for (const f of j3.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (j3.length > MAX_LISTED) errors.push(`  ... and ${j3.length - MAX_LISTED} more`);
  } else {
    notes.push(`leg j3: all ${ratifiedPes.size} ratified alias targets resolve to a shipped page ✓`);
  }

  // ── j4 NOTHING UNRATIFIED IS SEEDED ──
  const pendingKeys = new Set([...PENDING_RATIFICATION].map((t) => t.toUpperCase()));
  const droppedKeys = new Set([...DROPPED_ALIASES].map((t) => t.toUpperCase()));
  const j4 = [];
  for (const [key, { alias, pes }] of seeded) {
    if (ratifiedKeys.has(key) || pendingKeys.has(key)) continue;
    if (droppedKeys.has(key)) {
      j4.push(
        `"${alias}" → ${[...pes].join(", ")} is seeded but was REFUSED as an alias ` +
          `(DROPPED_ALIASES) — see the reason there before re-adding it`,
      );
      continue;
    }
    j4.push(
      `"${alias}" → ${[...pes].join(", ")} is seeded but appears in neither the ` +
        `ratified set nor the owner's pending list`,
    );
  }
  if (j4.length > 0) {
    errors.push(
      `leg j4 unratified-seed: ${j4.length} seeded alias(es) nobody ratified ` +
        `(first ${MAX_LISTED}):`,
    );
    for (const f of j4.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (j4.length > MAX_LISTED) errors.push(`  ... and ${j4.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg j4: ${seeded.size} seeded aliases, every one ratified or on the ` +
        `owner's pending list ✓`,
    );
  }

  // ── j5 NON-VACUITY ──
  if (ratifiedKeys.size < MIN_RATIFIED_ALIASES) {
    errors.push(
      `leg j5 vacuity: RATIFIED_ALIASES holds ${ratifiedKeys.size} terms, below the ` +
        `${MIN_RATIFIED_ALIASES} the #55 curation ratified — a partial transcription ` +
        `is the failure this leg exists to catch`,
    );
  }
  if ((truth.alias_mentions_total || 0) === 0) {
    errors.push(
      `leg j5 vacuity: the warehouse carries ZERO evidence_kind='alias' rows across ` +
        `${truth.mentions_total ?? "?"} mentions — the seed loader is inert (this is ` +
        `what a mis-resolved _SEED_PATH looked like corpus-wide until 2026-08-08), ` +
        `so j2 proves nothing`,
    );
  } else {
    notes.push(
      `leg j5: ${truth.alias_mentions_total} alias-tier rows of ${truth.mentions_total} ` +
        `mentions warehouse-wide — the curated tier is live ✓`,
    );
  }

  // ── j6 EXPORT FIDELITY ──
  const detailsDir = path.join(repoRoot, "data", "site", "json", "program_details");
  if (!fs.existsSync(detailsDir)) {
    errors.push(`leg j6: program_details sidecars not found at ${detailsDir}`);
    return;
  }
  const j6 = [];
  let sidecarsScanned = 0;
  let sidecarAliasRows = 0;
  for (const file of fs.readdirSync(detailsDir)) {
    if (!file.endsWith(".json")) continue;
    const pe = file.slice(0, -5);
    let sidecar;
    try {
      sidecar = JSON.parse(fs.readFileSync(path.join(detailsDir, file), "utf8"));
    } catch (e) {
      errors.push(`leg j6: ${file} failed to parse (${e.message})`);
      continue;
    }
    sidecarsScanned++;
    const counts = new Map();
    for (const m of sidecar.mentions || []) {
      if (m?.evidence_kind !== "alias") continue;
      const ratified = ratifiedKeys.get(String(m.matched_term || "").toUpperCase());
      if (!ratified) continue;
      sidecarAliasRows++;
      if (ratified.pes.includes(pe)) continue;
      const key = `${ratified.alias}→${pe}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key, n] of counts) {
      const [alias, badPe] = key.split("→");
      j6.push(
        `/program/${badPe}/ "${programs[badPe] || "(not in dim_programs)"}" publishes ` +
          `${n} alias-tier "${alias}" filing row(s); "${alias}" is ratified to ` +
          RATIFIED_ALIASES[alias].join(", "),
      );
    }
  }
  if (j6.length > 0) {
    errors.push(
      `leg j6 export-fidelity: ${j6.length} shipped program sidecar(s) publish a ` +
        `ratified alias on an unratified program — the exporter has not re-run ` +
        `since the seed changed (first ${MAX_LISTED}):`,
    );
    for (const f of j6.slice(0, MAX_LISTED)) errors.push(`  ${f}`);
    if (j6.length > MAX_LISTED) errors.push(`  ... and ${j6.length - MAX_LISTED} more`);
  } else {
    notes.push(
      `leg j6: ${sidecarsScanned} program sidecars scanned, ${sidecarAliasRows} ` +
        `ratified-alias row(s) shipped, every one on its ratified program ✓`,
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

// ─────────────────────────────────────────────────────────────────────────────
// LEG (k) — THE BADGE MUST MEAN WHAT THE DATA SAYS  (tri-persona review Wave 2)
// ─────────────────────────────────────────────────────────────────────────────
//
// The shipped defect: `dim_programs.fully_reconciled` was bool_and(reconciled)
// over EVERY J-book detail scenario. One of those, `AllPriorYears`, is a
// cumulative to-date element with no R-1/P-1 display column, so
// govbudget.jbooks.reconcile never issues a Gate A/B check for it and its rows
// keep reconciled=false permanently — 0 of 3,267 rows in the shipped PB2026
// corpus. The program-page badge read that flag, so 1,310 programs whose every
// CHECKED scenario ties wore the identical "Partial Reconciliation" warning as
// the 87 with a genuine failure, and a reader had no way to separate them.
// B-21 (all checks tie) and F-47 (five real BudgetYearOne failures) rendered
// the same words. Every number on both pages was true and cited; the falsehood
// was in a LABEL, which is precisely the class the 24-gate suite checked
// nowhere. The term was also undefined on the page and absent from /glossary/.
//
// This leg is the general form of that: a verdict rendered on a page must be
// the verdict its own evidence supports, and a term the site invents must be
// defined where a reader meets it.
//
//   k1 VERDICT AGREEMENT — the badge a program page RENDERS (read from the
//      badge's own text, so the leg works on any build, before or after the
//      attribute contract below existed) must equal the verdict the warehouse
//      supports for that program element. Truth comes from
//      reconbadge-recompute.py, which derives the checked scenario set from
//      reconcile.scenario_map() itself — never from dim_programs, whose column
//      is the artifact under test, and never from a second transcription of
//      the scenario list (a gate that agrees with a copy of the rule it is
//      checking agrees with itself).
//   k2 TERM DEFINED — every distinct badge term rendered on a program page
//      must appear verbatim in the built /glossary/ page, and the badge must
//      LINK there. A verdict word that exists nowhere else on the site is not
//      a disclosure; "Partial Reconciliation" appeared on 1,410 pages and in
//      no definition anywhere.
//   k3 STATE DECLARED — every reconciliation badge must carry
//      data-reconciliation-badge, so the rendered verdict is machine-readable
//      and k1 can never silently degrade into text-sniffing alone.
//   k4 NON-VACUITY (structural, not a pinned floor) — the population is the
//      RENDERED set: every out/program/*/index.html that renders one of the
//      known reconciliation badges. It must be non-empty; every full-tier page
//      must join to a warehouse verdict; and the badge vocabulary must be
//      exercised — a corpus in which no page ever renders a failure verdict
//      would satisfy k1 trivially while proving nothing about the distinction
//      this leg exists to protect.
//
// SPLIT KEYS. dim_programs' grain is (pe_bli, account, org): 11 pe_blis in the
// shipped corpus publish two-or-more pages, and the warehouse verdict here is
// per pe_bli, so those pages are checked for vocabulary/definition/declaration
// (k2-k4) but excluded from k1's equality. The count is reported in the notes;
// it is a disclosed hole, never a silent one.

/** Rendered badge text → the verdict it asserts. Legacy wordings included so
 *  the leg reads a PRE-fix build honestly instead of finding nothing. */
const RECON_BADGE_VERDICT = new Map([
  ["Reconciled", "reconciled"],
  ["Fully Reconciled", "reconciled"],
  ["Partial Reconciliation", "partial"],
  ["No detail to reconcile", "no-detail"],
  ["Summary figures (R-1/P-1)", "rollup"],
]);

function runReconciliationBadgeLeg(pages, errors, notes) {
  const script = path.join(__dirname, "reconbadge-recompute.py");
  if (!fs.existsSync(script)) {
    errors.push(`leg k: recompute helper missing at ${script}`);
    return;
  }
  const res = spawnSync("uv", ["run", "python", script], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    errors.push(
      `leg k: reconbadge-recompute.py failed (status ${res.status}): ` +
        `${(res.stderr || res.error?.message || "").slice(0, 400)}`,
    );
    return;
  }
  let truth;
  try {
    truth = JSON.parse(res.stdout);
  } catch (e) {
    errors.push(`leg k: recompute produced non-JSON output (${e.message})`);
    return;
  }
  if (truth.__error__) {
    errors.push(`leg k: recompute could not run — ${truth.__error__}`);
    return;
  }

  // Pages published under more than one slug for the same pe_bli — see the
  // SPLIT KEYS note above.
  const slugsByPe = new Map();
  const peBySlug = new Map();
  const programsPath = path.join(repoRoot, "data", "site", "json", "programs.json");
  if (!fs.existsSync(programsPath)) {
    errors.push("leg k: data/site/json/programs.json missing — cannot resolve page slugs");
    return;
  }
  let programRows;
  try {
    programRows = JSON.parse(fs.readFileSync(programsPath, "utf8"));
  } catch (e) {
    errors.push(`leg k: programs.json unreadable (${e.message})`);
    return;
  }
  for (const row of programRows) {
    if (!row || typeof row.pe_bli !== "string") continue;
    const slug = typeof row.slug === "string" ? row.slug : row.pe_bli;
    peBySlug.set(slug, row.pe_bli);
    if (!slugsByPe.has(row.pe_bli)) slugsByPe.set(row.pe_bli, new Set());
    slugsByPe.get(row.pe_bli).add(slug);
  }

  const glossaryPath = path.join(outDir, "glossary", "index.html");
  const glossaryText = fs.existsSync(glossaryPath)
    ? parse(fs.readFileSync(glossaryPath, "utf8"), { comment: false }).text
    : null;
  if (glossaryText === null) {
    errors.push("leg k2: out/glossary/index.html was not built — no term can be defined");
  }

  const verdictCounts = new Map();
  const mismatches = [];
  const undeclared = [];
  const unlinked = [];
  const unknownBadge = [];
  const undefinedTerms = new Set();
  let badgePages = 0;
  let splitSkipped = 0;
  let noDetailPages = 0;

  for (const { pe: slug, htmlPath } of pages) {
    const relPath = path.relative(outDir, htmlPath);
    let root;
    try {
      root = parse(fs.readFileSync(htmlPath, "utf8"), { comment: false });
    } catch {
      continue; // the main scan already reported the parse failure
    }
    // Read what a reader reads: the badge's own rendered words.
    let badgeEl = null;
    let term = null;
    for (const el of root.querySelectorAll('[data-slot="badge"]')) {
      const t = (el.text || "").trim();
      if (RECON_BADGE_VERDICT.has(t)) {
        badgeEl = el;
        term = t;
        break;
      }
    }
    if (!badgeEl) {
      unknownBadge.push({ slug, rel: relPath });
      continue;
    }
    badgePages++;
    const verdict = RECON_BADGE_VERDICT.get(term);
    verdictCounts.set(verdict, (verdictCounts.get(verdict) ?? 0) + 1);

    // k3 — the state must be declared, not only spelled.
    if (!badgeEl.getAttribute("data-reconciliation-badge")) {
      if (undeclared.length < MAX_LISTED) undeclared.push(`${relPath}: "${term}"`);
    }

    // k2 — defined in the glossary, and reachable from the badge itself.
    if (glossaryText !== null && verdict !== "rollup" && !glossaryText.includes(term)) {
      undefinedTerms.add(term);
    }
    if (verdict !== "rollup") {
      const html = badgeEl.parentNode ? badgeEl.parentNode.toString() : badgeEl.toString();
      if (!/href="[^"]*\/glossary\//.test(html)) {
        if (unlinked.length < MAX_LISTED) unlinked.push(`${relPath}: "${term}"`);
      }
    }

    if (verdict === "rollup") continue; // R-1/P-1 summary tier: no J-book detail

    const pe = peBySlug.get(slug) ?? slug;
    if ((slugsByPe.get(pe)?.size ?? 1) > 1) {
      splitSkipped++;
      continue; // disclosed hole — see SPLIT KEYS above
    }
    // A pe_bli with no in-scope detail row — or with no stg_budget_details row
    // at all (the trajectory-only feed programs, which have a page but no
    // R-2/P-40 exhibit) — supports exactly one verdict: nothing was checked.
    const expected = truth.verdicts[pe] ?? "no-detail";
    if (!truth.verdicts[pe]) noDetailPages++;
    if (expected !== verdict) {
      if (mismatches.length < MAX_LISTED) {
        mismatches.push(
          `${relPath}: renders "${term}" (${verdict}) but the warehouse says ` +
            `${expected} for ${pe}`,
        );
      }
      const k = `${verdict}->${expected}`;
      verdictCounts.set(`MISMATCH ${k}`, (verdictCounts.get(`MISMATCH ${k}`) ?? 0) + 1);
    }
  }

  // ── k4 NON-VACUITY (structural) ──
  if (badgePages === 0) {
    errors.push(
      "leg k is VACUOUS: not one of the " +
        `${pages.length} program pages renders a recognised reconciliation badge ` +
        `(known wordings: ${[...RECON_BADGE_VERDICT.keys()].join(" / ")})`,
    );
    return;
  }
  // A page with no reconciliation badge is legitimate in exactly one shape:
  // the DISAMBIGUATION page a split key publishes at its bare code
  // (/program/0145/ → "this code is used by 2 separate programs"), which
  // carries no figures of its own. That set is derived from programs.json —
  // every pe_bli with more than one row — never hardcoded, so a genuinely
  // badgeless program page can never hide inside it.
  const splitPes = new Set(
    [...slugsByPe].filter(([, slugs]) => slugs.size > 1).map(([pe]) => pe),
  );
  const unexplainedBadgeless = unknownBadge.filter((p) => !splitPes.has(p.slug));
  const missingDisambiguation = [...splitPes].filter(
    (pe) => !unknownBadge.some((p) => p.slug === pe),
  );
  if (unexplainedBadgeless.length) {
    errors.push(
      `leg k4: ${unexplainedBadgeless.length} program page(s) render NO recognised ` +
        `reconciliation badge and are not a split key's disambiguation page — ` +
        `the population is not the rendered set: ` +
        unexplainedBadgeless.slice(0, MAX_LISTED).map((p) => p.rel).join(", "),
    );
  }
  if (missingDisambiguation.length) {
    errors.push(
      `leg k4: ${missingDisambiguation.length} split key(s) publish no badgeless ` +
        `disambiguation page — the badgeless set no longer matches programs.json's ` +
        `own multi-row keys: ${missingDisambiguation.slice(0, MAX_LISTED).join(", ")}`,
    );
  }
  for (const required of ["reconciled", "partial"]) {
    if (!verdictCounts.get(required)) {
      errors.push(
        `leg k4: no program page renders the "${required}" verdict — the badge ` +
          "vocabulary is not exercised, so k1 proves nothing about the " +
          "distinction between a clean line and a failing one",
      );
    }
  }

  // ── k1 ──
  const nMismatch = [...verdictCounts]
    .filter(([k]) => k.startsWith("MISMATCH "))
    .reduce((a, [, v]) => a + v, 0);
  if (nMismatch) {
    const breakdown = [...verdictCounts]
      .filter(([k]) => k.startsWith("MISMATCH "))
      .map(([k, v]) => `${v}× ${k.slice(9)}`)
      .join(", ");
    errors.push(
      `leg k1: ${nMismatch} program page(s) render a reconciliation verdict the ` +
        `warehouse does not support (${breakdown}). AllPriorYears is ` +
        `${truth.scenario_rows?.AllPriorYears?.reconciled ?? 0} of ` +
        `${truth.scenario_rows?.AllPriorYears?.rows ?? 0} reconciled BY DESIGN ` +
        `(reconcile.scenario_map() issues no check for it); the checked set is ` +
        `${truth.in_scope_scenarios.join("/")}. First ${Math.min(mismatches.length, MAX_LISTED)}: ` +
        mismatches.join(" | "),
    );
  }
  // ── k2 ──
  if (undefinedTerms.size) {
    errors.push(
      `leg k2: badge term(s) rendered on program pages but defined nowhere in ` +
        `/glossary/: ${[...undefinedTerms].map((t) => `"${t}"`).join(", ")}`,
    );
  }
  if (unlinked.length) {
    errors.push(
      `leg k2: ${unlinked.length}+ reconciliation badge(s) do not link to ` +
        `/glossary/ — the term is unreachable from where the reader meets it: ` +
        unlinked.join(", "),
    );
  }

  // ── k3 ──
  if (undeclared.length) {
    errors.push(
      `leg k3: ${undeclared.length}+ reconciliation badge(s) carry no ` +
        `data-reconciliation-badge attribute: ${undeclared.join(", ")}`,
    );
  }

  notes.push(
    `leg k: ${badgePages} program pages carry a reconciliation badge ` +
      `(${[...verdictCounts]
        .filter(([k]) => !k.startsWith("MISMATCH "))
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}); warehouse verdicts ` +
      `${JSON.stringify(truth.counts)}; ${splitSkipped} split-key page(s) ` +
      `excluded from k1 (one pe_bli, several pages); ${noDetailPages} page(s) ` +
      `expect "no detail" (no in-scope J-book row at all)`,
  );
}
