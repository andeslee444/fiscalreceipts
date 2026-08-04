"use client";

/**
 * Client-side filterable + sortable programs table.
 * Receives the full programs array from the server component.
 *
 * §P1-11 (PM Sprint 2): this 1,741-row index offered only an agency dropdown,
 * while /years/ has a text filter and /companies/ has a name filter. It now
 * ships the same three affordances its siblings do, reusing their patterns
 * rather than inventing new ones:
 *
 *   - a TEXT FILTER over program title, PE/BLI and organization (the /years/
 *     `filterEntries` contract, same placeholder wording, same data-testid
 *     naming so the same gate style applies);
 *   - SORT ON ORG (the column was there and was not sortable);
 *   - CSV EXPORT of the current view (the /years/ blob pattern).
 *
 * The org column renders the HUMAN service name ("Air Force"), not the raw
 * workbook token ("F") — §P1-E badge sweep. The filter matches BOTH, so
 * typing "F", "Air Force" or "air" all work, and the CSV keeps the raw code
 * (it is the join key downstream consumers need) alongside the display name.
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import type { ProgramRow } from "@/lib/data";
import { Cite } from "@/components/cite";
import { serviceOrgName } from "@/lib/program-tier";
import { aliasChipText, aliasHitsForQuery } from "@/lib/aliases";
import { formatCount } from "@/lib/format";

type SortKey = "fy2026_total" | "fy2024_actual" | "title" | "org";

interface ProgramsTableProps {
  programs: ProgramRow[];
  orgs: string[];
}

/** Case-insensitive substring match over title, PE/BLI, raw org and org name. */
export function programHaystack(p: ProgramRow): string {
  return [p.title, p.pe_bli, p.org, serviceOrgName(p.org)]
    .join(" ")
    .toLowerCase();
}

/**
 * The rows a query selects: substring over the haystack UNION the curated
 * alias table (lib/aliases — the same resolver ⌘K uses).
 *
 * Exported for tests. The defect it closes: "sentinel" here returned only
 * "Sentinel Mods" while ⌘K said Sentinel = Ground Based Strategic Deterrent.
 */
export function filterPrograms(
  programs: readonly ProgramRow[],
  haystacks: Map<string, string>,
  query: string,
): ProgramRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...programs];
  const aliasHits = aliasHitsForQuery(query);
  return programs.filter(
    (p) =>
      (haystacks.get(p.pe_bli) ?? "").includes(q) || aliasHits.has(p.pe_bli),
  );
}

/** RFC-4180-ish field escaping (mirrors years-matrix csvField). */
function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of the current view. Dollar columns keep the units the table declares —
 * FY24 actuals in USD millions (the J-book grain), FY26 totals in USD
 * thousands (the workbook grain) — and say so in the header, rather than
 * silently converting one into the other. Missing values are empty, never 0.
 */
export function buildProgramsCsv(rows: readonly ProgramRow[]): string {
  const header = [
    "pe_bli",
    "org",
    "org_name",
    "title",
    "fy2024_actual_usd_millions",
    "fy2026_total_usd_thousands",
  ];
  const lines = [header.join(",")];
  for (const p of rows) {
    lines.push(
      [
        csvField(p.pe_bli),
        csvField(p.org),
        csvField(serviceOrgName(p.org)),
        csvField(p.title),
        p.fy2024_actual_millions != null ? String(p.fy2024_actual_millions) : "",
        p.trajectory?.fy2026_total != null ? String(p.trajectory.fy2026_total) : "",
      ].join(","),
    );
  }
  return lines.join("\n");
}

function SortIcon({
  col,
  sortKey,
  sortAsc,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
}) {
  if (sortKey !== col) {
    return (
      <span className="ml-1 text-muted-foreground/50" aria-hidden="true">
        ↕
      </span>
    );
  }
  return (
    <span className="ml-1" aria-hidden="true">
      {sortAsc ? "↑" : "↓"}
    </span>
  );
}

