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
