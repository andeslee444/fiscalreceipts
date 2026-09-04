/**
 * <FeedCardItemClient> — the CLIENT-SAFE TWIN of <FeedCardItem>
 * (feed-card-item.tsx), for the /feed/ section-expand feature (Task 6, #73,
 * addendum ruling 2).
 *
 * WHY A TWIN, NOT A REUSE. <FeedCardItem> cannot be imported into the
 * "use client" expand component (feed-section-expand.tsx): two of the
 * pieces it renders are transitively `import "server-only"`, which Next
 * throws on when the importing module ends up in a client bundle —
 *
 *   - <FeedHeadline> (components/feed-headline.tsx) calls
 *     feedHeadlineSegments(), a value import from src/lib/data.ts, which is
 *     `import "server-only"` at its top (it reads the exported JSON sidecars
 *     off disk with `fs`).
 *   - <Fy26SplitNote> (components/program-figures.tsx) statically imports
 *     <CoverageNote>, which imports src/lib/coverage.ts — also
 *     `import "server-only"`. Fy26SplitNote's own body never touches
 *     CoverageNote, but the taint is module-wide: importing ANY export from
 *     program-figures.tsx pulls in every top-level import in that file.
 *
 * Everything else <FeedCardItem> renders IS client-safe and is reused
 * directly, not duplicated: <Cite>, <ProseCite> (both "use client"),
 * <FeedMagnitudeLine> (feed-magnitude.tsx — its only reference to
 * src/lib/data.ts is `import type`, erased at compile time, so no runtime
 * import of the server-only module survives), <ScopeNote> (notes.tsx, a
 * pure presentational module with no imports beyond `ReactNode`), and
 * hhiBand (hhi-band.mjs, the plain, dependency-free SINGLE SOURCE for the
 * HHI band vocabulary — see that file's header for why it's the one copy
 * every consumer, including the gates, shares).
 *
 * PARITY CONTRACT. This component must render IDENTICAL markup (same
 * elements, same `data-*` attributes, same text) to <FeedCardItem> for the
 * same (card, companySlug, hasProgramPage) triple — verified by
 * __tests__/feed-card-item-parity.test.tsx, which renders both components
 * for fixture cards (including a code-led legacy headline and a
 * reconciliation-split yoy_swing card) and diffs their HTML.
 *
 * TWO PIECES ARE REIMPLEMENTED, NOT JUST RE-EXPORTED, below:
 *
 *   feedHeadlineSegmentsClient() — data.ts's feedHeadlineSegments() has a
 *   defense-in-depth fallback for PRE-#44 code-led sidecars: when a card's
 *   headline still literally starts with its own pe_bli code, it calls
 *   getPrograms() (disk I/O) to try to swap in a resolved title. The
 *   exporter has resolved and led with the title for every card since #44
 *   (feed.json's headline_segments arrive title-led already — see that
 *   function's doc comment), so this swap is a no-op for current exports:
 *   verified against the live corpus (2026-09-04), the 6 cards whose
 *   headline still starts with their own code (all pe_bli "LRASM0") carry
 *   card.title === card.pe_bli === "LRASM0", so the "resolved" title is the
 *   code itself and feedDisplayHeadline() returns card.headline unchanged.
 *   This twin skips the getPrograms() lookup entirely (no fs in the
 *   browser) and returns card.headline_segments as-is, which is provably
 *   identical output for every card in the shipped corpus. A future export
 *   that ships a *different* resolved title for a code-led card than what
 *   card.title carries would diverge here — the parity test's code-led
 *   fixture pins today's behavior so that regression is caught if it ever
 *   changes shape.
 *
 *   Fy26SplitNoteClient — byte-for-byte the same JSX as
 *   program-figures.tsx's Fy26SplitNote, using <ScopeNote>/<Cite> directly
 *   instead of importing the tainted module.
 */

import Link from "next/link";
import { Cite } from "@/components/cite";
import { ProseCite } from "@/components/prose-cite";
import { ScopeNote } from "@/components/notes";
import { FeedMagnitudeLine } from "@/components/feed-magnitude";
import { hhiBand } from "@/lib/hhi-band.mjs";
import type { FeedCard, FeedHeadlineSegment, Fy26Split } from "@/lib/data";

// ── feedHeadlineSegments twin (see doc comment above) ───────────────────────

function feedHeadlineSegmentsClient(card: FeedCard): FeedHeadlineSegment[] {
  const segments = card.headline_segments;
  if (!segments || segments.length === 0) {
    return [{ text: card.headline }];
  }
  return segments;
}

function FeedHeadlineClient({ card }: { card: FeedCard }) {
  const segments = feedHeadlineSegmentsClient(card);
  return (
    <>
      {segments.map((seg, i) =>
        seg.text !== undefined ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <ProseCite key={i} factId={seg.fact_id}>
            {seg.amount}
          </ProseCite>
        ),
      )}
    </>
  );
}

