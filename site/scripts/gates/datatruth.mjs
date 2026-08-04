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

  return { pass: errors.length === 0, errors, notes };
}
