/**
 * P1-1 — citation affordance visibility (PM-review Sprint 1 Task 6).
 *
 * The PM review measured the live citation underline at 1.26:1 against the
 * page background (WCAG 1.4.11 requires ≥3:1 for non-text UI), and counted
 * provenance chips/legends rendering at 10px. These tests pin the fixes:
 *
 *  1. globals.css declares explicit citation-decoration tokens
 *     (--cite-decoration / --cite-decoration-hover) whose MEASURED contrast
 *     vs --background (and vs --muted, the tinted row surface cites sit on)
 *     is ≥3:1 — computed here with the WCAG relative-luminance formula from
 *     the oklch values, not eyeballed.
 *  2. <Cite> state A and <ProseCite> actually wire those tokens, keep the
 *     dotted→solid hover lift, and the CiteLegend swatch uses the same token
 *     (the legend doubles as a truthful swatch).
 *  3. No provenance chip/legend component renders below 12px: the audited
 *     file list carries zero text-[10px]/text-[11px] classes, and the
 *     years-matrix / decade-trajectory legend elements (checked per-element —
 *     those files legitimately keep sub-12px NON-provenance uses like sort
 *     carets and dense data-grid text) are ≥12px.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

// ── WCAG contrast from oklch (OKLab → LMS → linear sRGB → luminance) ────────

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
  const f = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = [Math.max(l1, l2), Math.min(l1, l2)];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse `--name: oklch(L C H)` (H optional for achromatic) from CSS text. */
