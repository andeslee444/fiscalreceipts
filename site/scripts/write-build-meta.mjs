#!/usr/bin/env node
/**
 * write-build-meta.mjs — postbuild step
 *
 * Writes out/.build-meta.json immediately after `next build` produces out/.
 * The build gate (gates/build.mjs) reads this file to confirm the out/
 * directory was produced by a complete, current build — not left over from a
 * previous or failed run.
 *
 * Fields:
 *   built_at   — ISO timestamp of this build
 *   git_head   — current git HEAD SHA (or "unknown" in CI without git)
 *   source_mtimes_max — max mtime (ms) across site/src, site/public,
 *                       site/package.json at build time; gate checks that
 *                       built_at is newer than any source file touched after.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "..");
const outDir = path.resolve(siteDir, "out");

if (!fs.existsSync(outDir)) {
  console.error(
    "❌  write-build-meta: out/ does not exist — must run after `next build`"
  );
  process.exit(1);
}

// ── git HEAD ─────────────────────────────────────────────────────────────────
let gitHead = "unknown";
try {
  gitHead = execSync("git rev-parse HEAD", {
    cwd: siteDir,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
} catch {
  // non-fatal: might be in a detached/CI environment without git
}

// ── max mtime of watched source trees ────────────────────────────────────────
/**
 * Recursively collect max mtime (ms) under a directory, following no symlinks.
 * Returns 0 if dir doesn't exist.
 */
function maxMtime(dirOrFile) {
  if (!fs.existsSync(dirOrFile)) return 0;
  const st = fs.lstatSync(dirOrFile);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const entry of fs.readdirSync(dirOrFile, { withFileTypes: true })) {
    // Skip .next, node_modules, out — they're build artifacts
    if (["node_modules", ".next", "out"].includes(entry.name)) continue;
    const child = path.join(dirOrFile, entry.name);
    max = Math.max(max, maxMtime(child));
  }
  return max;
}

const watchedPaths = [
  path.join(siteDir, "src"),
  path.join(siteDir, "public"),
  path.join(siteDir, "package.json"),
  path.join(siteDir, "next.config.ts"),
  path.join(siteDir, "tsconfig.json"),
  path.join(siteDir, "postcss.config.mjs"),
];

const sourceMaxMtime = Math.max(...watchedPaths.map(maxMtime));

// ── write marker ──────────────────────────────────────────────────────────────
const meta = {
  built_at: new Date().toISOString(),
  built_at_ms: Date.now(),
  git_head: gitHead,
  source_mtimes_max_ms: sourceMaxMtime,
};

const dest = path.join(outDir, ".build-meta.json");
fs.writeFileSync(dest, JSON.stringify(meta, null, 2) + "\n", "utf8");

console.log(
  `✓  out/.build-meta.json written (git_head=${gitHead.slice(0, 8)}, source_max=${new Date(sourceMaxMtime).toISOString()})`
);
