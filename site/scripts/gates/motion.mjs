/**
 * gate — motion_gate (Phase 5C, G7)
 *
 * Static scan enforcing the single motion system (spec Goal 6). The rule this
 * gate enforces:
 *
 *   Every duration in site/src must come from the motion tokens declared in
 *   globals.css (--motion-fast/base/slow/story + --ease-standard/decelerate/
 *   accelerate) or their JS mirror (src/lib/motion.ts).
 *
 *   Built-in Tailwind duration scale classes (duration-150, duration-200,
 *   duration-300, etc.) are NOT equivalent to these tokens — for example
 *   duration-200 = 200 ms, while the closest token is --motion-fast (150 ms)
 *   or --motion-base (220 ms). They are banned unless the file is listed in
 *   BUILTIN_DURATION_EXEMPT below. Arbitrary values (duration-[...]) are
 *   banned unconditionally. No component may declare its own `<N>ms` literal.
 *
 * Checks:
 * 1. NO `\d+ms` duration literals in site/src **source code** (.ts/.tsx/.css)
 *    outside the allowlist (globals.css declares the tokens; lib/motion.ts
 *    mirrors them for JS consumers). Comments are stripped before scanning so
 *    prose like "TBT < 300ms" doesn't false-positive.
 * 2a. NO `duration-[` arbitrary Tailwind duration values anywhere in src.
 * 2b. NO built-in `duration-<digits>` Tailwind classes anywhere in src
 *    UNLESS the file is listed in BUILTIN_DURATION_EXEMPT (shadcn-generated
 *    files that import no motion-sensitive code are the only expected entries).
 * 3. globals.css declares ALL motion tokens in :root AND contains a
 *    prefers-reduced-motion block that collapses the duration tokens to 1ms
 *    plus the universal animation/transition-duration collapse.
 * 4. Compositor-only @keyframes SITE-WIDE (extends the 5B-3 animation-gate
 *    rule from the flow/hero keyframes to every stylesheet in src): every
 *    @keyframes block in src CSS may only declare transform / opacity /
 *    filter (+ animation-timing-function). animation.mjs has no keyframes
 *    parser to import (it checks built HTML, not stylesheets), so the parser
 *    lives here and is exported for reuse.
 *
 * Export: runMotionGate() → { pass, errors, notes }
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.resolve(siteRoot, "src");

/** Files allowed to declare raw ms literals (relative to site/). */
const MS_LITERAL_ALLOWLIST = ["src/app/globals.css", "src/lib/motion.ts"];

/**
 * Files allowed to use built-in Tailwind duration-<digits> classes (relative
 * to site/). Only shadcn-generated files that are imported nowhere in the
 * hand-authored codebase qualify — they are not part of our motion system and
 * migrating them would require forking the component.
 *
 * Before adding to this list, confirm the file is shadcn-generated and that
 * no hand-authored code re-exports or wraps the class names in question.
 */
const BUILTIN_DURATION_EXEMPT = [
  "src/components/ui/dialog.tsx", // shadcn-generated, imported nowhere, pre-5C
];

/** Required :root motion tokens (check 3). */
const REQUIRED_TOKENS = [
  "--motion-fast",
  "--motion-base",
  "--motion-slow",
  "--motion-story",
  "--ease-standard",
  "--ease-decelerate",
  "--ease-accelerate",
];

