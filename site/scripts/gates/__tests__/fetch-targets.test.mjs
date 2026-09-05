/**
 * Unit tests for gate 13 leg (i)'s source scanner (batch review 1.2).
 *
 * THE DEFECT. https://fiscalreceipts.com/json/feed.json 404'd in production
 * and nothing caught it. Leg (i) was written for exactly that bug and could
 * not see it: it reads `<a href>` out of built HTML, and no anchor anywhere
 * on this site points at /json/feed.json — the file is reached only by a
 * client-side fetch() baked into a JS bundle. Four more targets are in the
 * same position (/json/years_matrix.json, /json/flow_chart.json,
 * /config.json, /json-lite/search_quick.json): if one goes missing the
 * feature spins and errors, and every gate stays green.
 *
 * So the leg now also scans site/src for statically named fetch targets.
 * These tests pin what "statically named" means — because a scanner that
 * over-reaches invents paths that never shipped, and one that under-reaches
 * is the miss it was written to close.
 *
 * Run via `npm test` (vitest).
 */

import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  runJsonXmlHrefLeg,
  sameOriginJsonXmlTarget,
  scanFetchTargets,
  staticFetchTargets,
} from "../linkgraph.mjs";

const srcDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
);

describe("staticFetchTargets — the shapes it must catch", () => {
  it("finds a double-quoted absolute path", () => {
    expect(
      staticFetchTargets(`const resp = await fetch("/json/feed.json");`),
    ).toEqual(["/json/feed.json"]);
  });

  it("finds single-quoted and backtick literals", () => {
    expect(staticFetchTargets(`fetch('/config.json')`)).toEqual(["/config.json"]);
    expect(staticFetchTargets("fetch(`/json/flow_chart.json`)")).toEqual([
      "/json/flow_chart.json",
    ]);
  });

  it("finds a template literal whose static prefix is already a complete path", () => {
    expect(staticFetchTargets("fetch(`/json/feed.json?v=${build}`)")).toEqual([
      "/json/feed.json",
    ]);
  });

  it("strips query and hash so the target names a file", () => {
    expect(staticFetchTargets(`fetch("/json/feed.json?v=2#top")`)).toEqual([
      "/json/feed.json",
    ]);
  });

  it("survives whitespace and a multi-line call", () => {
    expect(
      staticFetchTargets(`const p = fetch(\n      "/json-lite/search_quick.json",\n    );`),
    ).toEqual(["/json-lite/search_quick.json"]);
  });

  it("de-duplicates and sorts", () => {
    expect(
      staticFetchTargets(`fetch("/b.json"); fetch("/a.json"); fetch("/b.json");`),
    ).toEqual(["/a.json", "/b.json"]);
  });
});

describe("staticFetchTargets — the shapes it must NOT invent", () => {
  it("ignores a per-row templated path (its existence is a sidecar question)", () => {
    expect(
      staticFetchTargets(
        "const r = await fetch(`/json-lite/program_details/${peBli}.json`);",
      ),
    ).toEqual([]);
  });

  it("ignores an asset-host base URL", () => {
    expect(
      staticFetchTargets(
        "const probe = await fetch(`${assetBase}/data/${probeName}.parquet`);",
      ),
    ).toEqual([]);
  });

  it("ignores a fetch whose URL comes from a helper call", () => {
    expect(
      staticFetchTargets(`fetch(assetUrl("/citations/citations.parquet"))`),
    ).toEqual([]);
    expect(staticFetchTargets("fetch(breakdownUrl(factId))")).toEqual([]);
  });

  it("ignores an absolute external URL", () => {
    expect(
      staticFetchTargets(`fetch("https://example.test/json/feed.json")`),
    ).toEqual([]);
  });

  it("does not match a word ending in fetch", () => {
    expect(staticFetchTargets(`prefetch("/json/feed.json")`)).toEqual([]);
  });
});

