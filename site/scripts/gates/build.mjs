/**
 * gate 1 — build_gate (mechanical checks on out/)
 *
 * Checks:
 * - program pages == programs.json count (data-driven: dim_programs +
 *   trajectory-only feed programs)
 * - agency pages == distinct orgs from agencies.json
 * - company pages == 200 (entities_top.json count)
 * - core pages present (/, /programs, /companies, /data, /flow, /downloads, /methodology, /about)
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
 */

import fs from "fs";
import path from "path";
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
  const sitemapProgramCount = programCount - zeroContentCount;

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
    if (builtPblis.length !== programCount) {
      errors.push(
        `program pages: found ${builtPblis.length}, expected ${programCount}`
      );
    } else {
      notes.push(`program pages: ${builtPblis.length} ✓`);
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
    // Expected: static(9) + feed(1) + district pages + filing pages + programs + companies + agencies
    // static(9) = /, /programs/, /companies/, /companies/families/, /data/,
    //             /flow/, /downloads/, /methodology/, /about/
    // (/flow/ added in Phase 5H; /companies/families/ added in PM Sprint 2
    //  §P1-3 — the curated rename/acquisition table.)
    // Programs: page universe MINUS zero-content noindex pages (5F policy —
    // built but excluded from the sitemap, like zero-mention filings).
    const STATIC_SITEMAP_PAGES = 9;
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
    if (!fileExists(vercelJsonPath)) {
      errors.push(
        "fact permalinks: out/vercel.json missing — /fact/{id} URLs will 404 on deploy " +
          "(site/public/vercel.json must ship the /fact/:id rewrite)"
      );
    } else {
      let rewriteOk = false;
      try {
        const vercelConfig = readJson(vercelJsonPath);
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

  return { pass: errors.length === 0, errors, notes };
}
