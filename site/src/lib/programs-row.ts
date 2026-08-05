/**
 * programs-row.ts — the /programs/ index row, projected (§P2-1 page weight).
 *
 * The props of a client component are serialized into the RSC flight payload,
 * so whatever <ProgramsTable> receives is shipped a SECOND time on top of the
 * rendered HTML. It used to receive the whole ProgramRow — hhi, the
 * award/narrative/project counts, exhibit_family, the full decade trajectory
 * and its full fact-id set — none of which the table renders. Measured on the
 * shipped sidecar: 975 KB of programs.json where the eight rendered fields
 * are 385 KB.
 *
 * So the server projects to exactly what the five columns, the text filter and
 * the CSV export need, with short keys (the key names themselves are 1,741
 * copies each in the payload). Nothing is lost: the full row is on the program
 * page, which is one click away from every row here.
 *
 * This lives in lib/ rather than beside the table because programs-table.tsx
 * is a "use client" module — the server page cannot call a function exported
 * from one.
 */

import type { ProgramRow } from "@/lib/data";

export interface ProgramsTableRow {
  /** PE/BLI code — also the row key, the alias key and the link target. */
  pe: string;
  /** Raw workbook org token ("F"); the human name is derived for display. */
  org: string;
  title: string;
  /** FY24 actual, USD millions (J-book grain). */
  fy24: number | null;
  /** FY24 citation fact_id (Cite state A), when the amount resolved. */
  fy24Fid: string | null;
  /** FY24 xml_path (Cite state B) for zero-amount / unresolved facts. */
  fy24Xml: string | null;
  /** FY26 total, USD thousands (workbook grain). */
  fy26: number | null;
  /** FY26 derived-citation fact_id. */
  fy26Fid: string | null;
}

/** Project a full ProgramRow down to what the table actually renders. */
export function toProgramsTableRow(p: ProgramRow): ProgramsTableRow {
  return {
    pe: p.pe_bli,
    org: p.org,
    title: p.title,
    fy24: p.fy2024_actual_millions,
    fy24Fid: p.fy2024_fact_id,
    fy24Xml: p.fy2024_xml_path,
    fy26: p.trajectory?.fy2026_total ?? null,
    fy26Fid: p.trajectory_fact_ids?.fy2026_total ?? null,
  };
}