describe("scanFetchTargets — against the real site/src", () => {
  it("finds the five statically named targets the client depends on", () => {
    const found = scanFetchTargets(srcDir);
    // Measured 2026-09-04; this is the population MIN_STATIC_FETCH_TARGETS
    // floors. Adding a target is fine; losing one without re-measuring is the
    // regression the floor exists to catch.
    expect([...found.keys()].sort()).toEqual([
      "/config.json",
      "/json-lite/search_quick.json",
      "/json/feed.json",
      "/json/flow_chart.json",
      "/json/years_matrix.json",
    ]);
    expect(found.get("/json/feed.json")).toEqual([
      "components/feed-section-expand.tsx",
    ]);
  });

  it("does not pick targets out of test files' fetch mocks", () => {
    const found = scanFetchTargets(srcDir);
    for (const sources of found.values()) {
      for (const f of sources) {
        expect(f).not.toMatch(/__tests__|\.test\.tsx?$/);
      }
    }
  });
});

describe("sameOriginJsonXmlTarget — the href half of leg (i)", () => {
  it("keeps a relative .json/.xml path", () => {
    expect(sameOriginJsonXmlTarget("/feeds/program/000074.xml")).toBe(
      "/feeds/program/000074.xml",
    );
  });

  it("unwraps the absolute self-URL every SubscribeLinks renders", () => {
    // The bug leg (i) exists for: lib/feeds.ts's abs() emits absolute
    // self-URLs, and the other legs' `href.startsWith("http")` check dropped
    // every one of them as external.
    expect(sameOriginJsonXmlTarget("https://fiscalreceipts.com/rss.xml")).toBe(
      "/rss.xml",
    );
  });

  it("strips query and hash", () => {
    expect(sameOriginJsonXmlTarget("/rss.xml?utm=1#top")).toBe("/rss.xml");
  });

  it("ignores a genuinely external URL", () => {
    expect(sameOriginJsonXmlTarget("https://example.test/rss.xml")).toBeNull();
  });

  it("ignores same-origin links that are not .json/.xml", () => {
    expect(sameOriginJsonXmlTarget("/program/0601101E/")).toBeNull();
    expect(sameOriginJsonXmlTarget("/citations/citations.parquet")).toBeNull();
  });

  it("ignores an empty or missing href", () => {
    expect(sameOriginJsonXmlTarget("")).toBeNull();
    expect(sameOriginJsonXmlTarget(undefined)).toBeNull();
  });
});

describe("runJsonXmlHrefLeg — the href floor must not be backfilled by fetch targets", () => {
  // Regression: a `checked` counter shared by the href sweep and the
  // fetch-target sweep meant `checked === 0` could never fire once the
  // real site/src's >= MIN_STATIC_FETCH_TARGETS static fetch targets were
  // found — an href-sweep regression (broken selector, empty page set)
  // would pass green. A `pages` list that resolves to nothing built (no
  // file under site/out for any of these URLs) forces the href sweep to
  // zero while scanFetchTargets(srcDir) still runs for real and finds its
  // usual targets, proving the two counters are independent.
  const NEVER_BUILT_PAGES = ["/__leg_i_regression_test__/no-such-page/"];

  it("errors on zero hrefs even though real fetch targets are present", () => {
    const errors = [];
    const notes = [];
    runJsonXmlHrefLeg(errors, notes, NEVER_BUILT_PAGES);

    // Sanity: the fetch-target half really did find targets in this run —
    // otherwise this test would pass for the wrong reason (both zero).
    expect(scanFetchTargets(srcDir).size).toBeGreaterThan(0);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "leg i: 0 same-origin .json/.xml hrefs found across scanned pages",
        ),
      ]),
    );
  });

  it("does not report the href sweep as a passing 'all resolve' note when it found zero", () => {
    const errors = [];
    const notes = [];
    runJsonXmlHrefLeg(errors, notes, NEVER_BUILT_PAGES);

    for (const note of notes) {
      expect(note).not.toMatch(/^leg i: \d+ same-origin target\(s\)/);
    }
  });
});
