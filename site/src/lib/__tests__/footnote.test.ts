/**
 * footnote.test.ts — unified copy-as-footnote formatter (PM Sprint 1 Task 4,
 * spec §P0-3).
 *
 * CONTRACT TESTS: the default (Chicago-flavored) style must reproduce the
 * gate-23 leg (c) goldens in scripts/gates/goldens/footnotes/ EXACTLY —
 * those files are the contract (never edited to match output).
 *
 * STYLE GOLDENS: the ap / bibtex / json variants are pinned by committed
 * fixtures in __tests__/goldens/footnotes/ (authored here, reviewed by hand).
 *
 * PANEL PATH: footnoteInputFromCitation maps a live citation payload (the
 * cite-shard row shape) + the threaded figure/program context into the
 * formatter input; for the pdf and workbook golden facts the end-to-end
 * panel path must reproduce the gate goldens verbatim.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  formatFootnote,
  footnoteInputFromCitation,
  documentTitleFromUrl,
  type FootnoteInput,
} from "../footnote";

const __dir = dirname(fileURLToPath(import.meta.url));
const gateGoldensDir = join(
  __dir,
  "..",
  "..",
  "..",
  "scripts",
  "gates",
  "goldens",
  "footnotes",
);
const styleGoldensDir = join(__dir, "goldens", "footnotes");

const TIERS = ["pdf", "workbook", "derived"] as const;

function gateFixture(tier: string): FootnoteInput {
  return JSON.parse(
    readFileSync(join(gateGoldensDir, `${tier}.input.json`), "utf8"),
  ) as FootnoteInput;
}
function gateGolden(tier: string): string {
  return readFileSync(join(gateGoldensDir, `${tier}.txt`), "utf8").trim();
}
function styleGolden(tier: string, style: string): string {
  return readFileSync(
    join(styleGoldensDir, `${tier}.${style}.txt`),
    "utf8",
  ).replace(/\n$/, "");
}

// ── Default style: the gate-23 golden contract ─────────────────────────────

describe("formatFootnote — default style reproduces the gate goldens", () => {
  for (const tier of TIERS) {
    it(`${tier} fixture → ${tier}.txt verbatim`, () => {
      expect(formatFootnote(gateFixture(tier))).toBe(gateGolden(tier));
    });
    it(`${tier} fixture → explicit "chicago" equals the default`, () => {
      expect(formatFootnote(gateFixture(tier), "chicago")).toBe(
        formatFootnote(gateFixture(tier)),
      );
    });
  }
});

// ── Variant styles: pinned by committed fixtures ───────────────────────────

describe("formatFootnote — ap / bibtex / json variants match style goldens", () => {
  for (const tier of TIERS) {
    for (const style of ["ap", "bibtex", "json"] as const) {
      it(`${tier} fixture → ${tier}.${style}.txt verbatim`, () => {
        expect(formatFootnote(gateFixture(tier), style)).toBe(
          styleGolden(tier, style),
        );
      });
    }
  }

  it("json variant is valid JSON carrying the full field set", () => {
    const parsed = JSON.parse(formatFootnote(gateFixture("pdf"), "json"));
    expect(parsed.source).toBe("Fiscal Receipts");
    expect(parsed.fact_id).toBe("bb54b1658b2746cb");
    expect(parsed.permalink).toBe("https://fiscalreceipts.com/fact/bb54b165");
    expect(parsed.program).toBe("F-35");
    expect(parsed.program_code).toBe("ATA000");
    expect(parsed.fiscal_year).toBe(2024);
    expect(parsed.row).toBe("Net Procurement (P-1)");
    expect(parsed.value).toBe("$5,247.070 million");
    expect(parsed.sha256).toMatch(/^528d1441/);
    expect(parsed.retrieved).toBe("2026-07-05");
  });
});

// ── Field completeness (mirror of the gate's per-tier manifest) ────────────

describe("formatFootnote — every style carries the required field set", () => {
  for (const tier of TIERS) {
    for (const style of ["chicago", "ap", "bibtex", "json"] as const) {
      it(`${tier} / ${style}: program, FY, row, value+unit, retrieved, permalink`, () => {
        const fixture = gateFixture(tier);
        const text = formatFootnote(fixture, style);
        expect(text).toContain(fixture.program!.name);
        expect(text).toContain(fixture.program!.code);
        // JSON carries the year as a structured field, prose styles as FY{Y}
        if (style === "json") {
          expect(JSON.parse(text).fiscal_year).toBe(fixture.fiscalYear);
        } else {
          expect(text).toMatch(new RegExp(`FY\\s*${fixture.fiscalYear}`));
        }
        expect(text).toContain(fixture.rowName!);
        // bibtex escapes $ and _ in values — compare against the escaped form
        const value =
          style === "bibtex"
            ? fixture.valueText!.replace(/([$_])/g, "\\$1")
            : fixture.valueText!;
        expect(text).toContain(value);
        expect(text).toContain(fixture.retrievedAt!);
        expect(text).toContain(fixture.permalink);
        if (tier === "pdf" || tier === "workbook") {
          expect(text).toContain(fixture.docTitle!);
          if (style === "json") {
            expect(JSON.parse(text).sha256).toBe(fixture.sha256);
          } else {
            expect(text).toMatch(/SHA-256/i);
          }
        }
        if (tier === "derived") {
          for (const fid of fixture.inputFactIds!) {
            expect(text).toContain(
              `https://fiscalreceipts.com/fact/${fid.slice(0, 8)}`,
            );
          }
        }
      });
    }
  }
});

// ── Graceful omission — never "null"/"undefined" in output ─────────────────

describe("formatFootnote — missing fields drop their segment", () => {
  it("minimal input still renders site, permalink, retrieved", () => {
    const s = formatFootnote({
      tier: "generic",
      factId: "abcdef0123456789",
      retrievedAt: "2026-07-30",
      permalink: "https://fiscalreceipts.com/fact/abcdef01",
    });
    expect(s).toContain("Fiscal Receipts");
    expect(s).toContain("https://fiscalreceipts.com/fact/abcdef01");
    expect(s).toContain("2026-07-30");
    expect(s).not.toMatch(/null|undefined/);
  });

  it("pdf tier without program/fy/row still emits doc + sha + permalink", () => {
    const fixture = gateFixture("pdf");
    const s = formatFootnote({
      ...fixture,
      program: null,
      fiscalYear: null,
      rowName: null,
    });
    expect(s).toContain(fixture.docTitle!);
    expect(s).toContain("SHA-256 528d1441");
    expect(s).toContain(fixture.permalink);
    expect(s).not.toMatch(/null|undefined/);
  });

  it("non-numeric fiscal-year tokens are not rendered as FYall-years", () => {
    const s = formatFootnote({
      ...gateFixture("pdf"),
      fiscalYear: "all-years",
    });
    expect(s).not.toMatch(/FYall/);
    expect(s).not.toMatch(/null|undefined/);
  });
});

// ── Document-title mapping (shard payloads carry only official_url) ────────

describe("documentTitleFromUrl", () => {
  it("workbook p1_display: FY from path + curated exhibit title", () => {
    expect(
      documentTitleFromUrl(
        "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/p1_display.xlsx",
        "workbook",
      ),
    ).toBe("FY2026 Department of Defense Budget: Procurement Programs (P-1)");
  });

  it("workbook r1_display: lowercase fy path variant", () => {
    expect(
      documentTitleFromUrl(
        "https://comptroller.war.gov/Portals/45/Documents/defbudget/fy2017/r1_display.xlsx",
        "workbook",
      ),
    ).toBe("FY2017 Department of Defense Budget: RDT&E Programs (R-1)");
  });

  it("jbook pdf: filename normalized (FY26 → FY2026, Vol I → , Vol. I)", () => {
    expect(
      documentTitleFromUrl(
        "https://www.saffm.hq.af.mil/Portals/84/documents/FY26/FY26%20Air%20Force%20Aircraft%20Procurement%20Vol%20I.pdf#page=55",
        "jbook_pdf",
      ),
    ).toBe("FY2026 Air Force Aircraft Procurement, Vol. I");
  });

  it("jbook pdf: underscore filenames become readable, never invented", () => {
    expect(
      documentTitleFromUrl(
        "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/budget_justification/pdfs/03_RDT_and_E/RDTE_OSD_PB_2026.pdf",
        "jbook_pdf",
      ),
    ).toBe("RDTE OSD PB 2026");
  });

  it("army volume filenames keep their hyphenated structure", () => {
    expect(
      documentTitleFromUrl(
        "https://example.mil/RDTE%20-%20Vol%201%20-%20Budget%20Activity%202.pdf",
        "jbook_pdf",
      ),
    ).toBe("RDTE - Vol 1 - Budget Activity 2");
  });

  it("returns null for missing urls", () => {
    expect(documentTitleFromUrl(null, "workbook")).toBeNull();
  });
});

// ── Panel path: live payload + threaded context → the golden line ──────────

/** The REAL cite-shard rows for the golden facts (data/site/json/cite-shards),
 *  with retrieved_at pinned to the timestamps the goldens cite. */
