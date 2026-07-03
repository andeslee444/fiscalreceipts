/**
 * gate — coverage_gate (Phase 5C, G2)
 *
 * For each coverage manifest entry, check representative built pages and verify:
 * 1. [data-coverage=<id>] exists on at least one representative page.
 * 2. The interpolated numbers match recomputation from data/site/json (where applicable).
 * 3. /methodology/ contains an element with id="coverage-<id>" for every id.
 *
 * Representative pages:
 *   follow-the-dollar + dossiers + company-awards + fy2026-partial
 *     → first flow program page (first slug in data/site/json/flows/)
 *   districts → out/district/index.html
 *   state-ca  → out/methodology/index.html (CA surface note lives there)
 *   years-matrix → out/years/index.html (single-edition honesty, Phase 5D)
 *
 * Counts are recomputed independently (no import of coverage.ts):
 *   flows = fs.readdirSync(data/site/json/flows).length
 *   programs = JSON.parse(programs.json).length
 *   dossiers = fs.readdirSync(dossiers).length
 *   districts = JSON.parse(districts/index.json).total_districts
 *   company-awards = entity_details filtered where awards.length > 0
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

const COVERAGE_IDS = [
  "follow-the-dollar",
  "dossiers",
  "company-awards",
  "districts",
  "state-ca",
  "fy2026-partial",
  "years-matrix",
  "service-books",
  "flow-bridge",
];

/**
 * Methodology anchor ids default to `coverage-<id>`; overrides listed here
 * (flow-bridge's anchor covers the whole /flow/ surface — Phase 5H).
 */
const ANCHOR_ID_OVERRIDES = {
  "flow-bridge": "coverage-flowdown",
};

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function htmlFor(url) {
  return path.join(outDir, ...url.split("/").filter(Boolean), "index.html");
}

/** Recompute counts from data sidecars, independently of coverage.ts */
function recomputeCounts() {
  const flowsDir = path.join(jsonDir, "flows");
  const flows = fs.existsSync(flowsDir)
    ? fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json")).length
    : 0;

  const programs = fs.existsSync(path.join(jsonDir, "programs.json"))
    ? readJson(path.join(jsonDir, "programs.json")).length
    : 0;

  const dossiersDir = path.join(jsonDir, "dossiers");
  const dossiers = fs.existsSync(dossiersDir)
    ? fs.readdirSync(dossiersDir).filter((f) => f.endsWith(".json")).length
    : 0;

  const districtIndexPath = path.join(jsonDir, "districts", "index.json");
  const districts = fs.existsSync(districtIndexPath)
    ? readJson(districtIndexPath).total_districts
    : 0;

  const entityDetailsDir = path.join(jsonDir, "entity_details");
  let companyAwards = 0;
  if (fs.existsSync(entityDetailsDir)) {
    for (const f of fs.readdirSync(entityDetailsDir).filter((f) => f.endsWith(".json"))) {
      try {
        const data = readJson(path.join(entityDetailsDir, f));
        if (Array.isArray(data.awards) && data.awards.length > 0) companyAwards++;
      } catch {
        // skip malformed
      }
    }
  }

  return { flows, programs, dossiers, districts, companyAwards };
}

/** First flow program slug */
function firstFlowSlug() {
  const flowsDir = path.join(jsonDir, "flows");
  if (!fs.existsSync(flowsDir)) return null;
  const files = fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;
  return files.sort()[0].replace(".json", "");
}

