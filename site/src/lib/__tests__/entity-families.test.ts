/**
 * entity-families.test.ts — §P1-3: one company, one row, no double count.
 *
 * The PM's repro is the first block: RAYTHEON COMPANY ($43.7B, #4) and
 * RTX CORP ($24.6B, #6) must become one family line, correctly re-ranked.
 */

import { describe, it, expect } from "vitest";
import type { EntityTop } from "@/lib/data";
import {
  allEvents,
  assertNoDoubleCount,
  companyRowFactIds,
  confidenceIsUniform,
  eventLabel,
  memberEventLabel,
  mergeCompanies,
  worstConfidence,
  type CuratedFamily,
  type FamilyEventsPayload,
  type FamilyMember,
} from "@/lib/entity-families";

function entity(
  family_key: string,
  display_name: string,
  total: number,
  opts: Partial<EntityTop> = {},
): EntityTop {
  return {
    family_key,
    display_name,
    slug: family_key.toLowerCase().replace(/ /g, "-"),
    total_obligation: total,
    total_obligation_fact_id: `fid-${family_key.toLowerCase()}`,
    uei_count: 10,
    worst_confidence: "medium",
    ...opts,
  };
}

function member(
  family_key: string,
  total: number,
  opts: Partial<FamilyMember> = {},
): FamilyMember {
  return {
    family_key,
    display_name: family_key,
    slug: family_key.toLowerCase().replace(/ /g, "-"),
    has_page: true,
    total_obligation: total,
    total_obligation_fact_id: `fid-${family_key.toLowerCase()}`,
    uei_count: 10,
    worst_confidence: "medium",
    arrival: null,
    ...opts,
  };
}

function family(
  label: string,
  members: FamilyMember[],
  opts: Partial<CuratedFamily> = {},
): CuratedFamily {
  const combined = members.reduce((n, m) => n + m.total_obligation, 0);
  return {
    label,
    slug: label.toLowerCase().replace(/ /g, "-"),
    members,
    combined_obligation: members.length > 1 ? combined : null,
    combined_obligation_fact_id: members.length > 1 ? `fid-fam-${label}` : null,
    combined_uei_count: members.reduce((n, m) => n + m.uei_count, 0),
    events: [],
    ...opts,
  };
}

function payloadOf(...families: CuratedFamily[]): FamilyEventsPayload {
  return {
    schema_version: 2,
    method: "hand-curated",
    source_kind: "external",
    seed: "data-seeds/entity_family_events.csv",
    sources_verified_through: "2026-08-04",
    families,
  };
}

// The live top-6 by obligation (USD), rounded to the cent.
const LOCKHEED = entity("LOCKHEED MARTIN", "LOCKHEED MARTIN CORPORATION", 135_361_939_903.34);
const BOEING = entity("BOEING", "THE BOEING COMPANY", 75_944_399_838.1);
const GD = entity("GENERAL DYNAMICS", "GENERAL DYNAMICS CORP", 46_502_379_775.45);
const RAYTHEON = entity("RAYTHEON", "RAYTHEON COMPANY", 43_730_561_330.38);
const NORTHROP = entity("NORTHROP GRUMMAN", "NORTHROP GRUMMAN CORPORATION", 32_856_724_565.67);
const RTX = entity("RTX", "RTX CORP", 24_624_474_165.71);

const LIVE_TOP6 = [LOCKHEED, BOEING, GD, RAYTHEON, NORTHROP, RTX];

const RTX_FAMILY = family("RTX", [
  member("RAYTHEON", RAYTHEON.total_obligation, { display_name: "RAYTHEON COMPANY" }),
  member("RTX", RTX.total_obligation, { display_name: "RTX CORP" }),
]);

describe("mergeCompanies — the PM's repro", () => {
  it("puts Raytheon and RTX on ONE row", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    const rtxRows = rows.filter((r) =>
      r.members.some((m) => m.family_key === "RTX" || m.family_key === "RAYTHEON"),
    );
    expect(rtxRows).toHaveLength(1);
    expect(rtxRows[0].merged).toBe(true);
    expect(rtxRows[0].members.map((m) => m.display_name)).toEqual([
      "RAYTHEON COMPANY",
      "RTX CORP",
    ]);
  });

  it("states the combined position", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    const rtx = rows.find((r) => r.key === "rtx")!;
    expect(rtx.totalObligation).toBeCloseTo(68_355_035_496.09, 2);
  });

  it("re-ranks the top ten correctly", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    expect(rows.map((r) => [r.rank, r.displayName])).toEqual([
      [1, "LOCKHEED MARTIN CORPORATION"],
      [2, "THE BOEING COMPANY"],
      [3, "RTX"],
      [4, "GENERAL DYNAMICS CORP"],
      [5, "NORTHROP GRUMMAN CORPORATION"],
    ]);
  });

  it("renders the CITED combined fact, not a browser-side sum", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    const rtx = rows.find((r) => r.key === "rtx")!;
    expect(rtx.factId).toBe("fid-fam-RTX");
  });

  it("drops the merged row count from the table (200 rows → 199)", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    expect(rows).toHaveLength(LIVE_TOP6.length - 1);
  });
});