const PDF_CITATION = {
  kind: "jbook_pdf",
  amount_text: "5,247.070",
  amount_thousands: null,
  cells: null,
  formula: null,
  inputs: null,
  hosted_pdf_url:
    "/pdfs/528d14414585406684021e04e74632cccf4b40f8ba039f89f8af1ddebc7bc01e.pdf#page=55",
  official_url:
    "https://www.saffm.hq.af.mil/Portals/84/documents/FY26/FY26%20Air%20Force%20Aircraft%20Procurement%20Vol%20I.pdf#page=55",
  page_number: 55,
  recorded_value: null,
  retrieved_at: "2026-07-05T01:16:15.825537-04:00",
  sha256: "528d14414585406684021e04e74632cccf4b40f8ba039f89f8af1ddebc7bc01e",
  sheet: null,
  units: "USD millions",
};

const WORKBOOK_CITATION = {
  kind: "workbook",
  amount_text: null,
  amount_thousands: 5565655.0,
  cells: "O839,O840,O841",
  formula: null,
  inputs: null,
  hosted_pdf_url: null,
  official_url:
    "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/p1_display.xlsx",
  page_number: null,
  recorded_value: null,
  retrieved_at: "2026-06-10T16:08:15.686145-04:00",
  sha256: "4d965906ad91aa8b7d6d5f891a0717ac25ace6c18f3d50df07ebde611774a9c0",
  sheet: "Exhibit P-1",
  units: "USD thousands",
};

