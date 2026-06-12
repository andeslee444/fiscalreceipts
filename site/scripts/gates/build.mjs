/**
 * gate 1 — build_gate (mechanical checks on out/)
 *
 * Checks:
 * - program pages == programs.json count (326)
 * - agency pages == distinct orgs from agencies.json
 * - company pages == 200 (entities_top.json count)
 * - core pages present (/, /programs, /companies, /data, /downloads, /methodology, /about)
 * - out/pagefind/pagefind.js exists
 * - sitemap URL count == emitted pages AND every URL starts with SITE_URL origin
 * - robots.txt present
 * - llms.txt contains /methodology/, /downloads/, ≥1 /program/ URL
 * - citations.json key count == manifest citation total (44,754)
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

  const programCount = programs.length;
  const companyCount = entities.length;
  const agencyCount = agencies.length;
  const citationTotal = siteMeta.counts?.citations ?? 0;

  notes.push(`sidecars: ${programCount} programs, ${companyCount} companies, ${agencyCount} agencies, ${citationTotal} citations`);

  // ── out/ exists ──────────────────────────────────────────────────────────
  if (!dirExists(outDir)) {
    errors.push(`out/ directory not found at ${outDir}`);
    return { pass: false, errors, notes };
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
  // Next.js static export writes sitemap as out/sitemap.xml or out/sitemap/index.html
  const sitemapXml = path.join(outDir, "sitemap.xml");
  // Try alternate: out/sitemap.xml from app/sitemap.ts -> writes out/sitemap.xml directly
  // or it may be at out/sitemap/index.html as plain text
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

    // Expected: static(7) + programs(326) + companies(200) + agencies(20) = 553
    const expectedTotal = 7 + programCount + companyCount + agencyCount;
    if (sitemapCount !== expectedTotal) {
      errors.push(
        `sitemap URL count: found ${sitemapCount}, expected ${expectedTotal} (7 static + ${programCount} programs + ${companyCount} companies + ${agencyCount} agencies)`
      );
    } else {
      notes.push(`sitemap: ${sitemapCount} URLs ✓`);
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
  const robotsTxt = path.join(outDir, "robots.txt");
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

  return { pass: errors.length === 0, errors, notes };
}
