#!/usr/bin/env node
/**
 * generate-og.mjs — OG share-card generator (Task 8b, Option B).
 *
 * satori (JSX-object → SVG) + @resvg/resvg-js (SVG → PNG) with the vendored
 * Inter SemiBold (assets/fonts/Inter-SemiBold.ttf, OFL — see OFL.txt).
 * Runs in prebuild AFTER prepare-assets.mjs; writes public/og/{slug}.png
 * (gitignored). Slug scheme mirrors src/lib/og.ts — keep them in sync.
 *
 * Spike note (recorded 2026-06-12): Next's native opengraph-image.tsx DOES
 * emit a valid 1200×630 PNG under output:'export' once
 * `export const dynamic = "force-static"` is added (out/about/opengraph-image,
 * extensionless, auto-wired meta). Option B is used anyway — one uniform
 * pipeline for program/company/agency/core cards and gate-friendly
 * public/og/*.png paths (plan decision, Task 8b).
 *
 * Card set:
 *   - program-{pe_bli}.png   (one per programs.json entry) title, org + PE,
 *                            FY26 figure, tagline
 *   - company-{slug}.png     (200) display_name, obligations
 *   - agency-{org}.png       (~20) org, program count, FY26 total
 *   - 8 core pages           home/feed/district-index/downloads/methodology/
 *                            data/about/filings-index
 *
 * Freshness: cards are regenerated when missing or older than BOTH this
 * script and site_meta.json (so data refreshes and design changes re-render,
 * while loop re-builds stay fast). Pass --force to regenerate everything.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { companyDisplay } from "../src/lib/company-name.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "..");
const jsonDir = path.resolve(siteDir, "..", "data", "site", "json");
const fontPath = path.join(siteDir, "assets", "fonts", "Inter-SemiBold.ttf");
const outDir = path.join(siteDir, "public", "og");

const FORCE = process.argv.includes("--force");

// ── Inputs ───────────────────────────────────────────────────────────────────

function readJson(name) {
  const full = path.join(jsonDir, name);
  if (!fs.existsSync(full)) {
    console.error(
      `❌  FATAL: ${full} not found — run \`uv run python -m govbudget export-site\` first.`
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

if (!fs.existsSync(fontPath)) {
  console.error(`❌  FATAL: vendored font missing: ${fontPath}`);
  process.exit(1);
}
const interSemiBold = fs.readFileSync(fontPath);

const siteMetaPath = path.join(jsonDir, "site_meta.json");
const siteMeta = readJson("site_meta.json");
const programs = readJson("programs.json");
const entities = readJson("entities_top.json");
const agencies = readJson("agencies.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Filename-safe id part — identical to ogSlugPart() in src/lib/og.ts. */
function sanitize(raw) {
  return String(raw).replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Compact USD format (mirrors lib/format.ts rules closely enough for cards).
 * The T rung is the §P1-6 fix — mirrors of the ladder must all reach T.
 * Known, deliberate divergence from lib/format.ts: the M rung here is always
 * 1 decimal and sub-thousand values carry no grouping separators; card text is
 * approximate by design and no gate compares it to page text.
 */
function fmtUsd(rawUsd) {
  if (rawUsd === null || rawUsd === undefined || Number.isNaN(rawUsd)) return null;
  const abs = Math.abs(rawUsd);
  const sign = rawUsd < 0 ? "-" : "";
  const f = (v, d) => v.toFixed(d).replace(/\.0+$/, (m) => (d > 0 ? m : ""));
  if (abs >= 1e12) return `${sign}$${f(abs / 1e12, abs / 1e12 < 10 ? 2 : 1)}T`;
  if (abs >= 1e9) return `${sign}$${f(abs / 1e9, abs / 1e9 < 10 ? 2 : 1)}B`;
  if (abs >= 1e6) return `${sign}$${f(abs / 1e6, abs / 1e6 < 10 ? 1 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${f(abs / 1e3, 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── Card template (satori element objects — no JSX in .mjs) ──────────────────

const h = (type, style, children) => ({ type, props: { style, ...(children !== undefined ? { children } : {}) } });

const COLORS = {
  bg: "#0f172a", // slate-900 — brand-neutral dark
  fg: "#f8fafc",
  muted: "#94a3b8",
  accent: "#38bdf8", // sky-400 accent bar
  rule: "#1e293b",
};

/**
 * Shared card layout:
 *   ┌──────────────────────────────────────┐
 *   │ Fiscal Receipts ▎KIND                │
 *   │                                      │
 *   │ TITLE (up to 3 lines)                │
 *   │ subtitle                             │
 *   │                                      │
 *   │ FIGURE        tagline                │
 *   └──────────────────────────────────────┘
 */
function card({ kind, title, subtitle, figure, figureLabel, tagline }) {
  return h(
    "div",
    {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: COLORS.bg,
      // Subtle corner glow: tasteful depth AND a guaranteed non-background
      // pixel floor for short-title cards (og_gate requires ≥5% non-bg).
      backgroundImage: `linear-gradient(125deg, ${COLORS.bg} 55%, #1d2b4a 100%)`,
      color: COLORS.fg,
      padding: "64px 72px",
      fontFamily: "Inter",
      borderLeft: `16px solid ${COLORS.accent}`,
    },
    [
      // Header row: wordmark + kind
      h(
        "div",
        { display: "flex", alignItems: "center", gap: "20px" },
        [
          h("div", { fontSize: "36px", color: COLORS.fg }, "Fiscal Receipts"),
          kind
            ? h(
                "div",
                {
                  fontSize: "26px",
                  color: COLORS.muted,
                  textTransform: "uppercase",
                  letterSpacing: "3px",
                },
                kind
              )
            : h("div", { display: "flex" }, []),
        ]
      ),
      // Title block
      h(
        "div",
        { display: "flex", flexDirection: "column", gap: "18px" },
        [
          h(
            "div",
            {
              fontSize: title.length > 60 ? "56px" : "68px",
              lineHeight: 1.15,
              color: COLORS.fg,
              maxWidth: "1040px",
            },
            truncate(title, 110)
          ),
          subtitle
            ? h(
                "div",
                { fontSize: "32px", color: COLORS.muted, maxWidth: "1040px" },
                truncate(subtitle, 90)
              )
            : h("div", { display: "flex" }, []),
        ]
      ),
      // Footer row: figure + tagline
      h(
        "div",
        {
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          borderTop: `2px solid ${COLORS.rule}`,
          paddingTop: "28px",
        },
        [
          figure
            ? h(
                "div",
                { display: "flex", flexDirection: "column", gap: "6px" },
                [
                  h("div", { fontSize: "58px", color: COLORS.accent }, figure),
                  figureLabel
                    ? h("div", { fontSize: "24px", color: COLORS.muted }, figureLabel)
                    : h("div", { display: "flex" }, []),
                ]
              )
            : h("div", { display: "flex" }, []),
          h("div", { fontSize: "26px", color: COLORS.muted }, tagline),
        ]
      ),
    ]
  );
}