const DERIVED_CITATION = {
  kind: "derived",
  amount_text: null,
  amount_thousands: null,
  cells: null,
  formula:
    "PB2026 FY2024 actuals - PB2024 FY2024 request (fct_book_diff request_vs_actuals)",
  inputs: '["5b532c52d3ebb4c2", "666be82264352b75"]',
  hosted_pdf_url: null,
  official_url: null,
  page_number: null,
  recorded_value: "286534.000",
  retrieved_at: "2026-07-29T18:00:00.000000+00:00",
  sha256: null,
  sheet: null,
  units: "USD thousands",
};

const F35 = { name: "F-35", code: "ATA000" };
const ORIGIN = "https://fiscalreceipts.com";

describe("footnoteInputFromCitation — the panel path", () => {
  it("pdf golden fact end-to-end: citation + figure ctx → pdf.txt verbatim", () => {
    const input = footnoteInputFromCitation(PDF_CITATION, "bb54b1658b2746cb", {
      origin: ORIGIN,
      program: F35,
      figure: {
        value: 5247.07,
        units: "USD millions",
        fy: 2024,
        measure: "actuals",
        basis: "jbook-detail",
        entity: "ATA000",
        edition: 2026,
      },
    });
    expect(formatFootnote(input)).toBe(gateGolden("pdf"));
  });

  it("workbook golden fact end-to-end: citation + figure ctx → workbook.txt verbatim", () => {
    const input = footnoteInputFromCitation(
      WORKBOOK_CITATION,
      "5b532c52d3ebb4c2",
      {
        origin: ORIGIN,
        program: F35,
        figure: {
          value: 5565655,
          units: "USD thousands",
          fy: 2024,
          measure: "actuals",
          basis: "toa",
          edition: 2026,
        },
      },
    );
    expect(formatFootnote(input)).toBe(gateGolden("workbook"));
  });

  it("derived fact: formula, both input-fact permalinks, value with unit", () => {
    const input = footnoteInputFromCitation(
      DERIVED_CITATION,
      "cde21cb5a87292ec",
      {
        origin: ORIGIN,
        program: F35,
        figure: { fy: 2024, measure: "request-vs-actuals", basis: "toa" },
      },
    );
    const s = formatFootnote(input);
    expect(s).toContain("F-35 (ATA000)");
    expect(s).toContain("FY2024");
    expect(s).toContain("$286,534 thousand");
    expect(s).toContain(
      "Derived: PB2026 FY2024 actuals - PB2024 FY2024 request (fct_book_diff request_vs_actuals)",
    );
    expect(s).toContain("https://fiscalreceipts.com/fact/5b532c52");
    expect(s).toContain("https://fiscalreceipts.com/fact/666be822");
    expect(s).toContain("https://fiscalreceipts.com/fact/cde21cb5");
    expect(s).toMatch(/retrieved 2026-07-29/i);
    expect(s).not.toMatch(/null|undefined/);
  });

  it("no figure/program ctx (drill-down open): complete citation-side fields, no fabricated row/FY", () => {
    const input = footnoteInputFromCitation(PDF_CITATION, "bb54b1658b2746cb", {
      origin: ORIGIN,
      pageLabel: "F-35",
    });
    const s = formatFootnote(input);
    expect(s).toContain("F-35"); // page-label fallback head
    expect(s).toContain("FY2026 Air Force Aircraft Procurement, Vol. I");
    expect(s).toContain("$5,247.070 million"); // amount_text is citation-side
    expect(s).toContain("SHA-256 528d1441");
    expect(s).toContain("https://fiscalreceipts.com/fact/bb54b165");
    // The figure's FY and row are threaded context — without them the
    // footnote must OMIT them, never guess.
    expect(s).not.toMatch(/FY2024/);
    expect(s).not.toMatch(/Net Procurement/);
    expect(s).not.toMatch(/null|undefined/);
  });

  it("rdte jbook-detail figure derives the R-2 row name, not P-40", () => {
    const input = footnoteInputFromCitation(
      {
        ...PDF_CITATION,
        official_url:
          "https://www.saffm.hq.af.mil/Portals/84/documents/FY26/FY26%20Air%20Force%20Research%20and%20Development%20Test%20and%20Evaluation%20Vol%20I.pdf#page=100",
      },
      "bb54b1658b2746cb",
      {
        origin: ORIGIN,
        program: F35,
        figure: {
          value: 5247.07,
          units: "USD millions",
          fy: 2024,
          measure: "actuals",
          basis: "jbook-detail",
          edition: 2026,
        },
      },
    );
    const s = formatFootnote(input);
    expect(s).toContain("Total Program Element");
    expect(s).toContain("Exhibit R-2");
    expect(s).not.toContain("Net Procurement");
  });

  it("project-level entity never claims the program-total row name", () => {
    const input = footnoteInputFromCitation(PDF_CITATION, "bb54b1658b2746cb", {
      origin: ORIGIN,
      program: F35,
      figure: {
        value: 100,
        units: "USD millions",
        fy: 2024,
        measure: "actuals",
        basis: "jbook-detail",
        entity: "ATA000/674794", // project-scoped — the P-40A row, not the total
        edition: 2026,
      },
    });
    expect(formatFootnote(input)).not.toContain("Net Procurement");
  });
});
