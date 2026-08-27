/**
 * gate 1 — build_gate (mechanical checks on out/)
 *
 * Checks:
 * - program pages == programs.json count (data-driven: dim_programs +
 *   trajectory-only feed programs)
 * - agency pages == distinct orgs from agencies.json
 * - company pages == 200 (entities_top.json count)
 * - core pages present (/, /programs, /companies, /data, /flow, /downloads, /methodology, /glossary, /about)
 * - out/pagefind/pagefind.js exists
 * - sitemap URL count == emitted pages AND every URL starts with SITE_URL origin
 * - robots.txt present
 * - llms.txt contains /methodology/, /downloads/, ≥1 /program/ URL
 * - placeholder-origin scan (backlog #18): sitemap.xml / llms.txt /
 *   robots.txt / index.html must NOT contain govbudget-placeholder.example —
 *   UNCONDITIONAL (env-independent), unlike the sitemap-origin leg below
 *   which compares against the verify-time NEXT_PUBLIC_SITE_URL and would
 *   false-pass a placeholder build verified without the env
 * - citations.json key count == manifest citation total (from site_meta.json, data-driven)
 * - download cards: citations.parquet href == /citations/citations.parquet (not /data/)
 * - stale-literal check: built downloads page must NOT contain hardcoded "44,754"
 * - fact-permalink route (PM Sprint 1 Task 5, §P0-4): out/vercel.json exists
 *   AND carries the `/fact/:id` → `/fact/` rewrite AND out/fact/index.html
 *   exists — the deploy can never ship footnote permalinks that 404
 * - (f1) fact-permalink trailing slash (ROADMAP #61, Sprint C Task C2):
 *   out/vercel.json ALSO carries the `/fact/:id/` → `/fact/` rewrite — the
 *   unslashed form alone left /fact/{id}/ 404ing, the one form external
 *   citations (CMSes, link-checkers) normalize onto. Config-shape only; see
 *   the leg's own comment for what it does and does not prove
 * - page-weight budget (PM Sprint 3 §P2-1): per-page raw AND gzip ceilings
 *   over the singleton pages and the heaviest instance of each templated
 *   class — see PAGE_WEIGHT_BUDGET below for why it is per-page and not a
 *   total over out/
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const dataDir = path.resolve(siteRoot, "..", "data", "site");
const jsonDir = path.resolve(dataDir, "json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(p) {
  return fs.existsSync(p) && fs.statSync(p).isFile();
}

function dirExists(p) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

// ── Page-weight budget (PM-review Sprint 3 §P2-1) ───────────────────────────
//
// WHY THIS EXISTS. The PM review found the index pages shipping multi-megabyte
// documents. Measured at the start of Sprint 3, /programs/ was 5,875,345 bytes
// (442,874 gzipped) with all 1,741 rows inline — and it had GROWN, because
// Sprint 2's filter/sort/CSV work added markup nobody weighed. Weight is the
// kind of regression that arrives one honest feature at a time and is never
// anybody's bug, so it gets a number and a gate like every other claim here.
//
// WHAT IT PINS. A ceiling per PAGE, never a total over out/ — the corpus grows
// (1,993 program pages today, more with each service book) and a total-bytes
// budget would fail on growth rather than on weight. The templated classes are
// covered by their HEAVIEST built instance, so the whole fleet is measured
// without pretending a fixed instance stays the fattest.
//
// Ceilings sit a few percent above what the Sprint 3 build actually achieves
// (recorded in each entry) — close enough to catch a regression, loose enough
// that ordinary data movement does not trip it. RAISING one is a deliberate
// act that has to be justified in the same breath as the change that needs it.
//
// gzip is measured with zlib level 9 — the transfer size a reader pays. Raw is
// the parse/DOM cost, which is what actually hurts a phone, so both are pinned.
export const PAGE_WEIGHT_BUDGET = [
  // Singleton pages. `measured` is the Sprint 3 post-fix build.
  // Re-baselined 2026-08-21 (Sprint E). The key split gives each
  // (account, pe_bli) pair its own row: 10 legitimate new programs worth
  // $5.35B — LPD Flight II $2.60B, Medium Landing Ship $1.96B — plus
  // corrected figures on the six rows that were previously publishing a
  // fused total. 277,357 -> 279,513 gzip.
  //
  // NOTE THE HEADROOM, not just the number. This entry's gzip ceiling was
  // set at 278,000 against a 261,871 measurement — 6.2% headroom — and
  // ordinary corpus growth ate it down to 0.23% (643 bytes) without anyone
  // noticing, which is why ten new rows breached it instantly. Restoring
  // 6.2% rather than the 0.23% that had drifted in: re-baselining to the
  // CURRENT proportional headroom would hand the next change the same
  // cliff. Gate 1's near-ceiling note (added 2026-08-14) is what stops
  // this recurring silently.
  { label: "/programs/", file: "programs/index.html", maxRaw: 2_850_000, maxGzip: 297_000, measured: "2,679,496 / 282,201" },
  { label: "/years/", file: "years/index.html", maxRaw: 45_000, maxGzip: 9_000, measured: "31,765 / 6,365" },
  { label: "/feed/", file: "feed/index.html", maxRaw: 1_700_000, maxGzip: 92_000, measured: "1,502,947 / 77,147" },
  { label: "/", file: "index.html", maxRaw: 1_330_000, maxGzip: 84_000, measured: "1,255,520 / 82,058" },
  { label: "/companies/", file: "companies/index.html", maxRaw: 710_000, maxGzip: 69_000, measured: "683,551 / 67,130" },
  { label: "/district/", file: "district/index.html", maxRaw: 265_000, maxGzip: 30_000, measured: "262,202 / 28,199" },
  { label: "/companies/families/", file: "companies/families/index.html", maxRaw: 226_000, maxGzip: 26_000, measured: "223,384 / 25,390" },
  { label: "/data/", file: "data/index.html", maxRaw: 95_000, maxGzip: 13_500, measured: "92,468 / 13,152" },
  // New page, Sprint C Task C3 (ROADMAP #62) — the /agency/ index (23 rows,
  // two <Cite> figures each). Same ~8% headroom convention as the other
  // section indexes above (/district/, /companies/families/) rather than a
  // round-number guess.
  { label: "/agency/", file: "agency/index.html", maxRaw: 190_000, maxGzip: 48_500, measured: "180,412 / 47,253" },
  // Re-baselined 2026-08-08 (Sprint A′). The 2026-08-08 corrections table added
  // ~16.3 KB raw / ~4.1 KB gzip: six was/now rows recording the figures this
  // sprint moved (district $8.01B→$5.58B, mentions 34,538→10,447, the /programs/
  // denominator, stated lineage edges 31→29, the FY2026 reconciliation split,
  // and the R-1 basis chip). The page is heavier because it now documents six
  // corrections — that is this page's job, and trimming the disclosure to fit a
  // budget would be the wrong trade. Ceilings carry the SAME proportional
  // headroom the previous pair did (raw ×1.1215, gzip ×1.0986), so the budget
  // still catches unintended growth from here.
  //
  // Re-baselined 2026-08-24 (ROADMAP #69) — CEILING RAISED, STATED PLAINLY.
  // The 2026-08-08 pair above was set against 125,112 / 33,863. By this
  // build the page had drifted to 127,800 / 34,494 WITHOUT the #69 row:
  // SIX bytes of gzip headroom (0.017%), the identical cliff /coverage/ hit
  // at nine bytes and /programs/ at 643. The near-ceiling note added
  // 2026-08-14 is doing its job — this page has been reported at 99.9% —
  // but a note is not a re-baseline, and any addition at all now fails.
  //
  // #69's seventh corrections row costs 853 raw / 267 gzip. The 2026-08-08
  // entry's own rule applies unchanged: "The page is heavier because it now
  // documents six corrections — that is this page's job, and trimming the
  // disclosure to fit a budget would be the wrong trade." It documents
  // seven now. So the row stays and the ceiling moves, rather than the
  // correction being written short enough to fit.
  //
  // Restoring ~6% headroom against the new measurement (the /programs/
  // Sprint E rule: re-baselining to the CURRENT proportional headroom hands
  // the next change the same cliff), not a round-number guess.
  { label: "/methodology/", file: "methodology/index.html", maxRaw: 136_500, maxGzip: 36_900, measured: "132,816 / 36,175" },
  // Task 6 (§Coverage). Twelve rows of prose; it grows a paragraph at a time
  // as features land, which is exactly the shape §P2-1 wants weighed.
  //
  // Re-baselined 2026-08-13 (Sprint C). This page had drifted to 16,491 of its
  // 16,500 gzip ceiling — NINE bytes of headroom — through ordinary prose growth
  // across prior sprints, without anyone noticing it was that close. Sprint C's
  // sitewide footer link to the new /glossary/ costs ~22 gzip bytes on every
  // page and tipped it to 16,513 (+13).
  //
  // The link is not optional: a glossary a reader cannot find is not shipped,
  // and the alternative — trimming /coverage/'s prose to buy back 13 bytes —
  // would cut disclosure to satisfy a budget, which is the wrong direction on
  // the page whose job is stating what the corpus does and does not cover.
  // Verified irreducible: a plain <a> costs the same as next/link, because the
  // layout's Server Component tree is duplicated into the RSC flight payload
  // regardless of element type.
  //
  // Both ceilings re-derived at the SAME proportional headroom the previous
  // pair carried (raw ×1.0708, gzip ×1.0742), so the budget still catches
  // unintended growth from here rather than being merely widened.
  { label: "/coverage/", file: "coverage/index.html", maxRaw: 96_000, maxGzip: 17_700, measured: "90,282 / 16,540" },
  // Templated classes — the heaviest built instance of each.
  { label: "/agency/*/ (heaviest)", dir: "agency", maxRaw: 2_060_000, maxGzip: 137_000, measured: "1,564,881 / 111,886 (/agency/F/)" },
  { label: "/program/*/ (heaviest)", dir: "program", maxRaw: 1_180_000, maxGzip: 151_000, measured: "1,108,222 / 142,041 (/program/0601102A/)" },
  { label: "/company/*/ (heaviest)", dir: "company", maxRaw: 545_000, maxGzip: 25_000, measured: "374,061 / 22,734 (/company/general-electric/)" },
  { label: "/filing/*/ (heaviest)", dir: "filing", maxRaw: 325_000, maxGzip: 27_500, measured: "301,669 / 26,484 (/filing/e4077ecc/)" },
];

