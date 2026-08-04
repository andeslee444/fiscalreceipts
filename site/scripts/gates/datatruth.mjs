/**
 * gate 24 — datatruth_gate (PM-review Sprint 2, spec §P1-5)
 *
 * "The one page built to let people check the site's work" must not lie about
 * itself. Two families of claim are verified against the BUILT artifact:
 *
 *  (a) dataset-card completeness — the set of dataset names rendered in the
 *      /data/ inventory table equals the set of Explorer parquets actually
 *      shipped in data/site/data/. Both directions: a shipped parquet with no
 *      card (budget_lines_decade was undocumented for the whole 5E era) and a
 *      card naming a parquet that does not exist are equally failures.
 *  (b) rendered row-count truth — every card's VISIBLE Rows cell equals the
 *      parquet's real row count, recomputed independently from the parquet
 *      files by datatruth-recompute.py (DuckDB). The gate reads rendered text,
 *      never a data-* attribute carrying the number, so a page that renders a
 *      stale literal cannot satisfy it by also emitting a correct attribute.
 *  (c) Explorer picker truth — the `#dataset-select` options (the actual
 *      queryable set: lib/duckdb registerDatasets) cover exactly the same
 *      parquets, and each option's rendered "(N rows)" matches the same
 *      recompute. A dataset documented in the table but unregistered in the
 *      engine is a lie of a different shape.
 *  (d) corpus statement — [data-corpus-statement] renders on /programs/,
 *      /years/, /methodology/ and /data/; every instance states the SAME two
 *      numbers in the canonical sentence shape; those numbers equal the
 *      program_details sidecar count (browsable pages) and programs.json
 *      length (detail-grade), recomputed here from data/site/json; and the
 *      §P0-5 scope tail is present on each.
 *  (e) /methodology/ §3's per-build check counts equal the artifacts that
 *      DEFINE them (dbt manifest, the verify.mjs gate registry, the eval set),
 *      recomputed here rather than read back from site_meta.
 *  (f) table sort determinism (§P1-7) — every data table declares its order
 *      via [data-sort-table]/[data-sort-order] and renders monotonically in
 *      it. An enumerated contract set (incl. the lobbying table that shipped
 *      2024, 2026, 2025) plus a sweep of ~400 built pages. See leg f's own
 *      block at the bottom of this file.
 *  (g) curated entity-family merge (§P1-3) — /companies/ split Raytheon
 *      ($43.7B, #4) from RTX ($24.6B, #6): one company, two rows. This leg
 *      asserts on the BUILT page that the merge held (no curated family
 *      appears in two rows) and that every curated event's source_url renders
 *      as an external reference on /companies/families/. See leg g's own
 *      block at the bottom of this file.
 *
 * WHY a built-artifact gate and not an export-time assertion: the defect this
 * closes was NEVER an export defect — the exporter's counts were correct and
 * the parquets were fresh; the /data/ page hardcoded literals that had drifted
 * from them. An export-time assertion cannot see rendered HTML and so cannot
 * catch it. This gate reads out/ and the parquets and compares the two.
 *
 * Export: runDataTruthGate() → { pass, errors, notes }
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(siteRoot, "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(repoRoot, "data", "site", "json");
const parquetDir = path.resolve(repoRoot, "data", "site", "data");

/** Pages that must carry the canonical corpus statement (§P1-5). */
const CORPUS_PAGES = ["/programs/", "/years/", "/methodology/", "/data/"];

/** Canonical corpus sentence shape — the two numbers are read from HERE. */
const CORPUS_RE =
  /([\d,]+)\s+browsable program pages;\s*([\d,]+)\s+of them carry detail-grade/i;

/** §P0-5 scope tail — same language as the hero qualifier. */
const CORPUS_SCOPE_TAIL =
  "excludes personnel, o&m, and appropriations not covered by the r-1/p-1 rollups";

/** A page with fewer cards than this is a parse failure, not a pass. */
const MIN_DATASET_CARDS = 10;

function htmlFor(url) {
  return path.join(outDir, ...url.split("/").filter(Boolean), "index.html");
}

function readHtml(url) {
  const p = htmlFor(url);
  if (!fs.existsSync(p)) return null;
  return parse(fs.readFileSync(p, "utf8"));
}

