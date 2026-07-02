"use client";

/**
 * Client-side filterable + sortable programs table.
 * Receives the full programs array from the server component.
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ProgramRow } from "@/lib/data";
import { Cite } from "@/components/cite";

type SortKey = "fy2026_total" | "fy2024_actual" | "title";

interface ProgramsTableProps {
  programs: ProgramRow[];
  orgs: string[];
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
  const [sortKey, setSortKey] = useState<SortKey>("fy2026_total");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let rows =
      orgFilter === "all"
        ? programs
        : programs.filter((p) => p.org === orgFilter);

    rows = [...rows].sort((a, b) => {
      if (sortKey === "title") {
        const cmp = a.title.localeCompare(b.title);
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
  }, [programs, orgFilter, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Agency:</span>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="rounded border border-border bg-background text-foreground px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All agencies</option>
            {orgs.map((org) => (
              <option key={org} value={org}>{org}</option>
            ))}
          </select>
        </label>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length.toLocaleString("en-US")} program
          {filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium text-muted-foreground w-24">PE/BLI</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted-foreground w-16">Org</th>
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
              <tr key={p.pe_bli} className="hover:bg-muted/40 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {p.pe_bli}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {p.org}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/program/${p.pe_bli}/`}
                    className="font-medium hover:underline text-foreground"
                    data-program-name
                  >
                    {p.title}
                  </Link>
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
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        FY26 figures carry derived workbook citations (click to inspect the
        formula and inputs). FY24 actuals cited to J-book PDF where available
        (underlined). See{" "}
        <Link href="/methodology/" className="underline hover:text-foreground">
          methodology
        </Link>
        .
      </p>
    </div>
  );
}