describe("mergeCompanies — safety", () => {
  it("leaves everything alone with no payload", () => {
    const rows = mergeCompanies(LIVE_TOP6, null);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => !r.merged)).toBe(true);
    expect(rows[0].factId).toBe("fid-lockheed martin");
  });

  it("refuses to merge a family with no cited combined fact", () => {
    const uncited = { ...RTX_FAMILY, combined_obligation_fact_id: null };
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(uncited));
    expect(rows).toHaveLength(6);
    expect(rows.some((r) => r.merged)).toBe(false);
  });

  it("does not merge a single-member family (nothing to combine)", () => {
    const solo = family("Lockheed Martin", [member("LOCKHEED MARTIN", 1)]);
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(solo));
    expect(rows).toHaveLength(6);
    expect(rows.some((r) => r.merged)).toBe(false);
  });

  it("counts members that are not in the top-200 list", () => {
    const withOutsider = family("RTX", [
      member("RAYTHEON", 43.7),
      member("RTX", 24.6),
      member("ROCKWELL COLLINS", 0.02, { has_page: false }),
    ]);
    const rows = mergeCompanies([RAYTHEON, RTX], payloadOf(withOutsider));
    expect(rows).toHaveLength(1);
    expect(rows[0].totalObligation).toBeCloseTo(68.32, 6);
    expect(rows[0].members.filter((m) => !m.has_page)).toHaveLength(1);
  });

  it("takes the WORST member confidence for the family", () => {
    const mixed = family("RTX", [
      member("RAYTHEON", 43.7, { worst_confidence: "high" }),
      member("RTX", 24.6, { worst_confidence: "medium" }),
    ]);
    const rows = mergeCompanies([RAYTHEON, RTX], payloadOf(mixed));
    expect(rows[0].worstConfidence).toBe("medium");
  });
});

describe("assertNoDoubleCount", () => {
  it("passes on the live merge", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    expect(assertNoDoubleCount(LIVE_TOP6, rows)).toEqual([]);
  });

  it("catches a registry family rendered in two rows", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    // simulate a regression: the merged family also left RTX on its own line
    const broken = [
      ...rows,
      {
        key: "rtx-solo",
        displayName: "RTX CORP",
        members: [member("RTX", RTX.total_obligation)],
        totalObligation: RTX.total_obligation,
        factId: "fid-rtx",
        ueiCount: 10,
        worstConfidence: "medium",
        family: null,
        merged: false,
        rank: 99,
      },
    ];
    const problems = assertNoDoubleCount(LIVE_TOP6, broken);
    expect(problems.join(" ")).toContain("counted twice");
  });

  it("catches a member shown but not counted in the combined figure", () => {
    const wrong = family("RTX", [member("RAYTHEON", 40), member("RTX", 20)], {
      combined_obligation: 40, // RTX silently dropped from the sum
      combined_obligation_fact_id: "fid-fam-RTX",
    });
    const rows = mergeCompanies([RAYTHEON, RTX], payloadOf(wrong));
    const problems = assertNoDoubleCount([RAYTHEON, RTX], rows);
    expect(problems.join(" ")).toMatch(/members sum to 60 but the cited combined figure is 40/);
  });

  it("catches a company that vanished", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY)).slice(1);
    expect(assertNoDoubleCount(LIVE_TOP6, rows).join(" ")).toContain("vanished");
  });

  it("catches a duplicated member inside one row", () => {
    const dup = family("RTX", [member("RTX", 10), member("RTX", 10)], {
      combined_obligation: 20,
      combined_obligation_fact_id: "f",
    });
    const rows = mergeCompanies([RTX], payloadOf(dup));
    expect(assertNoDoubleCount([RTX], rows).join(" ")).toContain("lists a member twice");
  });
});

