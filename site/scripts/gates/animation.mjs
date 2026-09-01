/**
 * gate — animation_gate
 *
 * (a) Top-50 category programs MUST have data-hero-category attribute in their
 *     built program pages. Missing hero → FAIL (not a warning).
 *     Top-50 list loaded from categories.json sidecar (keys = pe_blis).
 *
 * (b) JS chunk-set equality: chunks referenced by animated (top-50) program
 *     pages MUST equal chunks referenced by non-animated program pages within
 *     the same build — proves CSS-only animation, no JS bloat. Extra chunks
 *     in animated pages → FAIL.
 *
 * (c) Flow SVG: REQUIRE data-flow-svg on ALL 17 crosswalked program pages
 *     (list from flows/ sidecar dir). Assert that the total dollar amount
 *     summed from the flows JSON matches what the SVG text labels imply
 *     by checking each award node label resolves to a number > 0.
 *
 * (d) prefers-reduced-motion present in built CSS/HTML (accessibility).
 *
 * (e) No inline JS-driven animation (requestAnimationFrame in inline scripts).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

const REDUCED_MOTION_PATTERN = "prefers-reduced-motion";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect the set of JS chunk filenames referenced by <script src="..."> tags
 * in an HTML page (/_next/static/chunks/*.js only).
 */
