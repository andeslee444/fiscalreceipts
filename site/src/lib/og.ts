import { SITE_URL } from "./site";

/**
 * og.ts — OG share-card URL helpers (Task 8b).
 *
 * Cards are PNGs generated at prebuild by scripts/generate-og.mjs
 * (satori + resvg — Option B per the recorded plan decision) into
 * public/og/{slug}.png (gitignored). The slug scheme here MUST stay in sync
 * with OG_SLUG in scripts/generate-og.mjs:
 *
 *   program  → og/program-{pe_bli}.png
 *   company  → og/company-{slug}.png
 *   agency   → og/agency-{org}.png
 *   core     → og/{home|feed|district-index|downloads|methodology|data|about|filings-index}.png
 *
 * /filing/[uuid] pages keep the shared static default
 * (public/og-default-filing.png — plan decision 3; 4,258 renders not
 * justified for noindex-heavy thin pages).
 */

export type CoreOgPage =
  | "home"
  | "feed"
  | "district-index"
  | "downloads"
  | "methodology"
  | "data"
  | "about"
  | "filings-index";

/** Filename-safe id part — identical to sanitize() in generate-og.mjs. */
export function ogSlugPart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, "_");
}

function images(slug: string) {
  return [
    {
      url: `${SITE_URL}/og/${slug}.png`,
      width: 1200,
      height: 630,
    },
  ];
}

export function programOgImages(peBli: string) {
  return images(`program-${ogSlugPart(peBli)}`);
}

export function companyOgImages(slug: string) {
  return images(`company-${ogSlugPart(slug)}`);
}

export function agencyOgImages(org: string) {
  return images(`agency-${ogSlugPart(org)}`);
}

export function coreOgImages(page: CoreOgPage) {
  return images(page);
}
