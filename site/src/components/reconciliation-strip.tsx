import Link from "next/link";
import { Cite } from "@/components/cite";
import type { ReconciliationEntry } from "@/lib/data";

/**
 * ReconciliationStrip — the declared two-basis reconciliation (PM Sprint 1
 * §P0-1, gate 23 leg a2).
 *
 * Rendered under the Budget Figures cards whenever the sidecar carries
 * reconciliation entries: the same (program, fiscal year, measure) resolves
 * to two DIFFERENT official figures — the P-1/R-1 workbook Total Obligation
 * Authority and the R-2/P-40 J-book program line — and an unlabeled
 * definitional collision is worse than a missing number. Each entry renders
 * BOTH values as their own <Cite> (full basis attributes, both receipts one
 * click away) inside the [data-reconciliation] wrapper the gate requires.
 *
 * HONESTY CONSTRAINT (verified premise, plan 2026-07-30): the P-40
 * advance-procurement bridge row is NOT parsed as a detail scenario, so the
 * strip states the definitional difference as methodology copy — it never
 * fabricates a middle term or an uncited delta figure. Arithmetic is only
 * asserted where facts back it; here the honest sentence is that the
 * workbook TOA includes rows (advance procurement and similar) that the
 * J-book program line excludes.
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

export function ReconciliationStrip({
  entries,
}: {
  entries: ReconciliationEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <div
      data-reconciliation=""
      data-testid="reconciliation-strip"
      className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2.5"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Two official figures, one label — reconciled
      </p>
      {entries.map((e) => {
        const zeroDetail = e.detail.v === 0;
        return (
          <p
            key={`${e.fy}-${e.measure}`}
            className="text-xs leading-5 text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              {fyLabel(e.fy)} {MEASURE_LABEL[e.measure] ?? e.measure}:
            </span>{" "}
            <Cite
              value={e.toa.v}
              units={e.toa.units}
              dataset={e.toa.dataset}
              factId={e.toa.fid}
              basis="toa"
              fy={e.fy}
              measure={e.measure}
              edition={2026}
            />{" "}
            total obligation authority on the P-1/R-1 workbook, while the
            R-2/P-40 J-book program line records{" "}
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
            />
            {zeroDetail && " (a zero-dollar XML line)"}
            {" — "}
            the workbook TOA includes budget rows (advance procurement and
            similar) that the J-book program line excludes; both figures cite
            their receipts.{" "}
            <Link
              href="/methodology/"
              className="underline decoration-dotted hover:text-foreground hover:decoration-solid"
            >
              How the two bases relate &rarr;
            </Link>
          </p>
        );
      })}
    </div>
  );
}
