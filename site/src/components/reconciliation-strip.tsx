import Link from "next/link";
import { Cite } from "@/components/cite";
import { formatAmountNoCurrency, type AmountUnits } from "@/lib/format";
import { reproducibleDifference, toMillions } from "@/lib/derivation";
import type { ReconciliationEntry } from "@/lib/data";

/**
 * ReconciliationStrip — the declared two-basis reconciliation (PM Sprint 1
 * §P0-1, gate 23 leg a2; restructured per the visual-judge fix round).
 *
 * Rendered under the Budget Figures cards whenever the sidecar carries
 * reconciliation entries: the same (program, fiscal year, measure) resolves
 * to two DIFFERENT official figures — the P-1/R-1 workbook Total Obligation
 * Authority and the R-2/P-40 J-book program line — and an unlabeled
 * definitional collision is worse than a missing number.
 *
 * Structure (visual-judge M1 — the mechanism sentence used to repeat
 * verbatim per year, ~3 screens at 390px, and "RECONCILED" showed no
 * arithmetic):
 *   - ONE shared mechanism sentence at the top, carrying the canonical-basis
 *     statement and the methodology link;
 *   - a COMPACT per-year row set, each row the visible arithmetic between
 *     the two cited figures: `FY24 Actuals · $5.57B TOA − $5.25B J-book
 *     line = 318.6M`. Both cited values stay their own <Cite> (full basis
 *     attributes, both receipts one click away) inside the
 *     [data-reconciliation] wrapper the gate requires.
 *
 * HONESTY CONSTRAINTS (verified premise, plan 2026-07-30):
 *   - The P-40 advance-procurement bridge row is NOT parsed as a fact, so
 *     the per-year delta is UNLABELED arithmetic between the two cited
 *     figures — never captioned "advance procurement" (the shared mechanism
 *     sentence carries that explanation generically, once).
 *   - The delta renders WITHOUT a currency symbol (formatAmountNoCurrency —
 *     the Task 6b idiom): it is not a parsed fact, so it must not read as a
 *     cited dollar figure, and every "$" on a program page must live inside
 *     a [data-amount] (render-static currency scan).
 *   - The header claim matches what is shown: "Two official figures, one
 *     label — reconciled below", and the arithmetic IS below.
 *
 * The detail side may be fid-less (zero/unresolved XML root): it renders as
 * a state-B xml-path Cite — the divergence is just as visible to the reader
 * and just as declared to the gate.
 */

const MEASURE_LABEL: Record<string, string> = {
  actuals: "Actuals",
  enacted: "Enacted",
  request: "Request",
  total: "Total",
};

function fyLabel(fy: number): string {
  return `FY${String(fy).slice(-2)}`;
}

/** The closing arithmetic for ONE reconciliation row (§P2-8). */
function exactFor(e: ReconciliationEntry) {
  return reproducibleDifference(
    toMillions(e.toa.v, e.toa.units as AmountUnits),
    toMillions(e.detail.v, e.detail.units as AmountUnits),
    toMillions(e.delta_thousands, "USD thousands"),
  );
}

export function ReconciliationStrip({
  entries,
}: {
  entries: ReconciliationEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <div
      data-reconciliation=""
      data-derivation="reconciliation"
      data-testid="reconciliation-strip"
      className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2.5"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Two official figures, one label
        <span className="ml-1 font-normal normal-case tracking-normal">
          — reconciled below
        </span>
      </p>

      {/* ONE shared mechanism sentence (never repeated per year). */}
      <p className="text-xs leading-5 text-muted-foreground">
        Fiscal Receipts uses P-1/R-1 workbook total obligation authority
        (TOA) as the headline figure sitewide. The workbook TOA includes
        budget rows (such as advance procurement) that the R-2/P-40 J-book
        program line excludes.{" "}
        <Link
          href="/methodology/"
          className="underline decoration-dotted hover:text-foreground hover:decoration-solid"
        >
          How the two bases relate &rarr;
        </Link>
      </p>

      {/* Compact per-year arithmetic rows — both values cited, the
          difference shown as plain (uncited, $-less) arithmetic. */}
      <div className="space-y-1">
        {entries.map((e) => {
          const zeroDetail = e.detail.v === 0;
          return (
            <p
              key={`${e.fy}-${e.measure}`}
              data-testid="reconciliation-row"
              className="text-xs leading-5 text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {fyLabel(e.fy)} {MEASURE_LABEL[e.measure] ?? e.measure}
              </span>
              {" · "}
              <Cite
                value={e.toa.v}
                units={e.toa.units}
                dataset={e.toa.dataset}
                factId={e.toa.fid}
                basis="toa"
                fy={e.fy}
                measure={e.measure}
                edition={2026}
                chip={false}
              />{" "}
              TOA &minus;{" "}
              <Cite
                value={e.detail.v}
                units={e.detail.units}
                dataset={e.detail.dataset}
                factId={e.detail.fid}
                xmlPath={e.detail.fid ? null : e.detail.xml_path}
                basis="jbook-detail"
                fy={e.fy}
                measure={e.measure}
                edition={2026}
                chip={false}
              />{" "}
              J-book line{zeroDetail && " (a zero-dollar XML line)"} ={" "}
              <span
                title="Difference between the two cited figures — arithmetic, not a parsed budget row"
                className="font-mono tabular-nums"
              >
                {formatAmountNoCurrency(e.delta_thousands, "USD thousands")}
              </span>
              {/* §P2-8: the two cited figures are shown compactly ($5.57B,
                  $5.25B) and their difference is exact, so the row as printed
                  did not add up — 5.57 − 5.25 is 320M, not 318.6M. The
                  closing arithmetic follows, at the smallest precision at
                  which all three agree. */}
              {exactFor(e) && (
                <>
                  {" "}
                  <span
                    data-derivation-exact=""
                    className="whitespace-nowrap font-mono tabular-nums text-muted-foreground/80"
                  >
                    ({exactFor(e)!.a} &minus; {exactFor(e)!.b} ={" "}
                    {exactFor(e)!.delta})
                  </span>
                </>
              )}
            </p>
          );
        })}
      </div>

      {/* One shared unit + rounding statement, so the per-row parentheses can
          stay short. */}
      <p
        data-derivation-rounding=""
        className="text-xs leading-5 text-muted-foreground"
      >
        Figures in the sentence are rounded for reading; the parenthesised
        arithmetic is the same subtraction in USD millions, at the precision
        where it closes.
      </p>
    </div>
  );
}
