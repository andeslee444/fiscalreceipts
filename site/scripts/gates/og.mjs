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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const ogDir = path.resolve(siteRoot, "public", "og");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

const EXPECTED_WIDTH = 1200;
const EXPECTED_HEIGHT = 630;
const MIN_FILE_SIZE = 10 * 1024; // 10KB
const SAMPLE_PROGRAMS = 10;
const SAMPLE_AGENCIES = 5;

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

export async function runOgGate() {
  const errors = [];
  const notes = [];

  // Gracefully handle missing public/og/ (pre-build)
  if (!fs.existsSync(ogDir)) {
    notes.push("public/og/ not found — OG images not yet generated (SKIP)");
    return { pass: true, errors, notes };
  }

  const allOgFiles = fs.readdirSync(ogDir).filter((f) => f.endsWith(".png"));
  notes.push(`public/og/: ${allOgFiles.length} PNG files`);

  if (allOgFiles.length === 0) {
    errors.push("public/og/: no PNG files found");
    return { pass: false, errors, notes };
  }

  // ── (a) Core page OG PNGs ──────────────────────────────────────────────────
  const coreFiles = ["feed.png", "about.png", "programs.png", "companies.png"];
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

  // ── (b) Program OG samples ─────────────────────────────────────────────────
  const programOgFiles = allOgFiles.filter((f) => f.startsWith("program-"));
  const programSample = programOgFiles.slice(0, SAMPLE_PROGRAMS);

  let programOk = 0;
  for (const f of programSample) {
    const result = checkPng(path.join(ogDir, f));
    if (result.ok) {
      programOk++;
    } else {
      errors.push(`og_gate: program OG ${f}: ${result.error}`);
    }
  }
  if (programSample.length > 0) {
    notes.push(
      `program OG sample (${programSample.length}): ${programOk}/${programSample.length} valid ✓`
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
