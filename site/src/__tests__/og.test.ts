/**
 * Tests for Task 8b — OG share-card URL helpers (src/lib/og.ts).
 *
 * The slug scheme must mirror scripts/generate-og.mjs (sanitize + prefixes):
 * a drifting scheme would 404 every og:image. ogSlugPart's regex here is the
 * load-bearing contract.
 */

import { describe, it, expect } from "vitest";
import {
  ogSlugPart,
  programOgImages,
  companyOgImages,
  agencyOgImages,
  coreOgImages,
} from "@/lib/og";
import { SITE_URL } from "@/lib/site";

describe("ogSlugPart", () => {
  it("passes through alphanumeric ids unchanged", () => {
    expect(ogSlugPart("0603183D8Z")).toBe("0603183D8Z");
    expect(ogSlugPart("lockheed-martin")).toBe("lockheed-martin");
    expect(ogSlugPart("DARPA")).toBe("DARPA");
  });

  it("replaces filesystem-hostile characters with underscores", () => {
    expect(ogSlugPart("a/b c&d")).toBe("a_b_c_d");
  });
});

describe("og image metadata", () => {
  it("program cards point at /og/program-{pe_bli}.png at 1200×630", () => {
    expect(programOgImages("0603183D8Z")).toEqual([
      {
        url: `${SITE_URL}/og/program-0603183D8Z.png`,
        width: 1200,
        height: 630,
      },
    ]);
  });

  it("company cards point at /og/company-{slug}.png", () => {
    expect(companyOgImages("lockheed-martin")[0].url).toBe(
      `${SITE_URL}/og/company-lockheed-martin.png`,
    );
  });

  it("agency cards point at /og/agency-{org}.png", () => {
    expect(agencyOgImages("DARPA")[0].url).toBe(
      `${SITE_URL}/og/agency-DARPA.png`,
    );
  });

  it("core cards use the bare page slug", () => {
    expect(coreOgImages("filings-index")[0].url).toBe(
      `${SITE_URL}/og/filings-index.png`,
    );
    expect(coreOgImages("home")[0].url).toBe(`${SITE_URL}/og/home.png`);
  });

  it("urls are absolute via SITE_URL", () => {
    for (const images of [
      programOgImages("X"),
      companyOgImages("y"),
      agencyOgImages("Z"),
      coreOgImages("feed"),
    ]) {
      expect(images[0].url.startsWith(SITE_URL)).toBe(true);
    }
  });
});
