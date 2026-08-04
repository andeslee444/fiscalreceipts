import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Canonical corpus statement — PM-review Sprint 2, spec §P1-5.
 *
 * Hermetic: the real data sidecars must not be read. Each test drives
 * getCorpus through a mocked @/lib/data.
 */

const state = {
  programs: 1741,
  programPages: 1993,
  meta: {
    counts: { agencies: 23, citations: 1, companies: 200, programs: 1741, program_pages: 1993 },
    corpus_scope:
      "excludes personnel, O&M, and appropriations not covered by the R-1/P-1 rollups",
  } as Record<string, unknown>,
};

vi.mock("@/lib/data", () => ({
  getPrograms: () => new Array(state.programs).fill({}),
  getProgramPagesCount: () => state.programPages,
  getSiteMeta: () => state.meta,
}));

import { getCorpus, corpusStatement } from "@/lib/corpus";

const SCOPE =
  "excludes personnel, O&M, and appropriations not covered by the R-1/P-1 rollups";

function reset() {
  state.programs = 1741;
  state.programPages = 1993;
  state.meta = {
    counts: { agencies: 23, citations: 1, companies: 200, programs: 1741, program_pages: 1993 },
    corpus_scope: SCOPE,
  };
}

beforeEach(reset);

describe("corpusStatement", () => {
  it("states both universes with thousands separators and the scope tail", () => {
    expect(corpusStatement(1993, 1741, SCOPE)).toBe(
      "1,993 browsable program pages; 1,741 of them carry detail-grade R-2/P-40 J-book data — " +
        SCOPE +
        ".",
    );
  });

  it("matches the datatruth gate's leg-d regex (gate and component share the shape)", () => {
    // Keep in sync with scripts/gates/datatruth.mjs CORPUS_RE.
    const CORPUS_RE =
      /([\d,]+)\s+browsable program pages;\s*([\d,]+)\s+of them carry detail-grade/i;
    const m = corpusStatement(1993, 1741, SCOPE).match(CORPUS_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("1,993");
    expect(m![2]).toBe("1,741");
  });
});

describe("getCorpus", () => {
  it("derives both numbers from build data, never a literal", () => {
    state.programPages = 2100;
    state.programs = 1800;
    state.meta = { counts: { program_pages: 2100 }, corpus_scope: SCOPE };
    const c = getCorpus();
    expect(c.programPages).toBe(2100);
    expect(c.detailPages).toBe(1800);
    expect(c.statement).toContain("2,100 browsable program pages");
    expect(c.statement).toContain("1,800 of them carry detail-grade");
  });

  it("uses the build's scope wording verbatim (shared with the §P0-5 hero)", () => {
    expect(getCorpus().scope).toBe(SCOPE);
    expect(getCorpus().statement.endsWith(SCOPE + ".")).toBe(true);
  });

  it("throws when site_meta's declared page count disagrees with the sidecars", () => {
    state.meta = { counts: { program_pages: 1900 }, corpus_scope: SCOPE };
    expect(() => getCorpus()).toThrow(/program_pages=1900 but 1993/);
  });

  it("tolerates a pre-Sprint-2 export with no declared page count", () => {
    state.meta = { counts: {}, corpus_scope: SCOPE };
    expect(getCorpus().programPages).toBe(1993);
  });

  it("throws when the detail tier is not a subset of the page universe", () => {
    state.programs = 2000;
    state.meta = { counts: {}, corpus_scope: SCOPE };
    expect(() => getCorpus()).toThrow(/exceeds total program pages/);
  });

  it("throws on a degenerate (empty) corpus rather than rendering '0 pages'", () => {
    state.programPages = 0;
    state.meta = { counts: {}, corpus_scope: SCOPE };
    expect(() => getCorpus()).toThrow(/degenerate corpus/);
  });

  it("throws when the export predates corpus_scope rather than inventing wording", () => {
    state.meta = { counts: { program_pages: 1993 } };
    expect(() => getCorpus()).toThrow(/no corpus_scope/);
  });
});
