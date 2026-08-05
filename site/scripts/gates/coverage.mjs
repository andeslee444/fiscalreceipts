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
 *
 * ── leg cm: THE COVERAGE MAP (PM Sprint 3 Task 6, §Coverage) ────────────────
 *
 * /coverage/ publishes what the site covers, what it does not, the specific
 * blocker per feature and a dated target. Of every page on this site, it is
 * the one where an authored literal would be self-refuting — a stale coverage
 * number on the coverage page destroys exactly the credibility the page is
 * spending. So this leg recomputes EVERY figure the page renders, from the
 * shipped sidecars and the built feed files, and compares against the rendered
 * HTML — the same §P1-5 discipline the /data/ row counts get, applied to the
 * page that claims it.
 *
 * It also pins the page's STRUCTURE, because a roadmap without dates is the
 * defect the review actually reported:
 *   - every declared row is present, and no row is present that is not
 *     declared (both directions — a silently dropped feature is a lie of
 *     omission on a coverage page);
 *   - every row carries a blocker of real length. "Not done yet" is not a
 *     blocker, and a 20-character cell is that in disguise;
 *   - every target is either DATED (names a month and a year) or explicitly
 *     undated, in which case it must say so in as many words;
 *   - the crosswalk row is undated AND states the methodology limit —
 *     account-code coarseness, with DARPA named as the exception. That
 *     sentence is the page's centrepiece; the gate keeps it from decaying
 *     into "coming soon".
 * Vacuity fails: no rows, or a table that recomputes nothing, is a FAIL.
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

/**
 * Grouped count — MIRRORS formatCount() in src/lib/format.ts.
 *
 * The manifest interpolates grouped counts ("1,741", never "1741") so the
 * coverage notes read in the same notation as the corpus statement and the
 * /programs/ and /district/ prose. The gate still recomputes every number
 * from the sidecars and still demands an exact substring match — only the
 * notation of the expected string moved. Change one, change both.
 */
function fmtCount(n) {
  return Number(n).toLocaleString("en-US");
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
        return { n, d, pattern: `${fmtCount(n)} of ${fmtCount(d)}` };
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
        return { n, d, pattern: `${fmtCount(n)} of ${fmtCount(d)}` };
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
        return { n, d, pattern: `${fmtCount(n)} of ${fmtCount(d)}` };
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
        return { n, d, pattern: `${fmtCount(n)} of ${fmtCount(d)}` };
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
          pattern: `The matrix covers the ${fmtCount(n)} programs with detail-grade data; all ${fmtCount(d)} program pages are browsable.`,
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
          pattern: `${fmtCount(n)} of ${fmtCount(d)} crosswalked PEs — ${pct}% of the FY2026 request is not yet crosswalked`,
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

  // ── leg cm: the coverage map (Sprint 3 Task 6) ───────────────────────────
  runCoverageMapLeg(errors, notes);

  return { pass: errors.length === 0, errors, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// leg cm — /coverage/ (PM Sprint 3 Task 6, §Coverage)
// ═══════════════════════════════════════════════════════════════════════════

/** A dated target names a month and a year. Anything else is a vibe. */
const DATED_TARGET_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/;

/** Shortest sentence that can carry a real blocker. Below this it is "soon". */
const MIN_BLOCKER_CHARS = 60;

/** Count the RSS files (never the .atom.xml twins) in a built feed directory. */
function countRssFeeds(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".xml") && !f.endsWith(".atom.xml")).length;
}

/**
 * Recompute every figure /coverage/ renders, from the artifacts — never from
 * lib/coverage-map, which is the thing under test.
 *
 * Returns a map id → { n, d, must } where `must` is the list of substrings the
 * row's coverage cell has to contain. Numbers only: the blocker and target
 * prose is authored on purpose, and duplicating it here would pin the wording
 * instead of the truth.
 */
