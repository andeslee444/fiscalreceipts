#!/usr/bin/env node
/**
 * serve-static.mjs — custom static file server for gate suite.
 *
 * Port 4173.
 * - Serves out/ at /  with trailing-slash resolution:
 *     try exact path → $uri/index.html → $uri.html → 404.html
 * - Serves ../data/site at /assets/ with HTTP Range support
 *   (PDF.js, DuckDB-WASM need partial-content responses).
 *
 * Exports startServer() for programmatic gate reuse.
 * Also runnable directly: `node scripts/serve-static.mjs`
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(siteRoot, "out");
const assetsDir = path.resolve(siteRoot, "..", "data", "site");

const PORT = 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".parquet": "application/octet-stream",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/** Resolve a URL path under out/ with trailing-slash fallback. */
function resolveOutPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const candidates = [
    path.join(outDir, decoded),
    path.join(outDir, decoded, "index.html"),
    path.join(outDir, decoded + ".html"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** Handle HTTP Range request for a file. Returns true if handled. */
function handleRange(req, res, filePath) {
  const range = req.headers["range"];
  if (!range) return false;

  const stat = fs.statSync(filePath);
  const total = stat.size;

  // Parse "bytes=start-end" (only single range supported)
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (!m) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    res.end();
    return true;
  }

  const start = m[1] !== "" ? parseInt(m[1], 10) : total - parseInt(m[2], 10);
  const end = m[2] !== "" ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;

  if (start > end || start >= total) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    res.end();
    return true;
  }

  const chunkSize = end - start + 1;
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": mime(filePath),
    "Cache-Control": "no-cache",
  });

  const stream = fs.createReadStream(filePath, { start, end });
  stream.pipe(res);
  return true;
}

function serveFile(req, res, filePath) {
  const stat = fs.statSync(filePath);
  if (handleRange(req, res, filePath)) return;

  res.writeHead(200, {
    "Content-Type": mime(filePath),
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
}

function handler(req, res) {
  const urlPath = req.url.split("?")[0];

  // ── /config.json → local asset base ─────────────────────────────────────
  // The committed public/config.json points at the production R2 host
  // (LAUNCH.md Step 5 rewrote it for deploys). Gates must stay hermetic:
  // this server already serves ../data/site at /assets/ with Range support,
  // so answer /config.json with the local base instead of the file in out/.
  // Without this, live gates fetch assets from prod R2 (CORS-blocked from
  // 127.0.0.1) and the degraded gate's /assets/ blackhole never matches.
  if (urlPath === "/config.json") {
    const body = JSON.stringify({ assetBaseUrl: "/assets" });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-cache",
    });
    res.end(body);
    return;
  }

  // ── /_vercel/* → platform routes, stubbed ───────────────────────────────
  // NOT a relaxed assertion — an environment-fidelity fix, the same species
  // as /config.json above ("Gates must stay hermetic").
  //
  // Vercel Web Analytics loads /_vercel/insights/script.js and beacons to
  // /_vercel/insights/*. Those paths are served by the Vercel platform and
  // are BY CONSTRUCTION absent from the static export: deploy.sh uploads
  // site/out/ prebuilt, so no build could ever place a file there. Serving
  // out/ locally therefore 404s them, and Chromium logs a 404 subresource
  // as a console ERROR — which gate 3 (render-live) collects with no
  // allowlist and fails on, for every page it visits. Measured before this
  // stub existed: injecting the exact tag @vercel/analytics builds produced
  // `Failed to load resource: the server responded with a status of 404`,
  // 1 console error, on a page that had zero.
  //
  // Gate 3's assertion is UNCHANGED and still zero-tolerance; this only
  // stops the harness inventing an error the deployed site does not have.
  // The body is empty on purpose: @vercel/analytics installs its own
  // window.va queue stub before the script loads, so pageviews queue
  // harmlessly and nothing leaves the machine during a gate run.
  if (urlPath.startsWith("/_vercel/")) {
    res.writeHead(200, {
      "Content-Type": urlPath.endsWith(".js")
        ? "application/javascript"
        : "application/json",
      "Content-Length": 0,
      "Cache-Control": "no-cache",
    });
    res.end();
    return;
  }

  // ── /assets/ → ../data/site ────────────────────────────────────────────
  if (urlPath.startsWith("/assets/")) {
    const rel = urlPath.slice("/assets/".length);
    const filePath = path.resolve(assetsDir, rel);
    // Security: stay within assetsDir (require path.sep suffix to prevent
    // prefix-matching attacks like /assets/../../../etc/passwd or
    // a sibling dir that starts with the same prefix as assetsDir)
    if (!filePath.startsWith(assetsDir + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    serveFile(req, res, filePath);
    return;
  }

  // ── / → out/ ──────────────────────────────────────────────────────────
  const resolved = resolveOutPath(urlPath);
  if (resolved) {
    serveFile(req, res, resolved);
    return;
  }

  // ── 404.html fallback ─────────────────────────────────────────────────
  const notFound = path.join(outDir, "404.html");
  if (fs.existsSync(notFound)) {
    const stat = fs.statSync(notFound);
    res.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": stat.size,
    });
    fs.createReadStream(notFound).pipe(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  }
}

/**
 * Start the server. Returns { server, url, close }.
 * @param {number} [port=4173]
 */
export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      resolve({
        server,
        url,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

// ── CLI mode ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer(PORT).then(({ url }) => {
    console.log(`serve-static: listening at ${url}`);
    console.log(`  out/      → ${outDir}`);
    console.log(`  /assets/  → ${assetsDir}`);
  });
}
