import { describe, it, expect, vi } from "vitest";

/**
 * The /coverage/ manifest — PM Sprint 3 Task 6 (§Coverage).
 *
 * The page's whole claim is "every number here is build-derived". A test that
 * asserted authored literals would defeat the point, so the mock supplies
 * DELIBERATELY ODD counts: if any row's rendered string can be produced
 * without reading the mock, the row is authoring its number.
 */

const MOCK = {
  programs: 1234,
  programPages: 1500,
  dossiers: 51,
  flows: 19,
  lineage: 47,
  companies: 199,
  companiesWithAwards: 21,
  districts: 107,
  editions: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  filings: 4321,
};

vi.mock("@/lib/data", () => ({
  getProgramsCount: () => MOCK.programs,
  getProgramPagesCount: () => MOCK.programPages,
  getDossierCount: () => MOCK.dossiers,
  getFlowsCount: () => MOCK.flows,
  getLineagePrograms: () => MOCK.lineage,
  getCompaniesCount: () => MOCK.companies,
  getCompaniesWithAwardsCount: () => MOCK.companiesWithAwards,
  getDistrictsCount: () => MOCK.districts,
  getDecadeEditions: () => MOCK.editions,
  getFilingsCount: () => MOCK.filings,
  getSiteMeta: () => ({
    award_fy_range: {
      fy_min: 2017,
      fy_max: 2026,
      label: "FY2017–FY2026",
      latest_action_date: "2026-04-23",
      max_partial: true,
    },
  }),
  getFlowChartMeta: () => ({
    budgetFy: 2026,
    bridge: {
      crosswalkedPeCount: 11,
      universePeCount: 23,
      highConfidencePeCount: 7,
      pctNotCrosswalked: "98.7",
    },
  }),
}));

vi.mock("@/lib/feeds", () => ({
  getFeedInventory: () => ({
    items: 223,
    eventTypes: 4,
    programFeeds: 123,
    companyFeeds: 54,
  }),
}));

import {
  getCoverageMap,
  COVERAGE_MAP_IDS,
  CROSSWALK_LIMIT_ID,
} from "@/lib/coverage-map";

const rows = getCoverageMap();
const byId = new Map(rows.map((r) => [r.id, r]));

