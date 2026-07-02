#!/usr/bin/env node
/**
 * rewrite-config.mjs — write {"assetBaseUrl": "<host>"} to
 * site/out/config.json AND site/public/config.json.
 *
 * USAGE:
 *   node scripts/launch/rewrite-config.mjs <assetBaseUrl>
 *   # or via env:
 *   ASSET_BASE_URL=https://pub-xxx.r2.dev node scripts/launch/rewrite-config.mjs
 *
 * EXAMPLES:
 *   node scripts/launch/rewrite-config.mjs https://pub-abc123.r2.dev
 *   node scripts/launch/rewrite-config.mjs http://localhost:4000
 *
 * The URL must be an absolute http/https URL (no trailing slash required —
 * we strip trailing slashes for consistency).
 *
 * TARGETS:
 *   - site/out/config.json   (built output — served by Vercel/nginx)
 *   - site/public/config.json (dev source — picked up by Next.js dev server)
 *
 * Prints before/after for both files.  If site/out/ does not exist (pre-
 * build), only site/public/config.json is written (with a note).
 *
 * EXIT CODES:
 *   0  success
 *   1  invalid URL or write error
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// ── Resolve the host from argv or env ────────────────────────────────────────
const rawUrl = process.argv[2] ?? process.env.ASSET_BASE_URL ?? "";

if (!rawUrl) {
  console.error(
    "ERROR: no assetBaseUrl provided.\n" +
      "  Usage: node scripts/launch/rewrite-config.mjs <url>\n" +
      "     or: ASSET_BASE_URL=<url> node scripts/launch/rewrite-config.mjs"
  );
  process.exit(1);
}

// ── Validate ─────────────────────────────────────────────────────────────────
let parsedUrl;
try {
  parsedUrl = new URL(rawUrl);
} catch {
  console.error(`ERROR: invalid URL: ${rawUrl}`);
  process.exit(1);
}

if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
  console.error(
    `ERROR: URL must be http or https, got: ${parsedUrl.protocol}`
  );
  process.exit(1);
}

// Normalise: strip trailing slash
const assetBaseUrl = rawUrl.replace(/\/+$/, "");

// ── Targets ───────────────────────────────────────────────────────────────────
const targets = [
  {
    path: path.join(repoRoot, "site", "public", "config.json"),
    required: true,
    label: "site/public/config.json",
  },
  {
    path: path.join(repoRoot, "site", "out", "config.json"),
    required: false,
    label: "site/out/config.json",
  },
];

const newContent = JSON.stringify({ assetBaseUrl }, null, 2) + "\n";

let anyError = false;

for (const target of targets) {
  const dir = path.dirname(target.path);

  if (!fs.existsSync(dir)) {
    if (target.required) {
      console.error(`ERROR: directory not found: ${dir}`);
      anyError = true;
    } else {
      console.log(`NOTE: ${target.label} skipped — directory not found (run build first)`);
    }
    continue;
  }

  // Read before value
  let before = "(not present)";
  if (fs.existsSync(target.path)) {
    try {
      before = fs.readFileSync(target.path, "utf8").trim();
    } catch {
      before = "(unreadable)";
    }
  }

  // Write
  try {
    fs.writeFileSync(target.path, newContent, "utf8");
  } catch (err) {
    console.error(`ERROR writing ${target.label}: ${err.message}`);
    anyError = true;
    continue;
  }

  const after = newContent.trim();
  console.log(`\n${target.label}`);
  console.log(`  before: ${before}`);
  console.log(`  after:  ${after}`);
}

if (anyError) {
  process.exit(1);
}

console.log(`\nassetBaseUrl set to: ${assetBaseUrl}`);