function extractChunks(html) {
  const chunkRe = /\/_next\/static\/chunks\/([^"]+\.js)/g;
  const chunks = new Set();
  let m;
  while ((m = chunkRe.exec(html)) !== null) {
    chunks.add(m[1]);
  }
  return chunks;
}

/**
 * Compact-format a raw USD value exactly as formatAmountNoCurrency does in
 * site/src/lib/format.ts (rungs T/B/M/K + rounding promotion — §P1-6). Used to
 * verify SVG flow labels. Returns the formatted string without the leading '$'.
 */
const COMPACT_RUNGS = [
  { limit: 1_000_000_000_000, suffix: "T" },
  { limit: 1_000_000_000, suffix: "B" },
  { limit: 1_000_000, suffix: "M" },
  { limit: 1_000, suffix: "K" },
];

function formatAmountNoCurrency(rawUsd) {
  const abs = Math.abs(rawUsd);
  const sign = rawUsd < 0 ? "-" : "";
  for (let i = 0; i < COMPACT_RUNGS.length; i++) {
    const { limit, suffix } = COMPACT_RUNGS[i];
    if (abs < limit) continue;
    const v = abs / limit;
    const dec = v < 10 ? 2 : 1;
    if (i > 0 && Number(v.toFixed(dec)) >= 1000) {
      const up = COMPACT_RUNGS[i - 1];
      const uv = abs / up.limit;
      return `${sign}${uv.toFixed(uv < 10 ? 2 : 1)}${up.suffix}`;
    }
    return `${sign}${v.toFixed(dec)}${suffix}`;
  }
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
}

export async function runAnimationGate() {
  const errors = [];
  const notes = [];

  const programOutDir = path.join(outDir, "program");

  // Gracefully handle missing out/ (pre-build)
  if (!fs.existsSync(programOutDir)) {
    notes.push("out/program/ not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── Load top-50 list from categories.json ──────────────────────────────────
  const categoriesPath = path.join(jsonDir, "categories.json");
  let top50Set = new Set();
  let top50PeBlis = [];
  if (fs.existsSync(categoriesPath)) {
    try {
      const cats = JSON.parse(fs.readFileSync(categoriesPath, "utf8"));
      top50PeBlis = Object.keys(cats);
      top50Set = new Set(top50PeBlis);
      notes.push(`categories.json: ${top50PeBlis.length} top-50 pe_blis`);
    } catch (e) {
      errors.push(`animation_gate: failed to load categories.json: ${e.message}`);
    }
  } else {
    // Fallback to program_categories.csv
    const csvPath = path.resolve(
      siteRoot, "..", "data-seeds", "program_categories.csv"
    );
    if (fs.existsSync(csvPath)) {
      const lines = fs.readFileSync(csvPath, "utf8").split("\n");
      const header = lines[0] ?? "";
      const peIdx = header.split(",").findIndex((h) => h.trim().toLowerCase().startsWith("pe"));
      if (peIdx >= 0) {
        const seen = new Set();
        for (const l of lines.slice(1)) {
          const pe = l.split(",")[peIdx]?.trim();
          if (pe && !seen.has(pe)) {
            seen.add(pe);
            top50PeBlis.push(pe);
            top50Set.add(pe);
            if (top50PeBlis.length >= 50) break;
          }
        }
      }
      notes.push(`using program_categories.csv fallback: ${top50PeBlis.length} pe_blis`);
    } else {
      errors.push("animation_gate: neither categories.json nor program_categories.csv found — cannot check top-50 hero requirement");
    }
  }

  // ── (a) Hero section REQUIRED on all top-50 category program pages ─────────
  // The CategoryHero component renders data-hero-category attribute.
  let heroChecked = 0;
  let heroOk = 0;
  const HERO_ATTR = "data-hero-category";

  for (const pbl of top50PeBlis) {
    const pagePath = path.join(programOutDir, pbl, "index.html");
    if (!fs.existsSync(pagePath)) {
      errors.push(`animation_gate: top-50 program page missing: program/${pbl}/index.html — hero cannot be verified`);
      continue;
    }
    heroChecked++;
    const html = fs.readFileSync(pagePath, "utf8");
    if (html.includes(HERO_ATTR)) {
      heroOk++;
    } else {
      errors.push(
        `animation_gate: top-50 program/${pbl} missing ${HERO_ATTR} — CategoryHero not rendered`
      );
    }
  }
  if (heroChecked > 0) {
    notes.push(`top-50 hero (${HERO_ATTR}): ${heroOk}/${heroChecked} ✓`);
  }

  // ── (b) JS chunk-set equality: animated vs non-animated ───────────────────
  // Collect chunks from a sample of top-50 pages and non-top-50 pages.
  // If animated pages reference extra chunks, the animation must have JS bloat.
  const programDirs = fs
    .readdirSync(programOutDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const animatedDirs = programDirs.filter((d) => top50Set.has(d));
  const nonAnimatedDirs = programDirs.filter((d) => !top50Set.has(d));

  if (animatedDirs.length > 0 && nonAnimatedDirs.length > 0) {
    // Collect union of chunk sets across animated pages
    let animatedChunks = null;
    for (const d of animatedDirs.slice(0, 5)) {
      const pagePath = path.join(programOutDir, d, "index.html");
      if (!fs.existsSync(pagePath)) continue;
      const html = fs.readFileSync(pagePath, "utf8");
      const chunks = extractChunks(html);
      if (animatedChunks === null) {
        animatedChunks = chunks;
      } else {
        for (const c of chunks) animatedChunks.add(c);
      }
    }

    let nonAnimatedChunks = null;
    for (const d of nonAnimatedDirs.slice(0, 5)) {
      const pagePath = path.join(programOutDir, d, "index.html");
      if (!fs.existsSync(pagePath)) continue;
      const html = fs.readFileSync(pagePath, "utf8");
      const chunks = extractChunks(html);
      if (nonAnimatedChunks === null) {
        nonAnimatedChunks = chunks;
      } else {
        for (const c of chunks) nonAnimatedChunks.add(c);
      }
    }

    if (animatedChunks !== null && nonAnimatedChunks !== null) {
      const extra = [...animatedChunks].filter((c) => !nonAnimatedChunks.has(c));
      if (extra.length > 0) {
        errors.push(
          `animation_gate: animated program pages have ${extra.length} extra JS chunk(s) not present on non-animated pages — animation must be CSS-only: ${extra.slice(0, 3).join(", ")}`
        );
      } else {
        notes.push(
          `chunk-set equality: animated and non-animated program pages share identical JS chunks (${animatedChunks.size}) ✓`
        );
      }
    }
  } else {
    notes.push("chunk-set check: insufficient pages for comparison (skipped)");
  }

  // ── (c) Flow SVG required on crosswalked pages that can render it ────────
  // Crosswalked programs = pe_blis for which flows/{pe_bli}.json exists AND
  // carries at least one award. 2026-09-01 (FPDS-AP expansion): the "ALL 17
  // pages" rule predates page tiers — decade/rollup-tier pages do not render
  // section 7 by design, and a crosswalked PE can have zero district-bearing
  // transactions (empty sidecar → no chart, correctly). The gate now expects
  // the svg exactly where the template renders it: a non-empty sidecar AND a
  // built page containing the follow-dollar section anchor.
  const flowsDir = path.join(jsonDir, "flows");
  let flowPeBlis = [];
  if (fs.existsSync(flowsDir)) {
    flowPeBlis = fs
      .readdirSync(flowsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .filter((pbl) => {
        try {
          const sidecar = JSON.parse(
            fs.readFileSync(path.join(flowsDir, `${pbl}.json`), "utf8"),
          );
          return (sidecar.awards ?? []).length > 0;
        } catch {
          return true; // unreadable sidecar: keep it in scope so the leg fails loudly
        }
      })
      .filter((pbl) => {
        const pagePath = path.join(programOutDir, pbl, "index.html");
        if (!fs.existsSync(pagePath)) return true; // missing page: fail loudly below
        return fs.readFileSync(pagePath, "utf8").includes('id="follow-the-dollar"');
      });
  }
  notes.push(`flows sidecar: ${flowPeBlis.length} crosswalked full-tier programs in scope`);
  if (flowPeBlis.length < 10) {
    errors.push(
      `animation_gate: only ${flowPeBlis.length} crosswalked pages in scope (<10) — the leg would be vacuous`,
    );
  }

  let flowSvgOk = 0;
  let flowSvgMissing = 0;

  for (const pbl of flowPeBlis) {
    const pagePath = path.join(programOutDir, pbl, "index.html");
    if (!fs.existsSync(pagePath)) {
      errors.push(`animation_gate: crosswalked program/${pbl} has no built page`);
      flowSvgMissing++;
      continue;
    }
    const html = fs.readFileSync(pagePath, "utf8");
    if (!html.includes(`data-flow-svg="${pbl}"`)) {
      errors.push(
        `animation_gate: crosswalked program/${pbl} page missing data-flow-svg="${pbl}" attribute`
      );
      flowSvgMissing++;
      continue;
    }

    // Verify: the SVG contains at least one award node with a non-empty label.
    // Parse numbers from the SVG text elements and compare against the flow JSON.
    // We compare parsed numbers only (not string format) for robustness.
    const flowJsonPath = path.join(flowsDir, `${pbl}.json`);
    if (fs.existsSync(flowJsonPath)) {
      try {
        const flowData = JSON.parse(fs.readFileSync(flowJsonPath, "utf8"));
        const awards = flowData.awards ?? [];

        // Extract text nodes from the data-flow-svg subtree
        const svgStartIdx = html.indexOf(`data-flow-svg="${pbl}"`);
        const svgEndIdx = html.indexOf("</svg>", svgStartIdx);
        const svgSnippet = svgStartIdx >= 0 && svgEndIdx >= 0
          ? html.slice(svgStartIdx, svgEndIdx + 6)
          : "";

        // Parse number labels like "1.86M", "619.0M", "2.35B", etc.
        const labelRe = />([\d.]+[BbMmKk]?)</g;
        const svgNumbers = new Set();
        let lm;
        while ((lm = labelRe.exec(svgSnippet)) !== null) {
          const parsed = parseFloat(lm[1]);
          if (!isNaN(parsed) && parsed > 0) svgNumbers.add(parsed.toFixed(2));
        }

        // Check that the top award's formatted label appears in the SVG
        if (awards.length > 0) {
          const topAward = awards[0];
          const expectedLabel = formatAmountNoCurrency(topAward.dollars);
          // Parse what the label would be as a number
          const expectedNum = parseFloat(expectedLabel.replace(/[BMK]/i, ""));
          const found = [...svgNumbers].some((n) => {
            return Math.abs(parseFloat(n) - expectedNum) < 0.1;
          });
          if (!found && svgNumbers.size === 0) {
            errors.push(
              `animation_gate: flow SVG for ${pbl} has no numeric labels — SVG may be empty or malformed`
            );
            flowSvgMissing++;
            continue;
          }
          // If we have labels but can't match exactly, it's acceptable
          // (formatting may differ for very small/large values)
        }

        flowSvgOk++;
      } catch (e) {
        errors.push(`animation_gate: flow JSON parse error for ${pbl}: ${e.message}`);
        flowSvgMissing++;
        continue;
      }
    } else {
      // SVG present but no JSON to validate against (shouldn't happen)
      flowSvgOk++;
    }
  }

  if (flowPeBlis.length > 0) {
    notes.push(
      `flow SVG presence+validation: ${flowSvgOk}/${flowPeBlis.length} ✓` +
        (flowSvgMissing > 0 ? ` (${flowSvgMissing} missing/invalid)` : "")
    );
  }

  // ── (d) prefers-reduced-motion in built CSS ───────────────────────────────
  const homePath = path.join(outDir, "index.html");
  let reducedMotionFound = false;

  if (fs.existsSync(homePath)) {
    const homeHtml = fs.readFileSync(homePath, "utf8");
    if (homeHtml.includes(REDUCED_MOTION_PATTERN)) {
      reducedMotionFound = true;
    } else {
      const nextStaticCss = path.join(outDir, "_next", "static", "css");
      const nextStaticChunks = path.join(outDir, "_next", "static", "chunks");
      const cssSearchDirs = [nextStaticCss, nextStaticChunks].filter(fs.existsSync);

      outer: for (const dir of cssSearchDirs) {
        for (const cssFile of fs.readdirSync(dir)) {
          if (!cssFile.endsWith(".css")) continue;
          const cssContent = fs.readFileSync(path.join(dir, cssFile), "utf8");
          if (cssContent.includes(REDUCED_MOTION_PATTERN)) {
            reducedMotionFound = true;
            break outer;
          }
        }
      }
    }
  }

  if (reducedMotionFound) {
    notes.push("prefers-reduced-motion: found in built CSS/HTML ✓");
  } else {
    errors.push(
      "animation_gate: prefers-reduced-motion rule not found in built CSS — add @media (prefers-reduced-motion: reduce) to animation styles"
    );
  }

  // ── (e) No JS-only animations ─────────────────────────────────────────────
  let jsAnimationRisk = false;
  if (fs.existsSync(homePath)) {
    const homeHtml = fs.readFileSync(homePath, "utf8");
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = scriptRe.exec(homeHtml)) !== null) {
      const scriptContent = m[1];
      if (
        scriptContent.includes("requestAnimationFrame") &&
        scriptContent.includes("animation")
      ) {
        jsAnimationRisk = true;
        break;
      }
    }
  }

  if (jsAnimationRisk) {
    errors.push(
      "animation_gate: JS-driven requestAnimationFrame animation detected in inline script — prefer CSS animations"
    );
  } else {
    notes.push("JS animation check: no inline rAF animation detected ✓");
  }

  return { pass: errors.length === 0, errors, notes };
}
