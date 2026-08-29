/**
 * gate — og_gate
 *
 * Checks that OG PNG files exist and are plausible:
 *   (a) Core pages have OG PNGs (feed, about, programs, companies)
 *   (b) Program OG PNGs exist (sample 10)
 *   (c) Agency OG PNGs exist (sample 5)
 *   (d) Each sampled PNG is >= 10KB (non-blank proxy) and has valid PNG header
 *   (e) PNG dimensions encoded in header are 1200x630 (standard OG size)
 *   (f) DESCRIPTIONS ARE WRITTEN, AND ON THE CANONICAL BASIS (Sprint 3 §P2-5).
 *       Program og:description used to be a slice of R-2/P-40 justification
 *       prose, so every share card opened mid-thought. This leg reads the
 *       BUILT program pages and requires, on a sample:
 *         - og:description and the meta description are present and identical
 *           (one description, not two);
 *         - it opens with the program's own title and PE/BLI, and closes with
 *           the site's promise — a description is about the page, not an
 *           excerpt from inside it;
 *         - every dollar figure in it is re-derived HERE from the trajectory
 *           payload through the compact ladder and must match exactly, and the
 *           text must name the P-1/R-1 workbook TOA basis it came from. A
 *           description that quietly switched to the R-2/P-40 line (the §P0-1
 *           basis) fails.
 *       Non-vacuity: the sample must contain ≥5 pages that carry a figure.
 *
 * PNG dimension check: bytes 16-19 = width (big-endian uint32),
 *                      bytes 20-23 = height (big-endian uint32).
 * These are in the IHDR chunk, which always starts at byte 16 in a valid PNG.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// pngjs is in devDependencies; load via createRequire since this gate is ESM
// but pngjs ships as CJS.
const _require = createRequire(import.meta.url);
const { PNG } = _require("pngjs");

import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const ogDir = path.resolve(siteRoot, "public", "og");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");
const outDir = path.resolve(siteRoot, "out");

const EXPECTED_WIDTH = 1200;
const EXPECTED_HEIGHT = 630;
const MIN_FILE_SIZE = 10 * 1024; // 10KB
const SAMPLE_PROGRAMS = 10;
const SAMPLE_AGENCIES = 5;

/** Minimum fraction of pixels that must differ from the dominant background color. */
const MIN_PIXEL_DIVERSITY = 0.05; // 5%

// PNG header: bytes 0-7 = \x89PNG\r\n\x1a\n
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function checkPng(filePath) {
  const result = { ok: false, width: null, height: null, size: 0, error: null };
  try {
    const stat = fs.statSync(filePath);
    result.size = stat.size;
    if (stat.size < MIN_FILE_SIZE) {
      result.error = `file too small (${stat.size} bytes < ${MIN_FILE_SIZE} threshold — may be blank)`;
      return result;
    }

    // Read first 30 bytes for PNG signature + IHDR chunk header + dimensions
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(30);
    fs.readSync(fd, buf, 0, 30, 0);
    fs.closeSync(fd);

    // Check PNG signature
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== PNG_SIGNATURE[i]) {
        result.error = `invalid PNG signature at byte ${i}`;
        return result;
      }
    }

    // IHDR chunk: bytes 8-11 = chunk length (4 bytes), 12-15 = "IHDR",
    // 16-19 = width, 20-23 = height
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    result.width = width;
    result.height = height;

    if (width !== EXPECTED_WIDTH || height !== EXPECTED_HEIGHT) {
      result.error = `dimensions ${width}x${height}, expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`;
      return result;
    }

    result.ok = true;
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

/**
 * Decode a PNG file and return the fraction of pixels that differ from
 * the dominant background color (most frequent RGBA value in the first row).
 * Returns null if decode fails.
 */
