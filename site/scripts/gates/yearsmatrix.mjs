/**
 * gate — yearsmatrix_gate (Phase 5D, G8)
 *
 * Verifies the /years/ budget-over-time matrix end to end (spec §4):
 *
 *  (a) cell integrity — ≥30 sampled cells (program cells across EVERY
 *      amount_type present, Δ cells, project cells) recomputed independently
 *      from the parquet lake (budget_lines.parquet / jbook_details.parquet)
 *      via a python helper (yearsmatrix-recompute.py) and compared to the
 *      rendered years_matrix.json payload canonically (|diff| ≤ 0.001).
 *  (b) citation contract — sampled cells carry resolvable fact_ids per the
 *      three-state Cite rules (program cells: workbook|derived; project
 *      cells: jbook_pdf; state-B cells carry xp and NO fid); Δ cells resolve
 *      to derived citations whose formula recomputes (rv[0] − rv[1] ==
 *      recorded_value ≤ 0.001) and whose recorded_value equals the cell v.
 *  (c) UX mechanics via Playwright on /years/ —
 *      sticky header + sticky first column at 1440 AND 390 wide,
 *      sort correctness on two columns (missing-last), expand shows project
 *      rows, filter narrows to the searched program, CSV export parses and
 *      matches the current view (pe_bli set equality), filtered CSV matches
 *      the filtered view.
 *  (d) shard integrity — every fact_id referenced in years_matrix.json
 *      resolves in cite-shards/{fid[:2]}.json with a row deep-equal to its
 *      citations.json row; shard union == citations.json keys (no orphans,
 *      no misses, no misplaced keys).
 *  (e) breakdown integrity (spec §3b) — every sum-decomposable derived fact
 *      has breakdowns/{fact_id}.json; ≥10 sampled breakdowns across classes
 *      sum EXACTLY to recorded_value (≤0.005 canonical rounding); cited rows
 *      resolve via their shards; uncited rows are explicitly marked; on
 *      /years/, opening a Δ cell's citation shows the inline breakdown table
 *      whose sum row equals the derived figure and whose CSV export parses
 *      to the same rows.
 *  (f) decade cell recompute (Phase 5E, ADDITIVE) — sampled cells across
 *      ≥3 decade columns (the edition-honest fy{yyyy}{a|e|r} defaults)
 *      recompute from budget_lines_decade.parquet: workbook cells match
 *      their single lake row; derived decade sums recompute from their
 *      input fids (recorded_value == cell v == Σ inputs, ≤0.001).
 *  (h) CELL NOTATION + COUNT NOTATION (Sprint 3 Task 5, §P2-7 / §P1-5, live).
 *      "0.0" used to mean BOTH "the book records zero" and "the book records
 *      an amount under $50K", while absence was a dash — three different
 *      facts, two glyphs. This leg re-derives every visible cell's state from
 *      the PAYLOAD (data-v ÷ 1000 for program cells) and requires the glyph
 *      to match: `0` for zero, `<0.05` (sign preserved) for a rounded-down
 *      nonzero, `—` for absent; and requires a visible legend that names all
 *      three. Non-vacuity: all three states must be PRESENT in the opening
 *      view — a matrix with no rounded zeros would pass the mapping check
 *      while proving nothing.
 *      It also pins the filter summary's count notation, which is rendered
 *      client-side and so is invisible to gate 24's built-HTML sweep: the
 *      grid shipped "1741 of 1741 programs" under a corpus statement reading
 *      "1,741 of them".
 *  (g) edition integrity (Phase 5E, ADDITIVE — spec §2 rule 1): every
 *      sampled decade cell's source rows carry fiscal_year == the column's
 *      STATED edition and the cell's pe_bli; workbook citations' sha256
 *      must be among their lake rows' document_sha256. UI side (leg g-UI):
 *      the default view renders the decade columns with visible PB-edition
 *      tags and the edition-rule legend ("PB(N+2)"), and decade cells are
 *      state-A Cites.
 *  (e-UI overlay, STRENGTHENED 2026-07-02 — visual-judge M2 blocker: the
 *      large breakdown overlay shipped without a visible sum row) — an
 *      overlay-sized (>5-row) breakdown is opened live from the built page
 *      that cites it; the gate REQUIRES:
 *        · [data-testid="breakdown-overlay-total"][data-v] in the overlay
 *          header equals the derived recorded_value,
 *        · [data-testid="cite-legend"] present in the overlay header AND on
 *          /years/ near the table controls,
 *        · with [data-testid="breakdown-scroll"] scrolled to its midpoint,
 *          the [data-testid="breakdown-sum"] row REMAINS fully visible
 *          inside the scrollport (position:sticky td, non-transparent bg)
 *          and its data-v equals recorded_value.
 *
 * DOM contract for the /years/ page (BINDING for Task 4 — the gate was
 * built first, per house rules):
 *   [data-testid="years-matrix"]           table container
 *   tr[data-program-row][data-pe]          program rows
 *   tr[data-project-row]                   project sub-rows
 *   td/th[data-col="<key>"]                cells; numeric cells carry data-v
 *   [data-sort="<key>"]                    header sort trigger
 *   [data-expand]                          program expand caret
 *   [data-testid="years-filter"]           text filter input
 *   [data-testid="years-csv"]              CSV export button (download)
 *   [data-sticky-col]                      first-column sticky cells
 *   dollar cells render the existing <Cite> ([data-fact-id])
 *   citation panel breakdown (Task 3b + strengthened overlay contract):
 *   [data-testid="breakdown-table"], [data-testid="breakdown-sum"][data-v],
 *   [data-testid="breakdown-csv"], [data-testid="breakdown-scroll"],
 *   [data-testid="breakdown-overlay-total"][data-v],
 *   [data-testid="cite-legend"] (overlay header AND /years/ controls)
 *
 * Export: runYearsMatrixGate({ baseUrl }) → { pass, errors, notes }
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(siteRoot, "..");
const jsonDir = path.resolve(repoRoot, "data", "site", "json");

const TOL_CELL = 0.001;
const TOL_BREAKDOWN = 0.005;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function* iterPrograms(matrix) {
  for (const org of matrix.orgs) {
    for (const p of org.programs) {
      yield { org: org.org, program: p };
    }
  }
}

/** All fact_ids referenced by the matrix payload (program + project cells). */
function collectMatrixFids(matrix) {
  const fids = new Set();
  for (const { program } of iterPrograms(matrix)) {
    for (const cell of Object.values(program.cells)) {
      if (cell && cell.fid) fids.add(cell.fid);
    }
    for (const proj of program.projects) {
      for (const cell of Object.values(proj.cells)) {
        if (cell && cell.fid) fids.add(cell.fid);
      }
    }
  }
  return fids;
}

/** Deterministic sample: program cells covering every amount_type, Δ cells,
 *  and project cells. Returns {programCells, deltaCells, projectCells}. */
function sampleCells(matrix, { perType = 5, deltas = 6, projects = 10 } = {}) {
  const programCells = [];
  const deltaCells = [];
  const projectCells = [];
  const perTypeCount = new Map(matrix.amount_types.map((t) => [t, 0]));

  const programs = [...iterPrograms(matrix)];
  // Stride the list so samples spread across orgs (deterministic, no RNG).
  const stride = Math.max(1, Math.floor(programs.length / 37));
  for (let pass = 0; pass < stride; pass++) {
    for (let i = pass; i < programs.length; i += stride) {
      const { org, program } = programs[i];
      for (const at of matrix.amount_types) {
        const cell = program.cells[at];
        if (cell && perTypeCount.get(at) < perType) {
          programCells.push({ pe_bli: program.pe_bli, org, at, cell });
          perTypeCount.set(at, perTypeCount.get(at) + 1);
        }
      }
      const d = program.cells["fy2526_change"];
      if (d && deltaCells.length < deltas) {
        deltaCells.push({ pe_bli: program.pe_bli, org, cell: d });
      }
      for (const proj of program.projects) {
        for (const [ykey, cell] of Object.entries(proj.cells)) {
          if (cell && projectCells.length < projects) {
            projectCells.push({
              pe_bli: program.pe_bli,
              project_number: proj.project_number,
              scenario: matrix.project_scenarios[ykey],
              ykey,
              cell,
            });
          }
        }
      }
    }
  }
  return { programCells, deltaCells, projectCells };
}

/**
 * Deterministic decade-cell sample (Phase 5E legs f+g): up to `perColumn`
 * cited cells for EVERY default decade column, strided across programs.
 */
