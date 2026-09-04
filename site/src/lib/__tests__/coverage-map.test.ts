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
  // Backlog #35: the detail-grade tier is NOT the index length. Kept
  // deliberately different from `programs` so a row that reaches for the
  // wrong one fails here.
  detailGrade: 1230,
  programPages: 1500,
  // ROADMAP #28: the non-detail remainder is two claims, deliberately
  // UNEQUAL so a row that describes one and means both fails here. Their
  // sum is programPages − detailGrade = 270 (the row asserts it).
  remainder: { workbookOnly: 190, decadeOnly: 80, unclassified: [] },
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
  getDetailGradeCount: () => MOCK.detailGrade,
  getProgramPagesCount: () => MOCK.programPages,
  getPagesWithoutDetail: () => MOCK.remainder,
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
      // A target — dated or not — has to be a statement, not a shrug. Same
      // floor as the blocker: "TBD" and "No dated target." both fail here.
      expect(r.target.length, r.id).toBeGreaterThan(60);
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

  /**
   * TARGET POLICY (Sprint 3 round-3, the site owner's decision).
   *
   * The first cut of this page published eight dated targets that the
   * implementing agent picked on its own. The owner reviewed them and decided
   * the site should not publish dates nobody has committed to — so the
   * targets ship UNDATED, with every blocker kept verbatim.
   *
   * What the tests pin is therefore the property, not the count: an undated
   * target must say it is undated, must still name the work that is planned,
   * and must never read as abandonment. A dated target remains legal — it
   * just has to name a month and a year, so a date can only be added
   * deliberately.
   */
  it("an undated target names the planned work and never reads as abandoned", () => {
    const undated = rows.filter((r) => r.targetKind === "none");
    expect(undated.length).toBeGreaterThan(0);
    for (const r of undated) {
      const t = r.target.toLowerCase();
      expect(t, r.id).toMatch(/no dated target/);
      expect(t, r.id).not.toMatch(/\bno plans?\b|not planned|abandoned|shelved/);
    }
  });
});

describe("coverage map — every number is read, never authored", () => {
  it("program pages: detail-grade over the browsable universe", () => {
    const r = byId.get("program-pages")!;
    expect(r.numerator).toBe(MOCK.detailGrade);
    expect(r.denominator).toBe(MOCK.programPages);
    expect(r.covered).toContain("1,230 of 1,500");
    // …and the remainder is measured against the DETAIL tier, so a
    // regression to the index count would move it by two. ROADMAP #28: it
    // is now stated as TWO tiers, because they are different claims — a
    // rollup page has FY2026 workbook figures and no R-2/P-40 narrative; a
    // decade page has no FY2026 workbook line at all. Asserting both, and
    // that neither is the undifferentiated 270, is what stops the row
    // reverting to one sentence for both.
    expect(r.covered).toContain("190");
    expect(r.covered).toContain("80");
    expect(r.covered).not.toContain("270");
    expect(r.blocker).toContain("190");
    expect(r.blocker).toContain("80");
  });

  it("program pages: a page the row does not describe is a build failure", () => {
    // The two named halves must account for the whole non-detail remainder.
    // A first cut of this split counted tier labels instead of page content
    // and left the two backlog-#17 trajectory-only programs (a
    // programs.json row, no J-book detail, five FY2026 workbook rows each)
    // in neither — which failed the real build, correctly.
    expect(MOCK.remainder.workbookOnly + MOCK.remainder.decadeOnly).toBe(
      MOCK.programPages - MOCK.detailGrade,
    );
    expect(MOCK.remainder.unclassified).toHaveLength(0);
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

  it("names account-code coarseness as the reason, and states the evidence path behind each tier", () => {
    expect(r().blocker).toMatch(/account code/i);
    expect(r().blocker).toMatch(/coarse/i);
    expect(r().blocker).toMatch(/hand-adjudicated/i);
    expect(r().blocker).toMatch(/high means the contract/i);
    expect(r().blocker).toMatch(/independent adversarial reviewers/i);
    expect(r().blocker).toMatch(/medium means only/i);
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
