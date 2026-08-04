/**
 * programs-table.test.ts — §P1-11: the 1,741-row program index gets the text
 * filter, Org sort and CSV export its sibling pages already had.
 */

import { describe, it, expect } from "vitest";
import type { ProgramRow } from "@/lib/data";
import { buildProgramsCsv, programHaystack } from "@/components/programs-table";

function program(over: Partial<ProgramRow> = {}): ProgramRow {
  return {
    pe_bli: "ATA000",
    title: "F-35",
    org: "F",
    exhibit_family: "procurement",
    fully_reconciled: false,
    fy2024_actual_millions: 5247.07,
    fy2024_fact_id: "a".repeat(16),
    fy2024_xml_path: null,
    hhi: null,
    award_count: 0,
    narrative_count: 0,
    project_count: 0,
    trajectory: null,
    trajectory_fact_ids: null,
    ...over,
  };
}

describe("programHaystack — the §P1-11 text filter", () => {
  it("matches the program title", () => {
    expect(programHaystack(program())).toContain("f-35");
  });

  it("matches the PE/BLI", () => {
    expect(programHaystack(program())).toContain("ata000");
  });

  it("matches the RAW org token and the human org name", () => {
    const h = programHaystack(program({ org: "F" }));
    expect(h).toContain("air force");
    // the raw code is still in the haystack (it is what the dropdown filters on)
    expect(h.split(" ")).toContain("f");
  });

  it("matches agency acronyms unchanged", () => {
    expect(programHaystack(program({ org: "DARPA" }))).toContain("darpa");
  });
});

describe("buildProgramsCsv — §P1-11 export parity with /years/", () => {
  it("labels each dollar column with its own unit rather than converting", () => {
    const csv = buildProgramsCsv([program()]);
    const [header] = csv.split("\n");
    expect(header).toBe(
      "pe_bli,org,org_name,title,fy2024_actual_usd_millions,fy2026_total_usd_thousands",
    );
  });

  it("exports the raw org code AND the human name", () => {
    const csv = buildProgramsCsv([program()]);
    expect(csv.split("\n")[1]).toBe("ATA000,F,Air Force,F-35,5247.07,");
  });

  it("leaves missing values EMPTY, never 0", () => {
    const csv = buildProgramsCsv([
      program({ fy2024_actual_millions: null, fy2024_fact_id: null }),
    ]);
    const fields = csv.split("\n")[1].split(",");
    expect(fields[4]).toBe("");
    expect(fields[5]).toBe("");
  });

  it("quotes titles containing commas", () => {
    const csv = buildProgramsCsv([program({ title: "AIRCRAFT, ROTARY" })]);
    expect(csv).toContain('"AIRCRAFT, ROTARY"');
  });

  it("escapes embedded quotes RFC-4180 style", () => {
    const csv = buildProgramsCsv([program({ title: 'THE "BIG" ONE' })]);
    expect(csv).toContain('"THE ""BIG"" ONE"');
  });

  it("exports the FY26 workbook figure in thousands", () => {
    const csv = buildProgramsCsv([
      program({
        trajectory: {
          fy2024_actuals: null,
          fy2025_total: null,
          fy2026_total: 5565655,
        } as ProgramRow["trajectory"],
      }),
    ]);
    expect(csv.split("\n")[1]).toContain(",5565655");
  });

  it("exports one line per row plus the header", () => {
    const csv = buildProgramsCsv([program(), program({ pe_bli: "0604256N" })]);
    expect(csv.split("\n")).toHaveLength(3);
  });
});
