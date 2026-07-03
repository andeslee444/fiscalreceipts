/**
 * <PeText> — inline PE mention linking for arbitrary text (Phase 5F §2a).
 *
 * Renders `text` with every PE-shaped token that has a page turned into an
 * internal <a>. Used by dossier claims (server: pass the build-time
 * PeLinkIndex) and lobbying-mention snippets (client: pass a membership
 * built from the serializable peHrefs map). Unknown tokens and
 * self-references stay plain text — deterministic only.
 *
 * Link vocabulary: PE links NAVIGATE, so they render a SOLID underline —
 * the dotted underline is reserved for citation spans (Cite/ProseCite),
 * which open the citation panel in place. ↗ stays reserved for external
 * links. Keep in sync with narrative-body.tsx.
 *
 * No "use client" and no server-only imports: usable from both boundaries.
 */

import React from "react";
import {
  findPeLinks,
  segmentBody,
  type PeMembership,
} from "@/lib/pe-link";

export function PeText({
  text,
  peSet,
  selfPe,
  projectsByPe,
}: {
  text: string;
  peSet: PeMembership;
  selfPe?: string;
  projectsByPe?: (pe: string) => ReadonlySet<string>;
}) {
  const links = findPeLinks(text, peSet, { selfPe, projectsByPe });
  if (links.length === 0) return <>{text}</>;
  const segments = segmentBody(
    text,
    links.map((l) => ({ start: l.start, end: l.end, kind: "pe" as const, href: l.href })),
  );
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "pe" && seg.href ? (
          <a
            key={i}
            href={seg.href}
            className="text-primary underline decoration-solid underline-offset-2 hover:decoration-2"
            title={`Open program page for ${seg.text}`}
          >
            {seg.text}
          </a>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  );
}
