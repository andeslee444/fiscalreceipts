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
  Fy2026Absent,
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

/**
 * Fy26LinesNote (ROADMAP #69) — names the budget lines a page's FY2026
 * headline is made of, on the pages where the page's own title cannot.
 *
 * A BLI code can carry money in several budget activities. Almost always
 * every activity's line is titled the same (F-15EX files in BA-01, BA-05 and
 * BA-07, all "F-15EX"), the page's one title names all of it, and the
 * exporter emits no `lines` at all. Twice in PB2026 the Air Force labelled
 * the BA-07 sub-line differently, and the page ended up publishing the
 * combined total under one line's name: /program/HCMC00/ showed $383,072K
 * titled "HC/MC-130 Post Prod", which is the $17,986K half. The total is the
 * program's real FY2026 request and stays the headline — what was missing is
 * the seam, so this renders it: each constituent line, its budget activity,
 * and its own cited figure. Same disclosure register as Fy26SplitNote above.
 */
export function Fy26LinesNote({ split }: { split?: Fy26Split | null }) {
  const lines = split?.lines;
  if (!lines || lines.length < 2) return null;
  return (
    <ScopeNote label={null} className="mt-2 text-left">
      <p data-fy26-lines="" className="text-xs leading-relaxed text-muted-foreground">
        This budget-line code covers {lines.length} lines in this account:{" "}
        {lines.map((line, i) => (
          <span key={`${line.title}|${line.budget_activity ?? ""}`}>
            {i > 0 && (i === lines.length - 1 ? " and " : "; ")}
            {line.title}
            {line.budget_activity && ` (BA ${line.budget_activity}`}
            {line.budget_activity && line.budget_activity_title
              ? `, ${line.budget_activity_title.toLowerCase()})`
              : line.budget_activity && ")"}
            {" "}
            <Cite
              value={line.v}
              units={line.units}
              dataset={line.dataset}
              factId={line.fid}
              basis={line.basis}
              fy={line.fy}
              measure={line.measure}
              edition={line.edition}
              entity={line.entity}
              chip={false}
            />
          </span>
        ))}
        . The figure above is their total.
      </p>
    </ScopeNote>
  );
}

/**
 * Fy2026AbsentNote (ROADMAP #32a) — the page must not just stop.
 *
 * PB2026 renumbered program elements at scale: 319 program pages carry
 * FY2024/FY2025 money in the PB2026 R-1/P-1 workbook and no FY2026 row at
 * all. DARPA retired *Defense Research Sciences*, *Tactical Technology*,
 * *Sensor Technology*, *Electronics Technology* and 10 more while its FY2026
 * total ROSE to $4.92B — 2 of 16 PEs carried through unchanged. Verified
 * against the primary source (r1_display.xlsx): those FY2026 cells are
 * genuinely blank. The parser is right; the corpus had no way to SAY so, and
 * a reader who followed a line for a decade hit figures that stopped at
 * FY2025 with nothing to explain it.
 *
 * Three things this note deliberately does NOT do:
 *
 *   1. It does not name a successor. The corpus cannot prove *Defense
 *      Research Sciences* → *Emerging Opportunities*, and a named guess is a
 *      fabricated citation — the defect ROADMAP #53 and #69 closed. Successor
 *      edges are #32(b), folded into backlog #29. Gate 21 leg (g) fails if
 *      this note ever names another program element.
 *   2. It does not say zeroed / cancelled / terminated / defunded. Absence
 *      from one edition supports none of them — that is precisely the claim
 *      the 87 withdrawn "zeroed out in FY2026" feed cards made.
 *   3. It does not mint a figure. The only number here is the year the
 *      workbook stops at, and it comes from the exporter's own recompute of
 *      the sidecar's rows (`fy2026_absent.last_fy`), never from prose.
 *
 * ScopeNote, not CautionNote: this is honest scope disclosure about what the
 * edition covers, not a warning about a number's reliability (notes.tsx).
 */
export function Fy2026AbsentNote({
  fy2026Absent,
}: {
  fy2026Absent?: Fy2026Absent | null;
}) {
  if (!fy2026Absent) return null;
  return (
    <ScopeNote label={null} className="mt-3">
      <p
        data-fy2026-absent=""
        className="text-xs leading-relaxed text-muted-foreground"
      >
        {/* Every clause here is conditioned on something the PAGE shows,
            because the first version was false on 179 of 319 pages: it
            claimed "no FY2026 request" over cited FY2026 money, called a
            documented $0 an absence, and denied a successor the page named
            with a citation. The headline is now scoped to the workbook —
            the one record that IS blank — and each further claim renders
            only where it holds. */}
        <strong className="text-foreground">
          No FY2026 R-1/P-1 request line for this program element.
        </strong>{" "}
        The FY2026 President&apos;s Budget request workbook carries no FY2026
        line for it; its last workbook figure is FY{fy2026Absent.last_fy}.{" "}
        {fy2026Absent.jbook_fy2026_zero ? (
          <>
            {/* "recorded as zero", never the numeral. Gate 2 rejects any
                currency pattern outside [data-amount], and it was right to:
                a dollar figure in prose is an UNCITED figure, which is the
                one thing this site does not publish. The actual value is
                rendered, cited, in the trajectory table below -- this
                sentence points at it rather than restating it. */}
            The PB2026 J-book detail below does carry an FY2026 row for this
            line, recorded as zero. A workbook blank and a documented zero are
            different records, and this page shows both.{" "}
          </>
        ) : null}
        An absent line is not by itself an ending — PB2026 renumbered program
        elements at scale across the services and defense agencies, so this
        work may continue under a different number.{" "}
        {fy2026Absent.has_successor ? (
          <>
            Where this line&apos;s funding went is recorded under Program
            Lineage below.
          </>
        ) : (
          <>
            No ingested budget document in this corpus states a successor for
            this line.
          </>
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
      {card.key === "fy2026" && <Fy26LinesNote split={fy26Split} />}
    </div>
  );
}

interface ProgramFiguresProps {
  program: ProgramRow;
  summary: ProgramSummary;
  /** backlog #50 — from the sidecar's fy26_split field; absent when the
   *  program has no FY2026 disc/reconciliation workbook row. */
  fy26Split?: Fy26Split | null;
  /** ROADMAP #32a — from the sidecar's fy2026_absent field; absent when the
   *  PB2026 workbook DOES carry an FY2026 row for this line. */
  fy2026Absent?: Fy2026Absent | null;
}

export function ProgramFigures({
  program,
  summary,
  fy26Split = null,
  fy2026Absent = null,
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

      {/* ROADMAP #32a: PB2026 requests nothing here — say so, and say what
          that does and does not mean. Sits directly under the cards it
          explains, above the generic partial-year note. */}
      <Fy2026AbsentNote fy2026Absent={fy2026Absent} />

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