// ── Render pipeline ──────────────────────────────────────────────────────────

const SATORI_OPTS = {
  width: 1200,
  height: 630,
  fonts: [{ name: "Inter", data: interSemiBold, weight: 600, style: "normal" }],
};

const scriptMtime = fs.statSync(fileURLToPath(import.meta.url)).mtimeMs;
const metaMtime = fs.statSync(siteMetaPath).mtimeMs;
const staleBefore = Math.max(scriptMtime, metaMtime);

let rendered = 0;
let skipped = 0;

async function emit(slug, element) {
  const dest = path.join(outDir, `${slug}.png`);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).mtimeMs > staleBefore) {
    skipped += 1;
    return;
  }
  const svg = await satori(element, SATORI_OPTS);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } })
    .render()
    .asPng();
  fs.writeFileSync(dest, png);
  rendered += 1;
}

const TAGLINE = "Every number cited";

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(outDir, { recursive: true });

  // ── Core pages ─────────────────────────────────────────────────────────────
  const core = [
    ["home", {
      kind: null,
      title: "Federal defense budget data",
      subtitle: `${siteMeta.counts.programs} programs · ${siteMeta.counts.companies} contractor families · ${siteMeta.counts.citations.toLocaleString("en-US")} citations`,
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["feed", {
      kind: "Feed",
      title: "Anomaly feed",
      subtitle: "Budget swings, zeroed programs, concentration shifts, new entrants",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["district-index", {
      kind: "Districts",
      title: "District lens",
      subtitle: "Defense program dollars traced to congressional districts",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["years", {
      kind: "Years",
      title: "Budget over time",
      subtitle: "Program budgets year over year — every cell opens its citation",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["flow", {
      kind: "Flow",
      title: "Follow the money",
      subtitle: "Budget request to programs, obligations to contractors — honestly bridged",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["downloads", {
      kind: "Downloads",
      title: "Data downloads",
      subtitle: "Parquet exports with citation provenance",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["methodology", {
      kind: "Methodology",
      title: "How every figure is cited",
      subtitle: "J-book PDF coordinates, workbook cells, LDA filings, derived formulas",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["data", {
      kind: "Data",
      title: "Data explorer",
      subtitle: "Query the warehouse directly in your browser",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["about", {
      kind: "About",
      title: "About Fiscal Receipts",
      subtitle: "A spending-intelligence platform for U.S. federal defense data",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    ["filings-index", {
      kind: "Lobbying",
      title: "Lobbying filings",
      subtitle: "Senate LDA filings linked to defense programs",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
    // PM Sprint 3 Task 6 (§Coverage) — the roadmap page.
    ["coverage", {
      kind: "Coverage",
      title: "What we cover, and what we do not",
      subtitle: "Per-feature coverage, the specific blocker, and a dated target",
      figure: null, figureLabel: null, tagline: TAGLINE,
    }],
  ];
  for (const [slug, props] of core) {
    await emit(slug, card(props));
  }

  // ── Program cards ──────────────────────────────────────────────────────────
  for (const p of programs) {
    const fy26 = p.trajectory?.fy2026_total;
    await emit(
      `program-${sanitize(p.pe_bli)}`,
      card({
        kind: "Program",
        title: p.title || p.pe_bli,
        subtitle: `${p.org} · ${p.pe_bli}`,
        figure: fy26 != null ? fmtUsd(fy26 * 1000) : null,
        figureLabel: fy26 != null ? "FY2026 request" : null,
        tagline: TAGLINE,
      })
    );
  }

  // ── Rollup-tier program cards (Phase 5F §2a) ────────────────────────────────
  // Every program_details sidecar NOT in programs.json is a rollup page
  // (tier:'rollup' with title/service_org/trajectory on the sidecar).
  // Same card template — title, service + PE, FY2026 figure when known.
  {
    const fullTier = new Set(programs.map((p) => p.pe_bli));
    const detailsDir = path.join(jsonDir, "program_details");
    const serviceName = (code) =>
      ({ A: "Army", N: "Navy", F: "Air Force" })[code] ?? (code || "DoD");
    const rollupSlugs = fs.existsSync(detailsDir)
      ? fs
          .readdirSync(detailsDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.slice(0, -".json".length))
          .filter((pe) => !fullTier.has(pe))
          .sort()
      : [];
    for (const pe of rollupSlugs) {
      const d = JSON.parse(
        fs.readFileSync(path.join(detailsDir, `${pe}.json`), "utf8")
      );
      const fy26 = d.trajectory?.fy2026_total;
      await emit(
        `program-${sanitize(pe)}`,
        card({
          kind: "Program",
          title: d.title || pe,
          subtitle: `${serviceName(d.service_org ?? "")} · ${pe}`,
          figure: fy26 != null ? fmtUsd(fy26 * 1000) : null,
          figureLabel: fy26 != null ? "FY2026 request" : null,
          tagline: TAGLINE,
        })
      );
    }
    console.log(`  ↳ rollup-tier program cards: ${rollupSlugs.length}`);
  }

  // ── Company cards ──────────────────────────────────────────────────────────
  for (const e of entities) {
    await emit(
      `company-${sanitize(e.slug)}`,
      card({
        kind: "Company",
        title: companyDisplay(e.display_name || e.slug),
        subtitle: `${e.uei_count} linked UEI${e.uei_count === 1 ? "" : "s"}`,
        figure: fmtUsd(e.total_obligation),
        figureLabel: "federal obligations (FY2017+)",
        tagline: TAGLINE,
      })
    );
  }

  // ── Agency cards ───────────────────────────────────────────────────────────
  for (const a of agencies) {
    const fy26 = a.fy2026_total_thousands;
    await emit(
      `agency-${sanitize(a.org)}`,
      card({
        kind: "Agency",
        title: a.org,
        subtitle: `${a.program_count} program${a.program_count === 1 ? "" : "s"} tracked`,
        figure: fy26 != null ? fmtUsd(fy26 * 1000) : null,
        figureLabel: fy26 != null ? "FY2026 request" : null,
        tagline: TAGLINE,
      })
    );
  }

  // ── Default filing card (public/og-default-filing.png) ─────────────────────
  // Rendered through the same satori template so it matches the OG family.
  // Shared across all 4,258 filing pages (decision 3 — no per-filing render).
  {
    const filingCardElement = card({
      kind: "Lobbying",
      title: "Lobbying Filing",
      subtitle: "Senate LDA disclosure — activities, lobbyists, program mentions",
      figure: null,
      figureLabel: null,
      tagline: TAGLINE,
    });
    const filingDest = path.join(siteDir, "public", "og-default-filing.png");
    const filingStale =
      FORCE ||
      !fs.existsSync(filingDest) ||
      fs.statSync(filingDest).mtimeMs <= staleBefore;
    if (filingStale) {
      const svg = await satori(filingCardElement, SATORI_OPTS);
      const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } })
        .render()
        .asPng();
      fs.writeFileSync(filingDest, png);
      rendered += 1;
      console.log("  ↳ og-default-filing.png regenerated via satori template");
    } else {
      skipped += 1;
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const total = rendered + skipped;
  console.log(
    `✓  og cards: ${total} total (${rendered} rendered, ${skipped} fresh-skipped) in ${secs}s → public/og/`
  );
}

main().catch((err) => {
  console.error("❌  generate-og failed:", err);
  process.exit(1);
});
