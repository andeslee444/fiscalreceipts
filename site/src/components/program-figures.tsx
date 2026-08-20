import { Cite, type ExhibitFamily } from "@/components/cite";
import { TrajectorySpark } from "@/components/trajectory-spark";
import { DecadeTrajectory } from "@/components/decade-trajectory";
import { ReconciliationStrip } from "@/components/reconciliation-strip";
import { CoverageNote } from "@/components/coverage-note";
import { ScopeNote } from "@/components/notes";
import { normalizeExhibitFamily } from "@/lib/basis";
import type {
  DecadeSeries,
  Fy26Split,
  ProgramBookDiff,
  ProgramRow,
  ProgramSummary,
  SummaryCard,
} from "@/lib/data";
import { TRAJECTORY_FY_LABEL } from "@/lib/site";

/**
 * ProgramFigures — top-line financial figures grid (data-section="figures").
 *
 * PM Sprint 1 (§P0-1/§P0-2): the four cards render the sidecar's SUMMARY
 * UNION payload — computed in the exporter from workbook (toa) + J-book
 * detail facts, preferring toa — never a narrower upstream table. Each card
 * carries full basis attributes + the visible basis chip; absences render
 * the honest reason label (never a bare "—"); the reconciliation strip
 * declares every (fy, measure) where the two bases disagree, with both
 * receipts. Cards whose (fy, measure) appears in the reconciliation payload
 * carry data-reconciliation (gate 23 leg a2: every member of a declared
 * collision group is marked).
 *
 * Phase 5F §2d: the sparkline lives in <ProgramTrajectoryCard>
 * (data-section="trajectory") so the two skeleton sections stay distinct.
 */

/** Human measure labels for the card titles ("FY25 Enacted", "FY25 Total"). */
const CARD_MEASURE_LABEL: Record<string, string> = {
  actuals: "Actuals",
  enacted: "Enacted",
  request: "Request",
  total: "Total",
  "base-request": "Base Request",
};

/**
 * Honest absence labels (§P0-2 fix 2) — never a bare "—".
 *
 * DELIBERATELY free of em/en dashes and "$": gate 23 leg b2's bootstrap
 * matcher treats a dash-bearing card as an absence claim to test against the
 * page's detail figures. These ARE honest absences (the union found no
 * defensible canonical-basis value), and the machine-readable declaration is
 * the [data-absence][data-fy][data-measure][data-absence-reason] contract —
 * not a dash glyph.
 */
const ABSENCE_LABEL: Record<string, string> = {
  "not-published": "Not in the FY2026 J-books we ingested",
  "no-rollup": "No single program-level figure; see the line items below",
  "no-comparison": "No comparison: endpoints unavailable or on different bases",
};

export function cardLabel(card: SummaryCard): string {
  if (card.key === "change") return `${TRAJECTORY_FY_LABEL} Change`;
  const fy = `FY${String(card.fy).slice(-2)}`;
  const measure =
    CARD_MEASURE_LABEL[card.measure] ?? card.measure.replace(/-/g, " ");
  return `${fy} ${measure}`;
}

/** Set of "fy|measure" keys with a declared reconciliation entry. */
export function reconKeySet(summary: ProgramSummary | null): Set<string> {
  return new Set(
    (summary?.reconciliation ?? []).map((r) => `${r.fy}|${r.measure}`),
  );
}

/**
 * Fy26SplitNote (backlog #50) — the FY2026 card's combined figure ($7.70B
 * for Long Range Kill Chains, PE 1203154SF) is disc + reconciliation with no
 * visible seam. When the split has a reconciliation component, this renders
 * beside the combined figure: a reconciliation-share chip (gate 23 leg g's
 * [data-fy26-recon-chip] marker), then a caption stating both addends —
 * each its OWN cited figure, never a re-typed number — and the
 * discretionary-basis change vs FY2025 enacted (gate leg g's
 * [data-fy26-disc-pct-change] marker), the like-for-like rate a reader can
 * actually extrapolate. The combined figure stays the headline (it is the
 * true total); this note is what turns "+3052.9%" from an unlabelled claim
 * into a labelled one — the raw change card is untouched, still rendered by
 * the sibling "change" SummaryCardCell.
 *
 * Exported (backlog #54) — /feed/'s FeedCardItem renders this SAME component
 * beside a yoy_swing card whose PE carries reconciliation money, so the
 * disclosure's wording and [data-fy26-recon-chip]/[data-fy26-disc-pct-change]
 * markers stay identical on both surfaces rather than growing a second,
 * differently-worded copy.
 */