/** raw + gzip(level 9) bytes of one built file. */
function weigh(absPath) {
  const buf = fs.readFileSync(absPath);
  return { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length };
}

/**
 * Resolve a budget entry to the ONE file it measures: the named file, or the
 * heaviest index.html in a templated directory (raw size picks the candidate —
 * cheap over 4,394 filings — and only that one gets gzipped).
 */
function resolveBudgetTarget(entry) {
  if (entry.file) {
    const p = path.join(outDir, entry.file);
    return fileExists(p) ? { path: p, rel: entry.file } : null;
  }
  const base = path.join(outDir, entry.dir);
  if (!dirExists(base)) return null;
  let worst = null;
  for (const slug of fs.readdirSync(base)) {
    const p = path.join(base, slug, "index.html");
    let size;
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    if (!worst || size > worst.size) {
      worst = { size, path: p, rel: path.join(entry.dir, slug, "index.html") };
    }
  }
  return worst;
}

/** The leg. Returns {errors, notes} so runBuildGate can fold them in. */
/** Gzip-ceiling usage at or above which a page is reported as near-ceiling. */
const NEAR_CEILING_PCT = 90;

export function checkPageWeight() {
  const errors = [];
  const notes = [];
  const lines = [];
  const nearCeiling = [];

  for (const entry of PAGE_WEIGHT_BUDGET) {
    const target = resolveBudgetTarget(entry);
    if (!target) {
      errors.push(
        `page weight: ${entry.label} — nothing built to measure (${entry.file ?? `out/${entry.dir}/*/index.html`})`
      );
      continue;
    }
    const { raw, gzip } = weigh(target.path);
    if (raw > entry.maxRaw) {
      errors.push(
        `page weight: ${entry.label} is ${raw.toLocaleString()} bytes, over its ${entry.maxRaw.toLocaleString()}-byte ceiling (+${(raw - entry.maxRaw).toLocaleString()}) — measured at ${entry.measured} when the ceiling was set [${target.rel}]`
      );
    }
    if (gzip > entry.maxGzip) {
      errors.push(
        `page weight: ${entry.label} is ${gzip.toLocaleString()} bytes gzipped, over its ${entry.maxGzip.toLocaleString()}-byte ceiling (+${(gzip - entry.maxGzip).toLocaleString()}) — measured at ${entry.measured} when the ceiling was set [${target.rel}]`
      );
    }
    // NEAR-CEILING WARNING (2026-08-14). A ceiling is a cliff: it says nothing
    // until it says FAIL. /coverage/ drifted to NINE bytes of headroom through
    // ordinary prose growth and nobody knew until a one-line footer link tipped
    // it, and /methodology/ did the same thing a week earlier. Worse, every
    // `measured` string in this file had gone stale — /programs/ recorded
    // 261,871 while actually shipping 277,357, so the file itself told a reader
    // there was 6% headroom where there was 0.2%. The strings were refreshed
    // 2026-08-14; this note is what stops them rotting again unnoticed.
    //
    // A NOTE, not an error: six pages are legitimately above 94% today, and
    // failing on that would be inventing a stricter budget than anyone agreed
    // to. It is early warning, so the next person to add a sentence knows
    // before they spend an hour on the build that fails.
    const pctUsed = (100 * gzip) / entry.maxGzip;
    if (pctUsed >= NEAR_CEILING_PCT) {
      nearCeiling.push(
        `${entry.label} ${pctUsed.toFixed(1)}% (${gzip.toLocaleString()}/${entry.maxGzip.toLocaleString()} gzip, ${(entry.maxGzip - gzip).toLocaleString()} bytes left)`
      );
    }
    // ANNOTATION-DRIFT LEG (2026-08-24). The `measured` strings above are
    // the only page-weight facts a human reads WITHOUT running a build, and
    // they have now gone stale twice: /programs/ on 2026-08-14 (261,871
    // recorded against 277,357 shipped) and /filing/*/ today (21,784
    // recorded, 26,526 actual — the file promised 5,716 bytes of room where
    // there were 974). The near-ceiling note above was written to "stop them
    // rotting again unnoticed" and structurally cannot: it reports the LIVE
    // percentage and never compares it to what is written down, so a wrong
    // annotation stays wrong and quietly informs the next person's decision.
    // It informed one on 2026-08-24 — /methodology/ was reported as having
    // 637 bytes of headroom off a stale string when it had 6.
    //
    // Fires only on OVERSTATED headroom, and only past 2x. Understating is
    // harmless (someone trims when they needn't have), and small drift is
    // ordinary data movement — erroring on that would be failing on growth
    // rather than on weight, which this file's own header rules out.
    const ann = /^\s*([\d,]+)\s*\/\s*([\d,]+)/.exec(entry.measured ?? "");
    if (ann) {
      const annGzip = Number(ann[2].replace(/,/g, ""));
      const annLeft = entry.maxGzip - annGzip;
      const realLeft = entry.maxGzip - gzip;
      if (annLeft > 0 && realLeft > 0 && annLeft > 2 * realLeft) {
        errors.push(
          `page weight: ${entry.label}'s recorded measurement overstates its headroom — the entry says ${annGzip.toLocaleString()} gzip (${annLeft.toLocaleString()} bytes left) but the page weighs ${gzip.toLocaleString()} (${realLeft.toLocaleString()} left, ${(annLeft / realLeft).toFixed(1)}x less than recorded). Re-measure the entry — do NOT raise the ceiling to match [${target.rel}]`
        );
      }
    }
    lines.push(
      `${entry.label} ${raw.toLocaleString()}/${gzip.toLocaleString()}`
    );
  }

  if (nearCeiling.length > 0) {
    notes.push(
      `page weight: ${nearCeiling.length} page(s) at or above ${NEAR_CEILING_PCT}% of the gzip ceiling — ${nearCeiling.join("; ")}`
    );
  }
  if (errors.length === 0) {
    notes.push(
      `page weight: ${PAGE_WEIGHT_BUDGET.length} page budgets within ceiling ✓ (raw/gzip: ${lines.slice(0, 3).join("; ")}; …)`
    );
  }
  return { errors, notes };
}

export async function runBuildGate() {
  const errors = [];
  const notes = [];

  // ── Load sidecars ────────────────────────────────────────────────────────
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  const agencies = readJson(path.join(jsonDir, "agencies.json"));
  const siteMeta = readJson(path.join(jsonDir, "site_meta.json"));

  // Phase 5F §2a: the program-page universe is EVERY program_details sidecar
  // (full tier from programs.json + rollup tier), recomputed here
  // independently of src/. Zero-content pages (no details/narratives/awards/
  // mentions and every figure zero) are built but noindex — excluded from
  // the sitemap, so the two counts differ.
  const detailsDir = path.join(jsonDir, "program_details");
  const programSlugs = dirExists(detailsDir)
    ? fs.readdirSync(detailsDir).filter((f) => f.endsWith(".json"))
    : [];
  const programCount = programSlugs.length;
  let zeroContentCount = 0;
  for (const f of programSlugs) {
    try {
      const d = readJson(path.join(detailsDir, f));
      const hasContent =
        (d.details ?? []).length > 0 ||
        (d.narratives ?? []).length > 0 ||
        (d.awards ?? []).length > 0 ||
        (d.mentions ?? []).length > 0;
      if (hasContent) continue;
      const figures = (d.budget_lines ?? []).map((bl) => bl.amount_thousands);
      const t = d.trajectory;
      if (t) {
        for (const v of [t.fy2024_actuals, t.fy2025_total, t.fy2026_total]) {
          if (v !== null && v !== undefined) figures.push(v);
        }
      }
      if (figures.every((v) => v === 0)) zeroContentCount++;
    } catch {
      errors.push(`program sidecar unreadable: ${f}`);
    }
  }
  // Sprint E, Task E3 (ROADMAP #67): the 8 genuine appropriation-account
  // collisions each get a bare-pe_bli disambiguation STUB page in addition
  // to their program_details sidecars — a stub carries no sidecar of its
  // own (program-skeleton.mjs's gate 21 would otherwise demand the full
  // 13-section skeleton from a page that isn't a program at all), so it is
  // invisible to programCount above. Derived from programs.json's own
  // pe_bli duplicates — never hand-counted — so a future re-key changes
  // this automatically.
  const pesSeen = new Map();
  for (const p of programs) pesSeen.set(p.pe_bli, (pesSeen.get(p.pe_bli) ?? 0) + 1);
  const stubCount = [...pesSeen.values()].filter((n) => n > 1).length;

  const sitemapProgramCount = programCount - zeroContentCount + stubCount;

  const companyCount = entities.length;
  const agencyCount = agencies.length;
  const citationTotal = siteMeta.counts?.citations ?? 0;

  notes.push(
    `sidecars: ${programCount} program pages (${programs.length} full tier, ` +
      `${zeroContentCount} zero-content/noindex), ${companyCount} companies, ` +
      `${agencyCount} agencies, ${citationTotal} citations`
  );

  // ── out/ exists ──────────────────────────────────────────────────────────
  if (!dirExists(outDir)) {
    errors.push(`out/ directory not found at ${outDir}`);
    return { pass: false, errors, notes };
  }

  // ── Build staleness check ─────────────────────────────────────────────────
  // out/.build-meta.json is written by scripts/write-build-meta.mjs (postbuild).
  // Gate verifies: (a) marker exists, (b) git HEAD matches, (c) marker mtime is
  // newer than the newest watched source file — catches stale out/ after src edits.
  {
    const markerPath = path.join(outDir, ".build-meta.json");
    if (!fileExists(markerPath)) {
      errors.push(
        "out/.build-meta.json missing — out/ was not produced by a complete build " +
          "(re-run `npm run build`)"
      );
    } else {
      let marker;
      try {
        marker = readJson(markerPath);
      } catch (e) {
        errors.push(`out/.build-meta.json is corrupt: ${e.message}`);
        marker = null;
      }
      if (marker) {
        // (b) git HEAD check
        let currentHead = "unknown";
        try {
          const { execSync } = await import("child_process");
          currentHead = execSync("git rev-parse HEAD", {
            cwd: siteRoot,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
        } catch {
          // non-fatal if git unavailable
        }
        if (
          currentHead !== "unknown" &&
          marker.git_head !== "unknown" &&
          currentHead !== marker.git_head
        ) {
          errors.push(
            `out/.build-meta.json git_head mismatch: built from ${marker.git_head.slice(0, 8)}, ` +
              `current HEAD is ${currentHead.slice(0, 8)} — re-run \`npm run build\``
          );
        } else {
          notes.push(`build-meta git_head: ${marker.git_head.slice(0, 8)} ✓`);
        }

        // (c) mtime freshness: marker mtime must be newer than source max mtime.
        // This catches the "touched src file after build" failure mode.
        const markerMtime = fs.statSync(markerPath).mtimeMs;
        function maxMtimeGate(dirOrFile) {
          if (!fs.existsSync(dirOrFile)) return 0;
          const st = fs.lstatSync(dirOrFile);
          if (!st.isDirectory()) return st.mtimeMs;
          let mx = st.mtimeMs;
          for (const entry of fs.readdirSync(dirOrFile, { withFileTypes: true })) {
            if (["node_modules", ".next", "out"].includes(entry.name)) continue;
            mx = Math.max(mx, maxMtimeGate(path.join(dirOrFile, entry.name)));
          }
          return mx;
        }
        const watchedPaths = [
          path.join(siteRoot, "src"),
          path.join(siteRoot, "public"),
          path.join(siteRoot, "package.json"),
          path.join(siteRoot, "next.config.ts"),
          path.join(siteRoot, "tsconfig.json"),
          path.join(siteRoot, "postcss.config.mjs"),
        ];
        const sourceMax = Math.max(...watchedPaths.map(maxMtimeGate));
        if (markerMtime < sourceMax) {
          const staleBy = ((sourceMax - markerMtime) / 1000).toFixed(1);
          errors.push(
            `out/ is stale: a source file is ${staleBy}s newer than out/.build-meta.json ` +
              `(source_max=${new Date(sourceMax).toISOString()}, ` +
              `marker=${new Date(markerMtime).toISOString()}) — re-run \`npm run build\``
          );
        } else {
          notes.push("build freshness: out/ is newer than all watched source files ✓");
        }
      }
    }
  }

  // ── Program pages ────────────────────────────────────────────────────────
  const programOut = path.join(outDir, "program");
  if (!dirExists(programOut)) {
    errors.push("out/program/ directory not found");
  } else {
    const builtPblis = fs.readdirSync(programOut).filter((d) => {
      return fs.statSync(path.join(programOut, d)).isDirectory();
    });
    // Sprint E, Task E3: + stubCount — the 8 split-key bare-pe_bli
    // disambiguation pages are real, built out/program/{pe_bli}/ directories
    // with no program_details sidecar (see stubCount's own comment above).
    const expectedProgramPages = programCount + stubCount;
    if (builtPblis.length !== expectedProgramPages) {
      errors.push(
        `program pages: found ${builtPblis.length}, expected ${expectedProgramPages} ` +
          `(${programCount} sidecar-backed + ${stubCount} split-key stubs)`
      );
    } else {
      notes.push(`program pages: ${builtPblis.length} ✓ (incl. ${stubCount} split-key stubs)`);
    }
  }

  // ── Agency pages ─────────────────────────────────────────────────────────
  const agencyOut = path.join(outDir, "agency");
  if (!dirExists(agencyOut)) {
    errors.push("out/agency/ directory not found");
  } else {
    const builtOrgs = fs.readdirSync(agencyOut).filter((d) => {
      return fs.statSync(path.join(agencyOut, d)).isDirectory();
    });
    if (builtOrgs.length !== agencyCount) {
      errors.push(
        `agency pages: found ${builtOrgs.length}, expected ${agencyCount}`
      );
    } else {
      notes.push(`agency pages: ${builtOrgs.length} ✓`);
    }
  }

  // ── Company pages ─────────────────────────────────────────────────────────
  const companyOut = path.join(outDir, "company");
  if (!dirExists(companyOut)) {
    errors.push("out/company/ directory not found");
  } else {
    const builtSlugs = fs.readdirSync(companyOut).filter((d) => {
      return fs.statSync(path.join(companyOut, d)).isDirectory();
    });
    if (builtSlugs.length !== companyCount) {
      errors.push(
        `company pages: found ${builtSlugs.length}, expected ${companyCount}`
      );
    } else {
      notes.push(`company pages: ${builtSlugs.length} ✓`);
    }
  }

  // ── Core pages ────────────────────────────────────────────────────────────
  const corePages = [
    { path: "index.html", label: "/" },
    { path: path.join("programs", "index.html"), label: "/programs/" },
    { path: path.join("companies", "index.html"), label: "/companies/" },
    { path: path.join("data", "index.html"), label: "/data/" },
    { path: path.join("flow", "index.html"), label: "/flow/" },
    { path: path.join("downloads", "index.html"), label: "/downloads/" },
    { path: path.join("methodology", "index.html"), label: "/methodology/" },
    { path: path.join("glossary", "index.html"), label: "/glossary/" },
    // Sprint C Task C3 (ROADMAP #62) — the /agency/ index.
    { path: path.join("agency", "index.html"), label: "/agency/" },
    { path: path.join("about", "index.html"), label: "/about/" },
  ];
  for (const { path: rel, label } of corePages) {
    if (!fileExists(path.join(outDir, rel))) {
      errors.push(`core page missing: ${label}`);
    }
  }
  const missingCore = corePages.filter((c) => !fileExists(path.join(outDir, c.path)));
  if (missingCore.length === 0) {
    notes.push(`core pages: all ${corePages.length} present ✓`);
  }

  // ── Pagefind bundle ───────────────────────────────────────────────────────
  const pagefindJs = path.join(outDir, "pagefind", "pagefind.js");
  if (!fileExists(pagefindJs)) {
    errors.push("out/pagefind/pagefind.js not found — run `npm run build` (includes postbuild pagefind)");
  } else {
    notes.push("pagefind/pagefind.js ✓");
  }

  // ── Sitemap ───────────────────────────────────────────────────────────────
  // Next.js static export from app/sitemap.ts → out/sitemap.xml
  let sitemapContent = null;
  const sitemapCandidates = [
    path.join(outDir, "sitemap.xml"),
    path.join(outDir, "sitemap", "index.html"),
  ];
  for (const cand of sitemapCandidates) {
    if (fileExists(cand)) {
      sitemapContent = fs.readFileSync(cand, "utf8");
      break;
    }
  }

  if (!sitemapContent) {
    errors.push("sitemap.xml not found in out/ (tried sitemap.xml and sitemap/index.html)");
  } else {
    // Count <url> entries
    const urlMatches = sitemapContent.match(/<url>/g) || [];
    const sitemapCount = urlMatches.length;

    // Compute district page count from sidecar (0 if not yet generated)
    let districtPageCount = 0;
    try {
      const districtIndex = readJson(path.join(jsonDir, "districts", "index.json"));
      // +1 for /district/ index page, +N for each district detail page
      districtPageCount = 1 + (districtIndex.total_districts ?? 0);
    } catch {
      // sidecars not generated — only count the base /district/ page if it exists
      // but since the route needs params, it won't be in the sitemap when count=0.
    }
    // Compute filing page count from sidecar (Task 6a): /filings/ index +
    // ONLY mention-bearing filings (zero-mention filings are noindex and
    // deliberately excluded from the sitemap).
    let filingPageCount = 0;
    try {
      const filingsIndex = readJson(path.join(jsonDir, "filings_index.json"));
      const withMentions = (filingsIndex.filings ?? []).filter(
        (f) => f.has_mentions
      ).length;
      filingPageCount = 1 + withMentions;
    } catch {
      // sidecars not generated — no filing URLs expected
    }
    // Expected: static(12) + feed(1) + district pages + filing pages + programs + companies + agencies
    // static(12) = /, /programs/, /companies/, /companies/families/, /data/,
    //              /flow/, /downloads/, /methodology/, /glossary/, /agency/,
    //              /coverage/, /about/
    // (/flow/ added in Phase 5H; /companies/families/ added in PM Sprint 2
    //  §P1-3 — the curated rename/acquisition table; /coverage/ in Sprint 3
    //  Task 6 — the roadmap page; /glossary/ in Sprint C Task C1 — ROADMAP
    //  #60, term definitions; /agency/ in Sprint C Task C3 — ROADMAP #62,
    //  the /agency/{org}/ index, counted separately from the ${agencyCount}
    //  dynamic /agency/{org}/ pages below.)
    // Programs: page universe MINUS zero-content noindex pages (5F policy —
    // built but excluded from the sitemap, like zero-mention filings).
    const STATIC_SITEMAP_PAGES = 12;
    const expectedTotal =
      STATIC_SITEMAP_PAGES + 1 + districtPageCount + filingPageCount + sitemapProgramCount + companyCount + agencyCount;
    if (sitemapCount !== expectedTotal) {
      errors.push(
        `sitemap URL count: found ${sitemapCount}, expected ${expectedTotal} (${STATIC_SITEMAP_PAGES} static + 1 feed + ${districtPageCount} district + ${filingPageCount} filing + ${sitemapProgramCount} programs (${programCount} pages − ${zeroContentCount} zero-content noindex) + ${companyCount} companies + ${agencyCount} agencies)`
      );
    } else {
      notes.push(`sitemap: ${sitemapCount} URLs ✓ (${zeroContentCount} zero-content program page(s) excluded)`);
    }

    // Check all URLs start with SITE_URL origin
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://govbudget-placeholder.example";
    const origin = new URL(siteUrl).origin;
    const locMatches = sitemapContent.match(/<loc>([^<]+)<\/loc>/g) || [];
    const badUrls = locMatches.filter((m) => {
      const loc = m.replace(/<\/?loc>/g, "");
      return !loc.startsWith(origin);
    });
    if (badUrls.length > 0) {
      errors.push(
        `sitemap: ${badUrls.length} URLs do not start with origin ${origin}. First: ${badUrls[0]}`
      );
    } else if (locMatches.length > 0) {
      notes.push(`sitemap origins: all start with ${origin} ✓`);
    }
  }

  // ── robots.txt ────────────────────────────────────────────────────────────
  // Next.js static export from app/robots.ts → out/robots.txt
  const robotsCandidates = [
    path.join(outDir, "robots.txt"),
    path.join(outDir, "robots", "index.html"),
  ];
  let robotsFound = false;
  for (const cand of robotsCandidates) {
    if (fileExists(cand)) {
      robotsFound = true;
      notes.push("robots.txt ✓");
      break;
    }
  }
  if (!robotsFound) {
    errors.push("robots.txt not found in out/");
  }

  // ── llms.txt ─────────────────────────────────────────────────────────────
  const llmsTxt = path.join(outDir, "llms.txt");
  if (!fileExists(llmsTxt)) {
    errors.push("llms.txt not found in out/");
  } else {
    const content = fs.readFileSync(llmsTxt, "utf8");
    const checks = [
      { pattern: "/methodology/", label: "/methodology/" },
      { pattern: "/downloads/", label: "/downloads/" },
    ];
    for (const { pattern, label } of checks) {
      if (!content.includes(pattern)) {
        errors.push(`llms.txt missing ${label}`);
      }
    }
    const programLineRe = /\/program\/[A-Z0-9]+\//;
    if (!programLineRe.test(content)) {
      errors.push("llms.txt has no /program/... URL");
    } else {
      notes.push("llms.txt: /methodology/ + /downloads/ + /program/... ✓");
    }
  }

  // ── Placeholder-origin scan (backlog #18) ─────────────────────────────────
  // A build without NEXT_PUBLIC_SITE_URL bakes https://govbudget-placeholder
  // .example into sitemap/llms.txt/canonicals (src/lib/site.ts fallback).
  // The sitemap-origin check above is relative to the verify-time env — and
  // falls back to the SAME placeholder, so a placeholder build verified in a
  // placeholder env would false-pass it. This scan is UNCONDITIONAL: the
  // production artifacts must never contain the placeholder host, no matter
  // what origin this verify run was given.
  {
    const PLACEHOLDER_HOST = "govbudget-placeholder.example";
    const scanTargets = ["sitemap.xml", "llms.txt", "robots.txt", "index.html"];
    let scanned = 0;
    let hits = 0;
    for (const rel of scanTargets) {
      const p = path.join(outDir, rel);
      if (!fileExists(p)) continue; // absence is reported by each file's own leg
      scanned++;
      if (fs.readFileSync(p, "utf8").includes(PLACEHOLDER_HOST)) {
        hits++;
        errors.push(
          `placeholder origin: out/${rel} contains "${PLACEHOLDER_HOST}" — ` +
            "the site was built without NEXT_PUBLIC_SITE_URL; rebuild with the production origin"
        );
      }
    }
    if (hits === 0) {
      notes.push(`placeholder scan: ${scanned}/${scanTargets.length} artifacts free of ${PLACEHOLDER_HOST} ✓`);
    }
  }

  // ── Fact-permalink route (PM Sprint 1 Task 5, spec §P0-4) ─────────────────
  // The footnote formatter emits https://…/fact/{fid8} permalinks (gate 23
  // leg c goldens). Those URLs resolve ONLY when the deploy root carries the
  // Vercel rewrite AND the /fact/ resolver page built. out/ is the deploy
  // root (`vercel --prod` from site/out), and Next copies public/vercel.json
  // into out/ — so both artifacts must be in out/ or the permalinks 404.
  {
    const vercelJsonPath = path.join(outDir, "vercel.json");
    let vercelConfig = null;
    if (!fileExists(vercelJsonPath)) {
      errors.push(
        "fact permalinks: out/vercel.json missing — /fact/{id} URLs will 404 on deploy " +
          "(site/public/vercel.json must ship the /fact/:id rewrite)"
      );
    } else {
      let rewriteOk = false;
      try {
        vercelConfig = readJson(vercelJsonPath);
        rewriteOk = (vercelConfig.rewrites ?? []).some(
          (r) => r.source === "/fact/:id" && r.destination === "/fact/"
        );
      } catch (e) {
        errors.push(`fact permalinks: out/vercel.json is corrupt: ${e.message}`);
      }
      if (!rewriteOk) {
        errors.push(
          'fact permalinks: out/vercel.json lacks the {"source": "/fact/:id", "destination": "/fact/"} rewrite'
        );
      } else {
        notes.push("fact permalinks: /fact/:id rewrite present in out/vercel.json ✓");
      }

      // (f1) ROADMAP #61: /fact/{id}/ (trailing slash) 404ed in production
      // — verified live 2026-08-13: unslashed 200s, slashed 404s, even
      // though every OTHER route on the site canonically ends in a slash
      // (next.config.ts trailingSlash:true) and CMSes/link-checkers
      // normalize trailing slashes onto URLs routinely. Root cause,
      // confirmed against live Vercel routing rather than assumed: a curl
      // of the slashed URL returned Vercel's literal 404.html
      // (content-disposition: filename="404.html"), not the rewritten fact
      // page (content-disposition: filename="fact") — proving the
      // `/fact/:id` rewrite never fires for a slash-terminated request on
      // Vercel's edge, even though the open-source path-to-regexp@6
      // library's OWN default compile of that same source string DOES
      // match a trailing slash (checked locally against
      // node_modules/msw's path-to-regexp@6.3.0) — Vercel's actual
      // matching is stricter than the library's default. The fix is a
      // second, explicit literal rule for the slashed form.
      //
      // WHAT THIS LEG PROVES: only that out/vercel.json's rewrite array
      // carries that second rule (config shape) — NOT that Vercel's edge
      // honors it post-deploy. Nothing in this repo can prove the live
      // routing behaviour: scripts/serve-static.mjs (the server every
      // other local gate drives) never reads vercel.json and implements
      // only its own filesystem trailing-slash fallback
      // ($uri → $uri/index.html → $uri.html → 404.html) — per its own
      // docstring it doesn't apply Vercel rewrites at all, so it 404s on
      // BOTH /fact/{id} and /fact/{id}/ alike (there is no
      // out/fact/{id}/index.html for either) and cannot distinguish
      // "rewrite present" from "rewrite absent" for either form. A gate
      // built on that server would pass for the wrong reason. The live
      // curl above is the only behavioural evidence there is; re-check
      // production the same way after deploy.
      if (vercelConfig) {
        const slashedRewriteOk = (vercelConfig.rewrites ?? []).some(
          (r) => r.source === "/fact/:id/" && r.destination === "/fact/"
        );
        if (!slashedRewriteOk) {
          errors.push(
            'fact permalinks (f1): out/vercel.json lacks the {"source": "/fact/:id/", ' +
              '"destination": "/fact/"} rewrite — /fact/{id}/ (trailing slash) will 404 ' +
              "on deploy (ROADMAP #61)"
          );
        } else {
          notes.push(
            "fact permalinks (f1): /fact/:id/ (trailing-slash) rewrite present in out/vercel.json ✓"
          );
        }
      }
    }
    if (!fileExists(path.join(outDir, "fact", "index.html"))) {
      errors.push(
        "fact permalinks: out/fact/index.html missing — the /fact/ resolver page did not build"
      );
    } else {
      notes.push("fact permalinks: out/fact/index.html present ✓");
    }
  }

  // ── citations.json key count ──────────────────────────────────────────────
  const citationsPath = path.join(jsonDir, "citations.json");
  if (!fileExists(citationsPath)) {
    errors.push("citations.json not found in data/site/json/");
  } else {
    const citations = readJson(citationsPath);
    const citationKeys = Object.keys(citations).length;
    if (citationTotal === 0) {
      errors.push("site_meta.json counts.citations is 0 — re-run export-site");
    } else if (citationKeys !== citationTotal) {
      errors.push(
        `citations.json: ${citationKeys} keys, expected ${citationTotal} (from site_meta.json)`
      );
    } else {
      notes.push(`citations.json: ${citationKeys} keys == ${citationTotal} total ✓`);
    }
  }

  // ── Download-href check ───────────────────────────────────────────────────
  // The built downloads page must use /citations/citations.parquet (not /data/).
  const downloadsHtml = path.join(outDir, "downloads", "index.html");
  if (!fileExists(downloadsHtml)) {
    errors.push("out/downloads/index.html not found — cannot check download hrefs");
  } else {
    const dlContent = fs.readFileSync(downloadsHtml, "utf8");
    // Verify the citations parquet link points to /citations/ not /data/
    if (dlContent.includes("/data/citations.parquet")) {
      errors.push(
        "downloads page contains stale href /data/citations.parquet — should be /citations/citations.parquet"
      );
    } else if (dlContent.includes("citations.parquet")) {
      notes.push("download href: citations.parquet points to /citations/ ✓");
    } else {
      // Could be asset-URL-resolved at runtime; don't error, just note
      notes.push("download href: citations.parquet not found in static HTML (runtime asset URL)");
    }

    // Stale-literal check: must NOT contain hardcoded "44,754"
    if (dlContent.includes("44,754")) {
      errors.push(
        "downloads page contains stale literal \"44,754\" — counts must be data-driven from site_meta.json"
      );
    } else {
      notes.push("stale-literal check: no hardcoded \"44,754\" in downloads page ✓");
    }
  }

  // ── Page-weight budget (§P2-1) ────────────────────────────────────────────
  {
    const w = checkPageWeight();
    errors.push(...w.errors);
    notes.push(...w.notes);
  }

  return { pass: errors.length === 0, errors, notes };
}
