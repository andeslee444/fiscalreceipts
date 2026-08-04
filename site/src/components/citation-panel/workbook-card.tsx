"use client";

/**
 * workbook-card.tsx — the workbook tier of the citation drawer.
 *
 * Rebuilt for PM-review Sprint 2 Task 4 (spec §P1-9). The old card named a
 * sheet and some cell refs, headlined the compact figure with a contradicting
 * unit label ("$5.57B  USD thousands"), and offered a .xlsx download as the
 * only way to see the source. Seven fixes, in render order:
 *
 *  (1) AMOUNT — the RECORDED value leads, in its recorded units, with the
 *      compact dollar equivalence as a parenthetical aside:
 *      "5,565,655  USD thousands  (= $5.57B)". Same shape as the PDF tier
 *      ("5,247.070 USD millions (= $5.25B)"), same formatter (usdEquivalence).
 *  (7) DOCUMENT — the document title + edition, via documentTitleFromUrl
 *      (lib/footnote.ts — the copy-as-footnote formatter's own source of
 *      truth, so the drawer and the footnote name the document identically).
 *  (4) LOCATOR — sheet + cell refs, each ref rendered by <CellRef>: the
 *      column letter is its own element and the ref carries a spelled-out
 *      title ("column O, row 839"), because at 12px 'O' and '0' are the same
 *      picture. See the .cell-ref note in globals.css for why a slashed-zero
 *      font feature alone does not fix this.
 *  (3) ARITHMETIC — when the fact sums several cells, the operation is shown
 *      with each cell's own value: O839 a + O840 b + O841 c = total. Rendered
 *      only when those values actually add up (previewSumsToTotal).
 *  (2) PREVIEW — a small table of the cited rows plus ~2 rows of workbook
 *      context, from the build-time sidecar (lib/workbook-cells.ts). Cited
 *      rows are marked; a blank cell renders "—", never 0.
 *      Unreachable sidecar → an explicit "preview unavailable" note
 *      ([data-testid="workbook-preview-unavailable"]), never a spinner and
 *      never a fabricated table.
 *      The preview's numerals are NOT <Cite>-wrapped: like the PDF tier's
 *      rendered page, this is a picture of the SOURCE DOCUMENT, not a set of
 *      site figures. The cited value's Cite is the figure the reader clicked
 *      to get here. (Gate 2's currency scan reads static HTML only; the
 *      drawer is client-rendered, and these numerals carry no '$'.)
 *  (5) The card no longer renders its own "Official source" link — the panel
 *      footer owns the single copy.
 *  (6) The full SHA-256 gains a copy control — in the footer, beside the
 *      truncated hash it fixes (panel.tsx).
 */

import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { WorkbookCitation } from "@/lib/data";
import { usdEquivalence } from "@/lib/format";
import { documentTitleFromUrl } from "@/lib/footnote";
import { useAssetUrl } from "@/components/asset-config";
import {
  citedRows,
  fetchWorkbookPreview,
  previewSumsToTotal,
  type WorkbookPreview,
  type WorkbookPreviewRow,
} from "@/lib/workbook-cells";

interface WorkbookCardProps {
  citation: WorkbookCitation;
  /**
   * The citation's fact_id — the key of the cell-preview sidecar. Absent
   * (legacy callers) → the card renders without a preview rather than
   * guessing.
   */
  factId?: string | null;
}

/** Exact numerals with grouping and a TRUE minus sign (U+2212). */
function fmtCell(v: number): string {
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return v < 0 ? `−${s}` : s;
}

// ── CellRef — an unmistakable spreadsheet cell reference ─────────────────────

/**
 * "O839" with the column letters in their own element.
 *
 * The text content stays exactly "O839" so the ref can be selected and pasted
 * into a spreadsheet's name box; the column half is styled apart from the
 * digits and the whole token carries title/aria text spelling out which is
 * which. .cell-ref additionally requests slashed-zero from fonts that carry
 * the feature (globals.css).
 */
