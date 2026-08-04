"use client";

/**
 * Client-side companies table — filter/sort parity with programs-table
 * (Phase 5C Goal 2): text filter on company name + sortable obligation and
 * UEI-count columns. Confidence chip display unchanged.
 *
 * Rank (#) is the company's position by total obligations in the incoming
 * top-200 array — it is computed once and travels with the row, so it stays
 * stable under filtering and re-sorting.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EntityTop } from "@/lib/data";
import { Cite } from "@/components/cite";

interface CompaniesTableProps {
  companies: EntityTop[];
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700",
};

type SortKey = "total_obligation" | "uei_count";

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

export function CompaniesTable({ companies }: CompaniesTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_obligation");
  const [sortAsc, setSortAsc] = useState(false);

  // Attach the obligation rank once (input array is sorted by obligation desc)
  const ranked = useMemo(
    () => companies.map((c, i) => ({ ...c, rank: i + 1 })),
    [companies],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = q
      ? ranked.filter((c) => c.display_name.toLowerCase().includes(q))
      : ranked;

    rows = [...rows].sort((a, b) => {
      const av = sortKey === "total_obligation" ? a.total_obligation : a.uei_count;
      const bv = sortKey === "total_obligation" ? b.total_obligation : b.uei_count;
      return sortAsc ? av - bv : bv - av;
    });

    return rows;
  }, [ranked, query, sortKey, sortAsc]);

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
      {/* Filter */}
      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter:</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company name…"
            className="rounded border border-border bg-background text-foreground px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length.toLocaleString("en-US")} compan
          {filtered.length !== 1 ? "ies" : "y"}
        </span>
      </div>

      {/* Table.
          §P1-7 sort contract (gate 24 leg f) — see programs-table.tsx for the
          full contract: data-sort-order tracks the LIVE sort state and every
          row carries the comparator's own input in data-sort-value. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full text-sm"
          data-sort-table="companies"
          data-sort-order={`${sortKey}:${sortAsc ? "asc" : "desc"}`}
        >
          <thead className="bg-muted/60 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium text-muted-foreground w-10 text-right">
                #
              </th>
              <th scope="col" className="px-4 py-3 font-medium">Company</th>
              <th scope="col" className="px-4 py-3 font-medium text-center w-24">
                <button
                  onClick={() => toggleSort("uei_count")}
                  className="flex items-center mx-auto hover:text-foreground transition-colors"
                >
                  UEIs{" "}
                  <SortIcon col="uei_count" sortKey={sortKey} sortAsc={sortAsc} />
                </button>
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                <button
                  onClick={() => toggleSort("total_obligation")}
                  className="flex items-center ml-auto hover:text-foreground transition-colors"
                >
                  Total obligations{" "}
                  <SortIcon
                    col="total_obligation"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                  />
                </button>
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-center w-28">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((c) => (
              <tr
                key={c.slug}
                className="hover:bg-muted/40 transition-colors"
                data-sort-value={String(
                  sortKey === "total_obligation" ? c.total_obligation : c.uei_count,
                )}
              >
                <td className="px-4 py-3 text-right text-muted-foreground/60 text-xs tabular-nums">
                  {c.rank}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/company/${c.slug}/`}
                    className="font-medium hover:underline text-foreground"
                  >
                    {c.display_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-center text-muted-foreground tabular-nums">
                  {c.uei_count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <Cite
                    value={c.total_obligation}
                    units="USD"
                    dataset="dim_entities"
                    factId={c.total_obligation_fact_id}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={[
                      "inline-block rounded px-2 py-0.5 text-xs font-medium",
                      CONFIDENCE_COLORS[c.worst_confidence] ??
                        "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {c.worst_confidence}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
