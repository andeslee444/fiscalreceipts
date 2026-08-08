/**
 * programs-table.test.ts — §P1-11: the 1,741-row program index gets the text
 * filter, Org sort and CSV export its sibling pages already had.
 */

import { describe, it, expect } from "vitest";
import type { ProgramDecadeCells, ProgramRow } from "@/lib/data";
import {
  buildProgramsCsv,
  filterPrograms,
  programHaystack,
} from "@/components/programs-table";
import { toProgramsTableRow } from "@/lib/programs-row";
import { aliasChipText } from "@/lib/aliases";

/** A full warehouse row, as getPrograms() hands it to the server page. */
function fullProgram(over: Partial<ProgramRow> = {}): ProgramRow {
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
    fy2026_disc_toa_usd_thousands: null,
    fy2026_reconciliation_toa_usd_thousands: null,
    ...over,
  };
}

/**
 * The PROGRAM-LEVEL decade cells the index actually renders from — the same
 * years_matrix.json payload /years/ renders (see getProgramDecadeCells).
 * Defaults to the real ATA000 pair.
 */
function decadeCells(over: Partial<ProgramDecadeCells> = {}): ProgramDecadeCells {
  return {
    fy24: { v: 5565655, fid: "b".repeat(16) },
    fy26: { v: 4086744, fid: "d".repeat(16) },
    ...over,
  };
}

/**
 * What the client table actually receives — every fixture goes through the
 * real projection, so the whole suite exercises it.
 */
function program(
  over: Partial<ProgramRow> = {},
  cells: ProgramDecadeCells | undefined = decadeCells(),
) {
  return toProgramsTableRow(fullProgram(over), cells);
}

