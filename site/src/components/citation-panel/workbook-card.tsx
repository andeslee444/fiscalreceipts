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
import { basisChipText, CORE_MEASURES } from "@/lib/basis";
import { documentTitleFromUrl, type FootnoteFigure } from "@/lib/footnote";
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
  /**
   * The CLICKED FIGURE's declared context (fy / measure / basis / edition) —
   * the same object the footnote formatter gets, threaded from the panel.
   *
   * Fix round, both judges: the AMOUNT line read "5,565,655 USD thousands
   * (= $5.57B)" and the only disclosure that this was FY2024 ACTUALS was a
   * small column header inside the preview table. A reporter skimming the
   * drawer would quote $5.57B as FY2026 procurement. Every other cited figure
   * on the site carries a basis chip; this one now does too, from the SAME
   * vocabulary (lib/basis basisChipText) — no second dialect.
   */
  figure?: FootnoteFigure | null;
}

/** Exact numerals with grouping and a TRUE minus sign (U+2212). */
function fmtCell(v: number): string {
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return v < 0 ? `−${s}` : s;
}

/**
 * "FY2024 Actuals · P-1 TOA · PB2026" — the clicked figure's own declaration,
 * rendered in the chip's vocabulary and nothing else. Null when the figure
 * declared no basis (drill-down opens, legacy callers): an invented basis
 * would be worse than none.
 */
export function amountBasisLine(
  figure: FootnoteFigure | null | undefined,
): string | null {
  if (!figure) return null;
  const parts: string[] = [];
  if (figure.fy != null && figure.fy !== "") {
    parts.push(typeof figure.fy === "number" ? `FY${figure.fy}` : String(figure.fy));
  }
  // The CORE measure token (actuals / enacted / request / total / change) is
  // what disambiguates the FY, and basisChipText deliberately leaves it out —
  // inline it is carried by the column header the figure sits under. The
  // drawer has no such header, so it is spelled out here. Extended tokens are
  // left to the chip, which already labels them (no double rendering).
  if (figure.measure && CORE_MEASURES.has(figure.measure)) {
    parts.push(figure.measure);
  }
  const chip = figure.basis
    ? basisChipText(figure.basis, figure.measure ?? undefined, figure.edition ?? undefined)
    : null;
  if (chip) parts.push(chip);
  else if (figure.edition) parts.push(`PB${figure.edition}`);
  return parts.length > 0 ? parts.join(" · ") : null;
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

export function WorkbookCard({ citation, factId, figure }: WorkbookCardProps) {
  const assetUrl = useAssetUrl();
  const preview = useWorkbookPreview(factId);
  const basisLine = amountBasisLine(figure);

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
          {/* WHAT this amount IS. Without it the drawer's headline figure was
              a bare number whose fiscal year lived only in a column header
              further down the card. */}
          {basisLine && (
            <p
              data-testid="workbook-amount-basis"
              data-basis-line={basisLine}
              className="mt-0.5 text-xs text-muted-foreground"
            >
              {basisLine}
            </p>
          )}
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
        {rows.map((r, i) => {
          const v = r.v as number;
          // "+ −246,702" read as "plus negative". A recorded negative is a
          // SUBTRACTION; the operator changes and the magnitude stands alone,
          // so the equation reads the way it computes. The signed value as
          // recorded is still one hover away (title) and still in the preview
          // table below, which prints every cell verbatim.
          const op = i === 0 ? null : v < 0 ? " − " : " + ";
          const shown = i > 0 && v < 0 ? fmtCell(Math.abs(v)) : fmtCell(v);
          return (
            <React.Fragment key={r.r}>
              {op && <span className="text-muted-foreground">{op}</span>}
              <span className="whitespace-nowrap">
                <CellRef cell={`${preview.col}${r.r}`} />{" "}
                <span
                  className="font-mono tabular-nums"
                  title={`recorded as ${fmtCell(v)}`}
                >
                  {shown}
                </span>
              </span>
            </React.Fragment>
          );
        })}
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
          {/* MOBILE (fix round, ADD 8): three columns — an address, a long
              line-item label with inline code chips and Non-Add badges, and a
              right-aligned figure — do not fit a 390px drawer. Below `sm` the
              row stacks: address and figure on one line (the pairing the
              reader came for), label beneath at full width. One DOM, so
              data-testid / data-cited / data-cell-value hooks are unchanged. */}
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-border bg-muted/50 text-left">
              <th
                scope="col"
                className="px-2 py-1.5 font-semibold text-muted-foreground"
              >
                {/* The column holds CELL addresses (O837, O838…), not row
                    numbers — and the caption underneath already says "Rows
                    837–843". Exactly the imprecision this card exists to
                    eliminate. */}
                Cell
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
                role="row"
                className={[
                  // Mobile: a 2×2 grid — address and figure share the top
                  // line, the label spans the second. Source order stays
                  // address → label → value (the table's own semantics);
                  // placement is explicit, not order-dependent.
                  "grid grid-cols-[auto_1fr] gap-x-2 sm:table-row",
                  "border-b border-border last:border-0 px-2 py-1.5 sm:p-0",
                  r.cited ? "bg-primary/10" : "text-muted-foreground",
                ].join(" ")}
              >
                <th
                  scope="row"
                  role="rowheader"
                  className="col-start-1 row-start-1 sm:table-cell px-0 sm:px-2 sm:py-1.5 text-left font-normal"
                >
                  <CellRef cell={`${preview.col}${r.r}`} />
                  {r.cited && <span className="sr-only"> (cited)</span>}
                </th>
                <td role="cell" className="col-span-2 row-start-2 sm:table-cell px-0 sm:px-2 sm:py-1.5">
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
                  role="cell"
                  data-cell-value={r.v == null ? "" : String(r.v)}
                  className={`col-start-2 row-start-1 sm:table-cell px-0 sm:px-2 sm:py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
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