/** Rendered text → integer. "8,549" → 8549; anything else → null. */
function parseCount(text) {
  const m = String(text ?? "").trim().match(/^([\d,]+)$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function norm(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Independent parquet recompute (DuckDB, via uv run python). */
function recomputeParquets() {
  const script = path.join(__dirname, "datatruth-recompute.py");
  const res = spawnSync("uv", ["run", "python", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `datatruth-recompute.py failed (status ${res.status}): ${
        (res.stderr || "").slice(-800)
      }`,
    );
  }
  const parsed = JSON.parse(res.stdout);
  if (parsed.__error__) throw new Error(parsed.__error__);
  return parsed;
}

export async function runDataTruthGate() {
  const errors = [];
  const notes = [];

  // ── Independent truth: the parquets themselves ────────────────────────────
  let truth;
  try {
    truth = recomputeParquets();
  } catch (e) {
    return {
      pass: false,
      errors: [`parquet recompute: ${e.message}`],
      notes,
    };
  }
  const parquetNames = Object.keys(truth).sort();
  if (parquetNames.length < MIN_DATASET_CARDS) {
    errors.push(
      `parquet recompute: only ${parquetNames.length} parquets found in ${parquetDir} — expected ≥${MIN_DATASET_CARDS} (non-vacuous check)`,
    );
  }
  notes.push(
    `parquet recompute: ${parquetNames.length} Explorer parquets read from data/site/data/ ✓`,
  );

  const dataRoot = readHtml("/data/");
  if (!dataRoot) {
    return {
      pass: false,
      errors: [`missing built page: ${htmlFor("/data/")} — run npm run build`],
      notes,
    };
  }

  // ── leg a: dataset-card completeness ──────────────────────────────────────
  const cardEls = dataRoot.querySelectorAll("[data-dataset-card]");
  const cardNames = cardEls.map((el) => el.getAttribute("data-dataset-card"));
  const cardSet = new Set(cardNames);

  if (cardEls.length < MIN_DATASET_CARDS) {
    errors.push(
      `leg a (/data/): only ${cardEls.length} [data-dataset-card] rows found — expected ≥${MIN_DATASET_CARDS} (the inventory table must expose one row per shipped parquet)`,
    );
  }
  const missingCards = parquetNames.filter((n) => !cardSet.has(n));
  if (missingCards.length > 0) {
    errors.push(
      `leg a (/data/): ${missingCards.length} shipped parquet(s) have NO dataset card: ${missingCards.join(", ")}`,
    );
  }
  const phantomCards = [...cardSet].filter((n) => !(n in truth));
  if (phantomCards.length > 0) {
    errors.push(
      `leg a (/data/): ${phantomCards.length} dataset card(s) name a parquet that is not shipped: ${phantomCards.join(", ")}`,
    );
  }
  if (missingCards.length === 0 && phantomCards.length === 0 && cardEls.length >= MIN_DATASET_CARDS) {
    notes.push(
      `leg a: /data/ documents all ${parquetNames.length} shipped parquets, no phantoms ✓`,
    );
  }

  // ── leg b: rendered row-count truth ───────────────────────────────────────
  const countMismatches = [];
  for (const el of cardEls) {
    const name = el.getAttribute("data-dataset-card");
    const cell = el.querySelector("[data-dataset-rowcount]");
    if (!cell) {
      countMismatches.push(`${name}: no [data-dataset-rowcount] cell rendered`);
      continue;
    }
    const rendered = parseCount(cell.text);
    if (rendered === null) {
      countMismatches.push(
        `${name}: rows cell text ${JSON.stringify(norm(cell.text))} is not an integer`,
      );
      continue;
    }
    const actual = truth[name]?.rows;
    if (actual === undefined) continue; // already reported as a phantom card
    if (rendered !== actual) {
      countMismatches.push(
        `${name}: page renders ${rendered.toLocaleString("en-US")}, parquet has ${actual.toLocaleString("en-US")}`,
      );
    }
  }
  if (countMismatches.length > 0) {
    errors.push(
      `leg b (/data/): ${countMismatches.length} dataset card row-count(s) disagree with the shipped parquet — ${countMismatches.join("; ")}`,
    );
  } else if (cardEls.length > 0) {
    notes.push(
      `leg b: all ${cardEls.length} rendered row counts match the parquets exactly ✓`,
    );
  }

  // ── leg c: Explorer picker truth ──────────────────────────────────────────
  const select = dataRoot.querySelector("#dataset-select");
  if (!select) {
    errors.push(
      "leg c (/data/): no #dataset-select rendered — the Explorer picker is the queryable dataset set",
    );
  } else {
    const options = select.querySelectorAll("option");
    const optNames = options.map((o) => o.getAttribute("value"));
    const optSet = new Set(optNames);
    const unregistered = parquetNames.filter((n) => !optSet.has(n));
    if (unregistered.length > 0) {
      errors.push(
        `leg c (/data/): ${unregistered.length} shipped parquet(s) are NOT selectable in the Explorer: ${unregistered.join(", ")}`,
      );
    }
    const optMismatches = [];
    for (const o of options) {
      const name = o.getAttribute("value");
      const m = norm(o.text).match(/\(([\d,]+)\s+rows\)/);
      if (!m) {
        optMismatches.push(`${name}: option text ${JSON.stringify(norm(o.text))} states no row count`);
        continue;
      }
      const rendered = Number(m[1].replace(/,/g, ""));
      const actual = truth[name]?.rows;
      if (actual === undefined) {
        optMismatches.push(`${name}: option names a parquet that is not shipped`);
        continue;
      }
      if (rendered !== actual) {
        optMismatches.push(
          `${name}: option says ${rendered.toLocaleString("en-US")} rows, parquet has ${actual.toLocaleString("en-US")}`,
        );
      }
    }
    if (optMismatches.length > 0) {
      errors.push(
        `leg c (/data/): ${optMismatches.length} Explorer option(s) disagree with the shipped parquet — ${optMismatches.join("; ")}`,
      );
    } else if (unregistered.length === 0) {
      notes.push(
        `leg c: all ${options.length} Explorer options registered and row-count-true ✓`,
      );
    }
  }

  // ── leg d: one canonical corpus statement ─────────────────────────────────
  // Independent recompute of the two corpus numbers from the data sidecars.
  let expectedPages = null;
  let expectedDetail = null;
  const pdDir = path.join(jsonDir, "program_details");
  if (fs.existsSync(pdDir)) {
    expectedPages = fs
      .readdirSync(pdDir)
      .filter((f) => f.endsWith(".json")).length;
  }
  const programsPath = path.join(jsonDir, "programs.json");
  if (fs.existsSync(programsPath)) {
    expectedDetail = JSON.parse(fs.readFileSync(programsPath, "utf8")).length;
  }
  if (expectedPages === null || expectedDetail === null) {
    errors.push(
      "leg d: cannot recompute corpus numbers — data/site/json/program_details/ or programs.json missing",
    );
  } else {
    notes.push(
      `leg d: corpus recompute — ${expectedPages} program pages, ${expectedDetail} detail-grade ✓`,
    );
  }

  const seen = [];
  for (const url of CORPUS_PAGES) {
    const root = readHtml(url);
    if (!root) {
      errors.push(`leg d (${url}): built page missing at ${htmlFor(url)}`);
      continue;
    }
    const els = root.querySelectorAll("[data-corpus-statement]");
    if (els.length === 0) {
      errors.push(
        `leg d (${url}): no [data-corpus-statement] — the canonical corpus block must render on every page that states corpus size`,
      );
      continue;
    }
    for (const el of els) {
      const text = norm(el.text);
      const m = text.match(CORPUS_RE);
      if (!m) {
        errors.push(
          `leg d (${url}): corpus statement does not match the canonical shape — got ${JSON.stringify(text.slice(0, 160))}`,
        );
        continue;
      }
      const pages = Number(m[1].replace(/,/g, ""));
      const detail = Number(m[2].replace(/,/g, ""));
      seen.push({ url, pages, detail });
      if (expectedPages !== null && pages !== expectedPages) {
        errors.push(
          `leg d (${url}): corpus statement says ${pages.toLocaleString("en-US")} browsable program pages, sidecars have ${expectedPages.toLocaleString("en-US")}`,
        );
      }
      if (expectedDetail !== null && detail !== expectedDetail) {
        errors.push(
          `leg d (${url}): corpus statement says ${detail.toLocaleString("en-US")} detail-grade, programs.json has ${expectedDetail.toLocaleString("en-US")}`,
        );
      }
      if (!text.toLowerCase().includes(CORPUS_SCOPE_TAIL)) {
        errors.push(
          `leg d (${url}): corpus statement is missing the §P0-5 scope tail ("${CORPUS_SCOPE_TAIL}")`,
        );
      }
    }
  }
  // Cross-page agreement — the whole point of "one canonical statement".
  const distinct = new Set(seen.map((s) => `${s.pages}/${s.detail}`));
  if (distinct.size > 1) {
    errors.push(
      `leg d: corpus size is stated ${distinct.size} different ways across pages — ${seen
        .map((s) => `${s.url} ${s.pages}/${s.detail}`)
        .join(", ")}`,
    );
  } else if (seen.length === CORPUS_PAGES.length && distinct.size === 1) {
    notes.push(
      `leg d: one corpus statement (${[...distinct][0]}) on all ${CORPUS_PAGES.length} pages ✓`,
    );
  }

  // ── leg e: /methodology/ per-build check counts ───────────────────────────
  // §P1-5, same defect class as the dataset row counts: §3 used to author
  // "197 automated test functions across 42 test modules ... 21 dbt
  // data-model assertions ... 45 question-answer pairs ... ≥41 correct".
  // Every literal had rotted. Each number is now derived at export; this leg
  // recomputes it INDEPENDENTLY from the artifact that defines it (never from
  // site_meta — that is the thing under test) and compares against the
  // rendered text.
  const methodRoot = readHtml("/methodology/");
  if (!methodRoot) {
    errors.push("leg e: built /methodology/ missing");
  } else {
    const el = methodRoot.querySelector("[data-build-checks]");
    if (!el) {
      errors.push(
        "leg e (/methodology/): no [data-build-checks] — §3's per-build check counts must render from build-derived values",
      );
    } else {
      const text = norm(el.text);

      // Independent recomputes from the defining artifacts.
      const expected = {};
      const dbtManifest = path.join(repoRoot, "dbt", "target", "manifest.json");
      if (fs.existsSync(dbtManifest)) {
        const nodes = JSON.parse(fs.readFileSync(dbtManifest, "utf8")).nodes ?? {};
        expected.dbt = Object.values(nodes).filter(
          (n) => n.resource_type === "test",
        ).length;
      }
      const verifyMjs = path.join(__dirname, "..", "verify.mjs");
      if (fs.existsSync(verifyMjs)) {
        expected.gates = (
          fs.readFileSync(verifyMjs, "utf8").match(/gateResults\.push\(\{\s*n:\s*\d+/g) ?? []
        ).length;
      }
      const evalYaml = path.join(repoRoot, "evals", "phase5_questions.yaml");
      if (fs.existsSync(evalYaml)) {
        expected.evalQs = (
          fs.readFileSync(evalYaml, "utf8").match(/^- id:/gm) ?? []
        ).length;
      }
      const vp5 = path.join(repoRoot, "src", "govbudget", "verify_phase5.py");
      if (fs.existsSync(vp5)) {
        const m = fs.readFileSync(vp5, "utf8").match(/^ACCURACY_THRESHOLD\s*=\s*(\d+)/m);
        if (m) expected.evalThreshold = Number(m[1]);
      }

      const checks = [
        [expected.dbt, /([\d,]+)\s+dbt data-model assertions/, "dbt assertions"],
        [expected.gates, /([\d,]+)\s+site verification gates/, "site verification gates"],
        [expected.evalQs, /([\d,]+)\s+question-answer pairs/, "eval questions"],
        [expected.evalThreshold, /at least\s+([\d,]+)\s+correct answers/, "eval threshold"],
      ];
      let checked = 0;
      for (const [want, re, label] of checks) {
        if (want === undefined) continue;
        const m = text.match(re);
        if (!m) {
          errors.push(
            `leg e (/methodology/): §3 states no ${label} — expected ${want} from the defining artifact`,
          );
          continue;
        }
        const got = Number(m[1].replace(/,/g, ""));
        checked += 1;
        if (got !== want) {
          errors.push(
            `leg e (/methodology/): §3 says ${got.toLocaleString("en-US")} ${label}, the defining artifact has ${want.toLocaleString("en-US")}`,
          );
        }
      }
      if (checked === 0) {
        errors.push(
          "leg e: no per-build count could be recomputed (vacuous) — the defining artifacts were all unreadable",
        );
      }
      // The literals this leg exists to prevent must never come back.
      for (const rotted of ["197 automated test", "42 test modules", "45 question-answer"]) {
        if (norm(methodRoot.text).includes(rotted)) {
          errors.push(
            `leg e (/methodology/): the rotted literal "${rotted}" is rendered again — per-build counts must be build-derived`,
          );
        }
      }
      if (errors.every((e) => !e.startsWith("leg e"))) {
        notes.push(
          `leg e: /methodology/ per-build counts match their defining artifacts (${checked} checked) ✓`,
        );
      }
    }
  }

  // ── leg f: table sort determinism ─────────────────────────────────────────
  runSortLeg(errors, notes);

  // ── leg g: curated entity-family merge (§P1-3) ────────────────────────────
  runFamilyMergeLeg(errors, notes);

  return { pass: errors.length === 0, errors, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// leg f — table sort determinism (§P1-7)
// ═══════════════════════════════════════════════════════════════════════════
//
// `/company/lockheed-martin/` rendered its Lobbying Activity years as
// 2024, 2026, 2025. fct_influence had no ORDER BY, so the table showed
// whatever order the query returned; 33 of the 66 families with filings were
// out of order, and the same class of defect ran through mentions, awards,
// linked-program chips and filing sub-lists. On a site whose entire claim is
// "check our work", a visibly unsorted table invites doubt about the numbers
// in it.
//
// The contract every data table now ships, and this leg enforces:
//   [data-sort-table="<name>"] [data-sort-order="<key>:asc|desc"]   container
//   [data-sort-value="<v>"]                                          each row
// data-sort-value is the COMPARATOR'S OWN INPUT, serialized — not a rendered
// cell — so what is checked is the order the sort actually produced.
//
// Two halves, because either alone is toothless:
//   (1) REQUIRED: an enumerated set of (page, table) pairs must be present
//       with the exact declared order. Deleting an attribute, or quietly
//       flipping a table to `asc`, fails — it cannot pass by vanishing.
//   (2) SWEEP: across a large page sample, EVERY [data-sort-table] found must
//       be monotonic in its declared direction. New tables are covered the
//       day they ship the contract.

/** (page, table, declared order, min rows) pairs that MUST exist. */
const SORT_CONTRACTS = [
  // The reported repro. Lockheed has three filing years — 2026, 2025, 2024.
  ["/company/lockheed-martin/", "lobbying-activity", "filing_year:desc", 3],
  ["/companies/", "companies", "total_obligation:desc", 100],
  ["/programs/", "programs", "fy2026_total:desc", 100],
  ["/filings/", "filings", "mentions_then_year_desc_then_client:asc", 25],
  ["/district/CO-05/", "district-programs", "total_obligation:desc", 3],
];

/** Directories under out/ swept for the monotonicity check, and how many. */
const SORT_SWEEP = [
  ["company", 200],
  ["district", 120],
  ["program", 80],
];

/**
 * Compare two data-sort-value strings the way the page's comparator does:
 * numerically when BOTH parse as numbers (including the ±Infinity sentinels
 * the tables emit for missing values), else by localeCompare — which is what
 * the string-keyed sorts use, evaluated in this same Node/ICU during SSG.
 */
function sortCmp(a, b) {
  const an = Number(a);
  const bn = Number(b);
  const aNum = a.trim() !== "" && !Number.isNaN(an);
  const bNum = b.trim() !== "" && !Number.isNaN(bn);
  if (aNum && bNum) return an === bn ? 0 : an < bn ? -1 : 1;
  return a.localeCompare(b);
}

/**
 * Check one container. Returns null when monotonic, else a description of the
 * FIRST violating adjacent pair (the shape a human can act on).
 */
function checkSortedContainer(el) {
  const order = el.getAttribute("data-sort-order") ?? "";
  const m = order.match(/^([A-Za-z0-9_]+):(asc|desc)$/);
  if (!m) {
    return `declares data-sort-order=${JSON.stringify(order)}, which is not "<key>:asc|desc"`;
  }
  const dir = m[2];
  const rows = el.querySelectorAll("[data-sort-value]");
  const values = rows.map((r) => r.getAttribute("data-sort-value") ?? "");
  for (let i = 1; i < values.length; i++) {
    const cmp = sortCmp(values[i - 1], values[i]);
    const bad = dir === "desc" ? cmp < 0 : cmp > 0;
    if (bad) {
      return (
        `${order} is violated at rows ${i}→${i + 1}: ` +
        `${JSON.stringify(values[i - 1])} then ${JSON.stringify(values[i])}` +
        ` (rendered ${values.length} rows)`
      );
    }
  }
  return null;
}

/** Every built index.html under out/<dir>/, capped at `limit`, sorted. */
function sampleBuiltPages(dir, limit) {
  const root = path.join(outDir, dir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name, "index.html"))
    .filter((p) => fs.existsSync(p))
    .sort()
    .slice(0, limit);
}

function runSortLeg(errors, notes) {
  // ── (1) the enumerated contracts ────────────────────────────────────────
  let contractsOk = 0;
  for (const [url, table, expectOrder, minRows] of SORT_CONTRACTS) {
    const root = readHtml(url);
    if (!root) {
      errors.push(`leg f (${url}): built page missing at ${htmlFor(url)}`);
      continue;
    }
    const el = root.querySelector(`[data-sort-table="${table}"]`);
    if (!el) {
      errors.push(
        `leg f (${url}): no [data-sort-table="${table}"] — every data table must declare its default sort`,
      );
      continue;
    }
    const declared = el.getAttribute("data-sort-order");
    if (declared !== expectOrder) {
      errors.push(
        `leg f (${url} ${table}): declares data-sort-order=${JSON.stringify(
          declared,
        )}, expected ${JSON.stringify(expectOrder)}`,
      );
      continue;
    }
    const nRows = el.querySelectorAll("[data-sort-value]").length;
    if (nRows < minRows) {
      errors.push(
        `leg f (${url} ${table}): only ${nRows} row(s) carry data-sort-value — expected ≥${minRows} (a table that renders nothing cannot prove it is sorted)`,
      );
      continue;
    }
    const violation = checkSortedContainer(el);
    if (violation) {
      errors.push(`leg f (${url} ${table}): ${violation}`);
      continue;
    }
    contractsOk += 1;
  }
  if (contractsOk === SORT_CONTRACTS.length) {
    notes.push(
      `leg f: all ${SORT_CONTRACTS.length} declared table sorts present and monotonic (incl. lobbying-activity year desc) ✓`,
    );
  }

  // ── (2) the sweep ───────────────────────────────────────────────────────
  const sweepViolations = [];
  let sweptPages = 0;
  let sweptTables = 0;
  for (const [dir, limit] of SORT_SWEEP) {
    const pages = sampleBuiltPages(dir, limit);
    if (pages.length === 0) {
      errors.push(
        `leg f sweep: no built pages under out/${dir}/ — the sweep would be vacuous`,
      );
      continue;
    }
    for (const p of pages) {
      sweptPages += 1;
      const root = parse(fs.readFileSync(p, "utf8"));
      for (const el of root.querySelectorAll("[data-sort-table]")) {
        // Containers with 0-1 rows are trivially sorted; still counted, so a
        // build that renders every table empty cannot inflate the tally.
        sweptTables += 1;
        const violation = checkSortedContainer(el);
        if (violation) {
          sweepViolations.push(
            `${path.relative(outDir, p)} [${el.getAttribute("data-sort-table")}]: ${violation}`,
          );
        }
      }
    }
  }
  if (sweptTables < 100) {
    errors.push(
      `leg f sweep: only ${sweptTables} declared tables found across ${sweptPages} pages — expected ≥100 (non-vacuous check)`,
    );
  }
  if (sweepViolations.length > 0) {
    errors.push(
      `leg f sweep: ${sweepViolations.length} table(s) render out of their declared order — ${sweepViolations
        .slice(0, 5)
        .join(" | ")}`,
    );
  } else if (sweptTables >= 100) {
    notes.push(
      `leg f sweep: ${sweptTables} declared tables across ${sweptPages} pages, all monotonic ✓`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// leg g — the curated entity-family merge held (§P1-3)
// ═══════════════════════════════════════════════════════════════════════════
//
// The defect: `/companies/` listed RAYTHEON COMPANY $43.7B at #4 and RTX CORP
// $24.6B at #6. One company — Raytheon renamed to RTX in 2023 — split across
// two rows, understating the combined position by roughly half and misordering
// the top ten.
//
// Two assertions, both on the BUILT artifact, both recomputed from the SEED
// (data-seeds/entity_family_events.csv) rather than from the payload the page
// was rendered from — so an exporter that dropped or mangled a curated family
// cannot satisfy this leg by also mangling its own output:
//
//   (1) THE MERGE HELD. Every row of /companies/ declares the registry family
//       keys it renders in [data-family-keys]. No two rows may carry keys that
//       the curated seed assigns to the same family; and every seed family with
//       ≥2 keys present on the page must be on exactly ONE row. This is the
//       double-count/split check in its rendered form.
//   (2) EVERY SOURCE IS AN EXTERNAL REFERENCE. Each curated event's source_url
//       must render on /companies/families/ as an <a href> to that exact URL,
//       opening off-site. These rows cite documents outside the lake; if one
//       ever rendered as a warehouse citation chip (or lost its link), the page
//       would be claiming provenance it does not have.
//
// Vacuity guards: the seed must parse, must carry ≥10 events, and must resolve
// ≥1 multi-member family against the page — a leg that checks nothing passes
// nothing.

const FAMILY_EVENTS_SEED = path.resolve(
  repoRoot,
  "data-seeds",
  "entity_family_events.csv",
);
const MIN_CURATED_EVENTS = 10;

/** Minimal RFC-4180 CSV reader (quoted fields with embedded commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

/**
 * Independent recompute of govbudget.entities.normalize_name — the normalizer
 * that MINTED the warehouse family keys. Deliberately reimplemented here so a
 * change to the Python side that silently stops matching shows up as a gate
 * failure rather than as a quietly unmerged table.
 */
const LEGAL_SUFFIXES = new Set([
  "INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "LIMITED", "CORP",
  "CORPORATION", "CO", "COMPANY", "PLC", "GMBH", "SA", "AG", "PTY",
  "JV", "TRUST", "FOUNDATION", "REALTY",
]);

function normalizeName(name) {
  let up = (name || "").toUpperCase();
  up = up.replace(/(?<=[A-Z])\.(?=[A-Z])/g, "");
  up = up.replace(/[^A-Z0-9 ]+/g, " ");
  let tokens = up.split(/\s+/).filter(Boolean);
  if (tokens[0] === "THE") tokens.shift();
  let changed = true;
  while (changed && tokens.length) {
    changed = false;
    while (tokens.length && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
      tokens.pop();
      changed = true;
    }
    while (tokens.length && tokens[tokens.length - 1] === "THE") {
      tokens.pop();
      changed = true;
    }
    while (tokens.length && tokens[0] === "THE") {
      tokens.shift();
      changed = true;
    }
  }
  return tokens.join(" ");
}

function runFamilyMergeLeg(errors, notes) {
  if (!fs.existsSync(FAMILY_EVENTS_SEED)) {
    errors.push(
      `leg g: curated seed missing at ${FAMILY_EVENTS_SEED} — /companies/ would go ` +
        `back to splitting renamed companies with nothing to notice it`,
    );
    return;
  }
  const events = parseCsv(fs.readFileSync(FAMILY_EVENTS_SEED, "utf8"));
  if (events.length < MIN_CURATED_EVENTS) {
    errors.push(
      `leg g: curated seed has ${events.length} events, expected ≥${MIN_CURATED_EVENTS} ` +
        `(a near-empty table cannot be the publishable asset it is meant to be)`,
    );
    return;
  }

  // seed → family label → the set of normalized endpoint names it claims.
  const seedFamilies = new Map();
  for (const ev of events) {
    const label = (ev.family || "").trim();
    if (!label) continue;
    if (!seedFamilies.has(label)) seedFamilies.set(label, new Set());
    const keys = seedFamilies.get(label);
    for (const name of [label, ev.from_name, ev.to_name]) {
      const n = normalizeName(name);
      if (n) keys.add(n);
    }
  }

  // ── (1) the merge held, on the rendered page ─────────────────────────────
  const companies = readHtml("/companies/");
  if (!companies) {
    errors.push("leg g: built /companies/ missing");
  } else {
    const rows = companies.querySelectorAll("[data-family-keys]");
    if (rows.length < 50) {
      errors.push(
        `leg g (/companies/): only ${rows.length} rows carry [data-family-keys] — ` +
          `every row must declare the registry families it renders`,
      );
    }
    // rendered key → the row that rendered it
    const rowOfKey = new Map();
    const keysOfRow = [];
    rows.forEach((tr, i) => {
      const keys = (tr.getAttribute("data-family-keys") || "")
        .split("|")
        .map((k) => k.trim())
        .filter(Boolean);
      keysOfRow.push(keys);
      for (const k of keys) {
        if (rowOfKey.has(k)) {
          errors.push(
            `leg g (/companies/): registry family ${k} is rendered on two rows ` +
              `(${rowOfKey.get(k)} and ${i}) — its obligations are counted twice`,
          );
        }
        rowOfKey.set(k, i);
      }
    });

    let checkedFamilies = 0;
    for (const [label, keys] of seedFamilies) {
      const present = [...keys].filter((k) => rowOfKey.has(k));
      if (present.length < 2) continue; // nothing on this page to merge
      checkedFamilies++;
      const rowIds = new Set(present.map((k) => rowOfKey.get(k)));
      if (rowIds.size !== 1) {
        errors.push(
          `leg g (/companies/): curated family "${label}" is SPLIT across ` +
            `${rowIds.size} rows — ${present
              .map((k) => `${k}→row ${rowOfKey.get(k)}`)
              .join(", ")}. One company must be one line (§P1-3).`,
        );
      }
    }
    if (checkedFamilies === 0) {
      errors.push(
        "leg g (/companies/): no curated family has ≥2 members on the page — " +
          "the merge check is vacuous, which means the merge is not happening",
      );
    } else if (errors.every((e) => !e.startsWith("leg g"))) {
      notes.push(
        `leg g: ${checkedFamilies} curated families each on exactly one of ` +
          `${rows.length} /companies/ rows ✓`,
      );
    }

    // The Raytheon/RTX repro by name, so this leg names the reported defect.
    const rtxKeys = ["RAYTHEON", "RTX"].filter((k) => rowOfKey.has(k));
    if (rtxKeys.length === 2 && rowOfKey.get("RAYTHEON") !== rowOfKey.get("RTX")) {
      errors.push(
        "leg g (/companies/): RAYTHEON and RTX are still on separate rows — " +
          "the reported §P1-3 defect",
      );
    }
  }

  // ── (2) every curated source renders as an external reference ────────────
  const familiesPage = readHtml("/companies/families/");
  if (!familiesPage) {
    errors.push(
      "leg g: built /companies/families/ missing — the curated table is the " +
        "publishable asset and must have its own page",
    );
    return;
  }
  const hrefs = new Set(
    familiesPage.querySelectorAll("a[href]").map((a) => a.getAttribute("href")),
  );
  const missing = [];
  for (const ev of events) {
    const url = (ev.source_url || "").trim();
    if (!url) continue;
    if (!url.startsWith("https://")) {
      errors.push(`leg g: curated source is not https — ${url}`);
      continue;
    }
    if (!hrefs.has(url)) missing.push(url);
  }
  if (missing.length > 0) {
    errors.push(
      `leg g (/companies/families/): ${missing.length} curated event source(s) do ` +
        `not render as an external reference — ${missing.slice(0, 3).join(", ")}`,
    );
  }
  // …and they must be real off-site links, not internal chips.
  const externals = familiesPage.querySelectorAll("a[data-external-source]");
  const badTarget = externals.filter(
    (a) => a.getAttribute("target") !== "_blank" || !(a.getAttribute("rel") || "").includes("noopener"),
  );
  if (badTarget.length > 0) {
    errors.push(
      `leg g (/companies/families/): ${badTarget.length} source link(s) are not ` +
        `off-site links (target=_blank rel=noopener) — these are external ` +
        `references, not warehouse citations`,
    );
  }
  // The page must SAY so, in its own words.
  const methodText = (
    familiesPage.querySelector("[data-method-statement]")?.text ?? ""
  ).toLowerCase();
  for (const phrase of [
    "hand-curated",
    "external references, not warehouse citations",
    "nothing on it is",
  ]) {
    if (!methodText.includes(phrase)) {
      errors.push(
        `leg g (/companies/families/): the method statement does not say ` +
          `"${phrase}" — the page must state its method plainly (§P1-3)`,
      );
    }
  }
  if (errors.every((e) => !e.startsWith("leg g"))) {
    notes.push(
      `leg g: all ${events.length} curated sources render as external ` +
        `references on /companies/families/ ✓`,
    );
  }
}