export function CellRef({ cell }: { cell: string }) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!m) {
    return (
      <span data-testid="cell-ref" data-cell={cell} className="cell-ref">
        {cell}
      </span>
    );
  }
  const [, col, row] = m;
  return (
    <span
      data-testid="cell-ref"
      data-cell={`${col}${row}`}
      // title, not aria-label: axe's aria-prohibited-attr rule flags
      // aria-label on a roleless <span>, and the ref's own text ("O839") is
      // already the accessible name we want read out.
      title={`Spreadsheet cell — column ${col}, row ${row}`}
      className="cell-ref"
    >
      <span data-cell-col className="cell-ref-col">
        {col}
      </span>
      {row}
    </span>
  );
}

// ── WorkbookCard ─────────────────────────────────────────────────────────────

export function WorkbookCard({ citation, factId }: WorkbookCardProps) {
  const assetUrl = useAssetUrl();
  const preview = useWorkbookPreview(factId);

  const cellChips = citation.cells
    ? citation.cells.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const downloadPath = `/workbooks/${citation.sha256}.xlsx`;
  const docTitle = documentTitleFromUrl(citation.official_url, "workbook");

  const amount = citation.amount_thousands;
  const equivalence =
    amount != null ? usdEquivalence(amount, citation.units) : null;

  return (
    <div className="space-y-3">
      {/* (1) Amount — recorded value first, unit second, equivalence last. */}
      {amount != null && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
            Amount
          </span>
          {/* One line, one reading: recorded numerals, the unit they are in,
              then the dollar equivalence. Spaces are real text nodes so the
              line survives textContent verbatim. */}
          <p data-testid="workbook-amount">
            <span
              data-testid="workbook-amount-value"
              className="text-xl font-semibold tabular-nums"
            >
              {fmtCell(amount)}
            </span>
            {citation.units && (
              <span className="text-xs text-muted-foreground">
                {" "}
                {citation.units}
              </span>
            )}
            {equivalence && (
              <span
                data-testid="workbook-amount-usd"
                className="text-xs text-muted-foreground"
              >
                {" "}
                ({equivalence})
              </span>
            )}
          </p>
        </div>
      )}

      {/* (7) Document identity — which book, which edition. */}
      {docTitle && (
        <div data-testid="workbook-document" data-doc-title={docTitle}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
            Document
          </span>
          <span className="text-sm font-medium">{docTitle}</span>
        </div>
      )}

      {/* (4) Locator — sheet + unambiguous cell refs. */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
          {cellChips.length === 1 ? "Sheet · cell" : "Sheet · cells"}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {citation.sheet && (
            <span className="font-medium">{citation.sheet}</span>
          )}
          {citation.sheet && cellChips.length > 0 && (
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
          )}
          {cellChips.map((cell) => (
            <span
              key={cell}
              className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              <CellRef cell={cell} />
            </span>
          ))}
        </div>
      </div>

      {/* (3) Arithmetic — only when there is arithmetic to show, and only
          when the cells the drawer is about to print really do add up. */}
      {preview && citedRows(preview).length > 1 && previewSumsToTotal(preview) && (
        <ArithmeticLine preview={preview} />
      )}

      {/* (2) The cited cells, in their neighbourhood. */}
      {preview ? (
        <PreviewTable preview={preview} />
      ) : preview === null && factId ? (
        <p
          data-testid="workbook-preview-unavailable"
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          {"couldn't load the cell preview — download the workbook to see the cells in place"}
        </p>
      ) : null}

      {/* Download — unchanged; the whole file, for anyone who wants it. */}
      <a
        href={assetUrl(downloadPath)}
        download
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
      >
        <Download
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
          aria-hidden="true"
        />
        <span>Download workbook (.xlsx)</span>
      </a>
    </div>
  );
}

/**
 * Load the fact's cell preview.
 * `undefined` = not resolved yet (or no fact id); `null` = resolved to
 * nothing (unreachable shard / no preview row) — the two must stay distinct
 * so the card can tell "still loading" from "we know we cannot show this".
 */
function useWorkbookPreview(factId: string | null | undefined) {
  const [loaded, setLoaded] = useState<{
    factId: string;
    preview: WorkbookPreview | null;
  } | null>(null);

  useEffect(() => {
    if (!factId) return;
    let cancelled = false;
    fetchWorkbookPreview(factId).then((preview) => {
      if (!cancelled) setLoaded({ factId, preview });
    });
    return () => {
      cancelled = true;
    };
  }, [factId]);

  if (!factId) return undefined;
  return loaded && loaded.factId === factId ? loaded.preview : undefined;
}