// ── hhiScopeNote twin — identical logic, hhiBand is the shared source ──────

function hhiScopeNoteClient(
  card: FeedCard,
): { band: string; text: string } | null {
  if (card.figure_units !== "hhi" || card.figure_value === null) return null;
  const band = hhiBand(card.figure_value);
  const yearText = card.fiscal_year ? `FY${card.fiscal_year}` : "that year";
  return {
    band: band.label,
    text:
      `${band.label} in ${yearText} — the program's pooled, all-years HHI ` +
      `can differ; see the program page.`,
  };
}

// ── Fy26SplitNote twin — identical JSX, client-safe imports only ───────────

function Fy26SplitNoteClient({ split }: { split: Fy26Split }) {
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

// ── FeedCardItemClient — same markup as FeedCardItem, client-safe pieces ───

export function FeedCardItemClient({
  card,
  companySlug,
  hasProgramPage,
}: {
  card: FeedCard;
  companySlug: string | null;
  hasProgramPage: boolean;
}) {
  const isConcentration = card.event_type === "concentration_shift";
  const isNewEntrant = card.event_type === "new_entrant";
  const isRvaGap = card.event_type === "request_vs_actuals_gap";
  const hhiScope = hhiScopeNoteClient(card);

  const basisProps = card.basis
    ? {
        basis: card.basis,
        fy: card.fy ?? undefined,
        measure: card.measure ?? undefined,
        edition: card.edition ?? undefined,
        entity: card.pe_bli ?? undefined,
      }
    : {};

  return (
    <div
      data-feed-card=""
      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 hover:bg-muted/60 transition-colors"
      {...(isNewEntrant && !companySlug ? { "data-no-company-page": "" } : {})}
    >
      <div data-mobile-pair-label="" className="min-w-0 sm:flex-1">
        <p
          className="text-sm font-medium leading-snug"
          data-source-text="headline"
          data-xml-path={`site:feed/${card.event_type}/${card.pe_bli ?? card.family_key ?? "unknown"}`}
        ><FeedHeadlineClient card={card} /></p>
        {hhiScope && (
          <p
            data-hhi-scope-note=""
            data-hhi-band={hhiScope.band}
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {hhiScope.text}
          </p>
        )}
        <FeedMagnitudeLine card={card} />
        {card.fy26_split?.has_reconciliation && (
          <Fy26SplitNoteClient split={card.fy26_split} />
        )}
        {card.pe_bli && (
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {card.pe_bli}
            </span>
            {card.program_url && hasProgramPage && (
              <Link
                href={card.program_url}
                className="text-xs text-primary underline decoration-dotted hover:decoration-solid"
              >
                view program &rarr;
              </Link>
            )}
          </div>
        )}
        {card.family_key && !card.pe_bli && (
          <p className="mt-1 text-xs font-mono">
            {companySlug ? (
              <Link
                href={`/company/${companySlug}/`}
                className="text-primary underline decoration-dotted hover:decoration-solid"
              >
                {card.family_key}
              </Link>
            ) : (
              <span className="text-muted-foreground">{card.family_key}</span>
            )}
          </p>
        )}
      </div>
      <div
        data-mobile-pair-value=""
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 sm:block sm:text-right"
      >
        {card.figure_value !== null && (
          <span
            data-primary-value="feed-figure"
            className="text-sm font-mono font-semibold"
          >
            {isConcentration || card.figure_units === "hhi" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_feed_events"
                factId={card.figure_fact_id}
                {...basisProps}
                display={`HHI ${card.figure_value.toFixed(0)}`}
              />
            ) : isNewEntrant || card.figure_units === "dollars" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_feed_events"
                factId={card.figure_fact_id}
                {...basisProps}
              />
            ) : isRvaGap ? (
              <Cite
                value={card.figure_value}
                units="USD thousands"
                dataset="fct_book_diff"
                factId={card.figure_fact_id}
                {...basisProps}
              />
            ) : card.figure_units === "pct_change" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_budget_trajectory"
                factId={card.figure_fact_id}
                display={`${card.figure_value >= 0 ? "+" : ""}${card.figure_value.toFixed(0)}%`}
                {...basisProps}
              />
            ) : (
              <Cite
                value={card.figure_value}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={card.figure_fact_id}
                {...basisProps}
              />
            )}
          </span>
        )}
        <div className="sm:mt-1">
          <Link
            href={card.why_url}
            className="text-[13px] text-foreground/70 underline decoration-dotted hover:text-foreground hover:decoration-solid"
            title="Why am I seeing this?"
          >
            why flagged?
          </Link>
        </div>
      </div>
    </div>
  );
}