function sampleDecadeCells(matrix, { perColumn = 3 } = {}) {
  const byKey = new Map((matrix.decade_columns ?? []).map((c) => [c.key, c]));
  const out = [];
  const programs = [...iterPrograms(matrix)];
  const stride = Math.max(1, Math.floor(programs.length / 37));
  for (const key of matrix.decade_default_columns ?? []) {
    const col = byKey.get(key);
    if (!col) continue;
    let n = 0;
    for (let pass = 0; pass < stride && n < perColumn; pass++) {
      for (let i = pass; i < programs.length && n < perColumn; i += stride) {
        const { program } = programs[i];
        const cell = program.cells[key];
        if (cell && cell.fid) {
          out.push({ pe_bli: program.pe_bli, col, cell });
          n++;
        }
      }
    }
  }
  return out;
}

/** Spawn the python recompute helper over the parquet lake. */
function recomputeFromLake(request) {
  const reqFile = path.join(
    os.tmpdir(),
    `yearsmatrix-recompute-${process.pid}.json`
  );
  fs.writeFileSync(reqFile, JSON.stringify(request));
  try {
    const res = spawnSync(
      "uv",
      ["run", "python", "site/scripts/gates/yearsmatrix-recompute.py", reqFile],
      { cwd: repoRoot, encoding: "utf8", timeout: 120000 }
    );
    if (res.status !== 0) {
      throw new Error(
        `recompute helper exited ${res.status}: ${(res.stderr || "").slice(0, 400)}`
      );
    }
    return JSON.parse(res.stdout);
  } finally {
    fs.rmSync(reqFile, { force: true });
  }
}

/** Minimal CSV parse (quoted fields with commas supported). */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    rows.push(fields);
  }
  return rows;
}

const BREAKDOWN_CLASSES = [
  { key: "traj_sum", test: (f) => f.startsWith("sum(budget_lines") },
  { key: "difference", test: (f, inputs) => f.includes(" - ") && inputs.length === 2 },
  { key: "agency_fy26", test: (f) => f.startsWith("sum(fct_budget_trajectory.fy2026_total)") },
  { key: "district", test: (f) => f.startsWith("sum(fct_district_programs.total_obligation)") },
  { key: "agency_fy24", test: (f) => f.startsWith("sum(dim_programs.fy2024_actual_millions)") },
];

const HEX16 = /^[0-9a-f]{16}$/;

