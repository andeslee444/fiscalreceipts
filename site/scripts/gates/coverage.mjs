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
 *   - EVERY row carries a target field of real length, and it is either DATED
 *     (names a month and a year) or explicitly undated, in which case it must
 *     say so in as many words. Both forms have to be a statement: below
 *     MIN_TARGET_CHARS a cell is "TBD" with extra whitespace;
 *   - the crosswalk row is undated AND states the methodology limit —
 *     account-code coarseness, with DARPA named as the exception. That
 *     sentence is the page's centrepiece; the gate keeps it from decaying
 *     into "coming soon".
 * Vacuity fails: no rows, or a table that recomputes nothing, is a FAIL.
 *
 * TARGET-DATE POLICY (Sprint 3 round 3 — deliberate rule change, recorded so
 * it is not mistaken for a gate being softened). This leg used to additionally
 * require that at least HALF the rows carried a dated target. That rule
 * encoded a design choice the implementing agent made on its own: it invented
 * eight dates and then gated the page into keeping them. The site owner
 * reviewed those dates and decided the page ships with the targets UNDATED,
 * because publishing a schedule the project has not committed to is the same
 * class of defect as publishing a figure it cannot recompute — and this is the
 * page least able to afford either. The half-dated rule was therefore wrong
 * about what it was protecting, so it is REPLACED (not dropped) by a rule that
 * protects the property that actually matters: every row must carry a target
 * field, a dated one must name a month and a year, an undated one must say so
 * and say enough to be a statement, and the crosswalk row must still name
 * account-code coarseness and DARPA. Dated targets remain legal in this
 * vocabulary — the gate has no opinion on how many there are, only that
 * whatever is published is checkable.
 */

import { spawnSync } from "child_process";
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

/**
 * Sidecars that actually carry R-2/P-40 J-book DETAIL rows — the detail-grade
 * tier (backlog #35). NOT programs.json's length: that is the /programs/
 * index, which since backlog #17 also lists trajectory-only program elements
 * with no J-book detail at all. Recomputed from the sidecars so the gate does
 * not inherit the claim it is checking.
 */
function detailGradeCount() {
  const dir = path.join(jsonDir, "program_details");
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    if (!raw.includes('"details"') || raw.includes('"details":[]')) continue;
    try {
      const d = JSON.parse(raw).details;
      if (Array.isArray(d) && d.length > 0) n++;
    } catch {
      // skip malformed
    }
  }
  return n;
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
          pattern:
            `The matrix covers the ${fmtCount(n)} program elements in the FY2026 budget index, ` +
            `${fmtCount(detailGradeCount())} of which carry detail-grade R-2/P-40 data; ` +
            `all ${fmtCount(d)} program pages are browsable.`,
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

  // ── leg cv: the unparsed-volume claim direction ──────────────────────────
  runVolumeClaimLeg(errors, notes);

  // ── leg cr: ranking entities whose coverage is uneven ────────────────────
  runUnevenRankingLeg(errors, notes);

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

/**
 * Shortest sentence that can carry a real target — dated or not. Same floor as
 * the blocker: "No dated target." on its own tells a reader nothing about
 * whether the work is planned, which is the whole question an undated target
 * has to answer.
 */
