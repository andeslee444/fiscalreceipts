/**
 * <NarrativeBody> — renders a J-book narrative body string with
 *
 *   1. prose amount links (Phase 5F §2c): exporter-recorded {start, end,
 *      fact_id, token} offsets become <ProseCite> spans (state-A behavior,
 *      data-prose-cite — never data-amount inside source text), and
 *   2. universal PE mention links (§2a): PE-shaped tokens with a page become
 *      internal <a> links; "PE X, Project Y" resolves to the target's
 *      #project-Y anchor when that project row exists.
 *
 * Offsets are into the RAW body string; rendering splits the body into
 * segments (lib/pe-link.segmentBody) so adjacent text survives byte-for-byte.
 * Defense-in-depth: an amount link whose recorded token no longer equals the
 * body slice is dropped (stale offsets must degrade to plain prose, never
 * mis-highlight).
 */

import React from "react";
import type { PeLinkIndex, ProseAmountLink } from "@/lib/data";
import { findPeLinks, segmentBody, type LinkRange } from "@/lib/pe-link";
import { ProseCite } from "@/components/prose-cite";

interface NarrativeBodyProps {
  body: string;
  /** Exporter-recorded prose dollar-token citations (may be absent). */
  amountLinks?: ProseAmountLink[];
  /** PE page/project resolver (build-time index; tests pass a stub). */
  peIndex: PeLinkIndex;
  /** The containing page's own PE — self-references stay plain. */
  selfPe?: string;
  className?: string;
}

export function NarrativeBody({
  body,
  amountLinks,
  peIndex,
  selfPe,
  className,
}: NarrativeBodyProps) {
  const ranges: LinkRange[] = [];

  // Amount links first — they take precedence over any overlapping PE token
  // (segmentBody drops later overlaps).
  for (const l of amountLinks ?? []) {
    if (body.slice(l.start, l.end) !== l.token) continue; // stale offset → plain prose
    ranges.push({ start: l.start, end: l.end, kind: "amount", factId: l.fact_id });
  }

  for (const link of findPeLinks(body, peIndex, {
    selfPe,
    projectsByPe: (pe) => peIndex.projects(pe),
  })) {
    ranges.push({ start: link.start, end: link.end, kind: "pe", href: link.href });
  }

  const segments = segmentBody(body, ranges);

  return (
    <p
      className={
        className ??
        "text-sm text-foreground leading-relaxed whitespace-pre-line"
      }
    >
      {segments.map((seg, i) => {
        if (seg.kind === "amount" && seg.factId) {
          return (
            <ProseCite key={i} factId={seg.factId}>
              {seg.text}
            </ProseCite>
          );
        }
        if (seg.kind === "pe" && seg.href) {
          // Plain <a> (not next/link): hrefs keep their canonical trailing
          // slash exactly as emitted — the linkgraph dead-link scan and the
          // pe-linking leg both assert on the literal href.
          return (
            <a
              key={i}
              href={seg.href}
              className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
              title={`Open program page for ${seg.text}`}
            >
              {seg.text}
            </a>
          );
        }
        return <React.Fragment key={i}>{seg.text}</React.Fragment>;
      })}
    </p>
  );
}
