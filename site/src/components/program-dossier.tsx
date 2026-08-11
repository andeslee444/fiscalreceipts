import React from "react";
import type { SnapshotMeta } from "@/lib/dossier";
import {
  DOSSIER_ALL_SECTIONS,
  DOSSIER_SECTION_TITLES,
  isFactCitation,
  type DossierFile,
} from "@/lib/dossier";
import type { PeLinkIndex } from "@/lib/data";
import { DossierFactChip, DossierUrlChip } from "@/components/dossier-chips";
import { CoverageNote } from "@/components/coverage-note";
import { ScopeNote } from "@/components/notes";
import { PeText } from "@/components/pe-text";

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
  /** PE page resolver for claim-text mention linking (Phase 5F §2a). */
  peIndex?: PeLinkIndex;
}

export function ProgramDossier({
  dossier,
  snapshotMeta,
  peIndex,
}: ProgramDossierProps) {
  const sections = DOSSIER_ALL_SECTIONS.filter(
    (key) => dossier.dossier[key].claims.length > 0,
  );
  // (#52 fallout) dropped_claims > 0 means the export-time filter removed a
  // claim whose citation no longer resolved (see _emit_dossier_sidecars).
  // Keep rendering the section — with the correction note — even in the
  // (currently hypothetical) case where every section emptied out; a
  // dossier that lost all its claims should say so, not silently vanish
  // the way an always-had-nothing dossier correctly does.
  const droppedCount = dossier.dropped_claims ?? 0;
  if (sections.length === 0 && droppedCount === 0) return null;

  // (#56 addendum) The wording depends on WHY claims were dropped — #52's
  // reason (citation no longer resolves) has nothing to do with #56's (the
  // citation still resolves, but its OWN CURRENT value no longer matches
  // what the claim's hardcoded prose says — e.g. a program-key re-key
  // changed which single account a stable fact_id now describes). Both can
  // fire on the same dossier. A sidecar this component predates (no
  // dropped_reasons field at all) falls back to #52's EXACT original
  // wording — the only reason that existed before this field did, and the
  // phrasing the existing regression tests pin verbatim.
  const reasons = dossier.dropped_reasons;
  const unresolvedN = reasons ? (reasons.unresolvable_citation ?? 0) : droppedCount;
  const staleN = reasons ? (reasons.stale_value ?? 0) : 0;
  const pronoun = droppedCount === 1 ? "it" : "they";
  const subjectFor = (n: number) =>
    n === droppedCount ? pronoun : n === 1 ? "one" : `${n}`;
  const correctionParts: string[] = [];
  if (unresolvedN > 0) {
    correctionParts.push(
      `${subjectFor(unresolvedN)} cited lobbying mentions that did not meet the evidence standard`,
    );
  }
  if (staleN > 0) {
    correctionParts.push(
      `${subjectFor(staleN)} stated ${staleN === 1 ? "a figure" : "figures"} a later correction changed`,
    );
  }
  const correctionText =
    correctionParts.length > 0
      ? correctionParts.join("; ")
      : "did not meet the evidence standard";

  return (
    <section
      className="mt-8 pt-6 border-t border-border"
      id="dossier"
      data-dossier={dossier.pe_bli}
    >
      <h2 className="text-xl font-semibold mb-1">Program dossier</h2>
      <p className="text-sm text-muted-foreground mb-1">
        Every sentence below carries its citation — warehouse figures open the
        citation panel, news claims link the cached source.
      </p>
      {/* Scope note — G2 contract (data-coverage="dossiers") */}
      <CoverageNote id="dossiers" className="mb-4" />
      {/* data-dossier-dropped-claims below is the machine-checkable hook for
          the regression test (a dossier that lost a claim still renders,
          and says so) and for gate 21-style DOM assertions if one is ever
          added. */}
      {droppedCount > 0 && (
        <ScopeNote className="mb-4" label="Correction">
          <p
            className="text-sm leading-relaxed"
            data-dossier-dropped-claims={droppedCount}
          >
            {droppedCount} claim{droppedCount === 1 ? "" : "s"} removed:{" "}
            {correctionText}.
          </p>
        </ScopeNote>
      )}

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
                  {peIndex ? (
                    // PE mentions in claim text link to their program pages
                    // (§2a); self-references stay plain.
                    <PeText
                      text={claim.text}
                      peSet={peIndex}
                      selfPe={dossier.pe_bli}
                      projectsByPe={(pe) => peIndex.projects(pe)}
                    />
                  ) : (
                    claim.text
                  )}
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
