import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * #46 — CURRENCY_RE and its anchored allowlist mirror must cover the same
 * magnitudes, forever.
 *
 * PM Sprint 2 added a trillions formatter ($3657.4B -> $3.66T) while both
 * regexes still matched only [BMK]. The consequence was NOT that the sweep
 * went blind — it still fires on the dollar amount — but that it truncates
 * the token it reports ("$1.2T" is reported as "$1.2"), and, the part that
 * actually breaks something, prose-allowlist.mjs:90 REJECTS a "$1.2T"
 * allowlist entry as an illegal pattern. A legitimate trillions figure could
 * therefore never be allowlisted, leaving the gate unfixable without a code
 * edit.
 *
 * These two regexes are documented as mirrors of each other, and the project
 * has already been bitten twice by paired constants drifting apart
 * (BASIS_LABEL vs the gate's copy; the CORPUS_SCOPE_TAIL mirror in
 * datatruth.mjs). This test pins them together.
 */
const magnitudes = (src) => src.match(/\[([TBMK]+)\]\?/)?.[1] ?? "";

describe("CURRENCY_RE magnitude coverage", () => {
  it("covers T, B, M and K", () => {
    const src = readFileSync("scripts/gates/render-static.mjs", "utf8");
    const found = magnitudes(src);
    for (const m of ["T", "B", "M", "K"]) expect(found).toContain(m);
  });

  it("prose-allowlist's anchored mirror covers the same magnitudes", () => {
    const a = magnitudes(readFileSync("scripts/gates/render-static.mjs", "utf8"));
    const b = magnitudes(readFileSync("scripts/gates/prose-allowlist.mjs", "utf8"));
    expect(a).not.toBe("");
    expect([...b].sort()).toEqual([...a].sort());
  });

  it("the anchored mirror accepts a trillions token as a legal allowlist pattern", () => {
    // The concrete regression: before #46 this threw "illegal allowlist
    // pattern" and a $T figure could not be allowlisted at all.
    const src = readFileSync("scripts/gates/prose-allowlist.mjs", "utf8");
    const literal = src.match(/const CURRENCY_TOKEN_RE = (\/.*\/);/)?.[1];
    expect(literal).toBeTruthy();
    // eslint-disable-next-line no-eval
    const re = eval(literal);
    expect(re.test("$1.2T")).toBe(true);
    expect(re.test("$5.82B")).toBe(true);
    expect(re.test("$20.9M")).toBe(true);
  });
});
