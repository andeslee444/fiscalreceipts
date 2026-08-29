import "server-only";

/**
 * Build-time asset base — the SSR value behind every `useAssetUrl()` href.
 *
 * Tri-persona review Wave 4, item 1. `/downloads/` shipped fifteen
 * `href="/assets/data/*.parquet"` links in its STATIC HTML. Those paths are
 * rewritten client-side by <AssetConfigProvider> from `/config.json`, so a
 * browser with JavaScript reached the files — and `curl`, `wget`, a
 * copy-link, a scripted fetch, and any reader without JS got a 404 from the
 * same-origin host, because nothing is served under `/assets/` in production.
 * On a site whose whole offer to an analyst is "download the data", that is
 * the journey broken for every non-browser client.
 *
 * The base is READ, not authored: `site/public/config.json` is the same file
 * `scripts/launch/rewrite-config.mjs` writes for a deploy and the same file
 * the browser fetches at runtime, so the server-rendered href and the
 * hydrated one come from one source and cannot disagree.
 *
 * The runtime fetch is deliberately KEPT (see asset-config.tsx): this only
 * seeds the SSR/first-paint value. `scripts/serve-static.mjs` answers
 * `/config.json` with `{"assetBaseUrl": "/assets"}` so the local gate suite
 * stays hermetic, and hydration still swaps the absolute host for the local
 * one there. Baking the value in instead of fetching it would take the gate
 * suite off local assets and point three gates at production R2.
 */

import { readFileSync } from "fs";
import { join } from "path";

let _assetBase: string | null = null;

/** Absolute asset host (no trailing slash) — e.g. `https://assets.fiscalreceipts.com`. */
export function getAssetBase(): string {
  if (_assetBase !== null) return _assetBase;
  const p = join(process.cwd(), "public", "config.json");
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    throw new Error(
      `[govbudget/asset-base] ${p} is missing. It is the committed source of ` +
        `the asset host for BOTH the server-rendered download hrefs and the ` +
        `runtime /config.json fetch — restore it (or run ` +
        `"node scripts/launch/rewrite-config.mjs <url>" from the repo root).`,
    );
  }
  let base: unknown;
  try {
    base = (JSON.parse(raw) as { assetBaseUrl?: unknown }).assetBaseUrl;
  } catch {
    throw new Error(`[govbudget/asset-base] ${p} is not valid JSON.`);
  }
  if (typeof base !== "string" || base.trim() === "") {
    throw new Error(
      `[govbudget/asset-base] ${p} has no string "assetBaseUrl" — got ` +
        `${JSON.stringify(base)}.`,
    );
  }
  return (_assetBase = base.trim().replace(/\/+$/, ""));
}
