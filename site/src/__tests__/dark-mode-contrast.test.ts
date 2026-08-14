/**
 * Sprint C Task C7 (ROADMAP #66) — dark-mode token contrast.
 *
 * globals.css redefines the SAME custom properties under
 * `@media (prefers-color-scheme: dark)` rather than introducing a second
 * token vocabulary. This file pins, with the WCAG relative-luminance
 * formula computed from the oklch values (not eyeballed), that every
 * redefined pair still clears AA in the dark scheme:
 *   - text pairs (foreground/background, card, popover, primary, secondary,
 *     muted, accent, destructive) ≥ 4.5:1
 *   - non-text UI pairs (the citation underline vs its effective
 *     background, --border vs --background) ≥ 3:1 (WCAG 1.4.11)
 *   - the §P2-6 scope register stays in the COOL family (r−b warmth ≤ 12,
 *     the same threshold gates/charts.mjs enforces), so it still reads as
 *     scope disclosure rather than caution once the palette flips.
 *
 * This is the static, deterministic half of the C7 verification. The
 * live/real-browser half — forcing Playwright's colorScheme so axe and the
 * citation-affordance probe actually run against the rendered dark page —
 * is gates/a11y.mjs leg (d); see that file's docstring for what it proves.
 *
 * oklchToSrgb/relativeLuminance/contrastRatio are the SAME formula
 * citation-affordance.test.ts uses for the light-mode tokens (duplicated,
 * not imported — both are small, self-contained, and this test's job is to
 * be an independent check, not a wrapper around the other file's math).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

function oklchToSrgb(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin: [number, number, number] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((x) => {
    x = Math.min(1, Math.max(0, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = [Math.max(l1, l2), Math.min(l1, l2)];
  return (hi + 0.05) / (lo + 0.05);
}

/** The `@media (prefers-color-scheme: dark) { :root { ... } }` block only —
 *  scoped so var lookups never accidentally match the light `:root` above
 *  it (both blocks declare the same property names). */
function darkBlock(css: string): string {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  if (start === -1) {
    throw new Error("globals.css has no @media (prefers-color-scheme: dark) block");
  }
  // Balanced-brace scan from the media query's opening `{`.
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces in the dark-mode media block");
}

function cssOklchVar(css: string, name: string): [number, number, number] {
  const m = css.match(
    new RegExp(`${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s*([\\d.]+)?\\s*\\)`),
  );
  if (!m) throw new Error(`CSS var ${name} not found as oklch() in the dark block`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function luminanceOf(css: string, name: string): number {
  return relativeLuminance(oklchToSrgb(...cssOklchVar(css, name)));
}

const css = read("app/globals.css");
const dark = darkBlock(css);

describe("C7 — dark mode declares only ONE token vocabulary", () => {
  it("uses @media (prefers-color-scheme: dark), never a second custom-variant", () => {
    // The house rule this task was explicitly warned about: a second token
    // vocabulary drifting from the first. `.dark`-class-based Tailwind
    // dark: variants (@custom-variant dark) exist in this file as unused
    // boilerplate (see globals.css top) — this test pins that dark-mode
    // values live ONLY in the media-query redefinition, not duplicated
    // into a parallel .dark selector block anywhere.
    const classBasedDarkBlock = /\.dark\s*{/.test(css);
    expect(classBasedDarkBlock).toBe(false);
  });

  it("redefines every token the light :root declares that dark mode changes", () => {
    for (const name of [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--border",
      "--input",
      "--ring",
      "--cite-decoration",
      "--cite-decoration-hover",
      "--scope-border",
      "--scope-bg",
    ]) {
      expect(() => cssOklchVar(dark, name), `${name} missing from dark block`).not.toThrow();
    }
  });
});

describe("C7 — dark-mode text contrast ≥ 4.5:1 (WCAG AA, computed)", () => {
  const PAIRS: [string, string, string][] = [
    ["--foreground", "--background", "body text"],
    ["--card-foreground", "--card", "card text"],
    ["--popover-foreground", "--popover", "popover text"],
    ["--primary-foreground", "--primary", "primary button text"],
    ["--secondary-foreground", "--secondary", "secondary text"],
    ["--muted-foreground", "--background", "muted text on page bg"],
    ["--muted-foreground", "--muted", "muted text on muted bg"],
    ["--muted-foreground", "--card", "muted text on card"],
    ["--accent-foreground", "--accent", "accent text"],
    ["--foreground", "--muted", "body text on muted bg"],
    ["--foreground", "--card", "body text on card"],
    ["--destructive", "--background", "destructive text on page bg"],
    ["--destructive", "--card", "destructive text on card"],
  ];

  it.each(PAIRS)("%s on %s (%s) is >= 4.5:1", (fg, bg) => {
    const ratio = contrastRatio(luminanceOf(dark, fg), luminanceOf(dark, bg));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("C7 — dark-mode non-text contrast ≥ 3:1 (WCAG 1.4.11, computed)", () => {
  const PAIRS: [string, string, string][] = [
    ["--border", "--background", "border vs page bg"],
    ["--cite-decoration", "--background", "cite underline (rest) vs page bg"],
    ["--cite-decoration", "--card", "cite underline (rest) vs card"],
    ["--cite-decoration-hover", "--background", "cite underline (hover) vs page bg"],
    // Regression case (found live by gates/a11y.mjs leg (d), not by this
    // file — added AFTER the fact): a text-foreground link with no
    // rest-state underline, sitting inline beside muted-foreground prose,
    // needs THIS pairing at >=3:1 (WCAG 1.4.1 / axe's link-in-text-block)
    // — a separate requirement from muted-foreground's own >=4.5:1
    // text-on-background pairings above. See src/app/page.tsx's
    // feed-headline <Link> (linkClassName="text-foreground hover:underline").
    ["--foreground", "--muted-foreground", "foreground text vs muted-foreground text (link-in-text-block)"],
  ];

  it.each(PAIRS)("%s on %s (%s) is >= 3:1", (fg, bg) => {
    const ratio = contrastRatio(luminanceOf(dark, fg), luminanceOf(dark, bg));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("hover decoration is a real lift over rest, same as light mode", () => {
    const bg = luminanceOf(dark, "--background");
    const rest = contrastRatio(luminanceOf(dark, "--cite-decoration"), bg);
    const hover = contrastRatio(luminanceOf(dark, "--cite-decoration-hover"), bg);
    expect(hover).toBeGreaterThan(rest);
  });
});

describe("C7 — §P2-6 scope register stays cool (non-amber) in dark mode", () => {
  it("--scope-border warmth (r−b) stays <= 12, the same ceiling gates/charts.mjs enforces", () => {
    const [r, , b] = oklchToSrgb(...cssOklchVar(dark, "--scope-border"));
    // oklchToSrgb returns 0..1 linear-adjacent sRGB channels; warmth only
    // needs their relative order, so scale to 0..255 to match the gate's
    // own r−b arithmetic exactly.
    const warmth = r * 255 - b * 255;
    expect(warmth).toBeLessThanOrEqual(12);
  });

  it("--scope-bg is distinguishable from --background (a panel, not invisible)", () => {
    const bg = luminanceOf(dark, "--background");
    const scopeBg = luminanceOf(dark, "--scope-bg");
    expect(Math.abs(scopeBg - bg)).toBeGreaterThan(0.001);
  });
});