describe("toProgramsTableRow — §P2-1: only what the table renders is shipped", () => {
  // The client component's props are serialized into the RSC flight payload,
  // so every field here is shipped a second time on top of the rendered HTML.
  // 1,741 full rows were 975 KB where the rendered eight are 385 KB.
  //
  // (2026-08 page-weight fix, gate 1) discK/reconK (backlog #50) are
  // CSV-export-only — no on-screen column — and are now OMITTED from the
  // row entirely for the 1,577 of 1,741 programs with no reconciliation:
  // for those, discK always equals fy26 exactly, so carrying it was a
  // redundant copy of a number already on the row, and it was measured as
  // the direct cause of /programs/'s page-weight ceiling failure. They are
  // present only for the minority of rows with a genuine, non-trivial
  // reconciliation split.
  const RENDERED_FIELDS_NO_RECON = [
    "pe",
    "org",
    "title",
    "fy24",
    "fy24Fid",
    "fy26",
    "fy26Fid",
  ];
  const RENDERED_FIELDS_WITH_RECON = [
    ...RENDERED_FIELDS_NO_RECON,
    "discK",
    "reconK",
  ];

  it("carries exactly the seven rendered fields when there is no reconciliation — no more", () => {
    expect(Object.keys(program()).sort()).toEqual(
      [...RENDERED_FIELDS_NO_RECON].sort(),
    );
  });

  it("adds discK/reconK ONLY when the program has a real, non-zero reconciliation split", () => {
    const row = program({
      fy2026_disc_toa_usd_thousands: 1916,
      fy2026_reconciliation_toa_usd_thousands: 7695000,
    });
    expect(Object.keys(row).sort()).toEqual(
      [...RENDERED_FIELDS_WITH_RECON].sort(),
    );
  });

  it("drops the payload the table never reads", () => {
    const row = program({
      award_count: 42,
      narrative_count: 9,
      project_count: 7,
      exhibit_family: "rdte",
      hhi: { hhi: 0.5 } as ProgramRow["hhi"],
    }) as unknown as Record<string, unknown>;
    for (const dropped of [
      "award_count",
      "narrative_count",
      "project_count",
      "exhibit_family",
      "fully_reconciled",
      "hhi",
      "trajectory",
      "trajectory_fact_ids",
    ]) {
      expect(row[dropped]).toBeUndefined();
    }
  });

  it("takes both money columns from the program-level decade cells", () => {
    const row = program({}, {
      fy24: { v: 111, fid: "b".repeat(16) },
      fy26: { v: 333, fid: "d".repeat(16) },
    });
    expect(row.fy24).toBe(111);
    expect(row.fy24Fid).toBe("b".repeat(16));
    expect(row.fy26).toBe(333);
    expect(row.fy26Fid).toBe("d".repeat(16));
  });

  /**
   * The three BLI codes shared across organisations. programs.json's
   * trajectory is the row's declared-ORG slice, so the index published a
   * component as if it were the program: BLI 30 read 408,006 (the OSD slice)
   * where /program/30/ reads 435,163 (OSD + DMACT + DTRA + DoDEA). Reading the
   * decade cell — the program-level figure, with the fact id the program page
   * itself cites — is what makes the join close.
   */
  it("prefers the program-level cell over the org-sliced trajectory", () => {
    const row = program(
      {
        pe_bli: "30",
        org: "OSD",
        title: "Other Major Equipment",
        trajectory: {
          fy2024_actuals: 408006,
          fy2026_total: 212900,
        } as ProgramRow["trajectory"],
        trajectory_fact_ids: {
          fy2024_actuals: "slice24".padEnd(16, "0"),
        } as ProgramRow["trajectory_fact_ids"],
      },
      { fy24: { v: 435163, fid: "e217cc752ada18b6" }, fy26: { v: 232181, fid: "6a0967669dbe63c4" } },
    );
    expect(row.fy24).toBe(435163);
    expect(row.fy26).toBe(232181);
    expect(JSON.stringify(row)).not.toContain("408006");
    expect(JSON.stringify(row)).not.toContain("212900");
  });

  /**
   * ONE LABEL, ONE BASIS across pages (Sprint 3 round 3).
   *
   * The FY24 column used to project fy2024_actual_millions — the P-40/R-2
   * J-book DETAIL figure — while the FY26 column beside it projected the P-1
   * TOA trajectory. So one row carried two bases in two adjacent columns, and
   * the index disagreed with every page it links to: F-35 read $5.25B here
   * and $5.57B on /years/ and /program/ATA000/, with nothing on the index
   * saying why. 22 of 1,741 rows differ materially; Shipboard Tactical
   * Communications differs by 18x.
   *
   * The column is canonical TOA now, so the index agrees with the pages it
   * indexes, both money columns share one basis and one unit, and the FY24
   * sort ranks programs by their canonical size.
   */
  it("takes FY24 from the canonical TOA cell, never the J-book detail figure", () => {
    const row = program({
      // The real ATA000 pair: J-book detail 5,247.07 USD millions vs the
      // P-1 TOA 5,565,655 USD thousands.
      fy2024_actual_millions: 5247.07,
      fy2024_fact_id: "a".repeat(16),
    });
    expect(row.fy24).toBe(5565655);
    expect(row.fy24Fid).toBe("b".repeat(16));
    // The J-book figure and its citation do not reach the index at all — it
    // lives on the program page, inside the reconciliation strip built for
    // exactly this pair.
    expect(JSON.stringify(row)).not.toContain("5247.07");
    expect(JSON.stringify(row)).not.toContain("a".repeat(16));
  });

  it("renders an absence where TOA has no FY24 row, rather than a J-book zero", () => {
    // The DARPA Advanced Technology Development case: the J-book XML
    // explicitly publishes a zero-dollar line (state B, "$0 [XML]") while the
    // workbook trajectory has no FY24 actuals row at all. The index used to
    // show "$0 [XML]" where /years/ showed an em-dash — two different
    // statements under one label. In a TOA column the honest render is the
    // absence; the zero-line statement stays on the program page, in the
    // basis that actually makes it.
    const row = program(
      {
        fy2024_actual_millions: 0,
        fy2024_fact_id: null,
        fy2024_xml_path: "/root/line[3]",
      },
      { fy24: null, fy26: { v: 5, fid: "d".repeat(16) } },
    );
    expect(row.fy24).toBeNull();
    expect(row.fy24Fid).toBeNull();
    expect(JSON.stringify(row)).not.toContain("/root/line[3]");
  });

  it("nulls a missing FY26 rather than inventing a 0", () => {
    expect(program({}, { fy24: null, fy26: null }).fy26).toBeNull();
    // …and a program with no decade row at all still projects cleanly.
    expect(toProgramsTableRow(fullProgram(), undefined).fy26).toBeNull();
  });

  // Backlog #50: the disc/reconciliation split rides alongside fy26 (the
  // combined total) rather than replacing it.
  it("projects the fy2026 disc/reconciliation split from ProgramRow", () => {
    const row = program({
      fy2026_disc_toa_usd_thousands: 1916,
      fy2026_reconciliation_toa_usd_thousands: 7695000,
    });
    expect(row.discK).toBe(1916);
    expect(row.reconK).toBe(7695000);
  });

  it("OMITS the disc/reconciliation split entirely when there is none, rather than carrying a redundant null or inventing a 0", () => {
    const row = program() as unknown as Record<string, unknown>;
    expect(row.discK).toBeUndefined();
    expect(row.reconK).toBeUndefined();
    expect(Object.keys(row)).not.toContain("discK");
    expect(Object.keys(row)).not.toContain("reconK");
  });
});

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
    // All four money columns are P-1 TOA in USD thousands now, and the
    // header says so — the FY24 column used to export J-book detail in
    // millions beside a TOA column in thousands. The trailing two (#50) are
    // fy2026's own addends — disc + reconciliation.
    expect(header).toBe(
      "pe_bli,org,org_name,title,fy2024_actual_toa_usd_thousands," +
        "fy2026_request_toa_usd_thousands,fy2026_disc_toa_usd_thousands," +
        "fy2026_reconciliation_toa_usd_thousands",
    );
  });

  it("exports the raw org code AND the human name", () => {
    const csv = buildProgramsCsv([
      program({}, { fy24: { v: 5565655, fid: "b".repeat(16) }, fy26: null }),
    ]);
    expect(csv.split("\n")[1]).toBe("ATA000,F,Air Force,F-35,5565655,,,");
  });

  it("leaves missing values EMPTY, never 0", () => {
    const csv = buildProgramsCsv([program({}, { fy24: null, fy26: null })]);
    const fields = csv.split("\n")[1].split(",");
    expect(fields[4]).toBe("");
    expect(fields[5]).toBe("");
    expect(fields[6]).toBe("");
    expect(fields[7]).toBe("");
  });

  it("exports the fy2026 disc/reconciliation split (backlog #50)", () => {
    const csv = buildProgramsCsv([
      program({
        fy2026_disc_toa_usd_thousands: 1916,
        fy2026_reconciliation_toa_usd_thousands: 7695000,
      }),
    ]);
    const fields = csv.split("\n")[1].split(",");
    expect(fields[6]).toBe("1916");
    expect(fields[7]).toBe("7695000");
  });

  // (2026-08 page-weight fix) discK/reconK no longer ride on every row's
  // payload — buildProgramsCsv now derives the discretionary column from
  // fy26 when there is no reconciliation. These two cases are the ones the
  // fix must leave byte-for-byte unchanged.
  describe("(page-weight fix) CSV output is unchanged for both row shapes", () => {
    it("a RECONCILIATION row: the real split values, not a fy26 fallback", () => {
      const row = program({
        fy2026_disc_toa_usd_thousands: 1916,
        fy2026_reconciliation_toa_usd_thousands: 7695000,
      });
      // Confirms the payload actually carries discK for this row (the
      // "present only when real" half of the fix).
      expect((row as unknown as Record<string, unknown>).discK).toBe(1916);
      const fields = buildProgramsCsv([row]).split("\n")[1].split(",");
      expect(fields[6]).toBe("1916");
      expect(fields[7]).toBe("7695000");
    });

    it("a NON-RECONCILIATION row: discK is absent from the payload, but the CSV still emits the correct (fy26) value", () => {
      const row = program({}, {
        fy24: null,
        fy26: { v: 4086744, fid: "d".repeat(16) },
      });
      // Confirms the payload win — discK really is gone, not just null.
      expect(
        Object.keys(row as unknown as Record<string, unknown>),
      ).not.toContain("discK");
      const fields = buildProgramsCsv([row]).split("\n")[1].split(",");
      expect(fields[5]).toBe("4086744"); // fy26 column, unchanged
      expect(fields[6]).toBe("4086744"); // disc column falls back to fy26
      expect(fields[7]).toBe("");        // no reconciliation — stays blank
    });

    it("the rare row with reconciliation but no recorded discretionary figure stays blank, never fy26", () => {
      // A genuine data gap (23 such rows in the live corpus): falling back
      // to fy26 here would overstate discretionary spend by the
      // reconciliation amount, so this must NOT trigger the fallback.
      const row = program({
        fy2026_disc_toa_usd_thousands: null,
        fy2026_reconciliation_toa_usd_thousands: 500,
      });
      const fields = buildProgramsCsv([row]).split("\n")[1].split(",");
      expect(fields[6]).toBe("");
      expect(fields[7]).toBe("500");
    });
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
      program({}, { fy24: null, fy26: { v: 5565655, fid: "d".repeat(16) } }),
    ]);
    expect(csv.split("\n")[1]).toContain(",5565655");
  });

  it("exports one line per row plus the header", () => {
    const csv = buildProgramsCsv([program(), program({ pe_bli: "0604256N" })]);
    expect(csv.split("\n")).toHaveLength(3);
  });
});


