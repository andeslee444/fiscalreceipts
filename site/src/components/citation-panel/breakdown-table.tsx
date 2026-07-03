"use client";

/**
 * breakdown-table.tsx — "show your work" tables for derived citations
 * (Phase 5D §3b).
 *
 * BreakdownSection (wired into DerivedCard when the panel knows the fact_id):
 *   - Lazily fetches /json/breakdowns/{fact_id}.json (lib/breakdowns.ts —
 *     cached, single-flight). No file → renders nothing (the derived card is
 *     unchanged; most derived facts are not sum-decomposable).
 *   - ≤ INLINE_ROW_LIMIT rows → the table renders INLINE in the panel.
 *   - Larger sets → a "View all N line items →" button opens a full-screen
 *     overlay (Radix dialog — same pattern as the PDF zoom overlay: portal,
 *     token-driven fade, focus trap, Esc/click-outside closes). A text filter
 *     appears above the table when rows > FILTER_ROW_THRESHOLD.
 *
 * Table contract (G8 leg e, BINDING):
 *   [data-testid="breakdown-table"]           the table
 *   [data-testid="breakdown-sum"][data-v]     sum row; data-v == recorded_value
 *   [data-testid="breakdown-csv"]             CSV download of the tbody rows
 *
 * Row semantics:
 *   - Sorted by amount desc (subtracted/negative inputs naturally sink).
 *   - Subtracted inputs (Δ breakdowns) arrive with v ALREADY NEGATED and are
 *     rendered as a negative line: "− <label>" + the negative amount — so the
 *     column arithmetic is visibly checkable against the sum row.
 *   - Cited rows render a state-A <Cite> on the input's fact_id — clicking
 *     drills the panel into that input's own citation (the provider's back
 *     stack supplies the Back affordance). From the overlay, drilling closes
 *     the overlay first so the panel card is visible.
 *   - Uncited rows (fid:null, uncited:true) render the ⁂ state — the table
 *     always accounts for 100% of the sum, honestly.
 */

import React, {
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Download, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Cite, CitationPanelContext } from "@/components/cite";
import {
  fetchBreakdown,
  type Breakdown,
  type BreakdownRow,
} from "@/lib/breakdowns";
import type { AmountUnits } from "@/lib/format";

/** Largest input set rendered inline in the panel body. */
export const INLINE_ROW_LIMIT = 5;
/** Overlay tables above this row count get a text filter. */
export const FILTER_ROW_THRESHOLD = 25;

/** Narrow the sidecar's units string to the Cite units union (fallback USD). */
function asAmountUnits(units: string): AmountUnits {
  return units === "USD thousands" || units === "USD millions"
    ? units
    : "USD";
}

/** Exact numerals (not compact) so the sum arithmetic is visibly checkable. */
function fmtExact(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** RFC-4180-ish field escaping. */
function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── BreakdownSection — DerivedCard entry point ───────────────────────────────

export function BreakdownSection({ factId }: { factId: string }) {
  // Loaded pair keyed by factId — deriving (instead of resetting state in the
  // effect) avoids a synchronous setState-in-effect and keeps a stale
  // breakdown from flashing when the card drills to another derived fact.
  const [loaded, setLoaded] = useState<{
    factId: string;
    breakdown: Breakdown | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBreakdown(factId).then((b) => {
      if (!cancelled) setLoaded({ factId, breakdown: b });
    });
    return () => {
      cancelled = true;
    };
  }, [factId]);

  const breakdown =
    loaded && loaded.factId === factId ? loaded.breakdown : undefined;

  if (!breakdown || breakdown.rows.length === 0) return null;

  if (breakdown.rows.length <= INLINE_ROW_LIMIT) {
    return (
      <div data-testid="breakdown-section">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
          Line items ({breakdown.rows.length})
          <span className="ml-1.5 normal-case tracking-normal">
            · {breakdown.units}
          </span>
        </span>
        <BreakdownTable breakdown={breakdown} />
      </div>
    );
  }

  return <BreakdownOverlay breakdown={breakdown} />;
}

// ── BreakdownOverlay — full-screen dialog for large input sets ───────────────

