import { describe, it, expect } from "vitest";
import {
  basisChipForExhibit,
  exhibitFamilyFromSheet,
  normalizeExhibitFamily,
} from "../basis";

describe("basisChipForExhibit", () => {
  it("labels an RDT&E line R-1", () => {
    expect(basisChipForExhibit("toa", "rdte")).toBe("R-1 TOA");
  });

  it("labels a procurement line P-1", () => {
    expect(basisChipForExhibit("toa", "procurement")).toBe("P-1 TOA");
  });

  it("labels a mixed aggregate with both exhibits", () => {
    expect(basisChipForExhibit("toa", "mixed")).toBe("P-1/R-1 TOA");
  });

  it("falls back to the mixed label when the exhibit is unknown", () => {
    // An unlabelled aggregate must not claim a single exhibit it cannot prove.
    expect(basisChipForExhibit("toa", null)).toBe("P-1/R-1 TOA");
  });

  it("leaves non-TOA bases alone", () => {
    expect(basisChipForExhibit("jbook-detail", "rdte")).toBe("P-40 detail");
  });
});

// ── exhibitFamilyFromSheet — the workbook citation's OWN locator ────────────
//
// The citation record for a TOA figure already states which sheet it was
// pulled from ("Exhibit R-1" / "Exhibit P-1" / "Exhibit P-1R"). The drawer
// and the /fact/ permalink page both have this string in scope without any
// program lookup, so it is the tightest available signal at those two call
// sites — verified against the shipped corpus (data/site/json/cite-shards/):
// exactly these three values occur, 27,578 / 7,959 / 403 times.
describe("exhibitFamilyFromSheet", () => {
  it("reads R-1 as rdte", () => {
    expect(exhibitFamilyFromSheet("Exhibit R-1")).toBe("rdte");
  });

  it("reads P-1 as procurement", () => {
    expect(exhibitFamilyFromSheet("Exhibit P-1")).toBe("procurement");
  });

  it("reads the combined P-1R sheet as procurement (footnote.ts's own WORKBOOK_TITLES calls p1r_display.xlsx \"Procurement Programs\")", () => {
    expect(exhibitFamilyFromSheet("Exhibit P-1R")).toBe("procurement");
  });

  it("returns null — never a guess — for a missing or unrecognized sheet", () => {
    expect(exhibitFamilyFromSheet(null)).toBeNull();
    expect(exhibitFamilyFromSheet(undefined)).toBeNull();
    expect(exhibitFamilyFromSheet("Some Other Sheet")).toBeNull();
  });
});

// ── normalizeExhibitFamily — narrows the corpus's raw token ─────────────────
//
// ProgramRow.exhibit_family is a raw `string` (program-header.tsx's own
// exhibitFamilyLabel() defensively handles "om"/"milpers"/unknown tokens for
// the badge). The chip vocabulary only knows two single exhibits; an
// unrecognized token must degrade to the honest mixed form rather than
// silently rendering as if it were rdte or procurement.
describe("normalizeExhibitFamily", () => {
  it("passes through the two known tokens", () => {
    expect(normalizeExhibitFamily("rdte")).toBe("rdte");
    expect(normalizeExhibitFamily("procurement")).toBe("procurement");
  });

  it("degrades an unrecognized token to null (→ mixed chip), never a guess", () => {
    expect(normalizeExhibitFamily("om")).toBeNull();
    expect(normalizeExhibitFamily("milpers")).toBeNull();
    expect(normalizeExhibitFamily(null)).toBeNull();
    expect(normalizeExhibitFamily(undefined)).toBeNull();
  });
});
