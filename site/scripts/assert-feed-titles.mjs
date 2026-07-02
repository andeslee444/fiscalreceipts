#!/usr/bin/env node
/**
 * assert-feed-titles.mjs — feed.json title-resolution assertion (V3 fix).
 *
 * Every yoy_swing / zeroed_fy2026 card must lead with a resolved program
 * title, never a bare PE/BLI code:
 *   (a) card.title is a non-empty string,
 *   (b) headline does not start with the raw pe_bli code,
 *   (c) headline's leading token is not code-shaped (7+ alphanumeric chars
 *       starting with a digit — e.g. "0101213F", "2035A19500").
 *
 * Usage: node scripts/assert-feed-titles.mjs   (exit 1 on any violation)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const feedPath = path.resolve(
  __dirname, "..", "..", "data", "site", "json", "feed.json",
);

const { cards } = JSON.parse(fs.readFileSync(feedPath, "utf8"));
const scoped = cards.filter(
  (c) => c.event_type === "yoy_swing" || c.event_type === "zeroed_fy2026",
);

const CODE_TOKEN_RE = /^\d[A-Z0-9]{6,}$/i;
const errors = [];
for (const c of scoped) {
  const lead = (c.headline ?? "").split(/\s+/)[0] ?? "";
  if (typeof c.title !== "string" || c.title.trim() === "") {
    errors.push(`${c.event_type} ${c.pe_bli}: title missing/empty`);
  } else if (c.pe_bli && c.headline.startsWith(c.pe_bli)) {
    errors.push(`${c.event_type} ${c.pe_bli}: headline leads with raw code — "${c.headline}"`);
  } else if (CODE_TOKEN_RE.test(lead)) {
    errors.push(`${c.event_type} ${c.pe_bli}: leading token "${lead}" is code-shaped — "${c.headline}"`);
  }
}

if (errors.length > 0) {
  console.error(`assert-feed-titles: FAIL (${errors.length} of ${scoped.length} cards)`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(
  `assert-feed-titles: PASS — ${scoped.length} yoy_swing/zeroed_fy2026 cards all lead with a resolved title`,
);