/** Properties allowed inside @keyframes blocks (compositor-only + timing). */
const KEYFRAME_PROP_ALLOWLIST = new Set([
  "transform",
  "opacity",
  "filter",
  "animation-timing-function",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect files under dir matching extensions. */
function collectFiles(dir, exts, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, exts, acc);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Strip comments so documentation prose ("200ms debounce") doesn't trip the
 * literal scan. Handles block comments in all files and line comments in
 * ts/tsx. Heuristic: `//` line-stripping may also truncate URL strings, which
 * is harmless for a `\d+ms` scan.
 */
function stripComments(text, ext) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (ext !== ".css") {
    out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  return out;
}

/**
 * Extract @keyframes blocks from CSS text.
 * Returns [{ name, body }] with brace-matched bodies.
 * Exported for reuse (extends the animation-gate compositor rule; animation.mjs
 * scans built HTML and has no stylesheet parser to import).
 */
export function extractKeyframes(cssText) {
  const blocks = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (i < cssText.length && depth > 0) {
      if (cssText[i] === "{") depth++;
      else if (cssText[i] === "}") depth--;
      i++;
    }
    blocks.push({ name, body: cssText.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

/**
 * List the CSS property names declared inside a keyframes block body
 * (across all its from/to/percent selectors).
 */
export function keyframeProperties(body) {
  const props = new Set();
  // Drop the inner selector braces, keep declarations: match `prop:` pairs.
  const declRe = /([a-zA-Z-]+)\s*:/g;
  let m;
  while ((m = declRe.exec(body)) !== null) {
    props.add(m[1].toLowerCase());
  }
  return [...props];
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export async function runMotionGate() {
  const errors = [];
  const notes = [];

  if (!fs.existsSync(srcDir)) {
    errors.push("motion_gate: site/src not found");
    return { pass: false, errors, notes };
  }

  const files = collectFiles(srcDir, [".ts", ".tsx", ".css"]);
  notes.push(`scanned ${files.length} source files`);

  const msLiteralRe = /\b\d+(?:\.\d+)?ms\b/g;
  const builtinDurationRe = /\bduration-\d+\b/g;
  let literalViolations = 0;
  let arbitraryViolations = 0;
  let builtinDurationViolations = 0;

  for (const file of files) {
    const rel = path.relative(siteRoot, file);
    const raw = fs.readFileSync(file, "utf8");
    const ext = path.extname(file);
    const code = stripComments(raw, ext);

    // ── (1) ms duration literals outside the allowlist ─────────────────────
    if (!MS_LITERAL_ALLOWLIST.includes(rel)) {
      const matches = code.match(msLiteralRe);
      if (matches) {
        literalViolations += matches.length;
        errors.push(
          `motion_gate: ${rel} declares ms literal(s) [${[...new Set(matches)].join(", ")}] — use var(--motion-*) tokens (globals.css) or MOTION (lib/motion.ts)`
        );
      }
    }

    // ── (2a) arbitrary Tailwind duration values ─────────────────────────────
    if (code.includes("duration-[")) {
      arbitraryViolations++;
      errors.push(
        `motion_gate: ${rel} uses arbitrary Tailwind duration value (duration-[...]) — use the token scale`
      );
    }

    // ── (2b) built-in Tailwind duration-<digits> classes ────────────────────
    // Built-in classes (duration-75/100/150/200/300/500/700/1000) do NOT map
    // onto our token scale — e.g. duration-200=200ms vs --motion-fast=150ms
    // vs --motion-base=220ms. All uses outside BUILTIN_DURATION_EXEMPT fail.
    if (!BUILTIN_DURATION_EXEMPT.includes(rel)) {
      const matches = code.match(builtinDurationRe);
      if (matches) {
        builtinDurationViolations += matches.length;
        errors.push(
          `motion_gate: ${rel} uses built-in Tailwind duration class(es) [${[...new Set(matches)].join(", ")}] — built-in classes don't map to the token scale; use var(--motion-*) or MOTION constants, or add to BUILTIN_DURATION_EXEMPT only if file is shadcn-generated`
        );
      }
    }

    // ── (4) compositor-only @keyframes, site-wide ───────────────────────────
    if (ext === ".css") {
      for (const kf of extractKeyframes(code)) {
        const bad = keyframeProperties(kf.body).filter(
          (p) => !KEYFRAME_PROP_ALLOWLIST.has(p)
        );
        if (bad.length > 0) {
          errors.push(
            `motion_gate: ${rel} @keyframes ${kf.name} animates non-compositor propert${bad.length === 1 ? "y" : "ies"} [${bad.join(", ")}] — only transform/opacity/filter allowed`
          );
        }
      }
    }
  }

  if (literalViolations === 0) notes.push("ms-literal scan: clean ✓");
  if (arbitraryViolations === 0) notes.push("arbitrary duration-[...] scan: clean ✓");
  if (builtinDurationViolations === 0) notes.push("built-in duration-<digits> scan: clean ✓ (exempt: " + BUILTIN_DURATION_EXEMPT.join(", ") + ")");

  // ── (3) globals.css tokens + prefers-reduced-motion collapse ─────────────
  const globalsPath = path.join(srcDir, "app", "globals.css");
  if (!fs.existsSync(globalsPath)) {
    errors.push("motion_gate: src/app/globals.css not found");
  } else {
    const css = fs.readFileSync(globalsPath, "utf8");

    const missingTokens = REQUIRED_TOKENS.filter((t) => !css.includes(`${t}:`));
    if (missingTokens.length > 0) {
      errors.push(
        `motion_gate: globals.css missing motion token declaration(s): ${missingTokens.join(", ")}`
      );
    } else {
      notes.push("motion tokens declared ✓");
    }

    // Reduced-motion block must collapse the duration tokens AND carry the
    // universal transition/animation duration collapse.
    const rmIdx = css.indexOf("prefers-reduced-motion");
    const rmBlock = rmIdx >= 0 ? css.slice(rmIdx) : "";
    const hasTokenCollapse = /--motion-fast:\s*1ms/.test(rmBlock);
    const hasUniversalCollapse =
      /animation-duration:\s*1ms\s*!important/.test(rmBlock) &&
      /transition-duration:\s*1ms\s*!important/.test(rmBlock);
    if (rmIdx === -1 || !hasTokenCollapse || !hasUniversalCollapse) {
      errors.push(
        "motion_gate: globals.css must contain a prefers-reduced-motion block that collapses the motion tokens to 1ms and applies the universal animation/transition-duration collapse"
      );
    } else {
      notes.push("prefers-reduced-motion collapse present ✓");
    }
  }

  return { pass: errors.length === 0, errors, notes };
}
