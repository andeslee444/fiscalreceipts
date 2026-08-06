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
  /** FY24 actual, USD thousands — P-1/R-1 TOA, the canonical basis. */
  fy24: number | null;
  /** FY24 derived-citation fact_id. */
  fy24Fid: string | null;
  /** FY26 total, USD thousands (workbook grain). */
  fy26: number | null;
  /** FY26 derived-citation fact_id. */
  fy26Fid: string | null;
}

/**
 * Project a full ProgramRow down to what the table actually renders.
 *
 * ONE LABEL, ONE BASIS (Sprint 3 round 3, gate 23 leg e). `fy24` used to be
 * `fy2024_actual_millions` — the P-40/R-2 J-book DETAIL figure — sitting
 * beside an FY26 column projected from the P-1 TOA trajectory. Two bases and
 * two units in two adjacent columns of one row, and no basis stated on either.
 *
 * The visible cost: this index disagreed with every page it links to. F-35 read
 * $5.25B here, $5.57B on /years/ and on /program/ATA000/. 22 of 1,741 rows
 * differ materially — Shipboard Tactical Communications by 18x ($28.6M against
 * $528.6M) — and the FY24 sort ranked those 22 by the wrong size.
 *
 * So the column is the canonical TOA figure, from the same trajectory object
 * the FY26 column already used: one basis, one unit, comparable across the row,
 * and identical to what /years/ and the program page publish. The J-book detail
 * figure is not lost — it is on the program page inside the reconciliation
 * strip Sprint 1 built for exactly this pair, one click from every row here.
 *
 * `fy24Xml` is gone with it: an xml_path is a J-book-detail citation state, and
 * a TOA column has no use for one. The 110 programs it served all rendered
 * "$0 [XML]" (a zero-dollar J-book line) where TOA publishes no FY24 row at
 * all; they render the honest absence now, which is what /years/ shows.
 */
export function toProgramsTableRow(p: ProgramRow): ProgramsTableRow {
  return {
    pe: p.pe_bli,
    org: p.org,
    title: p.title,
    fy24: p.trajectory?.fy2024_actuals ?? null,
    fy24Fid: p.trajectory_fact_ids?.fy2024_actuals ?? null,
    fy26: p.trajectory?.fy2026_total ?? null,
    fy26Fid: p.trajectory_fact_ids?.fy2026_total ?? null,
  };
}
