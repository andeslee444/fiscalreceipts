"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import type { DistrictIndexRow } from "@/lib/data";
import { formatAmount } from "@/lib/format";

type SortKey = "pop_district" | "pop_state" | "program_count" | "total_linkable_dollars";
type SortDir = "asc" | "desc";

interface SortHeaderProps {
  label: string;
  colKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortHeader({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  className,
}: SortHeaderProps) {
  const active = sortKey === colKey;
  return (
    <th
      className={[
        "px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide",
        "cursor-pointer select-none hover:text-foreground transition-colors",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSort(colKey)}
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      {label}
      <span className="ml-1 opacity-50" aria-hidden="true">
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </th>
  );
}

interface Props {
  districts: DistrictIndexRow[];
}

export function DistrictTable({ districts }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("total_linkable_dollars");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [stateFilter, setStateFilter] = useState<string>("");

  const uniqueStates = useMemo(
    () =>
      [...new Set(districts.map((d) => d.pop_state))]
        .filter(Boolean)
        .sort(),
    [districts],
  );

  const filtered = useMemo(() => {
    const base = stateFilter
      ? districts.filter((d) => d.pop_state === stateFilter)
      : districts;

    return [...base].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [districts, sortKey, sortDir, stateFilter]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "pop_district" || key === "pop_state" ? "asc" : "desc");
    }
  }

  return (
    <div>
      {/* State filter */}
      <div className="flex items-center gap-3 mb-3">
        <label htmlFor="state-filter" className="text-sm text-muted-foreground">
          Filter by state:
        </label>
        <select
          id="state-filter"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">All states ({districts.length})</option>
          {uniqueStates.map((s) => {
            const count = districts.filter((d) => d.pop_state === s).length;
            return (
              <option key={s} value={s}>
                {s} ({count})
              </option>
            );
          })}
        </select>
        {stateFilter && (
          <button
            onClick={() => setStateFilter("")}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            clear
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} district{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <SortHeader
                  label="District"
                  colKey="pop_district"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="State"
                  colKey="pop_state"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Programs"
                  colKey="program_count"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortHeader
                  label="Linkable dollars"
                  colKey="total_linkable_dollars"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((d) => (
                <tr
                  key={d.pop_district}
                  className="hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3 font-mono">
                    <Link
                      href={`/district/${d.pop_district}/`}
                      className="text-primary hover:underline"
                    >
                      {d.pop_district}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {d.pop_state}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {d.program_count}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {d.total_linkable_dollars > 0 ? (
                      // dim_geography is the uncited geography totals dataset —
                      // district-index linkable totals are geography aggregates
                      // with no individual fact_id (state C, uncited).
                      <span
                        data-amount
                        data-uncited="true"
                        data-dataset="dim_geography"
                        title={`$${d.total_linkable_dollars.toLocaleString("en-US")} USD`}
                      >
                        {formatAmount(d.total_linkable_dollars, "USD")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
