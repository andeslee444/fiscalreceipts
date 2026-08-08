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
 *
 * §48 NOTE (deliberately NOT threading exhibitFamily here): the task that
 * fixed the mislabelled TOA chip prescribed adding `exhibitFamily` to this
 * row. It does not belong here, and the reason is this file's own opening
 * paragraph: exhibit_family was ALREADY dropped from this exact projection
 * for being payload the table never reads, and that has not changed. The
 * /programs/ table renders no PER-ROW basis chip at all — the fy24/fy26
 * <Cite> cells (programs-table.tsx) pass no `basis` prop, so they emit no
 * chip and no data-basis attribute. The table's only basis chip is the
 * COLUMN header + a mobile footer note, ONE label for all 1,741 rows
 * (both RDT&E and procurement) — a genuine cross-program aggregate, the same
 * shape as /agency/*, /years/ and /feed/. Both those call sites now pass
 * "mixed" explicitly (programs-table.tsx's BasisColumnLabel and its mobile
 * note). A per-row exhibitFamily would be shipped weight this component
 * cannot use — exactly the anti-pattern §P2-1 exists to prevent, and the
 * existing "carries exactly the seven rendered fields" / "drops the payload
 * the table never reads" tests below (programs-table.test.ts) already pin
 * exhibit_family's absence. Verified by reading every <Cite>/basisChipText
 * call in programs-table.tsx before making this call — see the PR notes.
 */

import type { ProgramDecadeCells, ProgramRow } from "@/lib/data";

export interface ProgramsTableRow {
  /** PE/BLI code — also the row key, the alias key and the link target. */
  pe: string;
  /** Raw workbook org token ("F"); the human name is derived for display. */
  org: string;
  title: string;
  /** FY24 actuals, USD thousands — P-1/R-1 TOA, the canonical basis. */
  fy24: number | null;
  /** FY24 citation fact_id — the SAME fact the program page cites. */
  fy24Fid: string | null;
  /** FY26 request, USD thousands — same basis, same edition. */
  fy26: number | null;
  /** FY26 citation fact_id — the SAME fact the program page cites. */
  fy26Fid: string | null;
  /**
   * FY2026 discretionary/reconciliation split (backlog #50), USD thousands,
   * same TOA basis as fy26 — CSV-export-only (no on-screen column; the
   * on-screen figures are `fy26`, the combined total, and the program page's
   * own fy26_split card).
   *
   * (2026-08 page-weight fix, gate 1) OPTIONAL — omitted from the row
   * entirely, not carried as null, for the 1,577 of 1,741 programs with no
   * reconciliation at all. For those, discK always equals fy26 exactly
   * (backlog #50's own identity: disc + reconciliation = total; with no
   * reconciliation, disc IS the total already on the row as `fy26`), so
   * shipping it was 1,577 redundant copies of a number already present —
   * measured as the direct cause of /programs/'s page-weight ceiling
   * failure (discK/reconK appeared once per row across all 1,741 rows).
   * buildProgramsCsv (programs-table.tsx) derives the discretionary CSV
   * column back from fy26 when discK is absent AND there is no
   * reconciliation; present only when the program genuinely has a nonzero
   * reconciliation split.
   */
  discK?: number;
  reconK?: number;
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
 * So both columns are canonical TOA now, read from the PROGRAM-LEVEL decade
 * cells of years_matrix.json — the same payload /years/ renders, carrying the
 * same fact ids the program pages cite. One basis, one unit, comparable across
 * the row, and identical to the two other surfaces that publish it. The J-book
 * detail figure is not lost — it is on the program page inside the
 * reconciliation strip Sprint 1 built for exactly this pair, one click from
 * every row here.
 *
 * The decade cells rather than programs.json's `trajectory` — and they STAY
 * the source now that backlog #37 has fixed the trajectory at the exporter
 * (it is the program's total, not the declared org's slice, and agrees with
 * the decade cell on all 1,799 programs where both publish an FY2024 figure
 * and all 1,671 where both publish an FY2026 one). The reason to keep reading
 * the decade cell is not that the trajectory is wrong; it is that the decade
 * cell carries THE SAME FACT ID the program page and /years/ cite. Same
 * number from two different facts still gives a reader two different receipts
 * for one figure, and this index links straight at the page that shows the
 * other one. One number, one fact, three surfaces.
 *
 * `fy24Xml` is gone with it: an xml_path is a J-book-detail citation state, and
 * a TOA column has no use for one. The 110 programs it served all rendered
 * "$0 [XML]" (a zero-dollar J-book line) where TOA publishes no FY24 row at
 * all; they render the honest absence now, which is what /years/ shows.
 */
export function toProgramsTableRow(
  p: ProgramRow,
  cells: ProgramDecadeCells | undefined,
): ProgramsTableRow {
  const base: ProgramsTableRow = {
    pe: p.pe_bli,
    org: p.org,
    title: p.title,
    fy24: cells?.fy24?.v ?? null,
    fy24Fid: cells?.fy24?.fid ?? null,
    fy26: cells?.fy26?.v ?? null,
    fy26Fid: cells?.fy26?.fid ?? null,
  };
  const reconK = p.fy2026_reconciliation_toa_usd_thousands;
  // "No reconciliation" — omit both fields (see the discK/reconK doc comment
  // above for why this is safe: discretionary == fy26 in that case, and
  // buildProgramsCsv derives it back). A genuinely absent value (`null`) and
  // an explicit zero are treated the same; the live corpus only ever
  // produces null for "no split exists," never a literal 0, but either way
  // means the same thing here.
  if (reconK == null || reconK === 0) {
    return base;
  }
  return {
    ...base,
    discK: p.fy2026_disc_toa_usd_thousands ?? undefined,
    reconK,
  };
}
