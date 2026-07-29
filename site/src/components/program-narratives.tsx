import type { PeLinkIndex, ProgramNarrative } from "@/lib/data";
import { NarrativeBody } from "@/components/narrative-body";
import { NarrativeSourceChip } from "@/components/narrative-chip";

/**
 * ProgramNarratives — J-book narrative prose, split across the two skeleton
 * sections (Phase 5F §2d):
 *
 *   group="description"   → mission + description kinds
 *   group="justification" → justification + accomplishment_planned_program
 *                           (+ any unknown kinds, so nothing silently drops)
 *
 * Accomplishments stay collapsible (details/summary HTML — no JS).
 *
 * Each group's wrapper carries data-pagefind-body (Pagefind indexing — the
 * deep-search eval phrases live in accomplishments) AND
 * data-source-text="narrative" + data-xml-path (block-level citation; the
 * render-static a0 contract). Bodies render through <NarrativeBody>:
 * prose amount links become data-prose-cite spans (§2c — NEVER data-amount
 * inside source text) and PE mentions become internal links (§2a).
 */

export type NarrativeGroup = "description" | "justification";

const DESCRIPTION_KINDS = new Set(["mission", "description"]);

interface ProgramNarrativesProps {
  narratives: ProgramNarrative[];
  group: NarrativeGroup;
  /** PE page/project resolver for mention linking (build-time index). */
  peIndex: PeLinkIndex;
  /** The page's own PE — self-references stay plain text. */
  selfPe: string;
}

const KIND_ORDER: Record<string, number> = {
  mission: 0,
  description: 1,
  justification: 2,
  accomplishment_planned_program: 3,
};

function kindOrder(kind: string): number {
  return KIND_ORDER[kind] ?? 99;
}

function humanizeKind(kind: string): string {
  switch (kind) {
    case "mission":
      return "Mission";
    case "description":
      return "Description";
    case "justification":
      return "Justification";
    case "accomplishment_planned_program":
      return "Accomplishments & Planned Programs";
    default:
      return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Narratives belonging to a skeleton group (exported for the page's
 *  empty-state decision). Unknown kinds bucket under justification. */
export function narrativesInGroup(
  narratives: ProgramNarrative[],
  group: NarrativeGroup,
): ProgramNarrative[] {
  return narratives.filter((n) =>
    group === "description"
      ? DESCRIPTION_KINDS.has(n.kind)
      : !DESCRIPTION_KINDS.has(n.kind),
  );
}

export function ProgramNarratives({
  narratives,
  group,
  peIndex,
  selfPe,
}: ProgramNarrativesProps) {
  const inGroup = narrativesInGroup(narratives, group);
  if (inGroup.length === 0) {
    return null;
  }

  // Sort by kind order
  const sorted = [...inGroup].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));

  // Separate non-accomplishment from accomplishments
  const primary = sorted.filter(
    (n) => n.kind !== "accomplishment_planned_program",
  );
  const accomplishments = sorted.filter(
    (n) => n.kind === "accomplishment_planned_program",
  );

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-4 text-foreground">
        {group === "description" ? "Description" : "Justification"}
      </h2>

      {/* data-pagefind-body wraps main content for Pagefind indexing.
          data-source-text="narrative" signals that this subtree contains
          quoted source text (J-book prose) — the render-static gate skips
          currency patterns inside elements carrying data-source-text.
          data-xml-path provides the block-level citation anchor (first
          narrative's xml_path from the J-book XML source), satisfying the
          constraint that every data-source-text element must also carry
          data-xml-path. */}
      <div
        data-pagefind-body
        data-source-text="narrative"
        data-xml-path={sorted[0]?.xml_path ?? ""}
      >
        {/* Primary narratives (mission, description, justification) */}
        {primary.map((n, i) => (
          <div key={i} className="mb-6">
            {/* Explicit space text-nodes between the heading fragments: the
                visual gaps are CSS margins, but text extraction (Pagefind
                excerpts, copy/paste, screen readers) concatenates adjacent
                text without them — "Mission— Long Range Kill Chainssource"
                was the shipped join (Fix H2, 2026-07-28). */}
            <h3 className="text-sm font-semibold text-foreground mb-2">
              {humanizeKind(n.kind)}
              {n.title && n.title !== n.kind && (
                <>
                  {" "}
                  <span className="ml-2 font-normal text-muted-foreground">
                    — {n.title}
                  </span>
                </>
              )}
              {n.fact_id && (
                <>
                  {" "}
                  <NarrativeSourceChip factId={n.fact_id} />
                </>
              )}
            </h3>
            <NarrativeBody
              body={n.body}
              amountLinks={n.amount_links}
              peIndex={peIndex}
              selfPe={selfPe}
            />
          </div>
        ))}

        {/* Accomplishments — collapsible via native details/summary (no JS) */}
        {accomplishments.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {humanizeKind("accomplishment_planned_program")}{" "}
              <span className="font-normal text-muted-foreground">
                ({accomplishments.length})
              </span>
            </h3>
            <div className="space-y-2">
              {accomplishments.map((n, i) => (
                <details
                  key={i}
                  className="rounded-lg border border-border bg-muted/30 group"
                >
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors rounded-lg list-none flex items-center justify-between">
                    <span>
                      {n.title}
                      {/* space text-node: keeps the accomplishment title and
                          the "source" chip separate words in text extraction */}
                      {n.fact_id && (
                        <>
                          {" "}
                          <NarrativeSourceChip factId={n.fact_id} />
                        </>
                      )}
                    </span>
                    <span
                      className="text-muted-foreground text-xs group-open:rotate-180 transition-transform"
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </summary>
                  <div className="px-4 pb-4 pt-2">
                    <NarrativeBody
                      body={n.body}
                      amountLinks={n.amount_links}
                      peIndex={peIndex}
                      selfPe={selfPe}
                    />
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
