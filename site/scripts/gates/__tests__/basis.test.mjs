/**
 * Unit tests for gate 23 (basis.mjs) helpers — value normalization,
 * 3-significant-digit agreement, FY-label token extraction, the golden
 * footnote field-manifest parser, and leg (f)'s chip classification (#48).
 * Run via `npm test` (vitest).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  normalizeAmount,
  valuesAgree,
  fyTokensFromLabel,
  validateGoldenFootnote,
  chipExhibitClaim,
  isBasisChipClassName,
} from "../basis.mjs";

const goldensDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "goldens",
  "footnotes",
);

// ── normalizeAmount ──────────────────────────────────────────────────────────

describe("normalizeAmount", () => {
  it("parses $/B/M/K suffixed figures to dollars", () => {
    expect(normalizeAmount("$5.25B")).toBe(5.25e9);
    expect(normalizeAmount("$286.5M")).toBe(286.5e6);
    expect(normalizeAmount("$318.6K")).toBe(318.6e3);
    expect(normalizeAmount("$3.66T")).toBe(3.66e12);
  });

  it("parses comma-grouped plain dollars", () => {
    expect(normalizeAmount("$5,247.07")).toBeCloseTo(5247.07, 6);
    expect(normalizeAmount("$4,972,514")).toBe(4972514);
  });

  it("tolerates surrounding whitespace", () => {
    expect(normalizeAmount("  $4.09B ")).toBe(4.09e9);
  });

  it("returns null for absences, prose, and non-currency text", () => {
    expect(normalizeAmount("—")).toBeNull();
    expect(normalizeAmount("–")).toBeNull();
    expect(normalizeAmount("")).toBeNull();
    expect(normalizeAmount("FY24 Actuals")).toBeNull();
    expect(normalizeAmount("$5.25B requested")).toBeNull(); // not a lone figure
    expect(normalizeAmount(null)).toBeNull();
  });
});

// ── valuesAgree ──────────────────────────────────────────────────────────────

describe("valuesAgree (3-significant-digit tolerance)", () => {
  it("a rendered rounding of the exact value agrees ($5.25B ~ $5,247.07M)", () => {
    expect(valuesAgree(5.25e9, 5247.07e6)).toBe(true);
  });

  it("the P0-1 collision values do NOT agree ($5.25B vs $5.57B)", () => {
    expect(valuesAgree(5.25e9, 5.57e9)).toBe(false);
  });

  it("the P0-1 FY26 collision values do NOT agree ($4.09B vs $3.56B)", () => {
    expect(valuesAgree(4.09e9, 3.56e9)).toBe(false);
  });

  it("units normalize: $4,972,514 thousand-scale display ~ $4.97B", () => {
    // decade cell renders $4.97B; title carries $4,972,514 (USD thousands)
    expect(valuesAgree(4.97e9, 4972514e3)).toBe(true);
  });

  it("identical and zero values agree; null never agrees", () => {
    expect(valuesAgree(5e9, 5e9)).toBe(true);
    expect(valuesAgree(0, 0)).toBe(true);
    expect(valuesAgree(null, 5e9)).toBe(false);
    expect(valuesAgree(5e9, null)).toBe(false);
  });
});

// ── fyTokensFromLabel ────────────────────────────────────────────────────────

describe("fyTokensFromLabel", () => {
  it("extracts a single 2-digit FY", () => {
    expect(fyTokensFromLabel("FY24 Actuals")).toEqual({ years: [2024], change: false });
    expect(fyTokensFromLabel("FY25 Total")).toEqual({ years: [2025], change: false });
  });

  it("extracts 4-digit FYs", () => {
    expect(fyTokensFromLabel("FY2026 Request")).toEqual({ years: [2026], change: false });
  });

  it("extracts change-card endpoint pairs", () => {
    expect(fyTokensFromLabel("FY25→26 Change")).toEqual({
      years: [2025, 2026],
      change: true,
    });
  });

  it("returns empty for labels without FY tokens", () => {
    expect(fyTokensFromLabel("All Prior Years")).toEqual({ years: [], change: false });
  });
});

// ── validateGoldenFootnote (golden parser) ───────────────────────────────────

function loadGolden(tier) {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(goldensDir, `${tier}.input.json`), "utf8"),
  );
  const golden = fs.readFileSync(path.join(goldensDir, `${tier}.txt`), "utf8").trim();
  return { fixture, golden };
}

describe("validateGoldenFootnote", () => {
  it.each(["pdf", "workbook", "derived"])(
    "the committed %s golden satisfies its own field manifest",
    (tier) => {
      const { fixture, golden } = loadGolden(tier);
      expect(validateGoldenFootnote(fixture, golden)).toEqual([]);
    },
  );

  it("flags the CURRENT (pre-fix) pdf-tier footnote as incomplete (P0-3)", () => {
    const { fixture } = loadGolden("pdf");
    // Verbatim current production output (spec §P0-3 "Actual output").
    const current =
      "F-35: 5,247.070 — FY26 Air Force Aircraft Procurement Vol I.pdf, p.55; " +
      "sha256:528d14414585406684021e04e74632cccf4b40f8ba039f89f8af1ddebc7bc01e; " +
      "retrieved 2026-07-05; https://fiscalreceipts.com/program/ATA000/";
    const missing = validateGoldenFootnote(fixture, current);
    // The exact hazards P0-3 names: no unit, no FY, no row name, no document
    // title (filename only), no fact permalink.
    expect(missing.join("; ")).toMatch(/value with unit/);
    expect(missing.join("; ")).toMatch(/fiscal year/i);
    expect(missing.join("; ")).toMatch(/row\/field name/);
    expect(missing.join("; ")).toMatch(/fact permalink/);
  });

  it("flags a footnote missing the sha256 (pdf tier)", () => {
    const { fixture, golden } = loadGolden("pdf");
    const tampered = golden.replace(/SHA-256 [0-9a-f]{8}…/, "");
    expect(validateGoldenFootnote(fixture, tampered).join("; ")).toMatch(/sha256/);
  });

  it("flags a workbook footnote missing sheet/cells locator", () => {
    const { fixture, golden } = loadGolden("workbook");
    const noSheet = golden.replace("sheet Exhibit P-1, ", "").replace("Exhibit P-1", "");
    expect(validateGoldenFootnote(fixture, noSheet).join("; ")).toMatch(/sheet locator/);
    const noCells = golden.replace("cells O839,O840,O841", "");
    expect(validateGoldenFootnote(fixture, noCells).join("; ")).toMatch(/cells locator/);
  });

  it("flags a derived footnote missing formula or input permalinks", () => {
    const { fixture, golden } = loadGolden("derived");
    const noFormula = golden.replace(fixture.formula, "");
    expect(validateGoldenFootnote(fixture, noFormula).join("; ")).toMatch(
      /derivation formula/,
    );
    const noInput = golden.replace("https://fiscalreceipts.com/fact/666be822", "");
    expect(validateGoldenFootnote(fixture, noInput).join("; ")).toMatch(
      /input fact permalink/,
    );
  });

  it("flags a footnote missing the retrieved date", () => {
    const { fixture, golden } = loadGolden("workbook");
    const tampered = golden.replace(/retrieved \d{4}-\d{2}-\d{2}/i, "retrieved");
    expect(validateGoldenFootnote(fixture, tampered).join("; ")).toMatch(
      /retrieved date/,
    );
  });
});

// ── chipExhibitClaim / isBasisChipClassName — leg (f) (#48) ─────────────────

describe("chipExhibitClaim", () => {
  it("reads an RDT&E chip", () => {
    expect(chipExhibitClaim("R-1 TOA · PB2026")).toBe("rdte");
  });

  it("reads a procurement chip", () => {
    expect(chipExhibitClaim("P-1 TOA · PB2026")).toBe("procurement");
  });

  it("reads the combined both-exhibits chip as mixed, not procurement", () => {
    // The leading substring is literally "P-1" for both forms — the "/"
    // check must run BEFORE the "P-1 " (space) check, or every mixed chip
    // misreads as a procurement claim.
    expect(chipExhibitClaim("P-1/R-1 TOA · PB2026")).toBe("mixed");
  });

  it("returns null for a non-TOA chip (no opinion)", () => {
    expect(chipExhibitClaim("P-40 detail · PB2026")).toBeNull();
  });

  it("returns null for empty/absent text", () => {
    expect(chipExhibitClaim("")).toBeNull();
    expect(chipExhibitClaim(null)).toBeNull();
    expect(chipExhibitClaim(undefined)).toBeNull();
  });
});

describe("isBasisChipClassName", () => {
  // The exact className cite.tsx renders the chip with (Cite's basisChip and
  // CiteChips' chipText spans — verified identical at both call sites).
  const CHIP_CLASS =
    "ml-1 inline-block whitespace-nowrap rounded border border-border bg-muted px-1 py-0.5 align-middle font-sans text-xs font-normal leading-none text-muted-foreground no-underline";

  it("matches the chip's real rendered class string", () => {
    expect(isBasisChipClassName(CHIP_CLASS)).toBe(true);
  });

  it("does not match the fact-id chip's class (.cite-id-chip, a named class — no overlapping tokens)", () => {
    expect(isBasisChipClassName("cite-id-chip")).toBe(false);
  });

  it("does not match an unrelated span missing the distinguishing tokens", () => {
    expect(isBasisChipClassName("text-xs text-muted-foreground")).toBe(false);
  });

  it("handles missing/empty class attributes", () => {
    expect(isBasisChipClassName(null)).toBe(false);
    expect(isBasisChipClassName(undefined)).toBe(false);
    expect(isBasisChipClassName("")).toBe(false);
  });
});