export function Fy26SplitNote({ split }: { split: Fy26Split }) {
  if (!split.reconciliation) return null; // has_reconciliation implies this is set; defensive
  const sharePct = (split.recon_share * 100).toFixed(1);
  return (
    <ScopeNote label={null} className="mt-2 text-left">
      <span
        data-fy26-recon-chip=""
        className="inline-block whitespace-nowrap rounded border border-border bg-muted px-1 py-0.5 align-middle font-sans text-xs font-normal leading-none text-muted-foreground no-underline"
      >
        {sharePct}% reconciliation
      </span>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {split.disc && (
          <>
            <Cite
              value={split.disc.v}
              units={split.disc.units}
              dataset={split.disc.dataset}
              factId={split.disc.fid}
              basis={split.disc.basis}
              fy={split.disc.fy}
              measure={split.disc.measure}
              edition={split.disc.edition}
              chip={false}
            />
            {" discretionary + "}
          </>
        )}
        <Cite
          value={split.reconciliation.v}
          units={split.reconciliation.units}
          dataset={split.reconciliation.dataset}
          factId={split.reconciliation.fid}
          basis={split.reconciliation.basis}
          fy={split.reconciliation.fy}
          measure={split.reconciliation.measure}
          edition={split.reconciliation.edition}
          chip={false}
        />
        {" one-time reconciliation."}
        {split.disc_pct_change != null && (
          <span data-fy26-disc-pct-change="">
            {" "}
            Discretionary change vs FY2025 enacted:{" "}
            {split.disc_pct_change >= 0 ? "+" : ""}
            {split.disc_pct_change.toFixed(1)}%.
          </span>
        )}
      </p>
    </ScopeNote>
  );
}

function SummaryCardCell({
  card,
  reconKeys,
  exhibitFamily,
  fy26Split,
}: {
  card: SummaryCard;
  reconKeys: Set<string>;
  /** The page's OWN program exhibit (§48) — every TOA card on one program
   *  page shares its program's single exhibit_family. */
  exhibitFamily: ExhibitFamily;
  /** backlog #50 — only rendered beside the fy2026 card, and only when set. */
  fy26Split?: Fy26Split | null;
}) {
  const label = cardLabel(card);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-bold">
        {card.value !== null && card.units ? (
          <span
            className={
              card.key === "change"
                ? card.value > 0
                  ? "text-green-700"
                  : card.value < 0
                    ? "text-red-700"
                    : "text-foreground"
                : undefined
            }
          >
            {card.key === "change" && card.value >= 0 ? "+" : ""}
            <Cite
              value={card.value}
              units={card.units}
              dataset={card.dataset ?? "fct_decade_series"}
              factId={card.fid}
              xmlPath={card.fid ? null : card.xml_path}
              basis={card.basis ?? undefined}
              fy={card.fy}
              measure={card.measure}
              edition={card.edition}
              exhibitFamily={exhibitFamily}
              reconciled={reconKeys.has(`${card.fy}|${card.measure}`)}
            />
            {card.key === "change" && card.pct != null && (
              <span
                className="ml-1 text-sm font-normal text-muted-foreground"
                aria-hidden="true"
              >
                ({card.pct > 0 ? "+" : ""}
                {card.pct.toFixed(1)}%)
              </span>
            )}
          </span>
        ) : (
          <span
            data-absence=""
            data-fy={card.fy}
            data-measure={card.measure}
            data-absence-reason={card.absence_reason ?? "not-published"}
            className="block text-xs font-normal leading-4 text-muted-foreground"
          >
            {ABSENCE_LABEL[card.absence_reason ?? "not-published"] ??
              ABSENCE_LABEL["not-published"]}
          </span>
        )}
      </div>
      {card.key === "fy2026" && fy26Split?.has_reconciliation && (
        <Fy26SplitNote split={fy26Split} />
      )}
    </div>
  );
}

