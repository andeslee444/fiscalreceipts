"use client";

/**
 * Client-side companies table — filter/sort parity with programs-table
 * (Phase 5C Goal 2): text filter on company name + sortable obligation and
 * UEI-count columns.
 *
 * §P1-3 (PM Sprint 2), two changes:
 *
 *  1. CURATED FAMILY MERGE. `/companies/` listed RAYTHEON COMPANY ($43.7B, #4)
 *     and RTX CORP ($24.6B, #6) as two families — one company, renamed in
 *     2023. Rows now arrive already merged (lib/entity-families mergeCompanies,
 *     from the hand-curated seed), the combined figure is the exporter's CITED
 *     derived fact (never a browser-side sum), and rank is recomputed after
 *     the merge. A merged row names every registry name it folds in, links the
 *     ones that have pages, and points at /companies/families/ for the event
 *     and its source.
 *  2. CONFIDENCE CHIP SUPPRESSION. All 200 rows read "medium" — a chip that
 *     never varies conveys nothing while adding 200 amber badges. When the
 *     value is uniform across the whole table the column is dropped and the
 *     method is stated once, in the header. Uniformity is computed over ALL
 *     rows, not the filtered view, so the column cannot appear and disappear
 *     as the reader types.
 *
 * The filter matches the family label AND every member registry name, so
 * typing "Raytheon" still finds the RTX family line.
 *
 * Rank (#) travels with the row, so it stays stable under filtering and
 * re-sorting.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Cite } from "@/components/cite";
import type { CompanyRow } from "@/lib/entity-families";

interface CompaniesTableProps {
  rows: CompanyRow[];
  /** Suppressed when every row carries the same confidence (§P1-3). */
  showConfidence: boolean;
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

/** "renamed 2023" / "acquired 2018" — the shortest honest event label. */
function eventLabel(event: string, effectiveDate: string): string {
  const year = effectiveDate.slice(0, 4);
  return event === "rename" ? `renamed ${year}` : `acquired ${year}`;
}

/**
 * The registry names folded into a merged row. Members with a company page
 * link to it; members outside the top-200 export are named as plain text —
 * their obligations are in the total, they just have no page to open.
 */
function MergedMembers({ row }: { row: CompanyRow }) {
  const events = row.family?.events ?? [];
  const latest = events.length > 0 ? events[0] : null;
  return (
    <span className="mt-0.5 block text-xs text-muted-foreground">
      {row.members.map((m, i) => (
        <span key={m.family_key}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {m.has_page ? (
            <Link
              href={`/company/${m.slug}/`}
              className="hover:text-foreground hover:underline"
            >
              {m.display_name}
            </Link>
          ) : (
            <span title="Outside the top-200 list — counted in the total, no profile page">
              {m.display_name}
            </span>
          )}
        </span>
      ))}
      {latest && (
        <>
          {" — "}
          <Link
            href="/companies/families/"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            title="Hand-curated corporate rename/acquisition table, with sources"
          >
            {eventLabel(latest.event, latest.effective_date)}
          </Link>
        </>
      )}
    </span>
  );
}

export function CompaniesTable({ rows, showConfidence }: CompaniesTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_obligation");
  const [sortAsc, setSortAsc] = useState(false);

  // Haystack: the family label plus every registry name it folds in, so
  // "Raytheon" finds the RTX family line.
  const haystacks = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.key,
          [r.displayName, ...r.members.map((m) => m.display_name)]
            .join(" ")
            .toLowerCase(),
        ]),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((r) => (haystacks.get(r.key) ?? "").includes(q))
      : rows;

    out = [...out].sort((a, b) => {
      const av = sortKey === "total_obligation" ? a.totalObligation : a.ueiCount;
      const bv = sortKey === "total_obligation" ? b.totalObligation : b.ueiCount;
      return sortAsc ? av - bv : bv - av;
    });

    return out;
  }, [rows, haystacks, query, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const mergedCount = rows.filter((r) => r.merged).length;

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
          row carries the comparator's own input in data-sort-value.
          §P1-3 contract (gate 24 leg g): every row declares the registry
          family keys it renders in data-family-keys, so the gate can assert
          that no curated family is split across two rows. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full text-sm"
          data-sort-table="companies"
          data-sort-order={`${sortKey}:${sortAsc ? "asc" : "desc"}`}
          data-merged-families={mergedCount}
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
              {showConfidence && (
                <th scope="col" className="px-4 py-3 font-medium text-center w-28">
                  Confidence
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r) => (
              <tr
                key={r.key}
                className="hover:bg-muted/40 transition-colors"
                data-sort-value={String(
                  sortKey === "total_obligation" ? r.totalObligation : r.ueiCount,
                )}
                data-family-keys={r.members.map((m) => m.family_key).join("|")}
                {...(r.merged ? { "data-merged-family": r.key } : {})}
              >
                <td className="px-4 py-3 text-right text-muted-foreground/60 text-xs tabular-nums align-top">
                  {r.rank}
                </td>
                <td className="px-4 py-3">
                  {r.merged ? (
                    <>
                      <span className="font-medium text-foreground">
                        {r.displayName}
                      </span>
                      <MergedMembers row={r} />
                    </>
                  ) : (
                    <Link
                      href={`/company/${r.members[0].slug}/`}
                      className="font-medium hover:underline text-foreground"
                    >
                      {r.displayName}
                    </Link>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-muted-foreground tabular-nums align-top">
                  {r.ueiCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top">
                  <Cite
                    value={r.totalObligation}
                    units="USD"
                    dataset="dim_entities"
                    factId={r.factId}
                  />
                </td>
                {showConfidence && (
                  <td className="px-4 py-3 text-center align-top">
                    <span
                      className={[
                        "inline-block rounded px-2 py-0.5 text-xs font-medium",
                        CONFIDENCE_COLORS[r.worstConfidence] ??
                          "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      {r.worstConfidence}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