const MIN_TARGET_CHARS = 60;

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
  const detailGrade = detailGradeCount();
  // ROADMAP #28 split the non-detail remainder into two DIFFERENT things:
  // rollup-tier pages (a current FY2026 workbook line, no R-2/P-40 detail)
  // and decade-only history pages (no FY2026 line at all). The page says so
  // rather than lumping them, so the check follows — but the two parts must
  // still account for the whole remainder, which is the property that
  // actually matters and the one a lump total was standing in for.
  const decadeOnly = detailFiles.filter((f) => {
    try {
      return readJson(path.join(detailsDir, f)).tier === "decade";
    } catch {
      return false;
    }
  }).length;
  const rollupOnly = pages - detailGrade - decadeOnly;
  if (detailGrade + rollupOnly + decadeOnly !== pages) {
    throw new Error(
      `coverage: the three page tiers do not partition the corpus — ` +
        `${detailGrade} detail + ${rollupOnly} rollup + ${decadeOnly} decade ` +
        `!== ${pages} pages`
    );
  }

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
    // Backlog #35: the detail-grade tier is recomputed from the sidecars that
    // hold J-book detail rows, NOT from programs.json's length — the index
    // also lists trajectory-only lines, and this page LEADS with this number.
    "program-pages": {
      n: detailGrade,
      d: pages,
      must: [
        `${fmtCount(detailGrade)} of ${fmtCount(pages)}`,
        // Both parts of the split, and the arithmetic is asserted below —
        // a page could otherwise print two plausible numbers that do not
        // add up to the remainder they claim to divide.
        fmtCount(rollupOnly),
        fmtCount(decadeOnly),
      ],
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
  let targetsSeen = 0;

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

    // (4) EVERY row carries a target field: dated (names a month and a year)
    //     or explicitly undated (says so) — and either way, a statement.
    const targetEl = row.querySelector("[data-coverage-target]");
    if (!targetEl) {
      errors.push(
        `leg cm[${id}]: row has no [data-coverage-target] cell — every row must state where the work stands`,
      );
      continue;
    }
    targetsSeen++;
    const target = (targetEl.text ?? "").replace(/\s+/g, " ").trim();
    const kind = targetEl.getAttribute("data-target-kind");
    if (target.length < MIN_TARGET_CHARS) {
      errors.push(
        `leg cm[${id}]: target is ${target.length} chars ("${target}") — under ${MIN_TARGET_CHARS} it is "TBD" with extra words`,
      );
    }
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

  // (6) EVERY rendered row states where the work stands. See the TARGET-DATE
  //     POLICY note at the top of this file: the former "at least half the
  //     rows must carry a date" rule was replaced here, deliberately, because
  //     it protected an invented schedule rather than a checkable statement.
  //     What replaced it still has teeth — a row that drops its target cell,
  //     or fills it with "TBD", or marks itself dated without naming a month
  //     and a year, all fail above.
  if (targetsSeen !== rendered.length) {
    errors.push(
      `leg cm: ${targetsSeen} of ${rendered.length} rows carry a target field — every row on a coverage page must say where the work stands`,
    );
  }

  if (checkedFigures === 0) {
    errors.push("leg cm is VACUOUS: not one recomputed figure was matched against the page");
  }

  notes.push(
    `leg cm coverage map: ${rendered.length} row(s), ${checkedFigures} recomputed figure(s) matched, ` +
      `${targetsSeen} target statement(s), of which ${datedTargets} dated ✓`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// leg cv — THE UNPARSED-VOLUME CLAIM DIRECTION
// ═══════════════════════════════════════════════════════════════════════════
//
// The defect this leg exists for. /coverage/ shipped, live, for months:
//
//   "…the services publish no matching R-2/P-40 justification … there is no
//    narrative document to ingest: this is a limit of what the Department
//    publishes, not of what we have loaded."
//   "No dated target — the missing volumes do not exist publicly."
//
// At the moment those sentences were served, 25 FY2026 justification volumes
// sat downloaded and unparsed in this repository — 11 of the Navy's 13,
// including the shipbuilding book carrying Virginia, COLUMBIA and DDG-51,
// which are the three largest non-classified lines on the excluded list.
//
// EVERY NUMBER ON THAT PAGE WAS CORRECT. The 262 was recomputed by leg cm and
// matched. The falsehood lived in the prose beside the number, attributing a
// true count to a false cause — so no number-vs-citation gate could see it,
// and none did. This leg is the shape of check that would have: it compares a
// CLAIM DIRECTION against the world.
//
// Truth comes from volumes-recompute.py, which reconciles the raw download
// tree against the staged documents lake PER FILE — both upstream of every
// artifact /coverage/ renders from. Recomputing this from site_meta or from
// the sidecars would let the exporter mark its own homework, which is how the
// scope note shipped false on 179 of 319 pages here.
//
// Wave 5: that helper now reconciles CONTENT, not filenames. A volume whose
// embedded master XML is byte-identical to a parsed one is the same book
// under another cover and counts as ingested — see the helper's own
// docstring for the per-file evidence. Without that change this leg would
// have kept demanding a backlog sentence for 20 duplicate covers after the
// ingestion landed, which is the opposite false claim it exists to prevent.
//
// The leg is symmetric on purpose. It does not say "the page must confess a
// backlog"; it says the page's claim must match the reconciliation IN BOTH
// DIRECTIONS. When the ingestion lands and `unparsed` reaches zero, the
// backlog sentence becomes the false one, and this leg fails on it — so the
// correction cannot rot into the opposite error.

// Three predicates, and the distinction between the first two is the whole
// leg. Tested against BOTH the live pre-fix string and the corrected one
// before being written down here — a regex that fires on the fix is worse
// than no regex, because the next person deletes it.
//
// ABSOLUTE: an unconditional denial that the source documents exist or are
// obtainable. This is false while ANY volume sits unparsed on disk, no matter
// what else the sentence says, so it fails on sight. The negated form is
// explicitly exempted: "our backlog, NOT a limit of what the Department
// publishes" is the CORRECTION, and a substring match would flag it.
const ABSOLUTE_NONPUBLICATION_RE =
  /(?<!not )(?<!rather than )\b(the missing volumes do not exist|do(es)? not exist publicly|no narrative document to ingest)\b|(?<!not a )\blimit of what the (Department|services) publish/i;

// BLAME: non-publication offered as a cause. NOT false by itself — Classified
// Programs, the single largest excluded line, genuinely publish nothing, and
// the corrected page says so. It is only a defect when it is offered as the
// WHOLE account, i.e. when the backlog is never mentioned. So this one is
// reported only inside the missing-BACKLOG branch, never on its own.
const BLAME_NONPUBLICATION_RE = /\b(publish(es)? no|withheld|never published)\b/i;

/** Language that admits the volumes are held here and not yet ingested. */
const BACKLOG_RE =
  /\b(not (yet )?(parsed|ingested|loaded)|already downloaded|downloaded here|unparsed|our backlog|unbuilt ingestion)\b/i;

/** Independent per-file disk↔lake reconciliation (DuckDB, via uv run python). */
function recomputeVolumes() {
  const script = path.join(__dirname, "volumes-recompute.py");
  const res = spawnSync("uv", ["run", "python", script], {
    cwd: path.resolve(siteRoot, ".."),
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `volumes-recompute.py failed (status ${res.status}): ${(res.stderr || "").slice(-800)}`,
    );
  }
  const parsed = JSON.parse(res.stdout);
  if (parsed.__error__) throw new Error(parsed.__error__);
  return parsed;
}

function runVolumeClaimLeg(errors, notes) {
  const pagePath = htmlFor("/coverage/");
  if (!fs.existsSync(pagePath)) return; // leg cm already reported this

  let truth;
  try {
    truth = recomputeVolumes();
  } catch (e) {
    errors.push(`leg cv: volume recompute failed — ${e.message}`);
    return;
  }
  if (truth.__skip__) {
    notes.push(`leg cv: ${truth.__skip__} (SKIP)`);
    return;
  }

  const root = parse(fs.readFileSync(pagePath, "utf8"), { comment: false });
  const row = root
    .querySelectorAll("[data-coverage-row]")
    .find((r) => r.getAttribute("data-coverage-row") === "program-pages");
  if (!row) {
    errors.push(
      'leg cv: /coverage/ has no "program-pages" row — the row whose blocker explains the un-detailed pages',
    );
    return;
  }
  const blocker = (row.querySelector("[data-coverage-blocker]")?.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const target = (row.querySelector("[data-coverage-target]")?.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const claim = `${blocker} ${target}`;
  const before = errors.length;

  const shortfall = truth.unparsed_orgs
    .map((o) => `${o}: ${truth.by_org[o].unparsed} of ${truth.by_org[o].on_disk}`)
    .join(", ");

  if (truth.unparsed > 0) {
    const absolute = claim.match(ABSOLUTE_NONPUBLICATION_RE);
    if (absolute) {
      errors.push(
        `leg cv: /coverage/ "program-pages" states outright that the source documents are ` +
          `unavailable ("${absolute[0]}") while ${truth.unparsed} FY2026 volume(s) sit ` +
          `DOWNLOADED AND UNPARSED in this repo (${shortfall}). ` +
          `e.g. ${truth.sample_unparsed.slice(0, 3).join(", ")}. ` +
          "That is an engineering backlog wearing a departmental-withholding label.",
      );
    }
    if (!BACKLOG_RE.test(claim)) {
      const blame = claim.match(BLAME_NONPUBLICATION_RE);
      errors.push(
        `leg cv: ${truth.unparsed} FY2026 volume(s) are downloaded and unparsed (${shortfall}), ` +
          'and the "program-pages" row never says so' +
          (blame
            ? ` — it offers non-publication ("${blame[0]}") as the entire explanation`
            : "") +
          `, so a reader is left to conclude the documents do not exist. ` +
          `Rendered: "${claim.slice(0, 200)}"`,
      );
    }
  } else if (BACKLOG_RE.test(claim)) {
    errors.push(
      'leg cv: every FY2026 volume on disk is ingested, but /coverage/ still claims an unparsed backlog — ' +
        "the correction has rotted into the opposite false claim. " +
        `Rendered: "${claim.slice(0, 200)}"`,
    );
  }

  // The confirming note is only true when nothing above fired. A "✓" printed
  // beside its own failure is how a gate teaches people to skim past it.
  notes.push(
    `leg cv volume claim: ${truth.ingested}/${truth.on_disk} FY2026 volumes ingested ` +
      `(${truth.duplicate ?? 0} of them duplicate covers of a parsed book), ` +
      `${truth.unparsed} unparsed (${truth.unparsed_orgs.join(", ") || "none"}) — ` +
      (errors.length === before
        ? "claim direction matches the disk↔lake reconciliation ✓"
        : `claim direction CONTRADICTS the disk↔lake reconciliation (${errors.length - before} error(s))`),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// leg cr — A PAGE MAY NOT RANK ENTITIES BY MONEY WHILE THEIR COVERAGE IS
//          UNEVEN, UNLESS IT SAYS SO (§P0-6)
// ═══════════════════════════════════════════════════════════════════════════
//
// The nastiest of the six reviewer findings, because it has no wrong number
// in it at all. /agency/ said "sorted by FY2026 total" and rendered:
//
//   Air Force  519 programs   $97.7B   <- first
//   Navy       397 programs   $46.8B   <- second
//   Army       507 programs   $43.1B
//
// Every one of those figures is a correctly cited sum. But fct_budget_lines'
// own fy_2026_total by organization is N $121.8B, F $98.7B, A $43.3B — the
// Navy is FIRST, by $23B. It renders at $46.8B because 11 of its 13 FY2026
// justification volumes are unparsed, i.e. ~38% coverage against ~99% for the
// Air Force and Army.
//
// So the falsehood is produced by the ACT OF SORTING correct-but-unevenly-
// covered figures against each other. There is no number for a
// number-vs-citation gate to catch, and no single page states the false
// claim — the ORDER states it.
//
// THE GENERAL FORM, which is what this leg encodes: a page that ranks
// entities by a money figure must not present that order as a ranking of the
// underlying quantity while the entities' coverage differs materially, unless
// the disparity is disclosed on the page.
//
// Truth is volumes-recompute.py again — the same disk↔lake reconciliation leg
// cv uses, which is upstream of agencies.json and of every figure the page
// renders. When the ingestion lands and no service has unparsed volumes, this
// leg stops requiring the disclosure.
//
// Wave 5 landed it. The Navy's five unparsed procurement appropriations are
// loaded, and measured against fct_budget_lines' own fy_2026_total the three
// services now sit at N 97.0%, F 99.0%, A 99.5% of their workbook totals —
// with the ingested order (N $118.1B > F $97.7B > A $43.1B) matching the
// workbook order (N $121.8B > F $98.7B > A $43.3B) exactly. So this leg no
// longer requires the disclosure. /agency/ keeps a short, true one anyway:
// the totals are still sums over what is loaded, and if a future edition
// arrives unevenly this leg turns the requirement back on rather than
// discovering that the page has meanwhile stopped saying so.

/** Words that would let the page claim a plain spending ranking. */
const BARE_RANK_RE = /sorted by (the )?FY\d{4} total\b(?!\s*this site has ingested)/i;

/** The disclosure that makes an uneven ranking honest. */
const UNEVEN_DISCLOSURE_RE =
  /\b(uneven|incomplete|not yet parsed|understates|has ingested|ingested)\b/i;

function runUnevenRankingLeg(errors, notes) {
  const pagePath = htmlFor("/agency/");
  if (!fs.existsSync(pagePath)) {
    notes.push("leg cr: out/agency/index.html not found (SKIP)");
    return;
  }

  let truth;
  try {
    truth = recomputeVolumes();
  } catch (e) {
    errors.push(`leg cr: volume recompute failed — ${e.message}`);
    return;
  }
  if (truth.__skip__) {
    notes.push(`leg cr: ${truth.__skip__} (SKIP)`);
    return;
  }

  // Only SERVICE orgs matter here: /agency/ ranks them against each other, and
  // a defense-wide agency book being complete says nothing about the Navy's.
  const uneven = truth.unparsed_orgs.filter((o) => ["a", "f", "n"].includes(o));
  const root = parse(fs.readFileSync(pagePath, "utf8"), { comment: false });
  // SCRIPTS OUT FIRST. root.text includes <script> contents, and on a Next
  // static export that means the RSC flight payload — the same sentence
  // re-serialized with every element boundary as a separate JSON string. The
  // first run of this leg failed the CORRECTED page on exactly that: the
  // visible lede reads "sorted by the FY2026 total this site has ingested",
  // whose qualifier the pattern exempts, but in the flight payload "sorted by
  // the FY2026 total" and the <strong> that qualifies it are different
  // strings, so the exemption could not see it. A gate must read what a
  // reader reads. (feed.mjs leg e already makes this exact point about text
  // nodes vs. server payload.)
  for (const el of root.querySelectorAll("script, style")) el.remove();
  const text = (root.text ?? "").replace(/\s+/g, " ");

  if (uneven.length === 0) {
    notes.push(
      `leg cr: every service's FY2026 volumes are ingested ` +
        `(${["a", "f", "n"]
          .filter((o) => truth.by_org[o])
          .map((o) => `${o}: ${truth.by_org[o].ingested}/${truth.by_org[o].on_disk}`)
          .join(", ")}) — an unqualified ranking on /agency/ would be honest ✓`,
    );
    return;
  }

  const shortfall = uneven
    .map((o) => `${o}: ${truth.by_org[o].unparsed} of ${truth.by_org[o].on_disk} unparsed`)
    .join(", ");

  const worst = uneven.reduce((a, b) =>
    truth.by_org[b].unparsed / truth.by_org[b].on_disk >
    truth.by_org[a].unparsed / truth.by_org[a].on_disk
      ? b
      : a,
  );
  const worstName = { a: "Army", f: "Air Force", n: "Navy" }[worst];

  const bare = text.match(BARE_RANK_RE);
  if (bare) {
    errors.push(
      `leg cr: /agency/ claims to be "${bare[0]}" while service ingestion is ` +
        `uneven (${shortfall}) — that order ranks ingestion completeness under ` +
        "a spending label",
    );
  }

  // THE DISCLOSURE MUST BE A SENTENCE, AND IT MUST NAME THE WORST SERVICE IN
  // THE SAME SENTENCE.
  //
  // Scoped to a real paragraph rather than the whole page, because a
  // whole-page scan passes on debris: the pre-fix page contains "Navy" (it is
  // a row in the table) and, after the column header was relabelled, would
  // contain "ingested" too (three words in a <span>). Either check alone would
  // then be satisfied by text that discloses nothing. Requiring ONE paragraph
  // to carry both the disclosure and the name is what a reader actually needs
  // — "coverage varies" without naming the service that is at 38% is a
  // disclosure nobody can act on.
  const MIN_DISCLOSURE_CHARS = 80;
  const paragraphs = root
    .querySelectorAll("p")
    .map((p) => (p.text ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= MIN_DISCLOSURE_CHARS);
  const disclosing = paragraphs.filter((t) => UNEVEN_DISCLOSURE_RE.test(t));

  if (disclosing.length === 0) {
    errors.push(
      `leg cr: /agency/ ranks services by a money figure with ${shortfall}, ` +
        "and no paragraph on the page discloses that the totals are what has " +
        "been loaded rather than what is requested",
    );
  } else if (
    !disclosing.some((t) => new RegExp(`\\b${worstName}\\b`, "i").test(t))
  ) {
    errors.push(
      `leg cr: /agency/ discloses uneven coverage but no disclosing paragraph ` +
        `names ${worstName}, whose ${truth.by_org[worst].unparsed} of ` +
        `${truth.by_org[worst].on_disk} unparsed volumes make it the most ` +
        `understated row on the page`,
    );
  }

  notes.push(
    `leg cr uneven ranking: ${uneven.length} service(s) with unparsed FY2026 ` +
      `volumes (${shortfall}); /agency/ ` +
      (errors.some((e) => e.startsWith("leg cr:"))
        ? "does NOT carry the disclosure that makes its order readable"
        : `states its totals are ingestion-limited and names ${worstName} ✓`),
  );
}
