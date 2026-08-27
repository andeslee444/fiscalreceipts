/**
 * gate 6 — a11y_gate
 *
 * @axe-core/playwright on:
 *   - home
 *   - a program page WITH citation panel open
 *   - a company page
 *   - /data/
 *   - search palette open
 *
 * Requirement: zero serious/critical violations.
 *
 * P1-1 citation-affordance checks (PM Sprint 1 Task 6, spec §P1-1) — the
 * live site's citation underline measured 1.26:1 and provenance chips 10px:
 *   (a) underline contrast: computed text-decoration-color of every sampled
 *       [data-amount][data-fact-id] / [data-prose-cite] element vs its
 *       EFFECTIVE page background (ancestor backgrounds composited) must be
 *       ≥3:1 (WCAG 1.4.11 non-text contrast). Hover must read as
 *       interactive: decoration goes solid.
 *   (b) provenance floor: no citation chip/legend near [data-amount] may
 *       compute below 12px font-size (sampled program page + /years/).
 *       Non-vacuous: the checks FAIL if no elements are found to sample.
 *
 * PM Sprint 3 Task 4 (spec §P2-3 / §P2-6) — see gates/charts.mjs:
 *   (c) every [data-chart] figure carries a named, described chart whose data
 *       is reachable as a real table, openable from the keyboard, and that
 *       does not push the document sideways at 390px when opened;
 *   (n) scope-disclosure and caution notes are visually distinguishable on
 *       the composited colours a reader actually sees.
 *
 * (d) DARK MODE (Sprint C Task C7, ROADMAP #66). Every other leg above opens
 *     its browser context with the default (light) colorScheme, so a dark
 *     palette could ship with a contrast regression and every existing check
 *     would still pass — the harness would simply never look. This leg opens
 *     a SEPARATE context with `colorScheme: 'dark'` (Playwright honours
 *     prefers-color-scheme through this, forcing the media query this
 *     sprint's globals.css change is keyed on) and re-runs, under that forced
 *     scheme:
 *       - axe wcag2a/wcag2aa/wcag21a/wcag21aa on home + the sample program
 *         page (same tag set as the light-mode runs above — color-contrast
 *         is one of axe's rules, so a token pair that fails AA in dark mode
 *         surfaces here even though nothing about axe itself is dark-aware);
 *       - the SAME auditCitationAffordance() probe the light-mode P1-1 legs
 *         use (same ≥3:1 underline / ≥12px chip thresholds) — proving the
 *         citation affordance, not just body text, survives the palette
 *         swap, since that is the one piece of UI this site's whole value
 *         proposition rides on.
 *     WHAT THIS DOES NOT PROVE: only Chromium's dark rendering (Playwright's
 *     colorScheme forces the CSS media feature; it does not exercise a real
 *     OS-level dark switch, and other engines are untested). It also only
 *     samples the same two pages the light-mode checks already sample — a
 *     token pair used exclusively on some other page is not covered here.
 *
 * (e) PROVENANCE HIERARCHY (ROADMAP #43, owner decision 2026-08-27). Legs (a)
 *     and (b) pin FLOORS — the citation underline must clear 3:1, provenance
 *     chips must clear 12px. Nothing pinned a CEILING, so the Fact-ID chip was
 *     free to out-shout the figure it annotates, and did: three independent
 *     judging panels reported the blue monospace hash reading louder than the
 *     dollar value beside it. The owner kept chips ON (availability is the
 *     trust property) and asked for the chip to be made subordinate.
 *
 *     "Subordinate" is measured against the figure the chip actually
 *     annotates — the nearest PRECEDING [data-amount] in document order, which
 *     covers both chip placements (<Cite>'s inline sibling and <CiteChips>'
 *     detached cluster unit). Per pair, at rest:
 *       (e-i)   FILL      — the chip may not paint a background its figure does
 *                           not. A filled badge beside bare text is a UI object
 *                           beside content, and reads as the louder of the two.
 *       (e-ii)  CHROMA    — the chip's ink may not be more chromatic than its
 *                           figure's. A saturated hue on an otherwise
 *                           achromatic page attracts the eye first regardless
 *                           of what luminance contrast says.
 *       (e-iii) CONTRAST  — the chip must read STRICTLY quieter than its figure.
 *       (e-iv)  SIZE      — the chip may not be larger than its figure.
 *       (e-v)   WEIGHT    — the chip may not be heavier than its figure, and
 *                           may never render bold (≤500) at all: the chip
 *                           inherits font-weight from whatever cell it lands
 *                           in, so a 700 row made a 700 hash.
 *
 *     AND THE FLOORS ARE RE-ASSERTED HERE, on the same measured elements
 *     (≥12px, ≥4.5:1): subordination must come from hierarchy — relative
 *     weight, colour role, fill — never from pushing the chip under the
 *     accessibility bar legs (a)/(b) exist to hold. A future "quieter" chip
 *     that dims itself out of AA fails this leg, not passes it.
 *
 *     Runs in BOTH schemes. Dark is where the pre-fix defect was worst: the
 *     chip had no dark variant at all, so a blue-100 fill kept painting a lit
 *     block on a near-black page.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { runChartLegs } from "./charts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function getSampleProgram() {
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const programDetailsDir = path.join(jsonDir, "program_details");
  // Find first program with a jbook_pdf citation
  const citations = readJson(path.join(jsonDir, "citations.json"));
  for (const p of programs.sort((a, b) => a.pe_bli.localeCompare(b.pe_bli))) {
    const detPath = path.join(programDetailsDir, `${p.pe_bli}.json`);
    if (!fs.existsSync(detPath)) continue;
    try {
      const det = readJson(detPath);
      for (const d of det.details || []) {
        if (d.fact_id && citations[d.fact_id]?.kind === "jbook_pdf") {
          return { pbl: p.pe_bli, factId: d.fact_id };
        }
      }
    } catch {
      // skip
    }
  }
  return { pbl: programs[0]?.pe_bli, factId: null };
}

function getSampleCompany() {
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  return entities[0]?.slug ?? "lockheed-martin";
}

export async function runA11yGate(baseUrl) {
  const errors = [];
  const notes = [];

  const { pbl: samplePbl, factId: sampleFactId } = getSampleProgram();
  const sampleCompany = getSampleCompany();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: true });

  const testCases = [
    {
      label: "home",
      url: `${baseUrl}/`,
      setup: null,
    },
    {
      label: "program with panel open",
      url: `${baseUrl}/program/${samplePbl}/`,
      setup: async (page) => {
        if (sampleFactId) {
          const el = await page
            .$(`[data-fact-id="${sampleFactId}"]`)
            .catch(() => null);
          if (el) {
            await el.click();
            await page
              .waitForSelector('[data-testid="citation-panel"]', {
                timeout: 8000,
              })
              .catch(() => null);
            await page.waitForTimeout(500);
          }
        }
      },
    },
    {
      label: "company page",
      url: `${baseUrl}/company/${sampleCompany}/`,
      setup: null,
    },
    {
      label: "/data/",
      url: `${baseUrl}/data/`,
      setup: null,
    },
    {
      // Phase 5H — the flowdown SVG must carry proper roles/labels (nodes
      // are role=button, rivers are labeled groups). Audited with the chart
      // fully rendered (the island fetches its payload client-side).
      label: "/flow/ with chart rendered",
      url: `${baseUrl}/flow/`,
      setup: async (page) => {
        await page
          .waitForSelector('[data-testid="flow-chart"]', { timeout: 15000 })
          .catch(() => null);
        await page.waitForTimeout(300);
      },
    },
    {
      label: "search palette open",
      url: `${baseUrl}/`,
      setup: async (page) => {
        const trigger = await page
          .$('[data-testid="search-trigger"]')
          .catch(() => null);
        if (trigger) {
          await trigger.click();
        } else {
          await page.keyboard.press("Meta+k");
        }
        await page
          .waitForSelector(
            'input[placeholder*="search" i], [data-testid="search-input"]',
            { timeout: 5000 }
          )
          .catch(() => null);
        await page.waitForTimeout(300);
      },
    },
  ];

  try {
    for (const tc of testCases) {
      const page = await context.newPage();
      try {
        await page.goto(tc.url, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        if (tc.setup) {
          await tc.setup(page);
        }

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        const critical = results.violations.filter(
          (v) => v.impact === "critical"
        );
        const serious = results.violations.filter(
          (v) => v.impact === "serious"
        );

        const totalViolations = critical.length + serious.length;
        if (totalViolations > 0) {
          errors.push(
            `a11y ${tc.label}: ${critical.length} critical + ${serious.length} serious violations:`
          );
          for (const v of [...critical, ...serious].slice(0, 5)) {
            errors.push(
              `  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`
            );
          }
          if (critical.length + serious.length > 5) {
            errors.push(
              `  ... and ${critical.length + serious.length - 5} more`
            );
          }
        } else {
          const minor = results.violations.filter(
            (v) => !["critical", "serious"].includes(v.impact)
          );
          notes.push(
            `a11y ${tc.label}: 0 critical/serious (${minor.length} minor) ✓`
          );
        }
      } catch (e) {
        errors.push(`a11y ${tc.label}: ${e.message}`);
      } finally {
        await page.close();
      }
    }

    // ── P1-1 citation-affordance checks ─────────────────────────────────────
    await runAffordanceChecks(context, baseUrl, samplePbl, errors, notes);

    // ── (e) provenance hierarchy: the chip stays under its figure ───────────
    await runHierarchyLeg(context, baseUrl, samplePbl, errors, notes);

    // ── P2-3 chart legs + P2-6 note registers (Sprint 3 Task 4) ─────────────
    await runChartLegs(context, baseUrl, errors, notes);

    // ── (d) dark mode: forced colorScheme, re-run axe + P1-1 probes ─────────
    await runDarkModeLeg(browser, baseUrl, samplePbl, errors, notes);
  } finally {
    await context.close();
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}

/**
 * In-page audit: computed underline-decoration contrast on citation
 * affordances + computed font-size of provenance chips/legends.
 * Runs in the browser so tokens/vars are resolved exactly as users see them.
 */
