#!/usr/bin/env node
/**
 * generate-favicon.mjs — one-off favicon.ico generator (backlog #21).
 *
 * Browsers request /favicon.ico by convention; the site shipped no icon at
 * all, so every page view logged a 404 (the sole console error found during
 * 5H live verification). This script draws the brand mark — a receipt on the
 * OG-card palette (see generate-og.mjs COLORS: slate-900 field, sky-400
 * accent) — renders it at 16/32/48 with @resvg/resvg-js, and packs the PNGs
 * into a single .ico (PNG-compressed ICO entries are supported by every
 * modern browser).
 *
 * The output (site/public/favicon.ico) is COMMITTED — this script exists for
 * provenance/regeneration and is not part of the build pipeline.
 *
 * Run: node scripts/generate-favicon.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "..", "public", "favicon.ico");

// Brand palette — mirrors generate-og.mjs COLORS.
const BG = "#0f172a"; // slate-900
const PAPER = "#f8fafc"; // slate-50
const RULE = "#94a3b8"; // slate-400
const ACCENT = "#38bdf8"; // sky-400

// Receipt mark on a 48×48 grid: rounded slate field, light receipt with a
// torn zigzag bottom edge, two muted item rules and one accent total rule.
const SVG = `<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="10" fill="${BG}"/>
  <path d="M14 8 H34 V34 L31.5 37 L29 34 L26.5 37 L24 34 L21.5 37 L19 34 L16.5 37 L14 34 Z" fill="${PAPER}"/>
  <line x1="18" y1="14" x2="30" y2="14" stroke="${RULE}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="18" y1="20" x2="30" y2="20" stroke="${RULE}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="18" y1="27" x2="30" y2="27" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const SIZES = [16, 32, 48];

const pngs = SIZES.map((size) => {
  const resvg = new Resvg(SVG, {
    fitTo: { mode: "width", value: size },
  });
  return { size, data: resvg.render().asPng() };
});

// ── ICO container: ICONDIR + ICONDIRENTRY[] + PNG blobs ─────────────────────
const HEADER = 6;
const ENTRY = 16;
const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

let offset = HEADER + ENTRY * pngs.length;
const entries = [];
for (const { size, data } of pngs) {
  const e = Buffer.alloc(ENTRY);
  e.writeUInt8(size === 256 ? 0 : size, 0); // width
  e.writeUInt8(size === 256 ? 0 : size, 1); // height
  e.writeUInt8(0, 2); // palette colors (none)
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += data.length;
}

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
fs.writeFileSync(outPath, ico);
console.log(
  `favicon.ico: ${ico.length} bytes (${SIZES.join("/")}px PNG entries) → ${outPath}`
);
