/**
 * dossier.ts — parse + re-verify GATED dossier files (Phase 5B-3 Task 8a).
 *
 * Dossiers are produced by `govbudget dossiers collect` into
 * data/site/json/dossiers/{pe_bli}.json AFTER the Python cited-or-absent
 * gate (src/govbudget/dossiers/gate.py). The site loader re-verifies at SSG:
 *
 *   - structure: wrapped {pe_bli, model, collected_at, dossier: {…}} where
 *     every section is {claims: [{text, citation: {fact_id} | {url}}]}.
 *   - fact_id citations MUST resolve in citations.json.
 *   - url citations MUST be the url of a cached research snapshot
 *     (data/research/snapshots/index.json).
 *
 * Any violation THROWS — a loud build error, never a silent skip. The gate
 * should have rejected the file; the site must not render ungated content.
 * A missing dossier file is the one graceful case: the program page simply
 * renders no dossier section (zero placeholder text).
 */

export const DOSSIER_REQUIRED_SECTIONS = [
  "what_it_is",
  "why_it_matters",
  "players",
] as const;

export const DOSSIER_ALL_SECTIONS = [
  ...DOSSIER_REQUIRED_SECTIONS,
  "recent_developments",
] as const;

export type DossierSectionKey = (typeof DOSSIER_ALL_SECTIONS)[number];

export const DOSSIER_SECTION_TITLES: Record<DossierSectionKey, string> = {
  what_it_is: "What it is",
  why_it_matters: "Why it matters",
  players: "Key players",
  recent_developments: "Recent developments",
};

export interface DossierFactCitation {
  fact_id: string;
}

export interface DossierUrlCitation {
  url: string;
}

export type DossierCitation = DossierFactCitation | DossierUrlCitation;

export interface DossierClaim {
  text: string;
  citation: DossierCitation;
}

export interface DossierSections {
  what_it_is: { claims: DossierClaim[] };
  why_it_matters: { claims: DossierClaim[] };
  players: { claims: DossierClaim[] };
  recent_developments: { claims: DossierClaim[] };
}

/** The wrapped on-disk shape written by `govbudget dossiers collect`. */
export interface DossierFile {
  pe_bli: string;
  model: string;
  collected_at: string;
  dossier: DossierSections;
  /**
   * (#52 fallout, 2026-08-08) Count of claims dropped at export time
   * because their citation no longer resolved — most often a single-
   * common-word LDA match the #52 evidence-tier fix retracted. 0 when
   * nothing was dropped. Optional so a pre-#52 file parses without it.
   * Rendered as a ScopeNote by ProgramDossier when > 0 — a correction
   * that removed content ships labelled, not silent.
   */
  dropped_claims?: number;
  /**
   * (#56 addendum, 2026-08-11) WHY each drop happened, so the ScopeNote can
   * say the true reason instead of always assuming #52's ("cited lobbying
   * mentions that did not meet the evidence standard"):
   *   - unresolvable_citation: #52's original reason — the fact_id/url no
   *     longer resolves at all.
   *   - stale_value: the citation still resolves, but the claim's own
   *     hardcoded prose no longer matches its CURRENT value (e.g. a #56
   *     account re-key changed what a stable fact_id now records).
   * Only present keys had >=1 drop for that reason. Optional so a file
   * written before this addendum parses without it.
   */
  dropped_reasons?: { unresolvable_citation?: number; stale_value?: number };
}

/** Snapshot metadata for url-citation chips (title tooltip + retrieved note). */
export interface SnapshotMeta {
  retrieved_at: string | null;
  title: string | null;
}

export function isFactCitation(
  c: DossierCitation,
): c is DossierFactCitation {
  return "fact_id" in c;
}

function fail(peBli: string, message: string): never {
  throw new Error(
    `[govbudget/dossier] REJECTED dossier for ${peBli}: ${message}. ` +
      `The cited-or-absent gate (govbudget dossiers gate) should have caught ` +
      `this — the site refuses to render ungated dossier content.`,
  );
}

