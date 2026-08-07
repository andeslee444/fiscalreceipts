#!/usr/bin/env node
/**
 * verify_live_assets.mjs — POST-DEPLOY check that the CDN actually has the
 * assets the freshly-deployed pages cite.
 *
 * WHY THIS IS NOT A GATE IN `npm run verify`.
 *
 *   The 24-gate suite reads `site/out/` and a local static server. It is
 *   hermetic on purpose: it runs offline, it is deterministic, and a network
 *   flake must never turn it red for reasons that have nothing to do with the
 *   site. This check is the opposite of all three — it asks a remote host a
 *   question whose answer depends on the network.
 *
 *   More decisively: the property it checks is PRODUCTION CDN STATE, which
 *   cannot be true before a deploy. Asserting it inside a pre-deploy gate
 *   would be vacuous at best (the asset legitimately is not up yet) and wrong
 *   at worst (green because it checked the previous deploy's assets). It
 *   belongs AFTER the upload, and it must run by itself rather than sit in a
 *   doc as a step someone remembers — which is exactly how PDF citations
 *   silently degraded in production for every post-launch phase until the
 *   2026-07-04 catch (ROADMAP backlog #27).
 *
 *   So: scripts/launch/deploy.sh runs it automatically as the last step, and a
 *   failure here fails the deploy loudly. It is also runnable on its own to
 *   audit what is live right now.
 *
 * WHAT IT ASSERTS
 *   1. The N most recently added `jbook_pdf` assets (newest PDFs under
 *      data/site/pdfs/ that a jbook_pdf citation actually points at) each
 *      return 200/206 from the asset host, with a non-zero body that begins
 *      with the `%PDF-` magic. "Recently added" is the failure mode: an
 *      ingestion phase mints new citations, the deploy ships pages that cite
 *      them, and the binaries were never synced — the citation panel falls
 *      back to "open official source" and nothing notices.
 *   2. citations/citations.parquet is reachable (the Explorer + citation
 *      lookups read it) — proves the data/ and citations/ syncs landed too.
 *   3. The site host's /fact/ rewrite resolves — this comes from
 *      site/out/vercel.json and silently dies if the wrong directory was
 *      deployed.
 *
 * USAGE
 *   node scripts/launch/verify_live_assets.mjs
 *   node scripts/launch/verify_live_assets.mjs --count=8
 *   node scripts/launch/verify_live_assets.mjs --asset-base=https://... --site=https://...
 *   node scripts/launch/verify_live_assets.mjs --sha=<sha256>   # check exactly this asset
 *   node scripts/launch/verify_live_assets.mjs --skip-site      # asset host only
 *
 * The asset host defaults to site/public/config.json's `assetBaseUrl`, so the
 * check follows the same host the built pages were told to use.
 *
 * EXIT CODES
 *   0  every assertion passed
 *   1  an assertion failed (missing asset, bad status, empty or non-PDF body)
 *   2  could not even set up (no citations.json, no PDFs, bad arguments)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const pdfDir = path.join(repoRoot, "data", "site", "pdfs");
const citationsPath = path.join(repoRoot, "data", "site", "json", "citations.json");
const configPath = path.join(repoRoot, "site", "public", "config.json");

const DEFAULT_COUNT = 5;
const DEFAULT_SITE = "https://fiscalreceipts.com";
/** A known-good /fact/ id for the rewrite check (LAUNCH.md §7d). */
const FACT_PROBE = process.env.FACT_PROBE ?? "3134a6e0";
const TIMEOUT_MS = 30_000;

// ── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { count: DEFAULT_COUNT, shas: [], skipSite: false };
  for (const arg of argv) {
    const [k, v] = arg.includes("=") ? arg.split(/=(.*)/s) : [arg, ""];
    switch (k) {
      case "--count":
        opts.count = Number(v);
        break;
      case "--sha":
        opts.shas.push(v.trim().toLowerCase());
        break;
      case "--asset-base":
        opts.assetBase = v;
        break;
      case "--site":
        opts.site = v;
        break;
      case "--skip-site":
        opts.skipSite = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        opts.bad = arg;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  console.log(src.slice(0, src.indexOf(" */") + 3));
  process.exit(0);
}
if (opts.bad) {
  console.error(`ERROR: unknown argument: ${opts.bad}`);
  process.exit(2);
}
if (!Number.isInteger(opts.count) || opts.count < 1) {
  console.error(`ERROR: --count must be a positive integer`);
  process.exit(2);
}

/** Asset host: explicit flag > env > the host the built pages were given. */
function resolveAssetBase() {
  if (opts.assetBase) return opts.assetBase;
  if (process.env.ASSET_BASE_URL) return process.env.ASSET_BASE_URL;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (cfg.assetBaseUrl) return cfg.assetBaseUrl;
  } catch {
    /* fall through */
  }
  return null;
}

const assetBase = (resolveAssetBase() ?? "").replace(/\/+$/, "");
const siteBase = (opts.site ?? process.env.SITE_URL ?? DEFAULT_SITE).replace(/\/+$/, "");

if (!assetBase) {
  console.error(
    `ERROR: no asset base URL. Pass --asset-base=<url>, set ASSET_BASE_URL, ` +
      `or write assetBaseUrl into ${path.relative(repoRoot, configPath)}.`,
  );
  process.exit(2);
}

// ── Target selection ─────────────────────────────────────────────────────────

/**
 * The set of sha256s that a `jbook_pdf` citation points at.
 *
 * citations.json is ~90 MB, so it is STREAMED and scanned for the
 * `hosted_pdf_url` field rather than parsed: hosted_pdf_url is populated only
 * for jbook_pdf citations, and its value is exactly the asset path the
 * citation panel requests. Chunks overlap so a value split across a read
 * boundary is not missed.
 */
async function citedPdfShas() {
  const shas = new Set();
  const re = /"hosted_pdf_url"\s*:\s*"\/pdfs\/([0-9a-f]{64})\.pdf/g;
  const stream = fs.createReadStream(citationsPath, {
    encoding: "utf8",
    highWaterMark: 1 << 20,
  });
  let tail = "";
  for await (const chunk of stream) {
    const buf = tail + chunk;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(buf))) shas.add(m[1]);
    tail = buf.slice(-128); // longer than the longest match
  }
  return shas;
}