describe("confidenceIsUniform — the 200 amber badges", () => {
  it("is uniform when every row reads the same (the live case)", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    expect(confidenceIsUniform(rows)).toBe(true);
  });

  it("is not uniform as soon as one row differs", () => {
    const rows = mergeCompanies(
      [...LIVE_TOP6, entity("HUMANA", "HUMANA INC.", 15e9, { worst_confidence: "high" })],
      payloadOf(RTX_FAMILY),
    );
    expect(confidenceIsUniform(rows)).toBe(false);
  });

  it("treats an empty table as uniform (nothing to vary)", () => {
    expect(confidenceIsUniform([])).toBe(true);
  });
});

describe("worstConfidence", () => {
  it("orders low < medium < high", () => {
    expect(worstConfidence(["high", "medium"])).toBe("medium");
    expect(worstConfidence(["high", "low", "medium"])).toBe("low");
    expect(worstConfidence(["high", "high"])).toBe("high");
  });
});

describe("companyRowFactIds", () => {
  it("collects the combined fact AND every member fact (drill-down)", () => {
    const rows = mergeCompanies(LIVE_TOP6, payloadOf(RTX_FAMILY));
    const ids = companyRowFactIds(rows);
    expect(ids).toContain("fid-fam-RTX");
    expect(ids).toContain("fid-raytheon");
    expect(ids).toContain("fid-rtx");
  });
});

describe("allEvents", () => {
  const ev = (date: string, from: string): CuratedFamily["events"][number] => ({
    from_name: from,
    to_name: "X",
    event: "rename",
    effective_date: date,
    evidence: "sourced",
    source_url: "https://sec.gov/x",
    source_form: "8-K",
    source_date: date,
    source_verified: "2026-08-04",
    note: "n",
    from_family_key: null,
    to_family_key: null,
    anchor: `event-x-${date}`,
    changed_family_keys: [],
  });

  it("orders newest first", () => {
    const p = payloadOf(
      family("A", [member("A1", 1), member("A2", 1)], {
        events: [ev("2015-11-06", "old"), ev("2023-07-17", "new")],
      }),
    );
    expect(allEvents(p).map((e) => e.event.from_name)).toEqual(["new", "old"]);
  });

  it("is empty with no payload", () => {
    expect(allEvents(null)).toEqual([]);
  });

  it("includes families that merge nothing — the table is the asset", () => {
    const p = payloadOf(
      family("Lockheed Martin", [member("LOCKHEED MARTIN", 1)], {
        events: [ev("2015-11-06", "Sikorsky Aircraft Corporation")],
      }),
    );
    expect(allEvents(p)).toHaveLength(1);
  });
});


describe("per-former-name event labels (fix round)", () => {
  // /companies/ hung ONE trailing label off a heterogeneous member list, so
  // EXELIS INC. — acquired by Harris in 2015 — read "acquired 2019", the date
  // of the separate Harris/L3 merger, and ROCKWELL COLLINS, INC. (acquired
  // 2018) read "renamed 2023". The label now comes from the member's OWN
  // exporter-computed arrival.

  it("uses the event's own year, never the family's latest", () => {
    expect(eventLabel("acquisition", "2015-05-29")).toBe("acquired 2015");
    expect(eventLabel("rename", "2023-07-17")).toBe("renamed 2023");
  });

  it("says merged for a merger — not acquired, not renamed", () => {
    // Calling the UTC/Raytheon merger of equals an acquisition misstates who
    // absorbed whom; calling it a rename is worse.
    expect(eventLabel("merger", "2020-04-03")).toBe("merged 2020");
  });

  it("labels a 'from' arrival with what happened to that name", () => {
    expect(
      memberEventLabel({
        event_index: 2,
        anchor: "event-l3harris-technologies-2",
        role: "from",
        counterparty: "Harris Corporation",
        event: "acquisition",
        effective_date: "2015-05-29",
        evidence: "sourced",
      }),
    ).toBe("acquired 2015");
  });

  it("names the predecessor for a 'to' arrival", () => {
    // "Northrop Grumman Innovation Systems — acquired 2018" alone would leave
    // the reader wondering which company that was.
    expect(
      memberEventLabel({
        event_index: 0,
        anchor: "event-northrop-grumman-0",
        role: "to",
        counterparty: "Orbital ATK, Inc.",
        event: "acquisition",
        effective_date: "2018-06-06",
        evidence: "sourced",
      }),
    ).toBe("formerly Orbital ATK, Inc., acquired 2018");
  });
});