function recomputeCoverageMap() {
  const programs = readJson(path.join(jsonDir, "programs.json")).length;

  const detailsDir = path.join(jsonDir, "program_details");
  const detailFiles = fs.existsSync(detailsDir)
    ? fs.readdirSync(detailsDir).filter((f) => f.endsWith(".json"))
    : [];
  const pages = detailFiles.length;

  // Programs carrying a non-empty lineage rail — parsed, not grepped.
  let lineage = 0;
  for (const f of detailFiles) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(detailsDir, f), "utf8");
    } catch {
      continue;
    }
    if (!raw.includes('"lineage"')) continue;
    try {
      const rail = JSON.parse(raw).lineage?.rail;
      if (!rail) continue;
      if ((rail.predecessors?.length ?? 0) + (rail.successors?.length ?? 0) > 0) {
        lineage++;
      }
    } catch {
      // skip malformed
    }
  }

  const dossiersDir = path.join(jsonDir, "dossiers");
  const dossiers = fs.existsSync(dossiersDir)
    ? fs.readdirSync(dossiersDir).filter((f) => f.endsWith(".json")).length
    : 0;

  const flowsDir = path.join(jsonDir, "flows");
  const flows = fs.existsSync(flowsDir)
    ? fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json")).length
    : 0;

  const bridge = readJson(path.join(jsonDir, "flow_chart.json")).budget.bridge;
  const budgetFy = readJson(path.join(jsonDir, "flow_chart.json")).budget.fiscal_year;
  const pctNot = (
    (Number(bridge.not_yet_crosswalked_str) / Number(bridge.budget_total_str)) *
    100
  ).toFixed(1);

  const entityDir = path.join(jsonDir, "entity_details");
  const entityFiles = fs.existsSync(entityDir)
    ? fs.readdirSync(entityDir).filter((f) => f.endsWith(".json"))
    : [];
  let companyAwards = 0;
  for (const f of entityFiles) {
    try {
      const d = readJson(path.join(entityDir, f));
      if (Array.isArray(d.awards) && d.awards.length > 0) companyAwards++;
    } catch {
      // skip malformed
    }
  }
  const companies = readJson(path.join(jsonDir, "entities_top.json")).length;

  const districts = readJson(path.join(jsonDir, "districts", "index.json"))
    .districts.length;

  const editions = [
    ...new Set(
      (readJson(path.join(jsonDir, "years_matrix.json")).decade_columns ?? [])
        .map((c) => c.edition)
        .filter((e) => typeof e === "number"),
    ),
  ].sort((a, b) => a - b);

  const meta = readJson(path.join(jsonDir, "site_meta.json"));
  const win = meta.award_fy_range ?? {};

  const feedCards = (readJson(path.join(jsonDir, "feed.json")).cards ?? []).length;
  const feedsDir = path.join(outDir, "feeds");
  const eventTypeFeeds = countRssFeeds(feedsDir);
  const programFeeds = countRssFeeds(path.join(feedsDir, "program"));
  const companyFeeds = countRssFeeds(path.join(feedsDir, "company"));

  const filings = readJson(path.join(jsonDir, "filings_index.json")).total;

  return {
    "program-pages": {
      n: programs,
      d: pages,
      must: [`${fmtCount(programs)} of ${fmtCount(pages)}`, fmtCount(pages - programs)],
    },
    editions: {
      n: editions.length,
      d: null,
      must: [
        `${fmtCount(editions.length)} editions`,
        `PB${editions[0]}–PB${editions[editions.length - 1]}`,
      ],
    },
    dossiers: {
      n: dossiers,
      d: programs,
      must: [`${fmtCount(dossiers)} of ${fmtCount(programs)}`],
    },
    lineage: {
      n: lineage,
      d: programs,
      must: [`${fmtCount(lineage)} of ${fmtCount(programs)}`],
    },
    flows: {
      n: flows,
      d: programs,
      must: [`${fmtCount(flows)} of ${fmtCount(programs)}`],
    },
    bridge: {
      n: bridge.crosswalked_pe_count,
      d: bridge.crosswalk_universe_pe_count,
      must: [
        `${fmtCount(bridge.crosswalked_pe_count)} of ${fmtCount(bridge.crosswalk_universe_pe_count)}`,
        `${fmtCount(bridge.high_confidence_pe_count)} at high confidence`,
        `${pctNot}% of the FY${budgetFy} request`,
      ],
    },
    "company-awards": {
      n: companyAwards,
      d: companies,
      must: [`${fmtCount(companyAwards)} of ${fmtCount(companies)}`],
    },
    "awards-window": {
      n: null,
      d: null,
      must: [win.label, win.latest_action_date, `FY${win.fy_max} is a partial year`].filter(
        Boolean,
      ),
    },
    districts: {
      n: districts,
      d: 435,
      must: [`${fmtCount(districts)} of ${fmtCount(435)}`],
    },
    "state-ca": { n: null, d: null, must: ["California", "FY2025"] },
    feeds: {
      n: programFeeds + companyFeeds,
      d: null,
      must: [
        `${fmtCount(feedCards)} items`,
        `${fmtCount(eventTypeFeeds)} event types`,
        `${fmtCount(programFeeds)} program`,
        `${fmtCount(companyFeeds)} company watch feeds`,
      ],
    },
    filings: { n: filings, d: null, must: [fmtCount(filings)] },
  };
}

