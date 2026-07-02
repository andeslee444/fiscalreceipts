/**
 * gate — og_gate
 *
 * Checks that OG PNG files exist and are plausible:
 *   (a) Core pages have OG PNGs (feed, about, programs, companies)
 *   (b) Program OG PNGs exist (sample 10)
 *   (c) Agency OG PNGs exist (sample 5)
 *   (d) Each sampled PNG is >= 10KB (non-blank proxy) and has valid PNG header
 *   (e) PNG dimensions encoded in header are 1200x630 (standard OG size)
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const ogDir = path.resolve(siteRoot, "public", "og");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

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
  // slugs (company-boeing.png etc). Core pages are: home, feed, about, data.
  const coreFiles = ["home.png", "feed.png", "about.png", "data.png"];
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

  return { pass: errors.length === 0, errors, notes };
}