describe("coverage map — shape", () => {
  it("returns one row per declared id, in declared order", () => {
    expect(rows.map((r) => r.id)).toEqual([...COVERAGE_MAP_IDS]);
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("every row states a coverage figure, a specific blocker and a target", () => {
    for (const r of rows) {
      expect(r.label.length, r.id).toBeGreaterThan(3);
      expect(r.covered.length, r.id).toBeGreaterThan(3);
      // "the specific blocker" — a blocker like "not done yet" is useless, so
      // the shortest useful sentence is the floor.
      expect(r.blocker.length, r.id).toBeGreaterThan(60);
      expect(r.target.length, r.id).toBeGreaterThan(20);
      expect(["dated", "none"], r.id).toContain(r.targetKind);
      expect(r.derivation.length, r.id).toBeGreaterThan(10);
      expect(r.href, r.id).toMatch(/^\//);
    }
  });

  it("a dated target names a month and a year; an undated one says why not", () => {
    const DATED = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/;
    for (const r of rows) {
      if (r.targetKind === "dated") {
        expect(r.target, r.id).toMatch(DATED);
      } else {
        expect(r.target.toLowerCase(), r.id).toMatch(/no dated target/);
      }
    }
  });

  it("at least half the rows carry a dated target — a roadmap, not a list of excuses", () => {
    const dated = rows.filter((r) => r.targetKind === "dated").length;
    expect(dated * 2).toBeGreaterThanOrEqual(rows.length);
  });
});

describe("coverage map — every number is read, never authored", () => {
  it("program pages: detail-grade over the browsable universe", () => {
    const r = byId.get("program-pages")!;
    expect(r.numerator).toBe(MOCK.programs);
    expect(r.denominator).toBe(MOCK.programPages);
    expect(r.covered).toContain("1,234 of 1,500");
  });

  it("dossiers, flows and lineage are all over the detail-grade corpus", () => {
    expect(byId.get("dossiers")!.covered).toContain("51 of 1,234");
    expect(byId.get("flows")!.covered).toContain("19 of 1,234");
    expect(byId.get("lineage")!.covered).toContain("47 of 1,234");
    for (const id of ["dossiers", "flows", "lineage"] as const) {
      expect(byId.get(id)!.denominator, id).toBe(MOCK.programs);
    }
  });

  it("the budget→award bridge carries both the PE fraction and the dollar share", () => {
    const r = byId.get(CROSSWALK_LIMIT_ID)!;
    expect(r.numerator).toBe(11);
    expect(r.denominator).toBe(23);
    expect(r.covered).toContain("11 of 23");
    expect(r.covered).toContain("98.7%");
    expect(r.covered).toContain("FY2026");
  });

  it("company award linkage is the crosswalk seen from the company side", () => {
    const r = byId.get("company-awards")!;
    expect(r.covered).toContain("21 of 199");
  });

  it("districts are measured against all 435 seats", () => {
    const r = byId.get("districts")!;
    expect(r.numerator).toBe(MOCK.districts);
    expect(r.denominator).toBe(435);
    expect(r.covered).toContain("107 of 435");
  });

  it("editions come from the matrix columns, not a literal", () => {
    const r = byId.get("editions")!;
    expect(r.numerator).toBe(10);
    expect(r.covered).toContain("PB2017–PB2026");
  });

  it("the award window comes from site_meta, partial year and all", () => {
    const r = byId.get("awards-window")!;
    expect(r.covered).toContain("FY2017–FY2026");
    expect(r.covered).toContain("2026-04-23");
    expect(r.covered.toLowerCase()).toContain("partial");
  });

  it("feeds count the files the build actually wrote", () => {
    const r = byId.get("feeds")!;
    expect(r.covered).toContain("223");
    expect(r.covered).toContain("123");
    expect(r.covered).toContain("54");
  });

  it("filings state the indexed total", () => {
    expect(byId.get("filings")!.covered).toContain("4,321");
  });

  it("counts are grouped — gate 24 leg j notation, everywhere", () => {
    // MIRRORS the two shipped regexes in scripts/gates/datatruth.mjs leg j.
    // The site-wide sweep runs over built HTML; catching a violation here
    // means catching it in the module that produced it, with the row named.
    const COUNT_NOUNS =
      "programs?|program elements?|companies|districts?|filings?|mentions?|" +
      "awards?|award records?|facts?|datasets?|rows?|records?|signals?|pages?|" +
      "citations?|line items?|event types?|entries|elements?";
    const patterns = [
      new RegExp(
        String.raw`(?<![\d,.])(\d{4,})(?![\d,.])\s+(?:of\s+[\d,]+\s+)?(?:${COUNT_NOUNS})\b`,
        "gi",
      ),
      new RegExp(
        String.raw`(?<![\d,.])(\d{4,})(?![\d,.])\s+of\s+|(?:\bof\s+)(?<![\d,.])(\d{4,})(?![\d,.])`,
        "gi",
      ),
    ];
    const isYear = (n: number) => n >= 1900 && n <= 2099;
    for (const r of rows) {
      // Every string this module renders, not only `covered`.
      const text = [r.label, r.covered, r.derivation, r.blocker, r.target].join(" ");
      for (const re of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const raw = m[1] ?? m[2];
          if (!raw || isYear(Number(raw))) continue;
          expect.fail(
            `${r.id}: bare count "${raw}" in "${m[0]}" — write ${Number(raw).toLocaleString("en-US")}`,
          );
        }
      }
    }
  });
});

describe("coverage map — the crosswalk gap is framed as a methodology limit", () => {
  const r = () => byId.get(CROSSWALK_LIMIT_ID)!;

  it("names account-code coarseness as the reason, and DARPA as the exception", () => {
    expect(r().blocker).toMatch(/account code/i);
    expect(r().blocker).toMatch(/coarse/i);
    expect(r().blocker).toMatch(/DARPA/);
  });

  it("has no dated target, and says the limit is methodological", () => {
    expect(r().targetKind).toBe("none");
    expect(r().target.toLowerCase()).toContain("no dated target");
    expect(r().target.toLowerCase()).toMatch(/methodolog/);
  });

  it("does not describe itself as a backlog item or as unfinished work", () => {
    const t = `${r().blocker} ${r().target}`.toLowerCase();
    expect(t).not.toMatch(/not (yet )?(done|started|built)/);
    expect(t).not.toMatch(/coming soon/);
  });
});
