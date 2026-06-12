#!/usr/bin/env node
/**
 * prepare-assets.mjs — prebuild script
 *
 * Copies runtime assets into public/ so the static export can serve them.
 * Exits loudly (code 1) if the data/site/json sidecars are missing or stale.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(siteDir, "..");
const dataDir = path.resolve(repoRoot, "data", "site");
const jsonDir = path.resolve(dataDir, "json");
const nodeModules = path.resolve(siteDir, "node_modules");

// ── 1. Validate sidecar presence ──────────────────────────────────────────────
const metaPath = path.join(jsonDir, "site_meta.json");
if (!fs.existsSync(metaPath)) {
  console.error(
    "\n❌  FATAL: data/site/json/site_meta.json not found.\n" +
      "    Run `uv run python -m govbudget export-site` first.\n"
  );
  process.exit(1);
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
} catch (e) {
  console.error("❌  FATAL: Failed to parse site_meta.json:", e.message);
  process.exit(1);
}

if (meta.schema_version !== 1) {
  console.error(
    `\n❌  FATAL: site_meta.json schema_version is ${meta.schema_version}, expected 1.\n` +
      "    Run `uv run python -m govbudget export-site` first.\n"
  );
  process.exit(1);
}

console.log(`✓  site_meta.json OK (schema_version=1, built_at=${meta.built_at})`);

// ── helper ────────────────────────────────────────────────────────────────────
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`❌  FATAL: source file not found: ${src}`);
    process.exit(1);
  }
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`❌  FATAL: source directory not found: ${src}`);
    process.exit(1);
  }
  mkdirp(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── 2. Copy PDF.js worker ─────────────────────────────────────────────────────
const pdfWorkerSrc = path.join(
  nodeModules,
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs"
);
const pdfWorkerDest = path.join(siteDir, "public", "pdf.worker.min.mjs");
copyFile(pdfWorkerSrc, pdfWorkerDest);
console.log("✓  pdf.worker.min.mjs → public/");

// ── 3. Copy DuckDB-WASM bundles ───────────────────────────────────────────────
const duckdbDistDir = path.join(nodeModules, "@duckdb", "duckdb-wasm", "dist");
const duckdbDestDir = path.join(siteDir, "public", "duckdb");
mkdirp(duckdbDestDir);

const duckdbFiles = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-eh.wasm",
  "duckdb-browser-eh.worker.js",
];

for (const fname of duckdbFiles) {
  const src = path.join(duckdbDistDir, fname);
  const dest = path.join(duckdbDestDir, fname);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓  duckdb/${fname}`);
  } else {
    // Try alternative naming patterns
    const alt1 = path.join(duckdbDistDir, fname.replace("duckdb-browser-", "duckdb-"));
    const alt2 = path.join(duckdbDistDir, fname.replace("-browser", ""));
    if (fs.existsSync(alt1)) {
      fs.copyFileSync(alt1, dest);
      console.log(`✓  duckdb/${fname} (from ${path.basename(alt1)})`);
    } else if (fs.existsSync(alt2)) {
      fs.copyFileSync(alt2, dest);
      console.log(`✓  duckdb/${fname} (from ${path.basename(alt2)})`);
    } else {
      // FATAL: missing file means the build cannot serve DuckDB queries at runtime
      const available = fs.existsSync(duckdbDistDir)
        ? fs.readdirSync(duckdbDistDir).join(", ")
        : "(dist dir missing)";
      console.error(
        `❌  FATAL: duckdb/${fname} not found (tried ${path.basename(alt1)}, ${path.basename(alt2)}).\n` +
          `    Available in dist: ${available}\n` +
          `    Re-install @duckdb/duckdb-wasm or update the filename list in prepare-assets.mjs.`
      );
      process.exit(1);
    }
  }
}

// ── 4. Copy JSON search index ─────────────────────────────────────────────────
const jsonLiteDestDir = path.join(siteDir, "public", "json-lite");
mkdirp(jsonLiteDestDir);

const searchSrc = path.join(jsonDir, "search_quick.json");
const searchDest = path.join(jsonLiteDestDir, "search_quick.json");
copyFile(searchSrc, searchDest);
console.log("✓  search_quick.json → public/json-lite/");

// ── 5. Copy program_details/ ──────────────────────────────────────────────────
const detailsSrc = path.join(jsonDir, "program_details");
const detailsDest = path.join(jsonLiteDestDir, "program_details");
if (fs.existsSync(detailsSrc)) {
  copyDir(detailsSrc, detailsDest);
  const count = fs.readdirSync(detailsSrc).length;
  console.log(`✓  program_details/ (${count} files) → public/json-lite/`);
} else {
  console.warn("⚠   program_details/ not found — skipping");
}

// ── 6. Generate llms.txt ──────────────────────────────────────────────────────
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://govbudget-placeholder.example";

// Load programs.json for sample program URLs
const programsPath = path.join(jsonDir, "programs.json");
let samplePrograms = [];
if (fs.existsSync(programsPath)) {
  const programs = JSON.parse(fs.readFileSync(programsPath, "utf8"));
  samplePrograms = programs.slice(0, 3).map((p) => p.pe_bli);
}

const llmsTxt = [
  `# GovBudget`,
  ``,
  `GovBudget is a spending-intelligence platform for U.S. federal defense budget data.`,
  `Every displayed number is citation-backed with PDF page-level provenance.`,
  ``,
  `## Key pages`,
  ``,
  `${siteUrl}/methodology/`,
  `${siteUrl}/downloads/`,
  ...samplePrograms.map((pe_bli) => `${siteUrl}/program/${pe_bli}/`),
].join("\n");

const llmsDest = path.join(siteDir, "public", "llms.txt");
fs.writeFileSync(llmsDest, llmsTxt, "utf8");
console.log("✓  llms.txt generated");

console.log("\n✅  prepare-assets complete\n");
