/**
 * Unit tests for gate 3's mobile-viewport leg (gates/mobile.mjs).
 *
 * These pin the SAMPLE, not the browser run. The failure mode this leg exists
 * to prevent is a page class going unmeasured — so the sample's contents and
 * its non-vacuity floors are the thing a future edit must not quietly shrink.
 */

import { describe, it, expect } from "vitest";
import {
  MOBILE_VIEWPORT,
  buildMobileSample,
  computeMobileInstancePages,
} from "../mobile.mjs";

const instances = {
  programPbl: "0606301D8Z",
  companySlug: "lockheed-martin",
  filingUuid: "00000000-0000-0000-0000-000000000000",
};

describe("MOBILE_VIEWPORT", () => {
  it("is the 390x844 logical phone viewport the judges use", () => {
    expect(MOBILE_VIEWPORT).toEqual({ width: 390, height: 844 });
  });
});

describe("buildMobileSample", () => {
  const paths = buildMobileSample(instances).map((s) => s.path);

  it("covers every singleton page class that carries a table or a wide chart", () => {
    for (const p of [
      "/",
      "/programs/",
      "/companies/",
      "/companies/families/",
      "/data/",
      "/years/",
      "/district/",
      "/flow/",
      "/feed/",
      "/methodology/",
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("covers the templated page classes with real instances", () => {
    expect(paths).toContain("/program/0606301D8Z/");
    expect(paths).toContain("/company/lockheed-martin/");
    expect(paths).toContain("/filing/00000000-0000-0000-0000-000000000000/");
  });

  it("drops the filing page rather than requesting /filing/null/", () => {
    const noFiling = buildMobileSample({ ...instances, filingUuid: null });
    expect(noFiling.some((s) => s.path.startsWith("/filing/"))).toBe(false);
  });

  it("asserts the money is on screen on every value-bearing page", () => {
    const withValue = buildMobileSample(instances)
      .filter((s) => s.value)
      .map((s) => s.path)
      .sort();
    expect(withValue).toEqual([
      // Added after round-1 visual judging: `/` was not in this sample at all,
      // and it shipped the defect class the leg exists for — the mover title
      // painted over its dollar delta.
      "/",
      "/companies/",
      "/companies/families/",
      // Added with the coverage map (Task 6): four columns, two of them prose
      // — the shape that put /data/'s Scope and Citation cells off-canvas.
      "/coverage/",
      "/data/",
      "/district/",
      // Both added after round-1 judging. /feed/ kept its desktop two-column
      // row at 390; /flow/'s "View as table" pushed the AMOUNT column out of
      // its own scroll box, so the chart's stated fallback carried no dollars.
      "/feed/",
      "/flow/",
      // Added with the §P2-1 restructure: /programs/ was overflow-only while
      // both its money columns sat off the right edge inside the table's own
      // scroll container — (m1) passes on exactly that defect.
      "/programs/",
      "/years/",
    ]);
  });

  it("checks label/value collisions where a row declares the pair", () => {
    const withPairs = buildMobileSample(instances)
      .filter((s) => s.pairs)
      .map((s) => s.path)
      .sort();
    // (m3). Both are rows that put a long label beside a figure on one line at
    // desktop — the shape that overprints at 390.
    expect(withPairs).toEqual(["/", "/feed/"]);
    for (const s of buildMobileSample(instances)) {
      if (!s.pairs) continue;
      expect(s.pairs.rowSelector, `${s.path} pairs.rowSelector`).toBeTruthy();
      expect(s.pairs.labelSelector, `${s.path} pairs.labelSelector`).toBeTruthy();
      expect(s.pairs.valueSelector, `${s.path} pairs.valueSelector`).toBeTruthy();
      expect(s.pairs.describe, `${s.path} pairs.describe`).toBeTruthy();
    }
  });

  it("gives every value assertion a non-vacuity floor and a selector", () => {
    for (const s of buildMobileSample(instances)) {
      if (!s.value) continue;
      expect(s.value.selector, `${s.path} selector`).toBeTruthy();
      expect(s.value.min, `${s.path} min`).toBeGreaterThan(0);
      expect(s.value.describe, `${s.path} describe`).toBeTruthy();
      if (s.value.rowSelector) {
        expect(s.value.minRows, `${s.path} minRows`).toBeGreaterThan(0);
      }
    }
  });

  it("identifies value elements by data-* hooks, never by text", () => {
    for (const s of buildMobileSample(instances)) {
      if (!s.value) continue;
      expect(s.value.selector, `${s.path} selector`).toMatch(/\[data-/);
    }
  });

  it("waits for the two client islands before measuring them", () => {
    const bySlug = new Map(buildMobileSample(instances).map((s) => [s.path, s]));
    // /years/ is a 27KB shell that hydrates rows from years_matrix.json;
    // /flow/ fetches its Sankey payload. Measuring either early measures
    // an empty page.
    expect(bySlug.get("/years/").ready.selector).toBe("tr[data-program-row]");
    expect(bySlug.get("/flow/").ready.selector).toBe('[data-testid="flow-chart"]');
  });
});

describe("computeMobileInstancePages", () => {
  it("resolves real, deterministic instances from the shipped sidecars", () => {
    const a = computeMobileInstancePages();
    const b = computeMobileInstancePages();
    expect(a).toEqual(b);
    expect(a.programPbl).toBeTruthy();
    expect(a.companySlug).toBeTruthy();
    expect(a.filingUuid).toMatch(/^[0-9a-f-]{36}$/);
  });
});