function BreakdownOverlay({ breakdown }: { breakdown: Breakdown }) {
  const [open, setOpen] = useState(false);
  const parentPanel = useContext(CitationPanelContext);

  // Drilling into a row's citation from the overlay must reveal the panel
  // card underneath — close the overlay, then delegate to the provider.
  const drillContext = useMemo(
    () => ({
      openPanel: (fid: string) => {
        setOpen(false);
        parentPanel.openPanel(fid);
      },
      hasCitation: parentPanel.hasCitation,
    }),
    [parentPanel],
  );

  return (
    <div data-testid="breakdown-section">
      <button
        type="button"
        data-testid="breakdown-open"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="text-xs font-medium text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid transition-colors"
      >
        View all {breakdown.rows.length} line items →
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          {/* Token-driven fade (citation-panel-overlay keyframes, globals.css) —
              same pattern as the PDF zoom overlay. */}
          <DialogPrimitive.Overlay className="citation-panel-overlay fixed inset-0 z-[60] bg-black/70" />
          <DialogPrimitive.Content
            data-testid="breakdown-overlay"
            className="citation-panel-overlay fixed inset-2 z-[70] flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl outline-none sm:inset-8"
            aria-label={`All ${breakdown.rows.length} line items of this derived figure`}
            aria-modal="true"
          >
            <DialogPrimitive.Title className="sr-only">
              Line items of this derived figure
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Every input row that was summed to produce the derived value,
              each with its own citation
            </DialogPrimitive.Description>

            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
              <span className="truncate text-sm font-medium">
                Line items ({breakdown.rows.length})
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {breakdown.units}
                </span>
              </span>
              <DialogPrimitive.Close
                aria-label="Close line items"
                className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>

            {/* Scrollable table */}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <CitationPanelContext.Provider value={drillContext}>
                <BreakdownTable
                  breakdown={breakdown}
                  withFilter={breakdown.rows.length > FILTER_ROW_THRESHOLD}
                  stickySum
                />
              </CitationPanelContext.Provider>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

// ── BreakdownTable — the table itself (inline and overlay) ───────────────────

interface BreakdownTableProps {
  breakdown: Breakdown;
  /** Show the text filter above the table (large overlay sets). */
  withFilter?: boolean;
  /** Pin the sum row while scrolling (overlay). */
  stickySum?: boolean;
}

export function BreakdownTable({
  breakdown,
  withFilter = false,
  stickySum = false,
}: BreakdownTableProps) {
  const [filter, setFilter] = useState("");
  const units = asAmountUnits(breakdown.units);
  const recorded = Number(breakdown.recorded_value);

  // Sorted by amount desc (stable); subtracted/negative inputs sink.
  const sorted = useMemo(
    () => [...breakdown.rows].sort((a, b) => b.v - a.v),
    [breakdown.rows],
  );

  const displayed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        (r.pe_bli ?? "").toLowerCase().includes(q),
    );
  }, [sorted, filter]);

  function exportCsv() {
    const header = ["label", "pe_bli", "amount", "units", "fact_id"];
    const lines = [
      header.join(","),
      ...displayed.map((r) =>
        [
          csvField(r.label),
          csvField(r.pe_bli ?? ""),
          String(r.v),
          csvField(breakdown.units),
          r.fid ?? "uncited",
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `breakdown-${breakdown.fact_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      {/* Filter (large sets) + CSV export */}
      <div className="flex items-center justify-between gap-2">
        {withFilter ? (
          <input
            type="text"
            data-testid="breakdown-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter line items…"
            aria-label="Filter line items by name or PE/BLI"
            className="w-full max-w-xs rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        ) : (
          <span aria-hidden="true" />
        )}
        <button
          type="button"
          data-testid="breakdown-csv"
          onClick={exportCsv}
          aria-label="Download these line items as CSV"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Download className="h-3 w-3" aria-hidden="true" />
          CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table data-testid="breakdown-table" className="w-full text-xs">
          <caption className="sr-only">
            Input line items summed into this derived figure ({breakdown.units})
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              <th scope="col" className="px-2.5 py-1.5 font-semibold text-muted-foreground">
                Line item
              </th>
              <th
                scope="col"
                title={`Amount in ${breakdown.units}`}
                className="px-2.5 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap"
              >
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((r, i) => (
              <BreakdownRowTr key={`${r.fid ?? "uncited"}-${r.pe_bli ?? ""}-${i}`} row={r} units={units} />
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={2} className="px-2.5 py-2 text-muted-foreground">
                  No line items match the filter.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr
              data-testid="breakdown-sum"
              data-v={recorded}
              className={`border-t border-border bg-muted/60 font-semibold ${
                stickySum ? "sticky bottom-0" : ""
              }`}
            >
              <td className="px-2.5 py-1.5">
                Sum — recorded value
                {filter.trim() !== "" && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (all {sorted.length} line items)
                  </span>
                )}
              </td>
              <td className="px-2.5 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                {fmtExact(recorded)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BreakdownRowTr({
  row,
  units,
}: {
  row: BreakdownRow;
  units: AmountUnits;
}) {
  return (
    <tr className="border-b border-border last:border-0 transition-colors hover:bg-muted/30">
      <td className="px-2.5 py-1.5">
        <span className={row.subtracted ? "text-red-700" : undefined}>
          {row.subtracted ? "− " : ""}
          {row.label}
        </span>
        {row.pe_bli && (
          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            {row.pe_bli}
          </span>
        )}
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
        <Cite
          value={row.v}
          units={units}
          dataset="breakdowns"
          factId={row.fid ?? undefined}
          display={fmtExact(row.v)}
        />
      </td>
    </tr>
  );
}
