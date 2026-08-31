import { describe, it, expect, afterEach } from "vitest";

import {
  decadeProgramRow,
  deriveExhibitFamily,
  isDecadeDetails,
  isIngestedServiceOrg,
  isRollupDetails,
  isZeroContentDetails,
  rollupProgramRow,
  serviceOrgName,
  setIngestedServiceOrgs,
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
        basis: "toa",
        fy: 2024,
        measure: "actuals",
        edition: 2026,
        entity: "0708011F",
      },
    ],
    details: [],
    mentions: [],
    narratives: [],
    summary: {
      edition: 2026,
      basis_preference: "toa",
      cards: [],
      reconciliation: [],
      named_primes: [],
    },
    tier: "rollup",
    service_org: "F",
    title: "Industrial Preparedness/Pol Prevention",
    trajectory: {
      n_org_components: 1,
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

describe("isIngestedServiceOrg (data-derived from site_meta.ingested_service_orgs)", () => {
  // The set is injected at build time from the exporter payload (data.ts calls
  // setIngestedServiceOrgs). Restore the safe default after each test so the
  // suite stays order-independent.
  afterEach(() => {
    setIngestedServiceOrgs(["A", "N", "F"]);
  });

  it("reads the injected payload — defense-wide agency books are ingested too", () => {
    // The live FY2026 set spans 27 loaded books collapsing to 25 workbook-org
    // codes: the three services PLUS every defense-wide agency (OSD, DCSA, MDA,
    // DISA, DARPA, …). The old hardcoded A/N/F set lied for all of them.
    setIngestedServiceOrgs([
      "A", "N", "F", "OSD", "DCSA", "MDA", "DISA", "DARPA", "CYBER", "SOCOM",
    ]);
    // Services.
    expect(isIngestedServiceOrg("N")).toBe(true);
    expect(isIngestedServiceOrg("A")).toBe(true);
    expect(isIngestedServiceOrg("F")).toBe(true);
    // Defense-wide agencies whose pages used to FALSELY say "not yet ingested".
    expect(isIngestedServiceOrg("DCSA")).toBe(true);
    expect(isIngestedServiceOrg("OSD")).toBe(true);
    expect(isIngestedServiceOrg("MDA")).toBe(true);
  });

  it("is false for orgs with NO loaded FY2026 book (must stay 'not yet ingested')", () => {
    setIngestedServiceOrgs([
      "A", "N", "F", "OSD", "DCSA", "MDA", "DISA", "DARPA", "CYBER", "SOCOM",
    ]);
    // DHA / DEFW / IG appear in budget_lines but have no J-book — they MUST
    // keep the honest generic wording.
    expect(isIngestedServiceOrg("DHA")).toBe(false);
    expect(isIngestedServiceOrg("DEFW")).toBe(false);
    expect(isIngestedServiceOrg("IG")).toBe(false);
    expect(isIngestedServiceOrg("")).toBe(false);
    // 'SF' is never an org code (Space Force folds under 'F'); guard against a
    // regression that mistakes the PE-number suffix for an org.
    expect(isIngestedServiceOrg("SF")).toBe(false);
  });

  it("falls back to the A/N/F default before any payload is injected", () => {
    // Universal module: unit tests / any consumer that never injects still get
    // sensible service-only behavior rather than an empty set.
    expect(isIngestedServiceOrg("A")).toBe(true);
    expect(isIngestedServiceOrg("N")).toBe(true);
    expect(isIngestedServiceOrg("F")).toBe(true);
    expect(isIngestedServiceOrg("DHA")).toBe(false);
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
        summary: {
          edition: 2026,
          basis_preference: "toa",
          cards: [],
          reconciliation: [],
          named_primes: [],
        },
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
    // ProgramRow.org is the org CODE, never the display name: the GAO overlay
    // lookup, the /agency/{org}/ href and the agencies.json membership test
    // all key by code, and only display humanizes.
    expect(row.org).toBe("F");
    expect(serviceOrgName(row.org)).toBe("Air Force");
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

  it("falls back to the DoD umbrella when the sidecar declares no service", () => {
    // One live sidecar (9999999999) carries service_org "". "DoD" is the
    // honest umbrella, and deliberately not a service code — it matches no
    // agency page and no GAO overlay, which is the right answer for a line
    // with no declared service.
    const row = rollupProgramRow("000042", rollupDetails({ service_org: "" }));
    expect(row.org).toBe("DoD");
    expect(serviceOrgName(row.org)).toBe("DoD");
  });

  it("keeps Space Force under org F — 'SF' is a PE suffix, never an org", () => {
    // 0601102SF-style PE numbers carry an SF suffix, but every Space Force
    // line is published in the Air Force book under workbook org "F".
    const row = rollupProgramRow("0601102SF", rollupDetails({ service_org: "F" }));
    expect(row.org).toBe("F");
    expect(serviceOrgName(row.org)).toBe("Air Force");
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
          basis: "toa",
          fy: 2024,
          measure: "actuals",
          edition: 2026,
          entity: "000042",
        },
      ],
      trajectory: {
        n_org_components: 1,
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
        n_org_components: 1,
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

// ── ROADMAP #28 — the decade tier ──────────────────────────────────────────

/** Minimal decade sidecar: no FY2026 workbook row, no detail, no
 *  trajectory — only the cited pre-PB2026 series. */
function decadeDetails(overrides: Partial<ProgramDetails> = {}): ProgramDetails {
  return {
    awards: [],
    budget_lines: [],
    details: [],
    mentions: [],
    narratives: [],
    summary: {
      edition: 2026,
      basis_preference: "toa",
      cards: [],
      reconciliation: [],
      named_primes: [],
    },
    tier: "decade",
    service_org: "F",
    exhibit_family: "rdte",
    title: "Ground Based Strategic Deterrent",
    trajectory: null,
    trajectory_fact_ids: null,
    decade_series: {
      actuals: [
        {
          fy: 2016,
          v: 64966,
          fid: "2f5055bcb9d2ea0f",
          edition: 2018,
          basis: "toa",
          measure: "actuals",
        },
      ],
    },
    decade_absent: {
      first_edition: 2018,
      last_edition: 2024,
      edition_count: 5,
      fy_min: 2016,
      fy_max: 2024,
      renumber: false,
      has_successor: false,
    },
    ...overrides,
  } as ProgramDetails;
}

describe("decade tier (ROADMAP #28)", () => {
  it("recognises the tier, and does not confuse it with rollup", () => {
    expect(isDecadeDetails(decadeDetails())).toBe(true);
    expect(isRollupDetails(decadeDetails())).toBe(false);
    expect(isDecadeDetails(rollupDetails())).toBe(false);
  });

  it("takes exhibit_family from the sidecar, not from the empty budget_lines", () => {
    // The whole point: deriveExhibitFamily([]) is the generic "budget", which
    // would be what every one of these 553 pages rendered without the
    // exporter-supplied field.
    expect(deriveExhibitFamily([])).toBe("budget");
    expect(decadeProgramRow("0605230F", decadeDetails()).exhibit_family).toBe("rdte");
  });

  it("keeps the org CODE, never the humanized name (the #30 defect)", () => {
    expect(decadeProgramRow("0605230F", decadeDetails()).org).toBe("F");
  });

  it("declares no reconciliation verdict and no trajectory", () => {
    const row = decadeProgramRow("0605230F", decadeDetails());
    expect(row.reconciled_in_scope).toBeNull();
    expect(row.trajectory).toBeNull();
    expect(row.hhi).toBeNull();
  });

  it("is INDEXABLE on its cited decade figures alone", () => {
    // Pre-#28 this page had no budget_lines, no trajectory and no prose, so
    // `figures` was [] and [].every() is true — all 553 pages would have
    // been noindexed and dropped from the sitemap.
    expect(isZeroContentDetails(decadeDetails())).toBe(false);
  });

  it("still calls an all-zero decade series zero-content", () => {
    const zero = decadeDetails({
      decade_series: {
        actuals: [
          {
            fy: 2016,
            v: 0,
            fid: "2f5055bcb9d2ea0f",
            edition: 2018,
            basis: "toa",
            measure: "actuals",
          },
        ],
      },
    });
    expect(isZeroContentDetails(zero)).toBe(true);
  });
});
