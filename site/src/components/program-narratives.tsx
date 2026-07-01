import type { ProgramNarrative } from "@/lib/data";

/**
 * ProgramNarratives — mission kind first, then description/justification,
 * then accomplishment_planned_program items collapsible (details/summary HTML — no JS).
 *
 * The outer <div> carries data-pagefind-body so Pagefind indexes this content.
 */

interface ProgramNarrativesProps {
  narratives: ProgramNarrative[];
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

export function ProgramNarratives({ narratives }: ProgramNarrativesProps) {
  if (narratives.length === 0) {
    return null;
  }

  // Sort by kind order
  const sorted = [...narratives].sort(
    (a, b) => kindOrder(a.kind) - kindOrder(b.kind),
  );

  // Separate non-accomplishment from accomplishments
  const primary = sorted.filter(
    (n) => n.kind !== "accomplishment_planned_program",
  );
  const accomplishments = sorted.filter(
    (n) => n.kind === "accomplishment_planned_program",
  );

  return (
    <section
      aria-labelledby="narratives-heading"
      className="mb-8"
    >
      <h2
        id="narratives-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Program Narratives
      </h2>

      {/* data-pagefind-body wraps main content for Pagefind indexing.
          data-source-text="narrative" signals that this subtree contains
          quoted source text (J-book prose) — the render-static gate skips
          currency patterns inside elements carrying data-source-text, since
          dollar strings here are block-cited at the xml_path level. */}
      <div data-pagefind-body data-source-text="narrative">
        {/* Primary narratives (mission, description, justification) */}
        {primary.map((n, i) => (
          <div key={i} className="mb-6">
            <h3 className="text-sm font-semibold text-foreground mb-2">
              {humanizeKind(n.kind)}
              {n.title && n.title !== n.kind && (
                <span className="ml-2 font-normal text-muted-foreground">
                  — {n.title}
                </span>
              )}
            </h3>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
              {n.body}
            </p>
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
                    <span>{n.title}</span>
                    <span
                      className="text-muted-foreground text-xs group-open:rotate-180 transition-transform"
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </summary>
                  <div className="px-4 pb-4 pt-2">
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                      {n.body}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