function breakdownClass(citation) {
  if (citation.kind !== "derived" || !citation.formula) return null;
  if (citation.recorded_value == null || !Number.isFinite(Number(citation.recorded_value)))
    return null;
  let inputs = [];
  try {
    inputs = JSON.parse(citation.inputs ?? "[]");
  } catch {
    return null;
  }
  const allHex = Array.isArray(inputs) && inputs.every((x) => HEX16.test(String(x)));
  for (const cls of BREAKDOWN_CLASSES) {
    if (!cls.test(citation.formula, inputs)) continue;
    // agency_fy24 decomposes at PROGRAM grain (its thousands-inputs cannot
    // sum to a millions recorded_value) — eligible regardless of inputs.
    if (cls.key === "agency_fy24") return cls.key;
    if (allHex && inputs.length >= 2) return cls.key;
    return null;
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// LEG (i) — THE MEASURE LABEL ON A FIGURE MUST MATCH THE COLUMN IT CAME FROM
// (tri-persona review Wave 2; letter checked free against a-h above)
// ─────────────────────────────────────────────────────────────────────────────
//
// The shipped defect: FY2024 "Enacted" on /years/ is not an enacted
// appropriation. The PB2025 books had no FY2024 enacted column to publish —
// FY2024 ran under a continuing resolution when they went to press — so the
// figure comes from column K of r1_display.xlsx, headed verbatim "FY 2024 PB
// Request with CR Amounts*" (P-1: column Q, "FY 2024 PB Request with CR
// Adjustments Amount*"). On every one of the 1,525 /years/ programs carrying
// both, FY2024E and FY2024R are byte-identical, because they are the same
// column. FY2017E and FY2018E have the same shape in the PB2018/PB2019 books.
//
// The extraction was faithful and the program-page citation panel disclosed it
// correctly one click deep. /years/ dropped the qualifier: decade_columns
// carried only kind:"enacted", every cell stamped data-measure="enacted", and
// the CSV exported fy2024e_pb2025_usd_millions with no note — on the one
// surface built for cross-program "asked vs got" analysis.
//
// THE PREDICATE IS THE WORKBOOK'S OWN COLUMN HEADER, not the exporter's
// slug→measure table. workbook-cells/{fid[:2]}.json ships `col_header` — the
// literal text of the Excel header the number was read from. Re-deriving the
// exporter's mapping here would be a gate agreeing with a copy of the rule it
// checks; reading the header asks the source document instead.
//
//   i1 NO CONTRADICTION — for every emitted decade cell, the measure token the
//      payload publishes (cell.m, else the column's single divergent measure,
//      else its kind) must name at least one of the measure families its own
//      col_header names. "enacted" over "FY 2024 PB Request with CR Amounts*"
//      is a contradiction; "enacted-request" is not (both words are true:
//      filed under Enacted, sourced from a request column).
//   i2 JOIN INTEGRITY — every decade cell whose fid resolves to a WORKBOOK
//      citation must have a workbook-cells entry with a col_header, and every
//      decade column must contribute at least one checked cell. A silently
//      broken join would make i1 pass by checking nothing.
//   i3 RENDERED (live) — on /years/, every qualified column's header carries
//      the visible †, a visible footnote names the column and what it actually
//      reports, and the cells' rendered data-measure equals the payload token.
//   i4 CSV — the exported header for a qualified column carries its measure
//      token, so a downstream script reading the file inherits the qualifier
//      instead of the bare year+kind.
//   i5 NON-VACUITY (structural) — the population is the RENDERED set: every
//      decade cell in the payload. It must be non-empty, every decade column
//      must be represented, and at least one column must actually be
//      qualified — a corpus with no divergent column would satisfy i1
//      trivially.

/** Measure families a piece of text names. Substrings, because workbook
 *  headers are prose ("FY 2020 Total Enacted (Base+Emerg+ OCO)"). */
function measureFamilies(text) {
  const t = (text ?? "").toLowerCase();
  const out = new Set();
  if (t.includes("actual")) out.add("actuals");
  if (t.includes("enact")) out.add("enacted");
  if (t.includes("request")) out.add("request");
  return out;
}

/** Families a hyphenated measure token asserts ("enacted-request" → both). */
function tokenFamilies(token) {
  const out = new Set();
  for (const w of String(token ?? "").split("-")) {
    if (w === "actuals" || w === "enacted" || w === "request") out.add(w);
  }
  return out;
}

/** The measure token the payload publishes for ONE decade cell. Mirrors the
 *  client's `m ?? single-divergent-measure ?? kind` resolution exactly — this
 *  is a payload contract, not a re-derivation of the exporter's mapping. */
function payloadCellMeasure(col, cell) {
  if (cell && cell.m) return cell.m;
  if (col.measures && col.measures.length === 1) return col.measures[0];
  return col.kind;
}

function decadeColumnIsQualified(col) {
  return (col.measures ?? []).some((m) => m !== col.kind);
}

/** fid → col_header, over every workbook-cells shard. */
function readWorkbookColHeaders() {
  const dir = path.join(jsonDir, "workbook-cells");
  if (!fs.existsSync(dir)) return null;
  const map = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let obj;
    try {
      obj = readJson(path.join(dir, f));
    } catch {
      continue;
    }
    for (const [fid, row] of Object.entries(obj)) {
      if (row && typeof row.col_header === "string") map.set(fid, row.col_header);
    }
  }
  return map;
}

export function runDecadeMeasureLabelLeg(matrix, citations, errors, notes) {
  const cols = new Map((matrix.decade_columns ?? []).map((c) => [c.key, c]));
  if (cols.size === 0) {
    errors.push("leg i is VACUOUS: payload carries no decade_columns");
    return null;
  }
  const headers = readWorkbookColHeaders();
  if (!headers) {
    errors.push(`leg i: json/workbook-cells/ missing under ${jsonDir}`);
    return null;
  }

  const contradictions = [];
  const contradictionsByCol = new Map();
  const unjoinedWorkbook = [];
  const perCol = new Map();
  let population = 0;
  let checked = 0;

  for (const { program } of iterPrograms(matrix)) {
    for (const [key, cell] of Object.entries(program.cells)) {
      const col = cols.get(key);
      if (!col || !cell) continue;
      population++;
      perCol.set(key, (perCol.get(key) ?? 0) + 1);
      const token = payloadCellMeasure(col, cell);
      const header = cell.fid ? headers.get(cell.fid) : undefined;
      if (header === undefined) {
        // Only WORKBOOK citations are supposed to have a header; a derived
        // decade sum legitimately has none.
        const cit = cell.fid ? citations[cell.fid] : null;
        if (cit && cit.kind === "workbook") {
          if (unjoinedWorkbook.length < 10) {
            unjoinedWorkbook.push(`${program.pe_bli}/${key} (fid ${cell.fid})`);
          }
        }
        continue;
      }
      checked++;
      const hf = measureFamilies(header);
      if (hf.size === 0) continue; // the header names no family — no claim to contradict
      const tf = tokenFamilies(token);
      let overlap = false;
      for (const f of tf) if (hf.has(f)) overlap = true;
      if (!overlap) {
        contradictionsByCol.set(key, (contradictionsByCol.get(key) ?? 0) + 1);
        if (contradictions.length < 10) {
          contradictions.push(
            `${program.pe_bli}/${key}: published measure "${token}" but the ` +
              `workbook column it was read from is headed "${header}"`
          );
        }
      }
    }
  }

  // i5 — structural non-vacuity
  if (population === 0) {
    errors.push("leg i is VACUOUS: no decade cell in the payload");
    return null;
  }
  const uncovered = [...cols.keys()].filter((k) => !perCol.has(k));
  if (uncovered.length) {
    errors.push(
      `leg i5: ${uncovered.length} decade column(s) contribute no cell — the ` +
        `population is not the rendered set: ${uncovered.join(", ")}`
    );
  }
  const qualified = [...cols.values()].filter(decadeColumnIsQualified);
  if (qualified.length === 0) {
    errors.push(
      "leg i5: no decade column publishes a measure qualifier at all. Either " +
        "every column's workbook header agrees with its kind — which the " +
        "PB2018/PB2019/PB2025 continuing-resolution columns make false — or " +
        "the exporter stopped emitting decade_columns[].measures"
    );
  }

  // i1
  if (contradictionsByCol.size) {
    const total = [...contradictionsByCol.values()].reduce((a, b) => a + b, 0);
    const breakdown = [...contradictionsByCol]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ×${v}`)
      .join(", ");
    errors.push(
      `leg i1: ${total} of ${checked} decade cells publish a measure label its ` +
        `own workbook column header contradicts (${breakdown}). ` +
        contradictions.join(" | ")
    );
  }
  // i2
  if (unjoinedWorkbook.length) {
    errors.push(
      `leg i2: ${unjoinedWorkbook.length}+ decade cell(s) cite a WORKBOOK fact ` +
        `with no workbook-cells col_header — the header join is broken and i1 ` +
        `is checking less than it claims: ${unjoinedWorkbook.join(", ")}`
    );
  }
  notes.push(
    `leg i: ${checked}/${population} decade cells checked against their own ` +
      `workbook column header across ${perCol.size} columns; ` +
      `${qualified.length} column(s) publish a measure qualifier ` +
      `(${qualified.map((c) => `${c.key}=${(c.measures ?? []).join("+")}`).join(", ") || "none"})`
  );
  return { qualified };
}

export async function runYearsMatrixGate({ baseUrl }) {
  const errors = [];
  const notes = [];

  // ── Load static inputs ────────────────────────────────────────────────────
  const matrixPath = path.join(jsonDir, "years_matrix.json");
  if (!fs.existsSync(matrixPath)) {
    return {
      pass: false,
      errors: [`years_matrix.json missing at ${matrixPath} — run export-site`],
      notes,
    };
  }
  const matrix = readJson(matrixPath);
  const citations = readJson(path.join(jsonDir, "citations.json"));

  const size = fs.statSync(matrixPath).size;
  // Payload budget: ~1.6–2KB/program. Raised 900KB → 2MB in Phase 5G when the
  // Navy FY2026 J-book ingestion grew the detail-grade matrix from ~462 to 813
  // programs (~1.53MB). Raised 2MB → 4MB in the Phase 5G Army/AF/SF archive
  // round: the matrix grew 813 → 1,741 programs (~2.74MB) at the SAME
  // per-program density — legitimate corpus growth, not design regression.
  // Still catches runaway bloat (a doubling from here, 1,741 → ~2,540+).
  if (size >= 4096 * 1024) {
    errors.push(`years_matrix.json is ${size} bytes — over the 4MB budget`);
  }
  const nPrograms = [...iterPrograms(matrix)].length;
  notes.push(`matrix: ${nPrograms} programs / ${matrix.orgs.length} orgs / ${size} bytes`);

  const { programCells, deltaCells, projectCells } = sampleCells(matrix);
  const nSampled = programCells.length + deltaCells.length + projectCells.length;

  // ── Leg (i, static half): measure label vs the workbook column header ─────
  const measureLeg = runDecadeMeasureLabelLeg(matrix, citations, errors, notes);

  // ── Leg (a): cell integrity recompute vs the parquet lake ────────────────
  {
    const typesCovered = new Set(programCells.map((c) => c.at));
    const missingTypes = matrix.amount_types.filter((t) => !typesCovered.has(t));
    if (nSampled < 30) {
      errors.push(`leg a: only ${nSampled} cells sampled (<30)`);
    }
    if (missingTypes.length > 0) {
      errors.push(`leg a: no sampled cells for amount_type(s): ${missingTypes.join(", ")}`);
    }
    if (deltaCells.length === 0) errors.push("leg a: no Δ cells sampled");
    if (projectCells.length === 0) errors.push("leg a: no project cells sampled");

    let recomputed;
    try {
      recomputed = recomputeFromLake({
        programs: programCells.map(({ pe_bli, org, at }) => ({ pe_bli, org, at })),
        deltas: deltaCells.map(({ pe_bli, org }) => ({ pe_bli, org })),
        projects: projectCells.map(({ pe_bli, project_number, scenario }) => ({
          pe_bli,
          project_number,
          scenario,
        })),
      });
    } catch (e) {
      recomputed = null;
      errors.push(`leg a: recompute helper failed: ${e.message}`);
    }

    if (recomputed) {
      let ok = 0;
      for (const { pe_bli, org, at, cell } of programCells) {
        const rc = recomputed.programs[`${pe_bli}|${org}|${at}`];
        if (rc == null || Math.abs(rc - cell.v) > TOL_CELL) {
          errors.push(
            `leg a: program cell ${pe_bli}/${at} payload=${cell.v} lake=${rc}`
          );
        } else ok++;
      }
      let deltaVerified = 0;
      for (const { pe_bli, org, cell } of deltaCells) {
        const rc = recomputed.deltas[`${pe_bli}|${org}`];
        if (rc == null) continue; // no budget lines for one side — leg b still recomputes via inputs
        if (Math.abs(rc - cell.v) > TOL_CELL) {
          errors.push(`leg a: Δ cell ${pe_bli} payload=${cell.v} lake=${rc}`);
        } else {
          ok++;
          deltaVerified++;
        }
      }
      if (deltaCells.length > 0 && deltaVerified === 0) {
        errors.push("leg a: no sampled Δ cell was lake-recomputable");
      }
      for (const { pe_bli, project_number, scenario, cell } of projectCells) {
        const rc = recomputed.projects[`${pe_bli}|${project_number}|${scenario}`];
        if (rc == null || Math.abs(rc - cell.v) > TOL_CELL) {
          errors.push(
            `leg a: project cell ${pe_bli}/${project_number}/${scenario} payload=${cell.v} lake=${rc}`
          );
        } else ok++;
      }
      notes.push(`leg a: ${ok}/${nSampled} sampled cells recomputed from the lake ✓`);
    }
  }

  // ── Leg (b): citation contract on sampled cells ──────────────────────────
  {
    let ok = 0;
    for (const { pe_bli, at, cell } of programCells) {
      const cit = citations[cell.fid];
      if (!cit) {
        errors.push(`leg b: program cell ${pe_bli}/${at} fid ${cell.fid} unresolvable`);
        continue;
      }
      if (cit.kind !== "workbook" && cit.kind !== "derived") {
        errors.push(`leg b: program cell ${pe_bli}/${at} fid kind=${cit.kind} (want workbook|derived)`);
        continue;
      }
      if (cit.kind === "workbook" && Math.abs(cit.amount_thousands - cell.v) > TOL_CELL) {
        errors.push(
          `leg b: workbook cell ${pe_bli}/${at} v=${cell.v} != amount_thousands=${cit.amount_thousands}`
        );
        continue;
      }
      if (cit.kind === "derived" && Math.abs(Number(cit.recorded_value) - cell.v) > TOL_CELL) {
        errors.push(
          `leg b: derived cell ${pe_bli}/${at} v=${cell.v} != recorded_value=${cit.recorded_value}`
        );
        continue;
      }
      ok++;
    }
    for (const { pe_bli, cell } of deltaCells) {
      const cit = citations[cell.fid];
      if (!cit || cit.kind !== "derived") {
        errors.push(`leg b: Δ cell ${pe_bli} fid ${cell.fid} not a derived citation`);
        continue;
      }
      if (!cit.formula || !cit.formula.includes(" - ")) {
        errors.push(`leg b: Δ cell ${pe_bli} formula is not a difference: ${cit.formula}`);
        continue;
      }
      let inputs = [];
      try {
        inputs = JSON.parse(cit.inputs ?? "[]");
      } catch {
        /* handled below */
      }
      if (inputs.length !== 2 || !citations[inputs[0]] || !citations[inputs[1]]) {
        errors.push(`leg b: Δ cell ${pe_bli} inputs do not resolve: ${cit.inputs}`);
        continue;
      }
      const diff =
        Number(citations[inputs[0]].recorded_value) -
        Number(citations[inputs[1]].recorded_value);
      if (Math.abs(diff - Number(cit.recorded_value)) > TOL_CELL) {
        errors.push(
          `leg b: Δ cell ${pe_bli} formula recompute ${diff} != recorded ${cit.recorded_value}`
        );
        continue;
      }
      if (Math.abs(Number(cit.recorded_value) - cell.v) > TOL_CELL) {
        errors.push(`leg b: Δ cell ${pe_bli} v=${cell.v} != recorded ${cit.recorded_value}`);
        continue;
      }
      ok++;
    }
    for (const { pe_bli, project_number, cell } of projectCells) {
      if (!cell.fid) {
        // state-B cell: must carry xp and must NOT dangle a fid
        if (!cell.xp) {
          errors.push(
            `leg b: project cell ${pe_bli}/${project_number} has neither fid nor xp`
          );
        } else ok++;
        continue;
      }
      const cit = citations[cell.fid];
      if (!cit || cit.kind !== "jbook_pdf") {
        errors.push(
          `leg b: project cell ${pe_bli}/${project_number} fid ${cell.fid} not a jbook_pdf citation`
        );
        continue;
      }
      if (!cit.hosted_pdf_url || cit.page_number == null) {
        errors.push(
          `leg b: project cell ${pe_bli}/${project_number} citation lacks hosted_pdf_url/page_number`
        );
        continue;
      }
      ok++;
    }
    notes.push(`leg b: ${ok} sampled citations verified ✓`);
  }

  // ── Legs (f)+(g) static (Phase 5E): decade recompute + edition integrity ──
  {
    if (
      !Array.isArray(matrix.decade_columns) ||
      !(matrix.decade_default_columns ?? []).length
    ) {
      errors.push(
        "leg f: payload carries no decade_columns/decade_default_columns (Phase 5E contract)"
      );
    } else {
      const samples = sampleDecadeCells(matrix);
      const colsCovered = new Set(samples.map((s) => s.col.key));
      if (colsCovered.size < 3) {
        errors.push(`leg f: only ${colsCovered.size} decade columns sampled (<3)`);
      }
      // Resolve citations; collect the workbook fids each cell decomposes to.
      const wanted = new Set();
      const checks = [];
      for (const s of samples) {
        const cit = citations[s.cell.fid];
        if (!cit) {
          errors.push(
            `leg f: decade cell ${s.pe_bli}/${s.col.key} fid ${s.cell.fid} unresolvable`
          );
          continue;
        }
        if (cit.kind === "workbook") {
          checks.push({ s, cit, inputFids: [s.cell.fid] });
          wanted.add(s.cell.fid);
        } else if (cit.kind === "derived") {
          if (!cit.formula || !cit.formula.startsWith("sum(budget_lines")) {
            errors.push(
              `leg f: decade derived ${s.cell.fid} has unexpected formula: ${cit.formula}`
            );
            continue;
          }
          if (Math.abs(Number(cit.recorded_value) - s.cell.v) > TOL_CELL) {
            errors.push(
              `leg f: decade derived ${s.cell.fid} recorded ${cit.recorded_value} != cell ${s.cell.v}`
            );
            continue;
          }
          let inputs = [];
          try {
            inputs = JSON.parse(cit.inputs ?? "[]");
          } catch {
            /* handled below */
          }
          if (!Array.isArray(inputs) || inputs.length < 2) {
            errors.push(
              `leg f: decade derived ${s.cell.fid} inputs do not parse: ${cit.inputs}`
            );
            continue;
          }
          checks.push({ s, cit, inputFids: inputs });
          for (const f of inputs) wanted.add(f);
        } else {
          errors.push(
            `leg f: decade cell ${s.pe_bli}/${s.col.key} fid kind=${cit.kind} (want workbook|derived)`
          );
        }
      }

      let dec = null;
      if (wanted.size > 0) {
        try {
          dec = recomputeFromLake({ decade_fids: [...wanted] }).decade ?? {};
        } catch (e) {
          errors.push(`leg f: decade recompute helper failed: ${e.message}`);
        }
      }
      if (dec) {
        let okF = 0;
        let okG = 0;
        for (const { s, cit, inputFids } of checks) {
          const rows = inputFids.map((f) => dec[f]);
          if (rows.some((r) => r == null)) {
            errors.push(
              `leg f: decade cell ${s.pe_bli}/${s.col.key}: input fid missing from budget_lines_decade.parquet`
            );
            continue;
          }
          const sum = rows.reduce((acc, r) => acc + r.v, 0);
          if (Math.abs(sum - s.cell.v) > TOL_CELL) {
            errors.push(
              `leg f: decade cell ${s.pe_bli}/${s.col.key} payload=${s.cell.v} lake=${sum}`
            );
            continue;
          }
          okF++;
          // Leg (g): sources must all sit in the column's STATED edition,
          // belong to the cell's pe_bli, and a workbook citation's sha256
          // must be among its lake rows' documents (spec §2 rule 1).
          const fys = new Set(rows.flatMap((r) => r.fys));
          const pes = new Set(rows.flatMap((r) => r.pes));
          if (fys.size !== 1 || !fys.has(s.col.edition)) {
            errors.push(
              `leg g: decade cell ${s.pe_bli}/${s.col.key} sources span edition(s) [${[...fys].join(",")}] != stated PB${s.col.edition}`
            );
            continue;
          }
          if (pes.size !== 1 || !pes.has(s.pe_bli)) {
            errors.push(
              `leg g: decade cell ${s.pe_bli}/${s.col.key} sources span pe_bli(s) [${[...pes].join(",")}]`
            );
            continue;
          }
          if (
            cit.kind === "workbook" &&
            !rows.some((r) => (r.shas ?? []).includes(cit.sha256))
          ) {
            errors.push(
              `leg g: decade cell ${s.pe_bli}/${s.col.key} citation sha256 not among its lake rows`
            );
            continue;
          }
          okG++;
        }
        notes.push(
          `leg f: ${okF}/${checks.length} decade cells recomputed from budget_lines_decade.parquet across ${colsCovered.size} columns ✓`
        );
        notes.push(`leg g: ${okG}/${checks.length} decade cells edition-integrity verified ✓`);
      }
    }
  }

  // ── Leg (d): shard integrity ──────────────────────────────────────────────
  {
    const shardDir = path.join(jsonDir, "cite-shards");
    if (!fs.existsSync(shardDir)) {
      errors.push(`leg d: cite-shards/ missing at ${shardDir}`);
    } else {
      const matrixFids = collectMatrixFids(matrix);
      const shardCache = new Map();
      const loadShard = (prefix) => {
        if (!shardCache.has(prefix)) {
          const p = path.join(shardDir, `${prefix}.json`);
          shardCache.set(prefix, fs.existsSync(p) ? readJson(p) : null);
        }
        return shardCache.get(prefix);
      };

      let misses = 0;
      let mismatches = 0;
      for (const fid of matrixFids) {
        const shard = loadShard(fid.slice(0, 2));
        if (!shard || !(fid in shard)) {
          if (misses < 5) errors.push(`leg d: matrix fid ${fid} missing from its shard`);
          misses++;
          continue;
        }
        if (JSON.stringify(shard[fid]) !== JSON.stringify(citations[fid])) {
          if (mismatches < 5)
            errors.push(`leg d: shard row for ${fid} differs from citations.json`);
          mismatches++;
        }
      }
      if (misses > 5) errors.push(`leg d: ${misses} matrix fids missing from shards (total)`);
      if (mismatches > 5) errors.push(`leg d: ${mismatches} shard/citations mismatches (total)`);

      // Full union: every citations.json key in exactly its shard, no strays.
      let unionCount = 0;
      let misplaced = 0;
      for (const f of fs.readdirSync(shardDir).filter((f) => f.endsWith(".json"))) {
        const prefix = f.replace(".json", "");
        const shard = readJson(path.join(shardDir, f));
        for (const fid of Object.keys(shard)) {
          if (fid.slice(0, 2) !== prefix) misplaced++;
          if (!(fid in citations)) misplaced++;
          unionCount++;
        }
      }
      const nCitations = Object.keys(citations).length;
      if (misplaced > 0) errors.push(`leg d: ${misplaced} misplaced/orphaned shard keys`);
      if (unionCount !== nCitations) {
        errors.push(
          `leg d: shard union has ${unionCount} fids but citations.json has ${nCitations}`
        );
      } else {
        notes.push(
          `leg d: ${matrixFids.size} matrix fids + full ${unionCount}-fid shard union verified ✓`
        );
      }
    }
  }

  // ── Leg (e) static: breakdown presence + integrity ────────────────────────
  {
    const breakdownDir = path.join(jsonDir, "breakdowns");
    if (!fs.existsSync(breakdownDir)) {
      errors.push(`leg e: breakdowns/ missing at ${breakdownDir}`);
    } else {
      // Presence: every sum-decomposable derived fact has a breakdown file.
      const byClass = new Map();
      let missing = 0;
      for (const [fid, cit] of Object.entries(citations)) {
        const cls = breakdownClass(cit);
        if (!cls) continue;
        if (!byClass.has(cls)) byClass.set(cls, []);
        byClass.get(cls).push(fid);
        if (!fs.existsSync(path.join(breakdownDir, `${fid}.json`))) {
          if (missing < 5) errors.push(`leg e: breakdown missing for ${cls} fact ${fid}`);
          missing++;
        }
      }
      if (missing > 5) errors.push(`leg e: ${missing} breakdowns missing (total)`);
      const clsSummary = [...byClass.entries()]
        .map(([k, v]) => `${k}=${v.length}`)
        .join(" ");
      notes.push(`leg e: eligible derived facts by class: ${clsSummary}`);

      // Integrity: ≥10 samples spread across classes (first 3 of each).
      const samples = [];
      for (const fids of byClass.values()) {
        samples.push(...fids.slice(0, 3));
      }
      if (samples.length < 10) {
        errors.push(`leg e: only ${samples.length} breakdown samples available (<10)`);
      }
      const shardDir = path.join(jsonDir, "cite-shards");
      let ok = 0;
      for (const fid of samples) {
        const p = path.join(breakdownDir, `${fid}.json`);
        if (!fs.existsSync(p)) continue; // already reported above
        const b = readJson(p);
        const sum = b.rows.reduce((acc, r) => acc + r.v, 0);
        const recorded = Number(b.recorded_value);
        if (!Number.isFinite(recorded) || Math.abs(sum - recorded) > TOL_BREAKDOWN) {
          errors.push(`leg e: breakdown ${fid} rows sum ${sum} != recorded ${b.recorded_value}`);
          continue;
        }
        let rowsOk = true;
        for (const r of b.rows) {
          if (r.fid) {
            const shardPath = path.join(shardDir, `${r.fid.slice(0, 2)}.json`);
            const shard = fs.existsSync(shardPath) ? readJson(shardPath) : {};
            if (!(r.fid in shard)) {
              errors.push(`leg e: breakdown ${fid} row fid ${r.fid} not in its shard`);
              rowsOk = false;
            }
          } else if (r.uncited !== true) {
            errors.push(`leg e: breakdown ${fid} has a fid-less row not marked uncited`);
            rowsOk = false;
          }
        }
        if (rowsOk) ok++;
      }
      notes.push(`leg e: ${ok}/${samples.length} sampled breakdowns verified ✓`);
    }
  }

  // ── Legs (c) + (e-UI): Playwright on /years/ ─────────────────────────────
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    let pageUp = false;
    try {
      const resp = await page.goto(`${baseUrl}/years/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      if (!resp || resp.status() >= 400) {
        errors.push(`leg c: /years/ returned status ${resp ? resp.status() : "none"}`);
      } else {
        const table = await page
          .waitForSelector('[data-testid="years-matrix"]', { timeout: 15000 })
          .catch(() => null);
        if (!table) {
          errors.push('leg c: [data-testid="years-matrix"] not found on /years/');
        } else {
          pageUp = true;
        }
      }
    } catch (e) {
      errors.push(`leg c: /years/ navigation failed: ${e.message}`);
    }

    if (pageUp) {
      // ---- honesty-marker legend near the table controls (strengthened) ----
      if ((await page.locator('[data-testid="cite-legend"]').count()) === 0) {
        errors.push('leg e-UI: [data-testid="cite-legend"] missing on /years/ near the table controls');
      } else {
        notes.push("leg e-UI: honesty-marker legend on /years/ ✓");
      }

      // ---- sticky header + first column at 1440 and 390 ----
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const sticky = await page.evaluate(() => {
          const th = document.querySelector('[data-testid="years-matrix"] thead th');
          const col = document.querySelector("[data-sticky-col]");
          return {
            header: th ? getComputedStyle(th).position : null,
            firstCol: col ? getComputedStyle(col).position : null,
          };
        });
        if (sticky.header !== "sticky")
          errors.push(`leg c: header not sticky at ${width}px (position=${sticky.header})`);
        if (sticky.firstCol !== "sticky")
          errors.push(`leg c: first column not sticky at ${width}px (position=${sticky.firstCol})`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      // ---- decade defaults + edition tags + legend (Phase 5E leg g-UI) ----
      {
        const decadeDefaults = matrix.decade_default_columns ?? [];
        if (decadeDefaults.length < 10) {
          errors.push(
            `leg g-UI: payload decade_default_columns has ${decadeDefaults.length} entries (<10)`
          );
        }
        const nEditionThs = await page
          .locator("th[data-col][data-edition]")
          .count();
        const wantThs = Math.min(decadeDefaults.length, 10);
        if (nEditionThs < wantThs) {
          errors.push(
            `leg g-UI: only ${nEditionThs} decade headers with data-edition rendered by default (want ≥${wantThs})`
          );
        }
        // Spot-check 3 headers state their PB edition visibly.
        for (const key of decadeDefaults.slice(0, 3)) {
          const th = page.locator(`th[data-col="${key}"]`).first();
          if ((await th.count()) === 0) {
            errors.push(`leg g-UI: default decade column ${key} not rendered`);
            continue;
          }
          const edition = (matrix.decade_columns ?? []).find(
            (c) => c.key === key
          )?.edition;
          const text = (await th.textContent()) ?? "";
          if (!text.includes(`PB${edition}`)) {
            errors.push(
              `leg g-UI: header ${key} lacks its visible edition tag PB${edition}`
            );
          }
        }
        // The edition-rule legend near the controls.
        const legend = page.locator('[data-testid="edition-legend"]');
        if ((await legend.count()) === 0) {
          errors.push('leg g-UI: [data-testid="edition-legend"] missing on /years/');
        } else {
          const t = (await legend.first().textContent()) ?? "";
          if (!/PB\(N\+2\)/.test(t)) {
            errors.push("leg g-UI: edition legend does not state the PB(N+2) rule");
          }
        }
        // At least one decade cell renders as a state-A Cite by default.
        if (decadeDefaults.length > 0) {
          const anyDecadeCite = await page
            .locator(`td[data-col="${decadeDefaults[0]}"] [data-fact-id]`)
            .count();
          if (anyDecadeCite === 0) {
            errors.push(
              `leg g-UI: no cited cell rendered under decade column ${decadeDefaults[0]}`
            );
          } else {
            notes.push("leg g-UI: decade defaults + edition tags + legend ✓");
          }
        }
      }

      // ---- leg (i) live half: the qualifier a reader can actually see ----
      if (measureLeg && measureLeg.qualified.length > 0) {
        // Only columns that are VISIBLE by default can be asserted on the
        // opening view; the rest are one column-picker click away and their
        // payload contract is already covered by i1.
        const visibleQualified = [];
        for (const col of measureLeg.qualified) {
          const th = page.locator(`th[data-col="${col.key}"]`);
          if ((await th.count()) > 0) visibleQualified.push({ col, th: th.first() });
        }
        if (visibleQualified.length === 0) {
          errors.push(
            `leg i3: none of the ${measureLeg.qualified.length} qualified decade ` +
              `column(s) is visible in the opening view — the qualifier cannot ` +
              `be checked on what a reader reads ` +
              `(${measureLeg.qualified.map((c) => c.key).join(", ")})`
          );
        }
        for (const { col, th } of visibleQualified) {
          const headerText = (await th.textContent()) ?? "";
          if (!headerText.includes("\u2020")) {
            errors.push(
              `leg i3: header ${col.key} reports ${(col.measures ?? []).join("+")} ` +
                `but carries no \u2020 qualifier mark`
            );
          }
          if (!(await th.getAttribute("data-qualified"))) {
            errors.push(`leg i3: header ${col.key} carries no data-qualified attribute`);
          }
          // Every rendered cell in this column must stamp the payload's token.
          const stamped = await page.evaluate((k) => {
            const out = {};
            for (const td of document.querySelectorAll(`td[data-col="${k}"] [data-measure]`)) {
              const m = td.getAttribute("data-measure");
              out[m] = (out[m] ?? 0) + 1;
            }
            return out;
          }, col.key);
          const rendered = Object.keys(stamped);
          if (rendered.length === 0) {
            errors.push(`leg i3: column ${col.key} renders no [data-measure] cell`);
          }
          const allowed = new Set(col.measures ?? []);
          allowed.add(col.kind);
          const stray = rendered.filter((m) => !allowed.has(m));
          if (stray.length) {
            errors.push(
              `leg i3: column ${col.key} renders data-measure ` +
                `${stray.map((m) => `"${m}"`).join(", ")} — not in the payload's ` +
                `measure set [${[...allowed].join(", ")}]`
            );
          }
          // The bare kind may only be rendered by a column that genuinely has
          // non-divergent cells; a uniform qualified column rendering its kind
          // is the shipped defect exactly.
          if ((col.measures ?? []).every((m) => m !== col.kind) && stamped[col.kind]) {
            errors.push(
              `leg i3: column ${col.key} renders ${stamped[col.kind]} cell(s) as ` +
                `data-measure="${col.kind}" although every one of its cells is ` +
                `${(col.measures ?? []).join("+")}`
            );
          }
        }
        // A qualified column that is NOT default-visible is still one click
        // away in the column picker, and FY2024E — the column this leg exists
        // for — is exactly that. Reveal one and assert the same contract on
        // the revealed header, so "not in the default view" can never become
        // a place the qualifier quietly stops applying.
        const hiddenQualified = measureLeg.qualified.filter(
          (c) => !visibleQualified.some((v) => v.col.key === c.key)
        );
        if (hiddenQualified.length > 0) {
          const col = hiddenQualified[0];
          const label = `FY${col.fy}${{ actuals: "A", enacted: "E", request: "R" }[col.kind]}`;
          const chip = page.locator(`[aria-label="Show ${label} column"]`);
          if ((await chip.count()) === 0) {
            errors.push(
              `leg i3: qualified column ${col.key} is neither visible nor ` +
                `offered in the column picker — its qualifier is unreachable`
            );
          } else {
            await chip.first().click();
            const th = page.locator(`th[data-col="${col.key}"]`).first();
            await th.waitFor({ state: "attached", timeout: 5000 });
            const t = (await th.textContent()) ?? "";
            if (!t.includes("\u2020")) {
              errors.push(
                `leg i3: revealed column ${col.key} reports ` +
                  `${(col.measures ?? []).join("+")} but carries no \u2020`
              );
            }
            const revealed = await page.evaluate((k) => {
              const s = new Set();
              for (const td of document.querySelectorAll(`td[data-col="${k}"] [data-measure]`)) {
                s.add(td.getAttribute("data-measure"));
              }
              return [...s];
            }, col.key);
            const allowed = new Set([...(col.measures ?? []), col.kind]);
            const stray = revealed.filter((m) => !allowed.has(m));
            if (revealed.length === 0) {
              errors.push(`leg i3: revealed column ${col.key} renders no [data-measure] cell`);
            } else if (stray.length) {
              errors.push(
                `leg i3: revealed column ${col.key} renders data-measure ` +
                  `${stray.map((m) => `"${m}"`).join(", ")}, not in [${[...allowed].join(", ")}]`
              );
            } else {
              notes.push(
                `leg i3: revealed ${col.key} from the column picker — ` +
                  `\u2020 + data-measure ${revealed.join("/")} ✓`
              );
            }
            await chip.first().click(); // restore the default view
          }
        }

        // A footnote a reader can see, naming each visible qualified column.
        const fnote = page.locator('[data-testid="measure-qualifier-legend"]');
        if ((await fnote.count()) === 0) {
          errors.push(
            'leg i3: [data-testid="measure-qualifier-legend"] missing on /years/ — ' +
              "the \u2020 points at nothing"
          );
        } else {
          const t = (await fnote.first().textContent()) ?? "";
          for (const { col } of visibleQualified) {
            if (!t.includes(`FY${col.fy}`)) {
              errors.push(
                `leg i3: the measure footnote never names FY${col.fy}, whose ` +
                  `header flies a \u2020`
              );
            }
          }
          if (!/\u2020/.test(t)) {
            errors.push("leg i3: the measure footnote does not carry the \u2020 it explains");
          }
        }
        // i4 — the CSV a reader downloads must carry the qualifier too. Same
        // download path leg (c) uses below, read for its header row only.
        if (visibleQualified.length > 0) {
          let csv = null;
          try {
            const [download] = await Promise.all([
              page.waitForEvent("download", { timeout: 15000 }),
              page.locator('[data-testid="years-csv"]').click(),
            ]);
            csv = fs.readFileSync(await download.path(), "utf8").split("\n")[0];
          } catch (e) {
            errors.push(`leg i4: /years/ CSV export did not download (${e.message})`);
          }
          if (!csv) {
            errors.push("leg i4: could not read the /years/ CSV export header");
          } else {
            for (const { col } of visibleQualified) {
              // Each token must appear, not a particular joined spelling —
              // the gate holds the CONTRACT (the qualifier survives into the
              // file), never the exporter's choice of separator.
              const want = (col.measures ?? []).map((m) => m.replace(/-/g, "_"));
              const field = csv
                .split(",")
                .find((f) => f.startsWith(`${col.key}_pb${col.edition}`));
              if (!field) {
                errors.push(`leg i4: CSV header has no field for ${col.key}`);
              } else {
                const missing = want.filter((w) => !field.includes(w));
                if (missing.length) {
                  errors.push(
                    `leg i4: CSV field "${field}" for ${col.key} omits measure ` +
                      `token(s) ${missing.join(", ")} — a downstream script reading ` +
                      `this file still sees a bare ${col.kind} column`
                  );
                }
              }
            }
            notes.push("leg i3/i4: \u2020 header, footnote, cell data-measure and CSV header ✓");
          }
        }
      }

      // ---- sort correctness on two columns (missing-last) ----
      const readColumn = (key) =>
        page.evaluate((k) => {
          return [...document.querySelectorAll("tr[data-program-row]")]
            .filter((tr) => tr.offsetParent !== null)
            .map((tr) => {
              const td = tr.querySelector(`[data-col="${k}"][data-v]`);
              return td ? Number(td.getAttribute("data-v")) : null;
            });
        }, key);

      const check = (arr, dir) => {
        const nums = arr.filter((v) => v != null);
        const firstNullIdx = arr.findIndex((v) => v == null);
        if (firstNullIdx !== -1 && arr.slice(firstNullIdx).some((v) => v != null)) {
          return `missing values not last`;
        }
        for (let i = 1; i < nums.length; i++) {
          if (dir === "desc" ? nums[i] > nums[i - 1] + 1e-9 : nums[i] < nums[i - 1] - 1e-9)
            return `not ${dir} at index ${i}`;
        }
        return null;
      };

      // Sort keys come from the DEFAULT visible column set: the decade
      // defaults when the payload carries them (Phase 5E — the 5D keys are
      // no longer visible by default), else the 5D pair. Same check, same
      // strength: two visible columns, desc AND asc, missing-last.
      const sortKeys = (matrix.decade_default_columns ?? []).length
        ? [
            matrix.decade_default_columns[
              matrix.decade_default_columns.length - 1
            ],
            matrix.decade_default_columns[0],
          ]
        : ["fy_2026_total", "fy_2024_actuals"];

      // ---- §P2-2: the DEFAULT order, before any click ----
      // The grid used to open in payload order (org, then PE/BLI ascending),
      // which put the smallest, sparsest lines first — a first screenful of
      // em-dashes on the flagship view. It now opens sorted DESC on the
      // newest non-delta default column, which is exactly sortKeys[0].
      // Asserted here with ZERO clicks, so a regression to payload order
      // fails even though every click-driven check below would still pass.
      {
        const defaultKey = sortKeys[0];
        const ariaSort = await page
          .locator(`th[data-col="${defaultKey}"]`)
          .first()
          .getAttribute("aria-sort");
        if (ariaSort !== "descending") {
          errors.push(
            `leg c (§P2-2): /years/ does not OPEN sorted on ${defaultKey} — th[data-col="${defaultKey}"] aria-sort="${ariaSort}", want "descending"`
          );
        }
        const openingVals = await readColumn(defaultKey);
        const nNums = openingVals.filter((v) => v != null).length;
        if (nNums < 50) {
          errors.push(
            `leg c (§P2-2): only ${nNums} numeric ${defaultKey} cell(s) in the opening view (need ≥50) — the default-order check is vacuous`
          );
        }
        const defErr = check(openingVals, "desc");
        if (defErr) {
          errors.push(
            `leg c (§P2-2): /years/ opening order is not ${defaultKey} descending: ${defErr}`
          );
        } else if (nNums >= 50) {
          notes.push(
            `leg c: /years/ opens on ${defaultKey} desc over ${nNums} numeric cells ✓ (§P2-2)`
          );
        }
      }

      for (const key of sortKeys) {
        const trigger = page.locator(`[data-sort="${key}"]`).first();
        if ((await trigger.count()) === 0) {
          errors.push(`leg c: no sort trigger [data-sort="${key}"]`);
          continue;
        }
        // Normalize to the unsorted state first: the header cycles
        // desc → asc → cleared, and since §P2-2 the grid OPENS on sortKeys[0]
        // already descending. Clicking out of whatever state we are in keeps
        // the two assertions below testing exactly what they always did (one
        // click ⇒ desc, a second ⇒ asc) instead of testing an offset cycle.
        for (let guard = 0; guard < 3; guard += 1) {
          const state = await page
            .locator(`th[data-col="${key}"]`)
            .first()
            .getAttribute("aria-sort");
          if (state === "none" || state == null) break;
          await trigger.click();
        }
        await trigger.click();
        let vals = await readColumn(key);
        let err = check(vals, "desc");
        if (err) errors.push(`leg c: sort ${key} (1st click): ${err}`);
        await trigger.click();
        vals = await readColumn(key);
        err = check(vals, "asc");
        if (err) errors.push(`leg c: sort ${key} (2nd click): ${err}`);
      }
      notes.push("leg c: sort checks done");

      // ---- expand shows project rows ----
      {
        const before = await page.locator("tr[data-project-row]:visible").count();
        const caret = page.locator("[data-expand]").first();
        if ((await caret.count()) === 0) {
          errors.push("leg c: no [data-expand] caret found");
        } else {
          await caret.click();
          await page.waitForTimeout(400);
          const after = await page.locator("tr[data-project-row]:visible").count();
          if (after <= before) {
            errors.push(`leg c: expand did not reveal project rows (${before} → ${after})`);
          } else {
            notes.push(`leg c: expand revealed ${after - before} project rows ✓`);
          }
          await caret.click(); // collapse back
        }
      }

      // ---- CSV export matches the current view ----
      const csvPeSet = async () => {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15000 }),
          page.locator('[data-testid="years-csv"]').click(),
        ]);
        const file = await download.path();
        const rows = parseCsv(fs.readFileSync(file, "utf8"));
        if (rows.length < 2) throw new Error("CSV has no data rows");
        const header = rows[0];
        const peIdx = header.findIndex((h) => /pe.?bli/i.test(h));
        if (peIdx === -1) throw new Error(`CSV lacks a pe_bli column: ${header.join(",")}`);
        return new Set(rows.slice(1).map((r) => r[peIdx]).filter(Boolean));
      };
      const visiblePeSet = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("tr[data-program-row]")]
            .filter((tr) => tr.offsetParent !== null)
            .map((tr) => tr.getAttribute("data-pe"))
        );

      try {
        const csvSet = await csvPeSet();
        const visSet = new Set(await visiblePeSet());
        const missing = [...visSet].filter((pe) => !csvSet.has(pe));
        const extra = [...csvSet].filter((pe) => !visSet.has(pe));
        if (missing.length > 0 || extra.length > 0) {
          errors.push(
            `leg c: CSV/view mismatch (missing ${missing.length}, extra ${extra.length})`
          );
        } else {
          notes.push(`leg c: CSV matches view (${csvSet.size} programs) ✓`);
        }
      } catch (e) {
        errors.push(`leg c: CSV export failed: ${e.message}`);
      }

      // ---- leg h: §P2-7 cell notation + §P1-5 count notation ----
      {
        const legend = page.locator('[data-testid="cell-state-legend"]');
        if ((await legend.count()) === 0) {
          errors.push(
            'leg h (§P2-7): no [data-testid="cell-state-legend"] — the three ' +
              "notations render with nothing to decode them",
          );
        } else {
          const text = ((await legend.first().textContent()) ?? "").replace(/\s+/g, " ");
          for (const token of ["0", "<0.05", "\u2014"]) {
            if (!text.includes(token)) {
              errors.push(
                `leg h (§P2-7): the notation legend never mentions ${JSON.stringify(token)} — "${text.slice(0, 90)}"`,
              );
            }
          }
        }

        // Re-derive every visible program cell's state from its own data-v.
        const cells = await page.$$eval(
          "tr[data-program-row] td[data-col]",
          (tds) =>
            tds.map((td) => ({
              col: td.getAttribute("data-col"),
              v: td.hasAttribute("data-v") ? Number(td.getAttribute("data-v")) : null,
              state: td.getAttribute("data-cell-state"),
              text: (td.textContent ?? "").replace(/\s+/g, " ").trim(),
            })),
        );
        const seen = { zero: 0, "rounded-zero": 0, absent: 0, value: 0 };
        const bad = [];
        for (const c of cells) {
          const pct = c.col === "fy2526_pct_change";
          let want;
          if (c.v === null) want = "absent";
          else {
            const display = pct ? c.v : c.v / 1000;
            want =
              display === 0 ? "zero" : Math.abs(display) < 0.05 ? "rounded-zero" : "value";
          }
          if (c.state !== want) {
            bad.push(`${c.col} v=${c.v} declares ${c.state}, payload says ${want}`);
            continue;
          }
          seen[want] = (seen[want] ?? 0) + 1;
          const glyphOk =
            want === "absent"
              ? c.text.startsWith("\u2014")
              : want === "zero"
                ? /^[+\u2212-]?0%?$/.test(c.text)
                : want === "rounded-zero"
                  ? c.text.includes("<0.05")
                  : !c.text.includes("<0.05");
          if (!glyphOk) {
            bad.push(`${c.col} v=${c.v} is ${want} but renders ${JSON.stringify(c.text)}`);
          }
        }
        if (bad.length > 0) {
          errors.push(
            `leg h (§P2-7): ${bad.length} cell(s) whose glyph and payload disagree (first 5):`,
          );
          for (const b of bad.slice(0, 5)) errors.push(`  ${b}`);
        } else if (seen.zero === 0 || seen["rounded-zero"] === 0 || seen.absent === 0) {
          errors.push(
            `leg h (§P2-7) is VACUOUS: opening view holds ${seen.zero} zero, ` +
              `${seen["rounded-zero"]} rounded-zero and ${seen.absent} absent cell(s) — ` +
              `all three must be present for the distinction to be under test`,
          );
        } else {
          notes.push(
            `leg h: ${cells.length} cell(s) — ${seen.zero} zero, ${seen["rounded-zero"]} ` +
              `rounded-zero, ${seen.absent} absent, ${seen.value} valued; every glyph ` +
              `matches its payload, legend decodes all three ✓ (§P2-7)`,
          );
        }

        // §P1-5: the filter summary is client-rendered, so gate 24's sweep of
        // the built HTML cannot see it at all.
        const countEl = page.locator('[data-testid="years-count"]');
        if ((await countEl.count()) === 0) {
          errors.push(
            'leg h (§P1-5): no [data-testid="years-count"] on /years/ — the ' +
              "count-notation check has nothing to read",
          );
        } else {
          const summary = ((await countEl.first().textContent()) ?? "")
            .replace(/\s+/g, " ")
            .trim();
          const bare = summary.match(/(?<![\d,.])(\d{4,})(?![\d,.])/);
          if (bare) {
            errors.push(
              `leg h (§P1-5): /years/ renders the ungrouped count "${summary}" — ` +
                `write ${Number(bare[1]).toLocaleString("en-US")}, not ${bare[1]}`,
            );
          } else if (!/\d/.test(summary)) {
            errors.push(
              `leg h (§P1-5): the /years/ count summary carries no number at all ("${summary}")`,
            );
          } else {
            notes.push(`leg h: /years/ count notation grouped ("${summary}") ✓ (§P1-5)`);
          }
        }
      }

      // ---- filter narrows + filtered CSV matches ----
      {
        const target = matrix.orgs[0].programs[0];
        const filterInput = page.locator('[data-testid="years-filter"]');
        if ((await filterInput.count()) === 0) {
          errors.push('leg c: no [data-testid="years-filter"] input');
        } else {
          await filterInput.fill(target.pe_bli);
          await page.waitForTimeout(300);
          const vis = await visiblePeSet();
          if (!vis.includes(target.pe_bli)) {
            errors.push(`leg c: filter by ${target.pe_bli} hid the matching program`);
          }
          if (vis.length >= nPrograms) {
            errors.push(`leg c: filter did not narrow rows (${vis.length} visible)`);
          }
          try {
            const csvSet = await csvPeSet();
            const visSet = new Set(vis);
            if (
              csvSet.size !== visSet.size ||
              [...csvSet].some((pe) => !visSet.has(pe))
            ) {
              errors.push("leg c: filtered CSV does not match the filtered view");
            } else {
              notes.push(`leg c: filter narrows to ${vis.length} row(s), CSV matches ✓`);
            }
          } catch (e) {
            errors.push(`leg c: filtered CSV export failed: ${e.message}`);
          }
          await filterInput.fill("");
        }
      }

      // ---- Leg (e) UI: Δ cell breakdown table in the citation panel ----
      {
        const delta = deltaCells[0];
        if (!delta) {
          errors.push("leg e: no Δ cell available for the breakdown UI check");
        } else {
          // Phase 5E: the decade defaults replaced the Δ column in the
          // default view — reveal it through the column picker (the same
          // user path) before the check. The check itself is unchanged.
          if ((await page.locator('th[data-col="fy2526_change"]').count()) === 0) {
            const chip = page.locator('button[aria-label^="Show Δ"]').first();
            if ((await chip.count()) === 0) {
              errors.push(
                "leg e: Δ column hidden by default and no picker chip to reveal it"
              );
            } else {
              await chip.click();
              await page.waitForTimeout(300);
            }
          }
          const cite = page.locator(`[data-fact-id="${delta.cell.fid}"]`).first();
          if ((await cite.count()) === 0) {
            errors.push(`leg e: no [data-fact-id="${delta.cell.fid}"] Δ cite on /years/`);
          } else {
            await cite.click();
            const panel = await page
              .waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 })
              .catch(() => null);
            if (!panel) {
              errors.push("leg e: citation panel did not open from a Δ cell");
            } else {
              const table = await page
                .waitForSelector('[data-testid="breakdown-table"]', { timeout: 10000 })
                .catch(() => null);
              if (!table) {
                errors.push("leg e: breakdown table not shown for a Δ derived citation");
              } else {
                const sumV = await page.evaluate(() => {
                  const el = document.querySelector('[data-testid="breakdown-sum"][data-v]');
                  return el ? Number(el.getAttribute("data-v")) : null;
                });
                const recorded = Number(citations[delta.cell.fid].recorded_value);
                if (sumV == null || Math.abs(sumV - recorded) > TOL_CELL) {
                  errors.push(
                    `leg e: breakdown sum row ${sumV} != derived recorded ${recorded}`
                  );
                }
                try {
                  const [download] = await Promise.all([
                    page.waitForEvent("download", { timeout: 15000 }),
                    page.locator('[data-testid="breakdown-csv"]').click(),
                  ]);
                  const rows = parseCsv(fs.readFileSync(await download.path(), "utf8"));
                  const nTableRows = await page
                    .locator('[data-testid="breakdown-table"] tbody tr')
                    .count();
                  if (rows.length - 1 !== nTableRows) {
                    errors.push(
                      `leg e: breakdown CSV has ${rows.length - 1} data rows, table has ${nTableRows}`
                    );
                  } else {
                    notes.push("leg e: breakdown UI (inline table + sum + CSV) ✓");
                  }
                } catch (e) {
                  errors.push(`leg e: breakdown CSV export failed: ${e.message}`);
                }
              }
            }
          }
        }
      }

      // ---- Leg (e-UI overlay, STRENGTHENED 2026-07-02): the large-overlay
      //      sum row must stay visible while the overlay body is MID-SCROLL
      //      (visual-judge M2 blocker — do not weaken; see header docs) ----
      {
        // Find an overlay-sized breakdown (>5 rows renders as the overlay)
        // and the built page whose server-rendered HTML cites it.
        const breakdownDir = path.join(jsonDir, "breakdowns");
        const agencyDir = path.join(siteRoot, "out", "agency");
        let overlay = null; // { fid, nRows, url }
        if (fs.existsSync(breakdownDir) && fs.existsSync(agencyDir)) {
          const candidates = fs
            .readdirSync(breakdownDir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => {
              const b = readJson(path.join(breakdownDir, f));
              return { fid: f.replace(".json", ""), nRows: b.rows?.length ?? 0 };
            })
            .filter((c) => c.nRows > 5)
            .sort((a, b) => b.nRows - a.nRows);
          const slugs = fs.readdirSync(agencyDir);
          outer: for (const cand of candidates) {
            for (const slug of slugs) {
              const p = path.join(agencyDir, slug, "index.html");
              if (!fs.existsSync(p)) continue;
              if (fs.readFileSync(p, "utf8").includes(`data-fact-id="${cand.fid}"`)) {
                overlay = { ...cand, url: `/agency/${slug}/` };
                break outer;
              }
            }
          }
        }

        if (!overlay) {
          errors.push(
            "leg e-UI: no overlay-sized (>5-row) breakdown cited on any built agency page — the strengthened overlay checks cannot run"
          );
        } else {
          try {
            await page.goto(`${baseUrl}${overlay.url}`, {
              waitUntil: "networkidle",
              timeout: 30000,
            });
            const cite = page.locator(`[data-fact-id="${overlay.fid}"]`).first();
            await cite.scrollIntoViewIfNeeded();
            await cite.click();
            await page.waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 });
            await page.locator('[data-testid="breakdown-open"]').click({ timeout: 10000 });
            await page.waitForSelector('[data-testid="breakdown-overlay"]', { timeout: 10000 });

            const recorded = Number(citations[overlay.fid].recorded_value);

            // Header states the recorded total the line items reconcile to.
            const headerV = await page.evaluate(() => {
              const el = document.querySelector('[data-testid="breakdown-overlay-total"][data-v]');
              return el ? Number(el.getAttribute("data-v")) : null;
            });
            if (headerV == null || Math.abs(headerV - recorded) > TOL_CELL) {
              errors.push(
                `leg e-UI: overlay header total ${headerV} != recorded ${recorded} (${overlay.fid})`
              );
            }

            // Honesty-marker legend inside the overlay header.
            const legendInOverlay = await page
              .locator('[data-testid="breakdown-overlay"] [data-testid="cite-legend"]')
              .count();
            if (legendInOverlay === 0) {
              errors.push("leg e-UI: honesty-marker legend missing from the breakdown overlay");
            }

            // Scroll the overlay body to its midpoint, then require the sum
            // row to still be fully visible inside the scrollport.
            const scrolled = await page.evaluate(() => {
              const s = document.querySelector('[data-testid="breakdown-scroll"]');
              if (!s) return null;
              s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2);
              return { max: s.scrollHeight - s.clientHeight };
            });
            if (!scrolled) {
              errors.push('leg e-UI: [data-testid="breakdown-scroll"] scrollport missing in overlay');
            } else if (scrolled.max <= 0) {
              errors.push(
                `leg e-UI: overlay body does not scroll (${overlay.nRows} rows should overflow) — mid-scroll check impossible`
              );
            } else {
              await page.waitForTimeout(200);
              const mid = await page.evaluate(() => {
                const s = document.querySelector('[data-testid="breakdown-scroll"]');
                const row = document.querySelector('[data-testid="breakdown-sum"]');
                const td = row ? row.querySelector("td") : null;
                if (!s || !row || !td) return null;
                const sr = s.getBoundingClientRect();
                const rr = td.getBoundingClientRect();
                const style = getComputedStyle(td);
                return {
                  scrollTop: s.scrollTop,
                  visible:
                    rr.height > 0 &&
                    rr.top >= sr.top - 1 &&
                    rr.bottom <= sr.bottom + 1,
                  position: style.position,
                  bg: style.backgroundColor,
                  dataV: Number(row.getAttribute("data-v")),
                };
              });
              if (!mid) {
                errors.push("leg e-UI: overlay sum row not found while mid-scroll");
              } else {
                if (mid.scrollTop <= 0) {
                  errors.push("leg e-UI: overlay scrollport did not scroll (scrollTop=0)");
                }
                if (!mid.visible) {
                  errors.push(
                    "leg e-UI: overlay sum row NOT visible while mid-scroll (the M2 regression)"
                  );
                }
                if (mid.position !== "sticky") {
                  errors.push(
                    `leg e-UI: overlay sum td position=${mid.position} (want sticky)`
                  );
                }
                const transparent =
                  mid.bg === "rgba(0, 0, 0, 0)" ||
                  /\/\s*0(\.\d+)?\s*\)/.test(mid.bg) ||
                  /rgba\([^)]+,\s*0(\.\d+)?\s*\)/.test(mid.bg);
                if (transparent) {
                  errors.push(
                    `leg e-UI: overlay sum row background is not opaque (${mid.bg}) — rows would ghost through`
                  );
                }
                if (Math.abs(mid.dataV - recorded) > TOL_CELL) {
                  errors.push(
                    `leg e-UI: overlay sum data-v ${mid.dataV} != recorded ${recorded}`
                  );
                }
                if (
                  mid.scrollTop > 0 &&
                  mid.visible &&
                  mid.position === "sticky" &&
                  !transparent
                ) {
                  notes.push(
                    `leg e-UI (strengthened): overlay ${overlay.fid} (${overlay.nRows} rows on ${overlay.url}) — header total + legend + sum row pinned & opaque mid-scroll ✓`
                  );
                }
              }
            }
          } catch (e) {
            errors.push(`leg e-UI: overlay check failed: ${e.message}`);
          }
        }
      }

      if (consoleErrors.length > 0) {
        errors.push(
          `leg c: ${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(" | ")}`
        );
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
