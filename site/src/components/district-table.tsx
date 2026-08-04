"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DistrictIndexRow } from "@/lib/data";
import { districtDisplayLabel } from "@/lib/format";
import { Cite } from "@/components/cite";

type SortKey = "pop_district" | "pop_state" | "program_count" | "total_linkable_dollars";
type SortDir = "asc" | "desc";

interface SortHeaderProps {
  label: string;
  /** Compact label swapped in below the sm breakpoint (narrow columns). */
  shortLabel?: string;
  colKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortHeader({
  label,
  shortLabel,
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
        "py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap",
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
      {shortLabel ? (
        <>
          <span className="sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        label
      )}
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

  // Horizontal-scroll affordance: the table has a min-width wider than a
  // 390px viewport, so it scrolls inside the wrapper below. Show a right-edge
  // fade while more columns remain off-screen to the right.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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

      <div className="relative rounded-lg border border-border overflow-hidden bg-card">
        <div ref={scrollRef} className="overflow-x-auto">
          {/* Cells are whitespace-nowrap, so the table's min width is its
              content width — when that exceeds the viewport (narrow phones)
              the wrapper scrolls horizontally instead of clipping values,
              and the fade below signals the overflow. */}
          {/* §P1-7 sort contract (gate 24 leg f) — see programs-table.tsx. */}
          <table
            className="w-full text-sm"
            data-sort-table="districts"
            data-sort-order={`${sortKey}:${sortDir}`}
          >
            <thead className="bg-muted/50">
              <tr>
                <SortHeader
                  label="District"
                  colKey="pop_district"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="px-3 sm:px-4"
                />
                {/* State column hides below sm — the district code already
                    carries the state prefix (CO-05), and dropping it keeps
                    the LINKABLE $ column on-screen at 390px. */}
                <SortHeader
                  label="State"
                  colKey="pop_state"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="px-3 sm:px-4 hidden sm:table-cell"
                />
                <SortHeader
                  label="Programs"
                  colKey="program_count"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="px-3 sm:px-4 text-right"
                />
                <SortHeader
                  label="Linkable dollars"
                  shortLabel="Linkable $"
                  colKey="total_linkable_dollars"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="pl-3 pr-4 sm:pl-4 sm:pr-6 text-right"
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((d) => (
                <tr
                  key={d.pop_district}
                  className="hover:bg-muted/40 transition-colors"
                  data-sort-value={String(d[sortKey])}
                >
                  {/* No nowrap here: long special labels ("DC (undistricted)")
                      may wrap on narrow phones so the dollar column stays
                      fully on-screen; plain codes ("CO-05") never wrap. */}
                  <td className="px-3 sm:px-4 py-3 font-mono">
                    <Link
                      href={`/district/${d.pop_district}/`}
                      className="text-primary hover:underline"
                      title={
                        districtDisplayLabel(d.pop_district) !== d.pop_district
                          ? d.pop_district
                          : undefined
                      }
                    >
                      {/* Special codes (00/90/98/99) render a plain-language
                          label; the URL keeps the raw pop_district code. */}
                      {districtDisplayLabel(d.pop_district)}
                    </Link>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {d.pop_state}
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-right tabular-nums">
                    {d.program_count}
                  </td>
                  <td className="pl-3 pr-4 sm:pl-4 sm:pr-6 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {d.total_linkable_dollars > 0 ? (
                      // Derived 'district' aggregate citation — the sum of the
                      // district's per-program USAspending-cited obligations.
                      // State A opens the citation panel (formula + input
                      // chips); honest state C when the fact_id is absent.
                      <Cite
                        value={d.total_linkable_dollars}
                        units="USD"
                        dataset="fct_district_programs"
                        factId={d.total_linkable_fact_id}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Right-edge fade — visible only while the table can scroll further
            right (mobile affordance; disappears at the end of the scroll). */}
        {canScrollRight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-card to-transparent"
          />
        )}
      </div>
    </div>
  );
}