function cssOklchVar(css: string, name: string): [number, number, number] {
  const m = css.match(
    new RegExp(
      `${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s*([\\d.]+)?\\s*\\)`,
    ),
  );
  if (!m) throw new Error(`CSS var ${name} not found as oklch() in globals.css`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

describe("P1-1 §1 — citation underline decoration contrast ≥3:1 (measured)", () => {
  const css = read("app/globals.css");

  it("declares --cite-decoration and --cite-decoration-hover tokens", () => {
    expect(css).toMatch(/--cite-decoration:\s*oklch\(/);
    expect(css).toMatch(/--cite-decoration-hover:\s*oklch\(/);
  });

  it("resting decoration ≥3:1 vs --background AND vs --muted (WCAG 1.4.11)", () => {
    const deco = relativeLuminance(
      oklchToSrgb(...cssOklchVar(css, "--cite-decoration")),
    );
    const bg = relativeLuminance(
      oklchToSrgb(...cssOklchVar(css, "--background")),
    );
    const muted = relativeLuminance(oklchToSrgb(...cssOklchVar(css, "--muted")));
    expect(contrastRatio(deco, bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(deco, muted)).toBeGreaterThanOrEqual(3);
  });

  it("hover decoration ≥3:1 vs --background and a REAL lift over rest", () => {
    const rest = relativeLuminance(
      oklchToSrgb(...cssOklchVar(css, "--cite-decoration")),
    );
    const hover = relativeLuminance(
      oklchToSrgb(...cssOklchVar(css, "--cite-decoration-hover")),
    );
    const bg = relativeLuminance(
      oklchToSrgb(...cssOklchVar(css, "--background")),
    );
    expect(contrastRatio(hover, bg)).toBeGreaterThanOrEqual(3);
    // The hover state must be a visible color lift, not the same color.
    expect(contrastRatio(hover, bg)).toBeGreaterThan(contrastRatio(rest, bg));
  });

  it("old --border color would FAIL this check (regression tripwire)", () => {
    // The live-measured 1.26:1 underline was --border-colored. Assert our
    // formula reproduces that measurement so the ≥3:1 legs above have teeth.
    const border = relativeLuminance(oklchToSrgb(...cssOklchVar(css, "--border")));
    const bg = relativeLuminance(oklchToSrgb(...cssOklchVar(css, "--background")));
    expect(contrastRatio(border, bg)).toBeLessThan(1.3);
  });
});

describe("P1-1 §2 — decoration tokens wired into the affordance", () => {
  // Sprint 3 §P2-1 moved the treatment out of the per-figure class string and
  // into ONE globals.css rule (78,302 copies of a 250-byte string were 19.3 MB
  // of the shipped HTML). The contract is unchanged and is asserted at its new
  // home: the `.cite-figure` rule must carry the tokens and the dotted→solid
  // hover/focus lift, and both figure components must apply it.
  const citeFigureRule = (() => {
    const sheet = read("app/globals.css");
    const i = sheet.indexOf(".cite-figure {");
    if (i === -1) throw new Error(".cite-figure rule not found in globals.css");
    return sheet.slice(i, sheet.indexOf("}", i));
  })();

  it(".cite-figure carries the tokens + dotted→solid hover/focus lift", () => {
    expect(citeFigureRule).toContain("decoration-dotted");
    expect(citeFigureRule).toContain("decoration-(--cite-decoration)");
    expect(citeFigureRule).toContain("hover:decoration-(--cite-decoration-hover)");
    expect(citeFigureRule).toContain("hover:decoration-solid");
    expect(citeFigureRule).toContain("focus-visible:decoration-solid");
    expect(citeFigureRule).toContain(
      "focus-visible:decoration-(--cite-decoration-hover)",
    );
  });

  it("<Cite> state A applies the affordance rule", () => {
    const src = read("components/cite.tsx");
    expect(src).toContain('"cite-figure"');
  });

  it("<ProseCite> applies the SAME affordance rule", () => {
    const src = read("components/prose-cite.tsx");
    expect(src).toContain("cite-figure");
  });

  it("CiteLegend dotted-underline swatch uses the real decoration token", () => {
    const src = read("components/cite.tsx");
    const legend = src.slice(
      src.indexOf("function CiteLegend"),
      src.indexOf("function ReceiptsChip"),
    );
    expect(legend).toContain("decoration-(--cite-decoration)");
  });
});

describe("P1-1 §3 — no provenance chip/legend below 12px", () => {
  // Files whose ENTIRE sub-12px usage was provenance UI: after the bump they
  // must carry zero arbitrary sub-12px text classes.
  const auditFiles = [
    "components/cite.tsx",
    "components/prose-cite.tsx",
    "components/narrative-chip.tsx",
    "components/dossier-chips.tsx",
    "components/citation-panel/panel.tsx",
    "components/citation-panel/breakdown-table.tsx",
    "components/citation-panel/lda-card.tsx",
    "components/citation-panel/state-card.tsx",
    "components/citation-panel/usaspending-card.tsx",
    "components/lineage/lineage-rail.tsx",
    "components/lineage/family-funding-line.tsx",
    "app/fact/fact-resolver.tsx",
  ];

  it.each(auditFiles)("%s has no text-[10px]/text-[11px]", (rel) => {
    const src = read(rel);
    const hits = src.match(/text-\[1[01]px\]/g) ?? [];
    expect(hits, `${rel} still renders sub-12px text: ${hits.join(", ")}`).toEqual(
      [],
    );
  });

  /** JSX open-tag slice containing the given data-testid. */
  function openTag(src: string, testid: string): string {
    const i = src.indexOf(`data-testid="${testid}"`);
    expect(i, `data-testid="${testid}" not found`).toBeGreaterThan(-1);
    return src.slice(src.lastIndexOf("<", i), src.indexOf(">", i) + 1);
  }

  // Files that legitimately keep sub-12px NON-provenance uses (sort carets,
  // dense grid text, filter-group labels): audit their legend elements only.
  it("years-matrix legends (edition-legend, family-legend) are ≥12px", () => {
    const src = read("components/years-matrix.tsx");
    for (const id of ["edition-legend", "family-legend"]) {
      expect(openTag(src, id)).not.toMatch(/text-\[1[01]px\]/);
    }
  });

  it("decade-trajectory legends (marker key, blank/dash note) are ≥12px", () => {
    const src = read("components/decade-trajectory.tsx");
    for (const id of ["decade-marker-key", "decade-grid-note"]) {
      expect(openTag(src, id)).not.toMatch(/text-\[1[01]px\]/);
    }
  });
});