describe("filterPrograms — the alias resolver, wired (fix round)", () => {
  // The contradiction both judges hit: typing "sentinel" into this filter
  // returned only "Sentinel Mods" (1 of 1,741) while ⌘K, on the same word,
  // answered "Sentinel = Ground Based Strategic Deterrent". The alias table
  // was wired into ⌘K only.
  const GBSD = program({
    pe_bli: "0605238F",
    title: "Ground Based Strategic Deterrent EMD",
    org: "F",
  });
  const MODS = program({
    pe_bli: "SENT01",
    title: "Sentinel Mods",
    org: "F",
  });
  const F35 = program({ pe_bli: "ATA000", title: "F-35", org: "F" });
  const ALL = [GBSD, MODS, F35];
  const HAYSTACKS = new Map(ALL.map((p) => [p.pe, programHaystack(p)]));

  const hits = (q: string) =>
    filterPrograms(ALL, HAYSTACKS, q).map((p) => p.pe);

  it("surfaces GBSD for 'sentinel'", () => {
    expect(hits("sentinel")).toContain("0605238F");
  });

  it("keeps the literal title match too — union, not replacement", () => {
    expect(hits("sentinel")).toEqual(
      expect.arrayContaining(["0605238F", "SENT01"]),
    );
  });

  it("is case- and punctuation-insensitive like the palette", () => {
    expect(hits("  SENTINEL ")).toContain("0605238F");
    expect(hits("LGM-35A")).toContain("0605238F");
  });

  it("does not widen a query that is not an alias", () => {
    expect(hits("f-35")).toEqual(["ATA000"]);
  });

  it("keeps full-query precision — 'sentinel mods' is not the alias", () => {
    expect(hits("sentinel mods")).toEqual(["SENT01"]);
  });

  it("returns everything for an empty query", () => {
    expect(hits("").length).toBe(3);
  });
});