function auditCitationAffordance() {
  // Computed colors are not always rgb() strings — oklch tokens compile to
  // wide-gamut lab() in the built CSS and Chromium serializes them as such.
  // A 1×1 canvas probe resolves ANY css color to sRGB bytes.
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
  function parseColor(str) {
    const m = (str || "").match(
      /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\s*\)/,
    );
    if (m) {
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }
    if (!str || !probeCtx) return null;
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = "#000";
    probeCtx.fillStyle = str; // invalid values leave #000 — caller treats 0:0:0 honestly
    probeCtx.fillRect(0, 0, 1, 1);
    const d = probeCtx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  function composite(fg, bg) {
    // fg over bg → opaque result (bg is always opaque by construction)
    const a = fg.a + bg.a * (1 - fg.a);
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  }
  function effectiveBackground(el) {
    // Collect translucent ancestor layers down to the first opaque one,
    // then composite bottom-up over white (the body background).
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = composite(layers[i], bg);
    return bg;
  }
  function luminance({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(a, b) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  // (a) underline decoration contrast on citation affordances
  const citeEls = [
    ...document.querySelectorAll("[data-amount][data-fact-id]"),
  ].slice(0, 15);
  const proseEls = [...document.querySelectorAll("[data-prose-cite]")].slice(
    0,
    5,
  );
  const underline = [...citeEls, ...proseEls].map((el) => {
    const cs = getComputedStyle(el);
    const deco = parseColor(cs.textDecorationColor);
    const bg = effectiveBackground(el);
    const solid = deco && deco.a < 1 ? composite(deco, bg) : deco;
    return {
      ratio: solid ? ratio(luminance(solid), luminance(bg)) : 0,
      color: cs.textDecorationColor,
      text: (el.textContent || "").trim().slice(0, 24),
    };
  });

  // (b) provenance chips/legends near [data-amount] + citation legends
  const CHIP_SELECTORS = [
    "[data-receipts-chip]",
    "[data-amount] > span", // inner XML / ⁂-uncited chips
    "[data-amount] + span", // sibling receipts/basis chips
    "[data-narrative-chip]",
    "[data-dossier-chip]",
    "[data-lineage-cite]",
    '[data-testid="cite-legend"]',
    '[data-testid="decade-marker-key"]',
    '[data-testid="decade-grid-note"]',
    '[data-testid="edition-legend"]',
    '[data-testid="family-legend"]',
  ];
  const seen = new Set();
  const chips = [];
  for (const sel of CHIP_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      chips.push({
        sel,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        text: (el.textContent || "").trim().slice(0, 32),
      });
    }
  }

  return {
    underline,
    chips,
    receiptsChipCount: document.querySelectorAll("[data-receipts-chip]")
      .length,
  };
}

// ── Leg (e) thresholds ───────────────────────────────────────────────────────
// FLOORS re-asserted from legs (a)/(b) so "quieter" can never mean "dimmer
// than accessible". CEILINGS are the new half — see the module docstring.
const CHIP_MIN_FONT_PX = 12; // same floor leg (b) pins
const CHIP_MIN_RATIO = 4.5; // WCAG AA for text at this size
const CHIP_MAX_WEIGHT = 500; // a provenance annotation is never bold
const CHROMA_SLACK = 8; // sRGB max−min units; sub-perceptual rounding room
const FILL_SLACK = 2; // per-channel /255 — antialiasing/rounding room

/**
 * In-page audit: pair every Fact-ID chip with the figure it annotates and
 * measure both on the axes leg (e) constrains. Runs in the browser so tokens,
 * inherited weight and composited backgrounds resolve exactly as a reader
 * sees them. Self-contained by necessity — page.evaluate serializes the
 * function body, so the colour helpers cannot be shared with
 * auditCitationAffordance().
 */
function auditChipHierarchy() {
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
  function parseColor(str) {
    const m = (str || "").match(
      /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\s*\)/,
    );
    if (m) {
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }
    if (!str || !probeCtx) return null;
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = "#000";
    probeCtx.fillStyle = str;
    probeCtx.fillRect(0, 0, 1, 1);
    const d = probeCtx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  function composite(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  }
  function effectiveBackground(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = composite(layers[i], bg);
    return bg;
  }
  function luminance({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(a, b) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  function measure(el) {
    const cs = getComputedStyle(el);
    const bg = effectiveBackground(el);
    let ink = parseColor(cs.color);
    if (ink && ink.a < 1) ink = composite(ink, bg);
    return {
      text: (el.textContent || "").trim().slice(0, 20),
      fontSize: parseFloat(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
      bg: [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)],
      contrast: ink ? ratio(luminance(ink), luminance(bg)) : 0,
      chroma: ink
        ? Math.max(ink.r, ink.g, ink.b) - Math.min(ink.r, ink.g, ink.b)
        : 0,
    };
  }

  // Document order — the chip is always emitted immediately AFTER the
  // [data-amount] it annotates, whether as its inline sibling (<Cite>) or
  // inside <CiteChips>' detached cluster span.
  const nodes = [
    ...document.querySelectorAll("[data-amount], [data-receipts-chip]"),
  ];
  const pairs = [];
  let unpaired = 0;
  let lastFigure = null;
  for (const n of nodes) {
    if (n.hasAttribute("data-receipts-chip")) {
      if (lastFigure) pairs.push([n, lastFigure]);
      else unpaired++;
    } else {
      lastFigure = n;
    }
  }
  // Stride-sample so a long page is covered end to end, not just its header.
  const stride = Math.max(1, Math.floor(pairs.length / 60));
  const sampled = pairs.filter((_, i) => i % stride === 0).slice(0, 60);

  return {
    chipCount: document.querySelectorAll("[data-receipts-chip]").length,
    paired: pairs.length,
    unpaired,
    rows: sampled.map(([chip, figure]) => ({
      chip: measure(chip),
      figure: measure(figure),
    })),
  };
}

/**
 * Leg (e) reporter. `required` pages must find chips to sample — a vacuous
 * hierarchy check on a page whose chips stopped rendering would silently pass
 * while the site regressed.
 */
async function checkChipHierarchy(page, label, errors, notes, required) {
  const audit = await page.evaluate(auditChipHierarchy);

  if (audit.chipCount === 0) {
    if (required) {
      errors.push(
        `P1-1 hierarchy (${label}): no [data-receipts-chip] found — check is vacuous, page or selector broken`,
      );
    }
    return;
  }
  if (audit.unpaired > 0) {
    errors.push(
      `P1-1 hierarchy (${label}): ${audit.unpaired} fact-id chip(s) precede every [data-amount] on the page — a chip that annotates no figure`,
    );
  }
  // chipCount > 0 with nothing paired means every chip on the page annotates
  // no figure. The unpaired error above has already fired; say so in this
  // leg's own vocabulary and stop, rather than running the per-pair checks
  // over an empty sample (which would read as a pass).
  if (audit.rows.length === 0) {
    errors.push(
      `P1-1 hierarchy (${label}): ${audit.chipCount} fact-id chip(s) but 0 chip/figure pairs — nothing to compare, check is vacuous`,
    );
    return;
  }

  const fmt = (r) =>
    `chip ${r.chip.fontSize}px/w${r.chip.weight}/${r.chip.contrast.toFixed(2)}:1/chroma ${Math.round(r.chip.chroma)}/bg ${r.chip.bg.join(",")} vs figure "${r.figure.text}" ${r.figure.fontSize}px/w${r.figure.weight}/${r.figure.contrast.toFixed(2)}:1/chroma ${Math.round(r.figure.chroma)}/bg ${r.figure.bg.join(",")}`;

  const checks = [
    [
      "e-i fill",
      (r) =>
        r.chip.bg.some((c, i) => Math.abs(c - r.figure.bg[i]) > FILL_SLACK),
      `paints a fill its figure does not`,
    ],
    [
      "e-ii chroma",
      (r) => r.chip.chroma > r.figure.chroma + CHROMA_SLACK,
      `is more chromatic than its figure`,
    ],
    [
      "e-iii contrast",
      (r) => r.chip.contrast >= r.figure.contrast,
      `does not read strictly quieter than its figure`,
    ],
    ["e-iv size", (r) => r.chip.fontSize > r.figure.fontSize, `is larger than its figure`],
    [
      "e-v weight",
      (r) => r.chip.weight > r.figure.weight || r.chip.weight > CHIP_MAX_WEIGHT,
      `is heavier than its figure or renders bold (>${CHIP_MAX_WEIGHT})`,
    ],
    [
      "e-floor size",
      (r) => r.chip.fontSize < CHIP_MIN_FONT_PX,
      `dropped below the ${CHIP_MIN_FONT_PX}px floor leg (b) pins`,
    ],
    [
      "e-floor contrast",
      (r) => r.chip.contrast < CHIP_MIN_RATIO,
      `dropped below the ${CHIP_MIN_RATIO}:1 AA floor — subordination must not cost legibility`,
    ],
  ];

  let failed = 0;
  for (const [id, predicate, why] of checks) {
    const bad = audit.rows.filter(predicate);
    if (bad.length > 0) {
      failed++;
      errors.push(
        `P1-1 hierarchy ${id} (${label}): ${bad.length}/${audit.rows.length} sampled Fact-ID chip(s) — the chip ${why}. First: ${fmt(bad[0])}`,
      );
    }
  }
  if (failed === 0) {
    const worst = audit.rows.reduce((a, b) =>
      a.figure.contrast - a.chip.contrast < b.figure.contrast - b.chip.contrast
        ? a
        : b,
    );
    notes.push(
      `P1-1 hierarchy (${label}): ${audit.rows.length} of ${audit.paired} chip/figure pairs sampled, chip subordinate on every axis (narrowest margin — ${fmt(worst)}) ✓`,
    );
  }
}

/**
 * Leg (e), light mode. Both pages are REQUIRED: /programs/ is the surface the
 * judging panels actually scored (3,061 chips, one per money cell) and the
 * program page is the densest per-figure surface.
 */
async function runHierarchyLeg(context, baseUrl, samplePbl, errors, notes) {
  const pages = [
    { label: `/program/${samplePbl}/`, url: `${baseUrl}/program/${samplePbl}/` },
    { label: "/programs/", url: `${baseUrl}/programs/` },
  ];
  for (const { label, url } of pages) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await checkChipHierarchy(page, label, errors, notes, true);
    } catch (e) {
      errors.push(`P1-1 hierarchy (${label}): ${e.message}`);
    } finally {
      await page.close();
    }
  }
}

async function runAffordanceChecks(context, baseUrl, samplePbl, errors, notes) {
  const MIN_RATIO = 3;
  const MIN_FONT_PX = 12;

  const pages = [
    { label: `/program/${samplePbl}/`, url: `${baseUrl}/program/${samplePbl}/`, required: true },
    { label: "/years/", url: `${baseUrl}/years/`, required: false },
  ];

  for (const { label, url, required } of pages) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const audit = await page.evaluate(auditCitationAffordance);

      // (a) underline contrast — required on the program page.
      if (audit.underline.length === 0) {
        if (required) {
          errors.push(
            `P1-1 underline (${label}): no [data-amount][data-fact-id] elements found — check is vacuous, page or selector broken`,
          );
        }
      } else {
        const bad = audit.underline.filter((u) => u.ratio < MIN_RATIO);
        const min = Math.min(...audit.underline.map((u) => u.ratio));
        if (bad.length > 0) {
          errors.push(
            `P1-1 underline (${label}): ${bad.length}/${audit.underline.length} sampled citation underlines below ${MIN_RATIO}:1 (worst ${min.toFixed(2)}:1, color ${bad[0].color}, e.g. "${bad[0].text}") — WCAG 1.4.11`,
          );
        } else {
          notes.push(
            `P1-1 underline (${label}): ${audit.underline.length} sampled, min ${min.toFixed(2)}:1 (≥${MIN_RATIO}:1) ✓`,
          );
        }
      }

      // (a2) hover reads as interactive: decoration flips dotted → solid.
      if (required && audit.underline.length > 0) {
        const el = page.locator("[data-amount][data-fact-id]").first();
        const restStyle = await el.evaluate(
          (n) => getComputedStyle(n).textDecorationStyle,
        );
        await el.hover();
        const hover = await el.evaluate((n) => {
          const cs = getComputedStyle(n);
          return { style: cs.textDecorationStyle, color: cs.textDecorationColor };
        });
        if (restStyle !== "dotted" || hover.style !== "solid") {
          errors.push(
            `P1-1 hover (${label}): expected dotted→solid on hover, got rest=${restStyle} hover=${hover.style}`,
          );
        } else {
          notes.push(`P1-1 hover (${label}): dotted→solid on hover ✓`);
        }
      }

      // (b) provenance chip/legend 12px floor.
      if (audit.chips.length === 0) {
        if (required) {
          errors.push(
            `P1-1 chip sizes (${label}): no provenance chips/legends found — check is vacuous`,
          );
        }
      } else {
        const small = audit.chips.filter((c) => c.fontSize < MIN_FONT_PX);
        if (small.length > 0) {
          const worst = small
            .slice(0, 4)
            .map((c) => `${c.sel} "${c.text}" ${c.fontSize}px`)
            .join("; ");
          errors.push(
            `P1-1 chip sizes (${label}): ${small.length}/${audit.chips.length} provenance elements below ${MIN_FONT_PX}px — ${worst}`,
          );
        } else {
          notes.push(
            `P1-1 chip sizes (${label}): ${audit.chips.length} provenance elements all ≥${MIN_FONT_PX}px ✓`,
          );
        }
      }

      // Default-ON sanity (program page only): receipts chips render on
      // first visit with no stored preference (fresh context = clean
      // localStorage).
      if (required && audit.receiptsChipCount === 0) {
        errors.push(
          `P1-1 default (${label}): zero [data-receipts-chip] on a fresh visit — Receipts/Fact-IDs mode is not defaulting ON`,
        );
      } else if (required) {
        notes.push(
          `P1-1 default (${label}): ${audit.receiptsChipCount} fact-id chips visible on fresh visit ✓`,
        );
      }
    } catch (e) {
      errors.push(`P1-1 affordance (${label}): ${e.message}`);
    } finally {
      await page.close();
    }
  }
}

