import React from "react";
import type { SnapshotMeta } from "@/lib/dossier";
import {
  DOSSIER_ALL_SECTIONS,
  DOSSIER_SECTION_TITLES,
  isFactCitation,
  type DossierFile,
} from "@/lib/dossier";
import { DossierFactChip, DossierUrlChip } from "@/components/dossier-chips";

/**
 * ProgramDossier (Task 8a) — renders a GATED dossier's four sections:
 * "What it is / Why it matters / Key players / Recent developments".
 *
 * Cited-or-absent contract: this component only ever receives a dossier that
 * passed getDossier()'s re-verification (structure + every citation
 * resolvable). Each claim renders its text followed by its citation chip —
 * fact chips open the citation panel via the existing context, url chips link
 * the live source with the snapshot title tooltip + retrieved note.
 *
 * Empty sections (recent_developments for most programs) render NOTHING —
 * zero placeholder text. Pages without a dossier never mount this component.
 */

interface ProgramDossierProps {
  dossier: DossierFile;
  /** url → snapshot metadata (from getSnapshotMeta()) for url-citation chips. */
  snapshotMeta: Record<string, SnapshotMeta>;
}

export function ProgramDossier({ dossier, snapshotMeta }: ProgramDossierProps) {
  const sections = DOSSIER_ALL_SECTIONS.filter(
    (key) => dossier.dossier[key].claims.length > 0,
  );
  if (sections.length === 0) return null;

  return (
    <section
      className="mt-8 pt-6 border-t border-border"
      id="dossier"
      data-dossier={dossier.pe_bli}
    >
      <h2 className="text-xl font-semibold mb-1">Program dossier</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Every sentence below carries its citation — warehouse figures open the
        citation panel, news claims link the cached source.
      </p>

      <div className="space-y-5">
        {sections.map((key) => (
          <div key={key} data-dossier-section={key}>
            <h3 className="text-base font-semibold mb-2 text-foreground">
              {DOSSIER_SECTION_TITLES[key]}
            </h3>
            <ul className="space-y-2">
              {dossier.dossier[key].claims.map((claim, i) => (
                <li
                  key={`${key}-${i}`}
                  className="text-sm leading-relaxed text-foreground"
                  // Claim text may quote dollar figures from its cited source.
                  // data-source-text exempts it from the negative currency
                  // scan; the claim's own citation is the required anchor
                  // (data-cite-fact-id / data-cite-url — gate-enforced).
                  data-source-text="dossier-claim"
                  {...(isFactCitation(claim.citation)
                    ? { "data-cite-fact-id": claim.citation.fact_id }
                    : { "data-cite-url": claim.citation.url })}
                >
                  {claim.text}
                  {isFactCitation(claim.citation) ? (
                    <DossierFactChip factId={claim.citation.fact_id} />
                  ) : (
                    <DossierUrlChip
                      url={claim.citation.url}
                      meta={snapshotMeta[claim.citation.url] ?? null}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