async function pixelDiversityRatio(filePath) {
  return new Promise((resolve) => {
    try {
      const buf = fs.readFileSync(filePath);
      const png = new PNG();
      png.parse(buf, (err, data) => {
        if (err) return resolve(null);
        const { width, height, data: pixels } = data;
        const total = width * height;
        if (total === 0) return resolve(null);

        // Find dominant color in the first row (background proxy)
        const colorCount = new Map();
        for (let x = 0; x < width; x++) {
          const idx = x * 4;
          const key = `${pixels[idx]},${pixels[idx+1]},${pixels[idx+2]},${pixels[idx+3]}`;
          colorCount.set(key, (colorCount.get(key) ?? 0) + 1);
        }
        let dominantColor = null;
        let maxCount = 0;
        for (const [key, count] of colorCount) {
          if (count > maxCount) { maxCount = count; dominantColor = key; }
        }
        if (!dominantColor) return resolve(null);
        const [r, g, b, a] = dominantColor.split(",").map(Number);

        // Count pixels that differ from dominant color by more than a small threshold
        let different = 0;
        for (let i = 0; i < total; i++) {
          const pi = i * 4;
          const dr = Math.abs(pixels[pi] - r);
          const dg = Math.abs(pixels[pi+1] - g);
          const db = Math.abs(pixels[pi+2] - b);
          const da = Math.abs(pixels[pi+3] - a);
          if (dr + dg + db + da > 10) different++;
        }
        resolve(different / total);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

export async function runOgGate() {
  const errors = [];
  const notes = [];

  // Missing public/og/ is a hard FAIL — OG images are required for sharing.
  if (!fs.existsSync(ogDir)) {
    errors.push(`og_gate: public/og/ directory not found at ${ogDir} — OG image pipeline has not run`);
    return { pass: false, errors, notes };
  }

  const allOgFiles = fs.readdirSync(ogDir).filter((f) => f.endsWith(".png"));
  notes.push(`public/og/: ${allOgFiles.length} PNG files`);

  if (allOgFiles.length === 0) {
    errors.push("public/og/: no PNG files found");
    return { pass: false, errors, notes };
  }

  // ── (a) Core page OG PNGs ──────────────────────────────────────────────────
  // These are the actual core OG images generated by the satori pipeline.
  // "programs.png" and "companies.png" do not exist — the site uses per-entity
  // slugs (company-boeing.png etc). Core pages are: home, feed, about, data,
  // flow (Phase 5H).
  const coreFiles = ["home.png", "feed.png", "about.png", "data.png", "flow.png"];
  let coreMissing = 0;
  for (const f of coreFiles) {
    const p = path.join(ogDir, f);
    if (!fs.existsSync(p)) {
      errors.push(`og_gate: core OG missing: public/og/${f}`);
      coreMissing++;
    }
  }
  if (coreMissing === 0) {
    notes.push(`core OG PNGs: ${coreFiles.join(", ")} ✓`);
  }

  // ── (b) Program OG samples — header validity + pixel diversity floor ───────
  const programOgFiles = allOgFiles.filter((f) => f.startsWith("program-"));
  const programSample = programOgFiles.slice(0, SAMPLE_PROGRAMS);

  let programOk = 0;
  for (const f of programSample) {
    const filePath = path.join(ogDir, f);
    const result = checkPng(filePath);
    if (!result.ok) {
      errors.push(`og_gate: program OG ${f}: ${result.error}`);
      continue;
    }
    // Pixel diversity floor: ≥5% of pixels must differ from background
    const diversity = await pixelDiversityRatio(filePath);
    if (diversity === null) {
      errors.push(`og_gate: program OG ${f}: failed to decode PNG for pixel diversity check`);
      continue;
    }
    if (diversity < MIN_PIXEL_DIVERSITY) {
      errors.push(
        `og_gate: program OG ${f}: only ${(diversity * 100).toFixed(1)}% pixel diversity (< ${MIN_PIXEL_DIVERSITY * 100}% floor) — image appears blank`
      );
      continue;
    }
    programOk++;
  }
  if (programSample.length > 0) {
    notes.push(
      `program OG sample (${programSample.length}): ${programOk}/${programSample.length} valid with ≥${MIN_PIXEL_DIVERSITY * 100}% pixel diversity ✓`
    );
  } else {
    notes.push("program OG files: none found (dossier pipeline may not have run)");
  }

  // ── (c) Agency OG samples ──────────────────────────────────────────────────
  const agencyOgFiles = allOgFiles.filter((f) => f.startsWith("agency-"));
  const agencySample = agencyOgFiles.slice(0, SAMPLE_AGENCIES);

  let agencyOk = 0;
  for (const f of agencySample) {
    const result = checkPng(path.join(ogDir, f));
    if (result.ok) {
      agencyOk++;
    } else {
      errors.push(`og_gate: agency OG ${f}: ${result.error}`);
    }
  }
  if (agencySample.length > 0) {
    notes.push(
      `agency OG sample (${agencySample.length}): ${agencyOk}/${agencySample.length} valid ✓`
    );
  }

  // ── (d)+(e) Check all core PNGs that exist ──────────────────────────────────
  // (already covered by the samples above; add a quick check for any file
  // we have not yet checked)
  const existingCore = coreFiles.filter((f) => fs.existsSync(path.join(ogDir, f)));
  let coreOk = 0;
  for (const f of existingCore) {
    const result = checkPng(path.join(ogDir, f));
    if (result.ok) {
      coreOk++;
    } else {
      errors.push(`og_gate: core ${f}: ${result.error}`);
    }
  }
  if (existingCore.length > 0) {
    notes.push(`core OG PNG validity: ${coreOk}/${existingCore.length} ✓`);
  }

  // ── (f) descriptions are written, and on the canonical basis (§P2-5) ──────
  runDescriptionLeg(errors, notes);

  return { pass: errors.length === 0, errors, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// leg (f) — og:description
// ─────────────────────────────────────────────────────────────────────────────

/** The compact ladder, mirrored from src/lib/format.ts (see its header). */
function fmtUsdThousands(vThousands) {
  const raw = vThousands * 1000;
  const abs = Math.abs(raw);
  const sign = raw < 0 ? "-" : "";
  const rungs = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (let i = 0; i < rungs.length; i += 1) {
    const [limit, suffix] = rungs[i];
    if (abs < limit) continue;
    const v = abs / limit;
    const dec = v < 10 ? 2 : 1;
    if (i > 0 && Number(v.toFixed(dec)) >= 1000) {
      const [upLimit, upSuffix] = rungs[i - 1];
      const uv = abs / upLimit;
      return `${sign}$${uv.toFixed(uv < 10 ? 2 : 1)}${upSuffix}`;
    }
    return `${sign}$${v.toFixed(dec)}${suffix}`;
  }
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

const DESC_PROMISE = "Every figure links to the document it is printed in.";
const DESC_BASIS = "P-1/R-1 workbook total obligation authority";
const DESC_SAMPLE = 40;

function runDescriptionLeg(errors, notes) {
  const programsPath = path.join(jsonDir, "programs.json");
  if (!fs.existsSync(programsPath) || !fs.existsSync(outDir)) {
    errors.push(
      `og leg f: cannot run — missing ${!fs.existsSync(outDir) ? "out/" : "programs.json"}`
    );
    return;
  }
  const programs = JSON.parse(fs.readFileSync(programsPath, "utf8"));
  // Sample across the corpus rather than the first N: the alphabetical head is
  // all one service.
  const stride = Math.max(1, Math.floor(programs.length / DESC_SAMPLE));
  const sample = programs.filter((_, i) => i % stride === 0).slice(0, DESC_SAMPLE);

  let checked = 0;
  let withFigures = 0;
  const failures = [];

  for (const p of sample) {
    // THE PAGE THIS ROW IS, not the bare key. A split key (ROADMAP #45/#67 —
    // '20', '30', '500' and the ten account collisions) has one programs.json
    // row per side, each with its own page at `slug`; `out/program/{pe_bli}/`
    // is the DISAMBIGUATION STUB, whose description names both sides and
    // deliberately opens with neither row's title. Reading the stub and
    // comparing it against one side's title reports a violation that is not
    // there, and — worse — never checks the two real pages at all. Invisible
    // until Wave 5: the sample is a stride across programs.json, and the
    // corpus growing from 1,755 to 1,938 rows moved the stride onto '500'.
    const slug = p.slug ?? p.pe_bli;
    const file = path.join(outDir, "program", slug, "index.html");
    if (!fs.existsSync(file)) continue;
    const root = parse(fs.readFileSync(file, "utf8"), { comment: false });
    const meta = root
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");
    const og = root
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");
    checked += 1;

    if (!meta || !og) {
      failures.push(`${slug}: missing ${!meta ? "meta" : "og"} description`);
      continue;
    }
    if (meta !== og) {
      failures.push(`${slug}: meta and og descriptions differ`);
      continue;
    }
    if (!meta.startsWith(`${p.title} (${slug})`)) {
      failures.push(
        `${slug}: description does not open with its own title + code — "${meta.slice(0, 70)}…"`
      );
      continue;
    }
    if (!meta.endsWith(DESC_PROMISE)) {
      failures.push(
        `${slug}: description does not close with the site promise — "…${meta.slice(-60)}"`
      );
      continue;
    }

    const fy26 = p.trajectory?.fy2026_total ?? null;
    const fy24 = p.trajectory?.fy2024_actuals ?? null;
    const expected = [];
    if (fy26 != null) expected.push(`${fmtUsdThousands(fy26)} requested for FY2026`);
    if (fy24 != null) expected.push(`${fmtUsdThousands(fy24)} in FY2024 actuals`);

    const printed = meta.match(/\$[\d,.]+[TBMK]?/g) ?? [];
    if (expected.length === 0) {
      if (printed.length > 0) {
        failures.push(
          `${slug}: description states ${printed.join(", ")} but the corpus holds no trajectory figure for it`
        );
      }
      continue;
    }
    withFigures += 1;
    for (const clause of expected) {
      if (!meta.includes(clause)) {
        failures.push(
          `${slug}: description is missing (or disagrees with) "${clause}" — "${meta.slice(0, 120)}…"`
        );
      }
    }
    if (!meta.includes(DESC_BASIS)) {
      failures.push(
        `${slug}: description states figures without naming the ${DESC_BASIS} basis they came from`
      );
    }
  }

  if (failures.length > 0) {
    errors.push(`og leg f: ${failures.length} description violation(s) — §P2-5 (first 10):`);
    for (const f of failures.slice(0, 10)) errors.push(`  ${f}`);
    if (failures.length > 10) errors.push(`  ... and ${failures.length - 10} more`);
  } else if (withFigures < 5) {
    errors.push(
      `og leg f is VACUOUS: only ${withFigures} of ${checked} sampled program pages carry a figure in their description`
    );
  } else {
    notes.push(
      `og descriptions: ${checked} program page(s) sampled, ${withFigures} carrying figures — all written, identical meta/og, every dollar re-derived from the workbook TOA trajectory ✓`
    );
  }
}