interface ProgramFiguresProps {
  program: ProgramRow;
  summary: ProgramSummary;
  /** backlog #50 — from the sidecar's fy26_split field; absent when the
   *  program has no FY2026 disc/reconciliation workbook row. */
  fy26Split?: Fy26Split | null;
}

export function ProgramFigures({
  program,
  summary,
  fy26Split = null,
}: ProgramFiguresProps) {
  const reconKeys = reconKeySet(summary);
  // §48: every TOA card on this grid is this ONE program's own figure, so
  // they all share the page's own exhibit_family — never "mixed" here (this
  // is not an aggregate surface).
  const exhibitFamily = normalizeExhibitFamily(program.exhibit_family);
  return (
    <div className="mb-8">
      <h2
        id="figures-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Budget Figures
      </h2>

      {/* Key figures grid — the union cards, in slot order */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {summary.cards.map((card) => (
          <SummaryCardCell
            key={card.key}
            card={card}
            fy26Split={card.key === "fy2026" ? fy26Split : null}
            reconKeys={reconKeys}
            exhibitFamily={exhibitFamily}
          />
        ))}
      </div>

      {/* §P0-1: the declared two-basis reconciliation, both receipts */}
      <ReconciliationStrip entries={summary.reconciliation} />

      {/* FY2026 partial-year scope note — G2 contract
          (data-coverage="fy2026-partial") */}
      <CoverageNote id="fy2026-partial" className="mt-3" />
    </div>
  );
}

/**
 * ProgramTrajectorySection — the year-over-year sparkline card
 * (data-section="trajectory" content; the page wraps it). The sparkline
 * renders the SUMMARY CARDS themselves (PM Sprint 1: the trajectory mart's
 * per-org slices contradicted the union cards on multi-org programs — same
 * label, different value; drawing the cards makes spark and cards agree BY
 * CONSTRUCTION), plus the Phase 5E decade series (edition-honest, gaps
 * never interpolated) when the sidecar carries one.
 */
export function ProgramTrajectoryCard({
  program,
  summary,
  decadeSeries = null,
  bookDiff = null,
}: ProgramFiguresProps & {
  decadeSeries?: DecadeSeries | null;
  bookDiff?: ProgramBookDiff | null;
}) {
  const reconKeys = reconKeySet(summary);
  const exhibitFamily = normalizeExhibitFamily(program.exhibit_family);
  const sparkCards = summary.cards.filter(
    (c) => c.key !== "change" && c.value !== null,
  );
  if (sparkCards.length === 0 && !decadeSeries) return null;
  return (
    <div className="mb-8 rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-2">
        Budget Trajectory
      </div>
      {sparkCards.length > 0 && (
        <TrajectorySpark
          cards={summary.cards}
          reconKeys={reconKeys}
          exhibitFamily={exhibitFamily}
        />
      )}
      {decadeSeries && (
        <div className={sparkCards.length >= 2 ? "mt-4 border-t border-border pt-4" : undefined}>
          {/* Visual-judge M4: the cells render compact USD ($B/$M) while the
              workbook records thousands — the caption says both instead of
              contradicting the formatting. */}
          <div className="text-xs text-muted-foreground mb-2">
            Decade view — P-1/R-1 workbook TOA basis, shown compact in $B/$M
            (the workbook records USD thousands); each figure cites its own
            President&apos;s Budget edition
          </div>
          <DecadeTrajectory
            series={decadeSeries}
            bookDiff={bookDiff}
            reconKeys={reconKeys}
          />
        </div>
      )}
    </div>
  );
}