/**
 * Leg (d) — dark mode (Sprint C Task C7, ROADMAP #66). See the module
 * docstring for what this proves and what it does not. A SEPARATE context
 * (not the shared `context` the rest of this gate uses) because
 * colorScheme is a context-creation option in Playwright, not something a
 * page can be toggled into afterward.
 */
async function runDarkModeLeg(browser, baseUrl, samplePbl, errors, notes) {
  const MIN_RATIO = 3;
  const MIN_FONT_PX = 12;

  const context = await browser.newContext({
    javaScriptEnabled: true,
    colorScheme: "dark",
  });
  try {
    const pages = [
      { label: "home (dark)", url: `${baseUrl}/` },
      { label: `/program/${samplePbl}/ (dark)`, url: `${baseUrl}/program/${samplePbl}/` },
    ];

    for (const { label, url } of pages) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

        // Confirm the forced scheme actually took — a silently-ignored
        // colorScheme option would make every check below vacuously pass
        // against the LIGHT palette, proving nothing.
        const matchesDark = await page.evaluate(
          () => window.matchMedia("(prefers-color-scheme: dark)").matches,
        );
        if (!matchesDark) {
          errors.push(
            `a11y (d) ${label}: window.matchMedia('(prefers-color-scheme: dark)') is false with a forced dark context — the leg cannot prove anything`,
          );
          continue;
        }

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const critical = results.violations.filter((v) => v.impact === "critical");
        const serious = results.violations.filter((v) => v.impact === "serious");
        const total = critical.length + serious.length;
        if (total > 0) {
          errors.push(
            `a11y (d) ${label}: ${critical.length} critical + ${serious.length} serious violations under forced dark mode:`,
          );
          for (const v of [...critical, ...serious].slice(0, 5)) {
            errors.push(`  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`);
          }
        } else {
          notes.push(`a11y (d) ${label}: 0 critical/serious under forced dark mode ✓`);
        }

        // Same P1-1 probe the light-mode legs run — the citation underline
        // and provenance chips are the one piece of UI this site's whole
        // value proposition depends on, so dark mode gets the same bar.
        const audit = await page.evaluate(auditCitationAffordance);
        if (audit.underline.length > 0) {
          const bad = audit.underline.filter((u) => u.ratio < MIN_RATIO);
          const min = Math.min(...audit.underline.map((u) => u.ratio));
          if (bad.length > 0) {
            errors.push(
              `a11y (d) ${label}: ${bad.length}/${audit.underline.length} citation underlines below ${MIN_RATIO}:1 in dark mode (worst ${min.toFixed(2)}:1, color ${bad[0].color})`,
            );
          } else {
            notes.push(
              `a11y (d) ${label}: ${audit.underline.length} citation underlines sampled, min ${min.toFixed(2)}:1 in dark mode (≥${MIN_RATIO}:1) ✓`,
            );
          }
        }
        if (audit.chips.length > 0) {
          const small = audit.chips.filter((c) => c.fontSize < MIN_FONT_PX);
          if (small.length > 0) {
            errors.push(
              `a11y (d) ${label}: ${small.length}/${audit.chips.length} provenance chips below ${MIN_FONT_PX}px in dark mode`,
            );
          } else {
            notes.push(
              `a11y (d) ${label}: ${audit.chips.length} provenance chips all ≥${MIN_FONT_PX}px in dark mode ✓`,
            );
          }
        }

        // Leg (e) under the forced dark scheme. This is where the pre-fix
        // chip was worst — it carried NO dark variant, so its light-mode
        // blue-100 fill kept painting a lit block on a near-black page.
        // Required on the program page (home renders only a couple of chips).
        await checkChipHierarchy(
          page,
          label,
          errors,
          notes,
          label.startsWith("/program/"),
        );
      } catch (e) {
        errors.push(`a11y (d) ${label}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
}
