import { describe, it, expect } from "vitest";

import {
  deriveExhibitFamily,
  isIngestedServiceOrg,
  isRollupDetails,
  isZeroContentDetails,
  rollupProgramRow,
  serviceOrgName,
} from "@/lib/program-tier";
import type { ProgramDetails } from "@/lib/data";

/** Minimal rollup sidecar factory (shape of Batch A rollup exports). */
function rollupDetails(overrides: Partial<ProgramDetails> = {}): ProgramDetails {
  return {
    awards: [],
    budget_lines: [
      {
        account_title: "Industrial Preparedness",
        amount_thousands: 793,
        amount_type: "fy_2024_actuals",
        exhibit: "R-1",
        fact_id: "78b0453bb190f251",
        organization: "F",
        source_cells: "A1:B2",
        source_sheet: "Exhibit R-1",
        units: "USD thousands",
      },
    ],
    details: [],
    mentions: [],
    narratives: [],
    tier: "rollup",
    service_org: "F",
    title: "Industrial Preparedness/Pol Prevention",
    trajectory: {
      fy2024_actuals: 793,
      fy2025_total: null,
      fy2026_total: 917,
      fy2526_change: null,
      fy2526_pct_change: null,
    },
    trajectory_fact_ids: {
      fy2024_actuals: "78b0453bb190f251",
      fy2025_total: null,
      fy2026_total: "9a7a0e4bb33799d4",
      fy2526_change: null,
    },
    ...overrides,
  };
}

describe("serviceOrgName", () => {
  it("maps the three service workbook codes to service names", () => {
    expect(serviceOrgName("A")).toBe("Army");
    expect(serviceOrgName("N")).toBe("Navy");
    expect(serviceOrgName("F")).toBe("Air Force");
  });

  it("passes other org codes through unchanged (honest fallback)", () => {
    expect(serviceOrgName("DHA")).toBe("DHA");
    expect(serviceOrgName("OSD")).toBe("OSD");
    expect(serviceOrgName("")).toBe("");
  });
});

describe("isIngestedServiceOrg", () => {
  it("is true for Navy (FY2026 books ingested in Phase 5G)", () => {
    expect(isIngestedServiceOrg("N")).toBe(true);
  });

  it("is false for the still-uningested services and non-service codes", () => {
    // Army and Air Force stay on the manual path.
    expect(isIngestedServiceOrg("A")).toBe(false);
    expect(isIngestedServiceOrg("F")).toBe(false);
    // Defense-wide / other org codes are not service J-book codes.
    expect(isIngestedServiceOrg("DHA")).toBe(false);
    expect(isIngestedServiceOrg("OSD")).toBe(false);
    expect(isIngestedServiceOrg("")).toBe(false);
  });
});

describe("isRollupDetails", () => {
  it("is true only for tier:'rollup' sidecars", () => {
    expect(isRollupDetails(rollupDetails())).toBe(true);
    expect(
      isRollupDetails({
        awards: [],
        budget_lines: [],
        details: [],
        mentions: [],
        narratives: [],
      }),
    ).toBe(false);
  });
});

describe("deriveExhibitFamily", () => {
  it("maps R-1 lines to rdte and P-1/P-1R lines to procurement", () => {
    expect(deriveExhibitFamily([{ exhibit: "R-1" }])).toBe("rdte");
    expect(deriveExhibitFamily([{ exhibit: "P-1" }])).toBe("procurement");
    expect(deriveExhibitFamily([{ exhibit: "P-1R" }])).toBe("procurement");
  });

  it("picks the family with more lines when mixed, and 'budget' when empty", () => {
    expect(
      deriveExhibitFamily([
        { exhibit: "P-1" },
        { exhibit: "P-1R" },
        { exhibit: "R-1" },
      ]),
    ).toBe("procurement");
    expect(deriveExhibitFamily([])).toBe("budget");
  });
});

describe("rollupProgramRow", () => {
  it("synthesizes a ProgramRow-shaped record from a rollup sidecar", () => {
    const row = rollupProgramRow("0708011F", rollupDetails());
    expect(row.pe_bli).toBe("0708011F");
    expect(row.title).toBe("Industrial Preparedness/Pol Prevention");
    expect(row.org).toBe("Air Force");
    expect(row.exhibit_family).toBe("rdte");
    expect(row.fully_reconciled).toBe(false);
    expect(row.fy2024_actual_millions).toBeNull();
    expect(row.fy2024_fact_id).toBeNull();
    expect(row.fy2024_xml_path).toBeNull();
    expect(row.hhi).toBeNull();
    expect(row.trajectory?.fy2026_total).toBe(917);
    expect(row.trajectory_fact_ids?.fy2026_total).toBe("9a7a0e4bb33799d4");
    expect(row.award_count).toBe(0);
    expect(row.narrative_count).toBe(0);
    expect(row.project_count).toBe(0);
  });

  it("falls back to the PE code when the sidecar has no title", () => {
    const row = rollupProgramRow("000042", rollupDetails({ title: undefined }));
    expect(row.title).toBe("000042");
  });
});

describe("isZeroContentDetails", () => {
  it("flags a rollup page whose only figures are zeros (noindex policy)", () => {
    const zero = rollupDetails({
      budget_lines: [
        {
          account_title: "x",
          amount_thousands: 0,
          amount_type: "fy_2024_actuals",
          exhibit: "P-1",
          fact_id: "aaaaaaaaaaaaaaaa",
          organization: "N",
          source_cells: "A1",
          source_sheet: "s",
          units: "USD thousands",
        },
      ],
      trajectory: {
        fy2024_actuals: 0,
        fy2025_total: null,
        fy2026_total: 0,
        fy2526_change: null,
        fy2526_pct_change: null,
      },
    });
    expect(isZeroContentDetails(zero)).toBe(true);
  });

  it("keeps pages with any non-zero figure indexable", () => {
    expect(isZeroContentDetails(rollupDetails())).toBe(false);
  });

  it("keeps pages with narratives/details/awards/mentions indexable even when figures are zero", () => {
    const withNarrative = rollupDetails({
      budget_lines: [],
      trajectory: {
        fy2024_actuals: 0,
        fy2025_total: null,
        fy2026_total: null,
        fy2526_change: null,
        fy2526_pct_change: null,
      },
      narratives: [
        { body: "text", kind: "mission", title: "Mission", fact_id: "bbbbbbbbbbbbbbbb" },
      ],
    });
    expect(isZeroContentDetails(withNarrative)).toBe(false);
  });
});