/** Total program-page count (all program_details sidecars — Phase 5F). */
function programPagesCount() {
  const dir = path.join(jsonDir, "program_details");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

/** First rollup-tier program slug (sidecar with tier:'rollup', sorted) —
 *  the representative page for the service-books coverage note. */
function firstRollupSlug() {
  const dir = path.join(jsonDir, "program_details");
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      if (readJson(path.join(dir, f)).tier === "rollup") {
        return f.replace(".json", "");
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

export async function runCoverageGate() {
  const errors = [];
  const notes = [];

  const methodologyPath = htmlFor("/methodology/");
  if (!fs.existsSync(methodologyPath)) {
    notes.push("out/methodology/index.html not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── 1. /methodology/ must have #coverage-<id> anchors ──
  const methHtml = fs.readFileSync(methodologyPath, "utf8");
  const methRoot = parse(methHtml, { comment: false });
  for (const id of COVERAGE_IDS) {
    const anchorId = ANCHOR_ID_OVERRIDES[id] ?? `coverage-${id}`;
    const anchor = methRoot.querySelector(`[id="${anchorId}"]`);
    if (!anchor) {
      errors.push(`methodology: missing anchor id="${anchorId}"`);
    } else {
      notes.push(`methodology: #${anchorId} ✓`);
    }
  }

  // ── 2. Recompute counts ──
  const counts = recomputeCounts();
  notes.push(
    `recomputed: flows=${counts.flows}, programs=${counts.programs}, dossiers=${counts.dossiers}, ` +
    `districts=${counts.districts}, companyAwards=${counts.companyAwards}`
  );

  // ── 3. Check representative pages for [data-coverage=<id>] ──

  // follow-the-dollar, dossiers, company-awards, fy2026-partial: flow program page
  const flowSlug = firstFlowSlug();
  const flowPagePath = flowSlug ? htmlFor(`/program/${flowSlug}/`) : null;
  const flowPageExists = flowPagePath && fs.existsSync(flowPagePath);

  // districts: district index
  const districtIndexPagePath = htmlFor("/district/");
  const districtPageExists = fs.existsSync(districtIndexPagePath);

  // state-ca: methodology page (already loaded above)

  const surfaceChecks = [
    {
      id: "follow-the-dollar",
      pagePath: flowPagePath,
      pageExists: flowPageExists,
      pageLabel: flowSlug ? `/program/${flowSlug}/` : "(no flow page)",
      checkNumbers: () => {
        const n = counts.flows;
        const d = counts.programs;
        return { n, d, pattern: `${n} of ${d}` };
      },
    },
    {
      id: "dossiers",
      pagePath: flowPagePath,
      pageExists: flowPageExists,
      pageLabel: flowSlug ? `/program/${flowSlug}/` : "(no flow page)",
      checkNumbers: () => {
        const n = counts.dossiers;
        const d = counts.programs;
        return { n, d, pattern: `${n} of ${d}` };
      },
    },
    {
      id: "company-awards",
      pagePath: flowPagePath,
      pageExists: flowPageExists,
      pageLabel: flowSlug ? `/program/${flowSlug}/` : "(no flow page)",
      checkNumbers: () => {
        const n = counts.companyAwards;
        // Recompute denominator from entity_details dir count (independent of coverage.ts)
        const entityDetailsDir = path.join(jsonDir, "entity_details");
        const d = fs.existsSync(entityDetailsDir)
          ? fs.readdirSync(entityDetailsDir).filter((f) => f.endsWith(".json")).length
          : 0;
        return { n, d, pattern: `${n} of ${d}` };
      },
    },
    {
      id: "districts",
      pagePath: districtIndexPagePath,
      pageExists: districtPageExists,
      pageLabel: "/district/",
      checkNumbers: () => {
        const n = counts.districts;
        const d = 435;
        return { n, d, pattern: `${n} of ${d}` };
      },
    },
    {
      id: "state-ca",
      pagePath: methodologyPath,
      pageExists: true,
      pageLabel: "/methodology/",
      checkNumbers: null, // prose-only
    },
    {
      id: "fy2026-partial",
      pagePath: flowPagePath,
      pageExists: flowPageExists,
      pageLabel: flowSlug ? `/program/${flowSlug}/` : "(no flow page)",
      checkNumbers: null, // prose-only
    },
    {
      id: "years-matrix",
      pagePath: htmlFor("/years/"),
      pageExists: fs.existsSync(htmlFor("/years/")),
      pageLabel: "/years/",
      // Phase 5F: the note must state the matrix's detail-grade scope vs the
      // full browsable page universe, numbers interpolated (never hardcoded).
      checkNumbers: () => {
        const n = counts.programs;
        const d = programPagesCount();
        return {
          n,
          d,
          pattern: `The matrix covers the ${n} programs with detail-grade data; all ${d} program pages are browsable.`,
        };
      },
    },
    {
      id: "service-books",
      pagePath: (() => {
        const slug = firstRollupSlug();
        return slug ? htmlFor(`/program/${slug}/`) : null;
      })(),
      pageExists: (() => {
        const slug = firstRollupSlug();
        return slug ? fs.existsSync(htmlFor(`/program/${slug}/`)) : false;
      })(),
      pageLabel: (() => {
        const slug = firstRollupSlug();
        return slug ? `/program/${slug}/` : "(no rollup page)";
      })(),
      checkNumbers: null, // per-service prose ("…lives in the {service} J-book…")
    },
    {
      id: "flow-bridge",
      pagePath: htmlFor("/flow/"),
      pageExists: fs.existsSync(htmlFor("/flow/")),
      pageLabel: "/flow/",
      // Phase 5H: the note must state the crosswalked-PE fraction AND the
      // not-yet-crosswalked share of the request, all recomputed here from
      // the flow_chart export (independent of coverage.ts).
      checkNumbers: () => {
        const flowChart = readJson(path.join(jsonDir, "flow_chart.json"));
        const bridge = flowChart.budget.bridge;
        const n = bridge.crosswalked_pe_count;
        const d = bridge.crosswalk_universe_pe_count;
        const pct = (
          (Number(bridge.not_yet_crosswalked_str) /
            Number(bridge.budget_total_str)) *
          100
        ).toFixed(1);
        return {
          n,
          d,
          pattern: `${n} of ${d} crosswalked PEs — ${pct}% of the FY2026 request is not yet crosswalked`,
        };
      },
    },
  ];

  for (const check of surfaceChecks) {
    if (!check.pageExists) {
      errors.push(`coverage[${check.id}]: representative page ${check.pageLabel} not found in out/`);
      continue;
    }

    const html = fs.readFileSync(check.pagePath, "utf8");
    const root = parse(html, { comment: false });
    const el = root.querySelector(`[data-coverage="${check.id}"]`);

    if (!el) {
      errors.push(`coverage[${check.id}]: no [data-coverage="${check.id}"] found on ${check.pageLabel}`);
      continue;
    }

    notes.push(`coverage[${check.id}]: [data-coverage] present on ${check.pageLabel} ✓`);

    // Number interpolation check
    if (check.checkNumbers) {
      const { n, d, pattern } = check.checkNumbers();
      const text = el.text || el.textContent || "";
      if (!text.includes(pattern)) {
        errors.push(
          `coverage[${check.id}]: note text does not contain "${pattern}" (got: "${text.slice(0, 120)}")`
        );
      } else {
        notes.push(`coverage[${check.id}]: interpolated numbers "${pattern}" ✓`);
      }
    }
  }

  return { pass: errors.length === 0, errors, notes };
}