/**
 * Structural validation of a raw dossier file. Throws on any deviation from
 * the wrapped DOSSIER_SCHEMA shape; returns the typed file on success.
 */
export function parseDossier(raw: unknown, peBli: string): DossierFile {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(peBli, "file is not a JSON object");
  }
  const doc = raw as Record<string, unknown>;
  // Sprint E (#67): a dossier is loaded by PAGE identity. For a split key the
  // page is a slug ("3010-SCN") while pe_bli stays the program key ("3010"),
  // so the file carries an explicit `slug` and must self-describe the page it
  // is being rendered on. Falls back to pe_bli for every non-split program,
  // where the two are identical. This is not a loosening: a file with neither
  // field matching the requested key is still refused, and a file whose slug
  // names a DIFFERENT page is refused where a bare prefix check would have
  // let it through.
  const declaredPage =
    typeof doc.slug === "string" && doc.slug.length > 0 ? doc.slug : doc.pe_bli;
  if (typeof doc.pe_bli !== "string" || declaredPage !== peBli) {
    fail(
      peBli,
      `identity mismatch (file says pe_bli=${JSON.stringify(doc.pe_bli)},` +
        ` slug=${JSON.stringify(doc.slug ?? null)})`,
    );
  }
  if (typeof doc.dossier !== "object" || doc.dossier === null) {
    fail(peBli, "missing wrapped 'dossier' object");
  }
  const sections = doc.dossier as Record<string, unknown>;
  for (const key of DOSSIER_ALL_SECTIONS) {
    const section = sections[key];
    if (typeof section !== "object" || section === null) {
      fail(peBli, `missing section '${key}'`);
    }
    const claims = (section as Record<string, unknown>).claims;
    if (!Array.isArray(claims)) {
      fail(peBli, `section '${key}' has no claims array`);
    }
    claims.forEach((claim, i) => {
      if (typeof claim !== "object" || claim === null) {
        fail(peBli, `${key}[${i}] is not an object`);
      }
      const c = claim as Record<string, unknown>;
      if (typeof c.text !== "string" || c.text.trim() === "") {
        fail(peBli, `${key}[${i}] has empty text`);
      }
      const citation = c.citation;
      if (typeof citation !== "object" || citation === null) {
        fail(peBli, `${key}[${i}] has no citation`);
      }
      const cit = citation as Record<string, unknown>;
      const hasFact = typeof cit.fact_id === "string" && cit.fact_id !== "";
      const hasUrl = typeof cit.url === "string" && cit.url !== "";
      if (hasFact === hasUrl) {
        fail(
          peBli,
          `${key}[${i}] citation must carry exactly one of fact_id | url`,
        );
      }
    });
  }
  return doc as unknown as DossierFile;
}

/**
 * Re-verify the gate's citation contract at SSG. Throws (loud build error)
 * when a fact_id does not resolve in citations.json or a url is not a cached
 * research snapshot.
 */
export function validateDossierCitations(
  file: DossierFile,
  citationFactIds: ReadonlySet<string>,
  snapshotUrls: ReadonlySet<string>,
): void {
  for (const key of DOSSIER_ALL_SECTIONS) {
    file.dossier[key].claims.forEach((claim, i) => {
      const citation = claim.citation;
      if (isFactCitation(citation)) {
        if (!citationFactIds.has(citation.fact_id)) {
          fail(
            file.pe_bli,
            `${key}[${i}] cites fact_id '${citation.fact_id}' which does not ` +
              `resolve in citations.json`,
          );
        }
      } else if (!snapshotUrls.has(citation.url)) {
        fail(
          file.pe_bli,
          `${key}[${i}] cites url '${citation.url}' which is not a cached ` +
            `research snapshot`,
        );
      }
    });
  }
}

/** All warehouse fact_ids cited by the dossier (for the page citation slice). */
export function dossierFactIds(file: DossierFile): string[] {
  const ids: string[] = [];
  for (const key of DOSSIER_ALL_SECTIONS) {
    for (const claim of file.dossier[key].claims) {
      if (isFactCitation(claim.citation)) {
        ids.push(claim.citation.fact_id);
      }
    }
  }
  return ids;
}