export function ProgramsTable({ programs, orgs }: ProgramsTableProps) {
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("fy2026_total");
  const [sortAsc, setSortAsc] = useState(false);

  // Precomputed haystacks — 1,741 rows re-filtered on every keystroke.
  const haystacks = useMemo(
    () => new Map(programs.map((p) => [p.pe_bli, programHaystack(p)])),
    [programs],
  );

  // Which visible rows got here by ALIAS rather than by their own text — the
  // row says so, otherwise "Ground Based Strategic Deterrent EMD" looks like a
  // filter bug to someone who typed "sentinel".
  const aliasHits = useMemo(() => aliasHitsForQuery(query), [query]);

  const filtered = useMemo(() => {
    const base =
      orgFilter === "all"
        ? programs
        : programs.filter((p) => p.org === orgFilter);
    let rows = filterPrograms(base, haystacks, query);

    rows = [...rows].sort((a, b) => {
      if (sortKey === "title") {
        const cmp = a.title.localeCompare(b.title);
        return sortAsc ? cmp : -cmp;
      }
      if (sortKey === "org") {
        // Sort by the name the reader SEES, with PE/BLI as a stable tiebreak
        // so the whole order is deterministic inside an organization.
        const cmp =
          serviceOrgName(a.org).localeCompare(serviceOrgName(b.org)) ||
          a.pe_bli.localeCompare(b.pe_bli);
        return sortAsc ? cmp : -cmp;
      }
      if (sortKey === "fy2026_total") {
        const av = a.trajectory?.fy2026_total ?? -Infinity;
        const bv = b.trajectory?.fy2026_total ?? -Infinity;
        return sortAsc ? av - bv : bv - av;
      }
      // fy2024_actual
      const av = a.fy2024_actual_millions ?? -Infinity;
      const bv = b.fy2024_actual_millions ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });

    return rows;
  }, [programs, haystacks, orgFilter, query, sortKey, sortAsc]);

  /** The comparator's own input for a row, serialized (sort contract above). */
  function sortValue(p: ProgramsTableProps["programs"][number]): string {
    if (sortKey === "title") return p.title;
    if (sortKey === "org") return `${serviceOrgName(p.org)}|${p.pe_bli}`;
    if (sortKey === "fy2026_total") {
      return String(p.trajectory?.fy2026_total ?? -Infinity);
    }
    return String(p.fy2024_actual_millions ?? -Infinity);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      // Text columns read best A→Z; money columns read best largest-first.
      setSortAsc(key === "title" || key === "org");
    }
  }

  function exportCsv() {
    const blob = new Blob([buildProgramsCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "programs.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Filters — text filter + agency dropdown + CSV, matching /years/. */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="search"
          data-testid="programs-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by program, PE/BLI, or organization…"
          aria-label="Filter programs by name, PE/BLI, or organization"
          className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Agency:</span>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="rounded border border-border bg-background text-foreground px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All agencies</option>
            {orgs.map((org) => (
              <option key={org} value={org}>
                {serviceOrgName(org)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatCount(filtered.length)} of{" "}
          {formatCount(programs.length)} program
          {programs.length !== 1 ? "s" : ""}
        </span>
        <button
          type="button"
          data-testid="programs-csv"
          onClick={exportCsv}
          aria-label="Download the current view as CSV"
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          CSV
        </button>
      </div>

      {/* Table.
          §P1-7 sort contract (gate 24 leg f): data-sort-table names the table,
          data-sort-order declares "<key>:<dir>" for the order the rows are
          ACTUALLY in right now (it tracks the live sort state, so it stays
          true after the reader clicks a header), and every row carries the
          declared key's value in data-sort-value — the comparator's own input,
          serialized, "-Infinity" sentinel included, so monotonicity is checked
          against exactly what the sort saw. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full text-sm"
          data-sort-table="programs"
          data-sort-order={`${sortKey}:${sortAsc ? "asc" : "desc"}`}
        >
          <thead className="bg-muted/60 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium text-muted-foreground w-24">PE/BLI</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted-foreground w-28">
                <button
                  onClick={() => toggleSort("org")}
                  className="flex items-center hover:text-foreground transition-colors"
                >
                  Org <SortIcon col="org" sortKey={sortKey} sortAsc={sortAsc} />
                </button>
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <button
                  onClick={() => toggleSort("title")}
                  className="flex items-center hover:text-foreground transition-colors"
                >
                  Program{" "}
                  <SortIcon col="title" sortKey={sortKey} sortAsc={sortAsc} />
                </button>
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                <button
                  onClick={() => toggleSort("fy2024_actual")}
                  className="flex items-center ml-auto hover:text-foreground transition-colors"
                >
                  FY24 actual{" "}
                  <SortIcon
                    col="fy2024_actual"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                  />
                </button>
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                <button
                  onClick={() => toggleSort("fy2026_total")}
                  className="flex items-center ml-auto hover:text-foreground transition-colors"
                >
                  FY26 total{" "}
                  <SortIcon
                    col="fy2026_total"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((p) => (
              <tr
                key={p.pe_bli}
                className="hover:bg-muted/40 transition-colors"
                data-sort-value={sortValue(p)}
              >
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {p.pe_bli}
                </td>
                {/* §P1-E: the human service name, not the raw workbook token. */}
                <td className="px-4 py-3 text-xs text-muted-foreground" title={p.org}>
                  {serviceOrgName(p.org)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/program/${p.pe_bli}/`}
                    className="font-medium hover:underline text-foreground"
                    data-program-name
                  >
                    {p.title}
                  </Link>
                  {aliasHits.has(p.pe_bli) && (
                    <span
                      data-testid="programs-alias-hit"
                      data-alias-matched={aliasHits.get(p.pe_bli)!.matched}
                      className="ml-2 inline-block rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground align-middle"
                    >
                      {aliasChipText(
                        aliasHits.get(p.pe_bli)!.matched,
                        aliasHits.get(p.pe_bli)!.aliases,
                      )}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {p.fy2024_actual_millions != null ? (
                    <Cite
                      value={p.fy2024_actual_millions}
                      units="USD millions"
                      dataset="jbook_details"
                      factId={p.fy2024_fact_id}
                      xmlPath={p.fy2024_xml_path}
                    />
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.trajectory?.fy2026_total != null ? (
                    <Cite
                      value={p.trajectory.fy2026_total}
                      units="USD thousands"
                      dataset="fct_budget_trajectory"
                      factId={p.trajectory_fact_ids?.fy2026_total}
                    />
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                  No programs match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        FY26 figures carry derived workbook citations (click to inspect the
        formula and inputs). FY24 actuals cited to J-book PDF where available
        (underlined). CSV exports the current view, with FY24 in USD millions
        and FY26 in USD thousands as labeled. See{" "}
        <Link href="/methodology/" className="underline hover:text-foreground">
          methodology
        </Link>
        .
      </p>
    </div>
  );
}