describe("aliasChipText — ONE wording for ⌘K and the /programs/ filter", () => {
  // The chip read "matched: Sentinel · also known as Sentinel · GBSD ·
  // LGM-35A" — the matched alias named twice — while ⌘K said "also known as:
  // Sentinel · GBSD · LGM-35A" for the same program. Both surfaces now render
  // this function's output verbatim.
  const SENTINEL = ["Sentinel", "GBSD", "LGM-35A"];

  it("names the matched alias once, then the OTHER names", () => {
    expect(aliasChipText("Sentinel", SENTINEL)).toBe(
      "matched alias: Sentinel — also known as GBSD · LGM-35A",
    );
  });

  it("never repeats the matched alias in the also-known-as list", () => {
    const chip = aliasChipText("Sentinel", SENTINEL);
    expect(chip.match(/Sentinel/g)).toHaveLength(1);
  });

  it("matches on the normalized key, not the display form", () => {
    expect(aliasChipText("lgm35a", SENTINEL)).toBe(
      "matched alias: lgm35a — also known as Sentinel · GBSD",
    );
  });

  it("drops the trailing clause when the match is the only alias", () => {
    expect(aliasChipText("Golden Dome", ["Golden Dome"])).toBe(
      "matched alias: Golden Dome",
    );
  });

  it("falls back to the plain alias list when nothing matched", () => {
    expect(aliasChipText(undefined, SENTINEL)).toBe(
      "also known as: Sentinel · GBSD · LGM-35A",
    );
  });
});