/** The `count` most recently added PDF binaries that a citation points at. */
async function selectTargets(count) {
  if (opts.shas.length > 0) {
    return opts.shas.map((sha) => ({ sha, mtime: null, source: "--sha" }));
  }
  if (!fs.existsSync(pdfDir)) {
    console.error(`ERROR: ${path.relative(repoRoot, pdfDir)} not found — run export-site first.`);
    process.exit(2);
  }
  const pdfs = fs
    .readdirSync(pdfDir)
    .filter((n) => /^[0-9a-f]{64}\.pdf$/.test(n))
    .map((n) => ({
      sha: n.slice(0, 64),
      mtime: fs.statSync(path.join(pdfDir, n)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (pdfs.length === 0) {
    console.error(`ERROR: no PDF assets under ${path.relative(repoRoot, pdfDir)}.`);
    process.exit(2);
  }

  let cited = null;
  if (fs.existsSync(citationsPath)) {
    cited = await citedPdfShas();
  } else {
    console.warn(
      `WARN: ${path.relative(repoRoot, citationsPath)} not found — checking the ` +
        `newest PDF binaries without confirming a citation points at them.`,
    );
  }

  const eligible = cited ? pdfs.filter((p) => cited.has(p.sha)) : pdfs;
  if (eligible.length === 0) {
    console.error(
      `ERROR: none of the ${pdfs.length} local PDF assets is referenced by a ` +
        `jbook_pdf citation — the corpus and the binaries have diverged.`,
    );
    process.exit(2);
  }
  return eligible.slice(0, count).map((p) => ({ ...p, source: "newest cited" }));
}

// ── Assertions ───────────────────────────────────────────────────────────────

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
}

async function fetchWithTimeout(url, init = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

/** 200/206 + non-zero body + `%PDF-` magic. */
async function checkPdf(target) {
  const url = `${assetBase}/pdfs/${target.sha}.pdf`;
  const short = `${target.sha.slice(0, 12)}…`;
  let res;
  try {
    // Ranged GET: enough bytes to see the magic without pulling 20 MB.
    res = await fetchWithTimeout(url, { headers: { Range: "bytes=0-1023" } });
  } catch (e) {
    record(false, `PDF ${short}`, `request failed: ${e.message} (${url})`);
    return;
  }
  if (res.status !== 200 && res.status !== 206) {
    record(
      false,
      `PDF ${short}`,
      `HTTP ${res.status} from ${url} — the binary is not on the CDN. ` +
        `Run scripts/launch/upload_r2.sh --live.`,
    );
    return;
  }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length === 0) {
    record(false, `PDF ${short}`, `HTTP ${res.status} but a ZERO-length body (${url})`);
    return;
  }
  const magic = new TextDecoder().decode(body.slice(0, 5));
  if (magic !== "%PDF-") {
    record(
      false,
      `PDF ${short}`,
      `HTTP ${res.status}, ${body.length} bytes, but the body does not start ` +
        `with %PDF- (got ${JSON.stringify(magic)}) — an error page, not a PDF`,
    );
    return;
  }
  const total = res.headers.get("content-range")?.split("/")[1];
  record(
    true,
    `PDF ${short}`,
    `HTTP ${res.status}, %PDF- magic, ${total ? `${total} bytes total` : `${body.length} bytes`}`,
  );
}

async function checkUrl(label, url, { expectBody = true } = {}) {
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (e) {
    record(false, label, `request failed: ${e.message} (${url})`);
    return;
  }
  if (res.status !== 200) {
    record(false, label, `HTTP ${res.status} from ${url}`);
    return;
  }
  const len = (await res.arrayBuffer()).byteLength;
  if (expectBody && len === 0) {
    record(false, label, `HTTP 200 but a ZERO-length body (${url})`);
    return;
  }
  record(true, label, `HTTP 200, ${len} bytes`);
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  post-deploy live-asset verification");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  asset host: ${assetBase}`);
  if (!opts.skipSite) console.log(`  site host:  ${siteBase}`);
  console.log("");

  const targets = await selectTargets(opts.count);
  console.log(
    `── ${targets.length} recently-added jbook_pdf asset(s) [${targets[0].source}] ──`,
  );
  for (const t of targets) await checkPdf(t);

  console.log("");
  console.log("── R2 data assets ──");
  await checkUrl("citations/citations.parquet", `${assetBase}/citations/citations.parquet`);

  if (!opts.skipSite) {
    console.log("");
    console.log("── site host (proves site/out/ was the deployed directory) ──");
    await checkUrl(`/fact/${FACT_PROBE}`, `${siteBase}/fact/${FACT_PROBE}`);
    await checkUrl("/json/years_matrix.json", `${siteBase}/json/years_matrix.json`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length > 0) {
    console.log(
      `FAIL: ${failed.length} of ${results.length} live-asset assertion(s) failed.`,
    );
    console.log(
      `Assets missing from the CDN mean citation panels fall back to "open ` +
        `official source" for every reader. Re-run: scripts/launch/upload_r2.sh --live`,
    );
    process.exit(1);
  }
  console.log(`All ${results.length} live-asset assertions passed.`);
}

main().catch((e) => {
  console.error(`verify_live_assets: unhandled error: ${e?.stack ?? e}`);
  process.exit(1);
});
