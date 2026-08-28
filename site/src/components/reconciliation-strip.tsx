import Link from "next/link";
import { Cite } from "@/components/cite";
import { formatAmountNoCurrency, type AmountUnits } from "@/lib/format";
import { reproducibleDifference, toMillions } from "@/lib/derivation";
import type { Fy26Split, ReconciliationEntry } from "@/lib/data";

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
 * §P0-3 CORRECTION (2026-08-28) — THE FY2026 GAP IS NOT ADVANCE PROCUREMENT.
 * The shared mechanism sentence explained every year's TOA↔J-book gap as
 * "budget rows (such as advance procurement)". For FY2026 that is false, and
 * measurably so: of the 158 FY2026 rows this strip renders, 151 have a gap
 * that the one-time reconciliation appropriation accounts for in full, and
 * exactly ONE (B-21) is a genuine mix. /program/834130/ stated a $698.2M gap
 * and explained it as advance procurement while a chip ~100px above, on the
 * same screen, read "$698.2M one-time reconciliation" — the identical number
 * with two contradictory causes, both cited, one of them wrong.
 *
 * The tell is that FY24 and FY25 close on advance procurement exactly; only
 * FY2026 breaks, because only FY2026 has reconciliation money. So the fix is
 * not to relabel the delta everywhere — it is to name the mechanism THAT
 * YEAR'S row actually has, from that page's own cited fy26_split, and to
 * stop the shared sentence asserting AP as the sole cause when it is not.
 *
 * HONESTY CONSTRAINTS (verified premise, plan 2026-07-30):
 *   - The P-40 advance-procurement bridge row is NOT parsed as a fact, so
 *     the per-year delta is UNLABELED arithmetic between the two cited
 *     figures — never captioned "advance procurement" (the shared mechanism
 *     sentence carries that explanation generically, once).
 *   - The reconciliation portion IS a parsed, cited fact (fy26_split's own
 *     workbook row, the same fid the chip above renders), so it ships as a
 *     real <Cite>. The REMAINDER after subtracting it is arithmetic again,
 *     and renders $-less like the delta.
 *   - Where the reconciliation figure is at least the whole gap, no
 *     decomposition is asserted: the row says reconciliation accounts for
 *     the gap and stops. Five pages have reconciliation LARGER than their
 *     gap (the J-book line already carries part of it); inventing a negative
 *     "advance procurement" remainder for them would be a fabricated fact.
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

/**
 * The reconciliation money attributable to ONE strip row, in USD thousands —
 * or null where none applies.
 *
 * Only FY2026 carries a reconciliation appropriation, and only the request
 * measure is the figure the split describes, so every other row is null by
 * construction rather than by omission. Reading the page's OWN fy26_split
 * (the cited workbook rows the chip above renders) rather than re-deriving
 * it here is deliberate: two derivations of one number is how a page ends up
 * stating it two ways, which is the defect this component is being fixed for.
 */
function reconThousandsFor(
  e: ReconciliationEntry,
  split: Fy26Split | null | undefined,
): number | null {
  if (e.fy !== 2026 || e.measure !== "request") return null;
  if (!split?.has_reconciliation || !split.reconciliation) return null;
  return split.recon_k > 0 ? split.recon_k : null;
}

/** Below this (USD thousands) a remainder is rounding, not a second cause. */
const REMAINDER_EPSILON_K = 0.5;

export function ReconciliationStrip({
  entries,
  fy26Split,
}: {
  entries: ReconciliationEntry[];
  /** backlog #50 payload from the same sidecar — see reconThousandsFor. */
  fy26Split?: Fy26Split | null;
}) {
  if (entries.length === 0) return null;

  // Does ANY row on this page have a reconciliation cause? Decides whether the
  // shared sentence may present advance procurement as the whole story.
  const anyRecon = entries.some((e) => reconThousandsFor(e, fy26Split) !== null);

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

      {/* ONE shared mechanism sentence (never repeated per year). §P0-3: it
          may only name advance procurement as THE cause on pages where no row
          has a reconciliation cause — otherwise it names both and defers to
          the per-row statement, which is the one that knows. */}
      <p data-reconciliation-mechanism={anyRecon ? "mixed" : "ap"} className="text-xs leading-5 text-muted-foreground">
        Fiscal Receipts uses P-1/R-1 workbook total obligation authority
        (TOA) as the headline figure sitewide. The workbook TOA includes
        budget rows that the R-2/P-40 J-book program line excludes
        {anyRecon
          ? " — advance procurement in an ordinary year, and in FY2026 the one-time reconciliation appropriation as well. Each row below names the one it is."
          : " — advance procurement, most commonly."}{" "}
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
          const reconK = reconThousandsFor(e, fy26Split);
          const remainderK = reconK === null ? null : e.delta_thousands - reconK;
          return (
            <p
              key={`${e.fy}-${e.measure}`}
              data-testid="reconciliation-row"
              // IDENTITY, not claim: which (fy, measure) this row is. Gate 23
              // leg g5 selects the FY2026 request row by these so it can read
              // that row's OWN sentence — the shared mechanism sentence above
              // legitimately names advance procurement, and a strip-wide text
              // scan cannot tell "explains the mechanism" from "credits this
              // gap to it".
              data-reconciliation-fy={e.fy}
              data-reconciliation-measure={e.measure}
              data-reconciliation-cause={
                reconK === null
                  ? "ap"
                  : remainderK !== null && remainderK > REMAINDER_EPSILON_K
                    ? "mixed"
                    : "reconciliation"
              }
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
              {/* §P0-3: what the gap IS, on the row that knows. The
                  reconciliation side is the page's own cited workbook fact —
                  the same fid the split chip above renders, never a second
                  derivation of it. The remainder is arithmetic, so it stays
                  $-less like the delta. */}
              {reconK !== null && fy26Split?.reconciliation && (
                <span data-reconciliation-cause-note="">
                  {" — "}
                  <Cite
                    value={fy26Split.reconciliation.v}
                    units={fy26Split.reconciliation.units}
                    dataset={fy26Split.reconciliation.dataset}
                    factId={fy26Split.reconciliation.fid}
                    basis={fy26Split.reconciliation.basis}
                    fy={fy26Split.reconciliation.fy}
                    measure={fy26Split.reconciliation.measure}
                    edition={fy26Split.reconciliation.edition}
                    chip={false}
                  />
                  {remainderK !== null && remainderK > REMAINDER_EPSILON_K ? (
                    <>
                      {" of it one-time FY2026 reconciliation money, the "}
                      <span className="font-mono tabular-nums">
                        {formatAmountNoCurrency(remainderK, "USD thousands")}
                      </span>
                      {" balance other TOA-only rows such as advance procurement"}
                    </>
                  ) : (
                    " of one-time FY2026 reconciliation money accounts for this gap — not advance procurement"
                  )}
                </span>
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