function runCoverageMapLeg(errors, notes) {
  const pagePath = htmlFor("/coverage/");
  if (!fs.existsSync(pagePath)) {
    errors.push("leg cm: out/coverage/index.html not found — the coverage page did not build");
    return;
  }
  const root = parse(fs.readFileSync(pagePath, "utf8"), { comment: false });

  const table = root.querySelector("table[data-coverage-map]");
  if (!table) {
    errors.push("leg cm: /coverage/ renders no [data-coverage-map] table");
    return;
  }

  const expected = recomputeCoverageMap();
  const expectedIds = Object.keys(expected);
  const rendered = table.querySelectorAll("[data-coverage-row]");
  const renderedIds = rendered.map((r) => r.getAttribute("data-coverage-row"));

  // Vacuity + both directions of set equality.
  if (rendered.length === 0) {
    errors.push("leg cm is VACUOUS: [data-coverage-map] table renders zero rows");
    return;
  }
  for (const id of expectedIds) {
    if (!renderedIds.includes(id)) {
      errors.push(`leg cm: /coverage/ is missing the "${id}" row — a dropped feature is a lie of omission on a coverage page`);
    }
  }
  for (const id of renderedIds) {
    if (!expectedIds.includes(id)) {
      errors.push(`leg cm: /coverage/ renders row "${id}", which this gate cannot recompute — every row must be derivable`);
    }
  }

  let checkedFigures = 0;
  let datedTargets = 0;

  for (const row of rendered) {
    const id = row.getAttribute("data-coverage-row");
    const exp = expected[id];
    if (!exp) continue;

    // (1) machine-readable ratio attributes
    const attrN = row.getAttribute("data-covered-n");
    const attrD = row.getAttribute("data-covered-d");
    if (exp.n !== null && Number(attrN) !== exp.n) {
      errors.push(`leg cm[${id}]: data-covered-n is "${attrN}", recomputed ${exp.n}`);
    }
    if (exp.d !== null && Number(attrD) !== exp.d) {
      errors.push(`leg cm[${id}]: data-covered-d is "${attrD}", recomputed ${exp.d}`);
    }

    // (2) the rendered coverage sentence carries the recomputed figures
    const coveredEl = row.querySelector('[data-primary-value="covered"]');
    if (!coveredEl) {
      errors.push(`leg cm[${id}]: row has no [data-primary-value="covered"] cell`);
    } else {
      const text = (coveredEl.text ?? "").replace(/\s+/g, " ");
      for (const want of exp.must) {
        if (!text.includes(want)) {
          errors.push(
            `leg cm[${id}]: coverage cell does not contain "${want}" (rendered: "${text.slice(0, 160)}")`,
          );
        } else {
          checkedFigures++;
        }
      }
    }

    // (3) a specific blocker
    const blockerEl = row.querySelector("[data-coverage-blocker]");
    const blocker = (blockerEl?.text ?? "").replace(/\s+/g, " ").trim();
    if (blocker.length < MIN_BLOCKER_CHARS) {
      errors.push(
        `leg cm[${id}]: blocker is ${blocker.length} chars ("${blocker}") — under ${MIN_BLOCKER_CHARS} it is "not done yet" with extra words`,
      );
    }

    // (4) a dated target, or an explicit statement that there is not one
    const targetEl = row.querySelector("[data-coverage-target]");
    const target = (targetEl?.text ?? "").replace(/\s+/g, " ").trim();
    const kind = targetEl?.getAttribute("data-target-kind");
    if (kind === "dated") {
      datedTargets++;
      if (!DATED_TARGET_RE.test(target)) {
        errors.push(
          `leg cm[${id}]: target is marked dated but names no month and year ("${target.slice(0, 120)}")`,
        );
      }
    } else if (kind === "none") {
      if (!/no dated target/i.test(target)) {
        errors.push(
          `leg cm[${id}]: target is marked undated but does not say so ("${target.slice(0, 120)}")`,
        );
      }
    } else {
      errors.push(`leg cm[${id}]: data-target-kind is "${kind}", expected dated|none`);
    }
  }

  // (5) the crosswalk row is the page's centrepiece: undated, and stating the
  //     methodology limit rather than a queue position.
  const xw = rendered.find((r) => r.getAttribute("data-coverage-row") === "bridge");
  if (!xw) {
    errors.push('leg cm: no "bridge" row — the crosswalk gap is the page\'s reason to exist');
  } else {
    const blocker = (xw.querySelector("[data-coverage-blocker]")?.text ?? "").replace(/\s+/g, " ");
    const target = (xw.querySelector("[data-coverage-target]")?.text ?? "").replace(/\s+/g, " ");
    if (!/account code/i.test(blocker) || !/coarse/i.test(blocker)) {
      errors.push(
        "leg cm[bridge]: the blocker must name account-code coarseness as the reason — that sentence is what makes the gap a methodology limit rather than an excuse",
      );
    }
    if (!/DARPA/.test(blocker)) {
      errors.push(
        "leg cm[bridge]: the blocker must name DARPA as the structure where account codes DO resolve — the exception is what makes the rule checkable",
      );
    }
    if (xw.querySelector("[data-coverage-target]")?.getAttribute("data-target-kind") !== "none") {
      errors.push("leg cm[bridge]: the crosswalk gap must not carry a dated target — it is not a backlog item");
    }
    if (!/methodolog/i.test(target)) {
      errors.push('leg cm[bridge]: the crosswalk target must say the limit is methodological');
    }
    // The page states the crosswalk figure TWICE — in the row and in the
    // section below it. Two statements of one number is how §P0-2 happened,
    // so both are checked against the same recompute.
    const restated = (root.querySelector("[data-coverage-crosswalk]")?.text ?? "").replace(
      /\s+/g,
      " ",
    );
    if (!restated) {
      errors.push("leg cm[bridge]: the crosswalk section restates no figure — [data-coverage-crosswalk] is missing or empty");
    } else {
      for (const want of expected.bridge.must) {
        if (!restated.includes(want)) {
          errors.push(
            `leg cm[bridge]: the crosswalk section says "${restated.slice(0, 160)}" — it does not carry "${want}", which the row above does`,
          );
        }
      }
    }
  }

  // (6) at least half the rows carry a date — otherwise this is a list of
  //     excuses, which is the state the review already found the site in.
  if (datedTargets * 2 < rendered.length) {
    errors.push(
      `leg cm: only ${datedTargets} of ${rendered.length} rows carry a dated target — a roadmap where most rows have no date is not a roadmap`,
    );
  }

  if (checkedFigures === 0) {
    errors.push("leg cm is VACUOUS: not one recomputed figure was matched against the page");
  }

  notes.push(
    `leg cm coverage map: ${rendered.length} row(s), ${checkedFigures} recomputed figure(s) matched, ` +
      `${datedTargets} dated target(s) ✓`,
  );
}
