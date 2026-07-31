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
 *     appears when rows > FILTER_ROW_THRESHOLD, PINNED in the overlay's
 *     sticky header (not the scrollport) so it stays visible mid-scroll
 *     (judge advisory, backlog #21).
 *
 * Table contract (G8 leg e, BINDING — overlay legs STRENGTHENED 2026-07-02
 * after the visual-judge M2 finding):
 *   [data-testid="breakdown-table"]           the table
 *   [data-testid="breakdown-sum"][data-v]     sum row; data-v == recorded_value
 *   [data-testid="breakdown-csv"]             CSV download of the tbody rows
 *   [data-testid="breakdown-scroll"]          overlay scrollport; the sum row
 *                                             MUST stay visible mid-scroll
 *                                             (sticky tds, opaque bg)
 *   [data-testid="breakdown-overlay-total"][data-v]
 *                                             recorded total in the overlay
 *                                             header ("sums to …")
 *   [data-testid="cite-legend"]               honesty-marker legend in the
 *                                             overlay header
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
import { Cite, CiteLegend, CitationPanelContext } from "@/components/cite";
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

/**
 * Exact numerals (not compact) so the sum arithmetic is visibly checkable.
 * FIXED 3 decimals (visual-judge decimal-alignment finding): every breakdown
 * amount pads to 3dp ("168.2" → "168.200") so, with tabular-nums, the decimal
 * points form a vertical rule down the column.
 */
function fmtExact(v: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/**
 * Invisible twin of the Cite state-C trailing "⁂" (same classes → same
 * advance width). Appended to CITED rows and the sum row so their numerals
 * end at exactly the same x as uncited rows' — keeping the decimal points
 * aligned across all rows despite the uncited glyph.
 */
function MarkerSpacer() {
  return (
    <span className="ml-0.5 invisible select-none" aria-hidden="true">
      ⁂
    </span>
  );
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
  // Filter state lives HERE (not in BreakdownTable) so the input can render
  // inside the overlay's non-scrolling header — pinned visible while the row
  // list scrolls (judge advisory, backlog #21). Reset on close so a reopened
  // overlay starts unfiltered (the pre-pin behavior, when the input unmounted
  // with the table).
  const [filter, setFilter] = useState("");
  const parentPanel = useContext(CitationPanelContext);
  const recorded = Number(breakdown.recorded_value);

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

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFilter("");
        }}
      >
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

            {/* Toolbar — states the recorded total up front so the reader
                knows what the line items must reconcile to (M2 finding). */}
            <div className="shrink-0 border-b border-border px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  Line items ({breakdown.rows.length})
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {breakdown.units} · sums to{" "}
                    <span
                      data-testid="breakdown-overlay-total"
                      data-v={recorded}
                      className="font-mono tabular-nums text-foreground"
                    >
                      {fmtExact(recorded)}
                    </span>
                  </span>
                </span>
                <DialogPrimitive.Close
                  aria-label="Close line items"
                  className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>
              <CiteLegend />
              {/* Text filter pinned in the sticky header region — stays
                  visible while [data-testid="breakdown-scroll"] scrolls. */}
              {breakdown.rows.length > FILTER_ROW_THRESHOLD && (
                <input
                  type="text"
                  data-testid="breakdown-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter line items…"
                  aria-label="Filter line items by name or PE/BLI"
                  className="mt-2 w-full max-w-xs rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>

            {/* Scrollable table — THIS div is the vertical scrollport the
                sticky sum row pins to (data-testid consumed by the G8
                strengthened e-UI leg). The table wrapper inside must NOT be
                its own scroll container in overlay mode, or `sticky bottom-0`
                pins to the wrong box and the sum row vanishes mid-scroll. */}
            <div
              data-testid="breakdown-scroll"
              className="min-h-0 flex-1 overflow-auto p-4 pb-0"
            >
              <CitationPanelContext.Provider value={drillContext}>
                <BreakdownTable breakdown={breakdown} filter={filter} stickySum />
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
  /**
   * Filter text, controlled by the caller — the overlay owns the input and
   * pins it in its sticky header (backlog #21). Inline tables pass nothing.
   */
  filter?: string;
  /** Pin the sum row while scrolling (overlay). */
  stickySum?: boolean;
}

export function BreakdownTable({
  breakdown,
  filter = "",
  stickySum = false,
}: BreakdownTableProps) {
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
      {/* CSV export (the overlay's text filter lives in its pinned header) */}
      <div className="flex items-center justify-end gap-2">
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

      {/* In stickySum (overlay) mode the wrapper must NOT be a scroll
          container — `overflow-x-auto` would become the sum row's sticky
          scrollport (it never scrolls vertically, so the row would sit inert
          at the table foot). The overlay's own scroll div handles both axes. */}
      <div
        className={
          stickySum
            ? "rounded-md border border-border"
            : "overflow-x-auto rounded-md border border-border"
        }
      >
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
            {/* Sticky pinning lives on the TDs, not the TR — Chromium does
                not apply position:sticky to table rows. The background must
                be OPAQUE (bg-muted, not bg-muted/60) so scrolled line items
                cannot ghost through the pinned row; the -1px box-shadow
                stands in for border-top, which collapsed borders leave
                behind when a cell goes sticky. */}
            <tr
              data-testid="breakdown-sum"
              data-v={recorded}
              className={`border-t border-border font-semibold ${
                stickySum ? "" : "bg-muted/60"
              }`}
            >
              <td
                className={`px-2.5 py-1.5 ${
                  stickySum
                    ? "sticky bottom-0 bg-muted [box-shadow:0_-1px_0_var(--color-border)]"
                    : ""
                }`}
              >
                Sum — recorded value
                {filter.trim() !== "" && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (all {sorted.length} line items)
                  </span>
                )}
              </td>
              <td
                className={`px-2.5 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
                  stickySum
                    ? "sticky bottom-0 bg-muted [box-shadow:0_-1px_0_var(--color-border)]"
                    : ""
                }`}
              >
                {fmtExact(recorded)}
                <MarkerSpacer />
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
  const isUncited = !row.fid;
  return (
    <tr className="border-b border-border last:border-0 transition-colors hover:bg-muted/30">
      <td className="px-2.5 py-1.5">
        <span className={row.subtracted ? "text-red-700" : undefined}>
          {row.subtracted ? "− " : ""}
          {row.label}
        </span>
        {row.pe_bli && (
          // Every breakdown pe_bli has a program page (the Phase 5F universe
          // covers every distinct PE in budget_lines) — link it (§2a).
          <a
            href={`/program/${encodeURIComponent(row.pe_bli)}/`}
            className="ml-1.5 rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
            title={`Open program page for ${row.pe_bli}`}
          >
            {row.pe_bli}
          </a>
        )}
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
        {/* Uncited rows carry an EXPLICIT muted tag ahead of the amount (not
            just the trailing ⁂ glyph) — visual-judge M2 finding. It sits
            before the numerals so it cannot disturb decimal alignment. */}
        {isUncited && (
          <span
            className="mr-1.5 rounded bg-muted px-1 py-0.5 font-sans text-xs font-normal text-muted-foreground align-middle"
            title="input has no citation row — still counted in the sum"
          >
            uncited
          </span>
        )}
        <Cite
          value={row.v}
          units={units}
          dataset="breakdowns"
          factId={row.fid ?? undefined}
          display={fmtExact(row.v)}
        />
        {/* Cited rows get an invisible ⁂-width spacer so their numerals line
            up with uncited rows' (whose Cite appends a real trailing ⁂). */}
        {!isUncited && <MarkerSpacer />}
      </td>
    </tr>
  );
}