// ── ArithmeticLine ───────────────────────────────────────────────────────────

function ArithmeticLine({ preview }: { preview: WorkbookPreview }) {
  const rows = citedRows(preview);
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
        How the cells combine
      </span>
      {/* Inline flow (not flex): the operators are real text nodes, so the
          line reads as one equation to a screen reader, a copy-paste, and a
          gate reading textContent — not as a bag of positioned chips. */}
      <p
        data-testid="workbook-arithmetic"
        data-total={preview.total}
        className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs leading-6"
      >
        {rows.map((r, i) => (
          <React.Fragment key={r.r}>
            {i > 0 && <span className="text-muted-foreground">{" + "}</span>}
            <span className="whitespace-nowrap">
              <CellRef cell={`${preview.col}${r.r}`} />{" "}
              <span className="font-mono tabular-nums">
                {fmtCell(r.v as number)}
              </span>
            </span>
          </React.Fragment>
        ))}
        <span className="text-muted-foreground">{" = "}</span>
        <span className="font-mono font-semibold tabular-nums">
          {fmtCell(preview.total)}
        </span>
      </p>
      {preview.units && (
        <p className="mt-1 text-xs text-muted-foreground">
          Values in {preview.units}, as recorded in the workbook.
        </p>
      )}
    </div>
  );
}

// ── PreviewTable ─────────────────────────────────────────────────────────────

function rowLabel(r: WorkbookPreviewRow): string {
  return [r.title, r.note].filter(Boolean).join(" · ");
}

function PreviewTable({ preview }: { preview: WorkbookPreview }) {
  const rows = preview.rows;
  const first = rows[0]?.r;
  const last = rows[rows.length - 1]?.r;
  const nCited = citedRows(preview).length;

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
        In the workbook
      </span>
      <div className="overflow-x-auto rounded-md border border-border">
        <table
          data-testid="workbook-preview"
          data-sheet={preview.sheet}
          data-col={preview.col}
          className="w-full text-xs"
        >
          <caption className="sr-only">
            {`Rows ${first}–${last} of ${preview.sheet}; the ${nCited} cited cell${
              nCited === 1 ? "" : "s"
            } ${nCited === 1 ? "is" : "are"} highlighted.`}
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              <th
                scope="col"
                className="px-2 py-1.5 font-semibold text-muted-foreground"
              >
                Row
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 font-semibold text-muted-foreground"
              >
                Line item
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap"
              >
                <span className="cell-ref cell-ref-col">{preview.col}</span>
                {preview.col_header && (
                  <span className="ml-1 font-normal normal-case">
                    — {preview.col_header}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.r}
                data-testid="workbook-preview-row"
                data-row={r.r}
                data-cited={r.cited ? "true" : "false"}
                className={
                  r.cited
                    ? "border-b border-border bg-primary/10 last:border-0"
                    : "border-b border-border text-muted-foreground last:border-0"
                }
              >
                <th scope="row" className="px-2 py-1.5 text-left font-normal">
                  <CellRef cell={`${preview.col}${r.r}`} />
                  {r.cited && <span className="sr-only"> (cited)</span>}
                </th>
                <td className="px-2 py-1.5">
                  {r.code && (
                    <span className="cell-ref mr-1.5 rounded bg-muted px-1 py-0.5 text-[11px]">
                      {r.code}
                    </span>
                  )}
                  <span className={r.cited ? "font-medium" : undefined}>
                    {rowLabel(r)}
                  </span>
                  {r.flag && r.flag.toLowerCase() !== "add" && (
                    <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[11px]">
                      {r.flag}
                    </span>
                  )}
                </td>
                <td
                  data-cell-value={r.v == null ? "" : String(r.v)}
                  className={`px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
                    r.cited ? "font-semibold text-foreground" : ""
                  }`}
                >
                  {r.v == null ? "—" : fmtCell(r.v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {`Rows ${first}–${last} of ${preview.sheet}`}
        {preview.units ? `, ${preview.units}` : ""}. Cited rows are
        highlighted; a blank cell shows “—”.
      </p>
    </div>
  );
}
