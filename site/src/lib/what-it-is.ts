/**
 * what-it-is.ts — the WHAT-IT-IS card's content decision (PM Sprint 2, §P1-2).
 *
 * The card used to render one template string for all 1,993 program pages:
 *
 *     "F-35 — a procurement program run by Air Force."
 *
 * …on the largest program in the corpus, while a genuinely good, fact-cited
 * sentence sat ~3,000px below in the dossier. This module decides, per page,
 * which of three honest sources the card speaks from. It is PURE (no fs, no
 * React) so both the page and the gate-facing unit tests can call it.
 *
 * Tier 1 — DOSSIER (the 50 programs with a gated dossier).
 *   Hoist the dossier's first one-or-two `what_it_is` claims VERBATIM, each
 *   with its own citation, into the card. Nothing is re-written or merged:
 *   a claim's text and its citation travel together, so the card's sentences
 *   stay as clickable and as checkable as they are in the dossier section.
 *   The 2nd claim is taken only when the pair still fits the card (the answer
 *   strip is an above-the-fold contract — gate 16 measures it at 390×844).
 *
 * Tier 2 — FIELDS (full-tier programs with no dossier).
 *   A deterministic sentence assembled from J-book/workbook fields the page
 *   already renders: org, exhibit family, the workbook line's account title,
 *   and the J-book project count. No LLM, no invention, no adjectives — every
 *   clause is a field. The account clause carries the FACT ID of the workbook
 *   row it was read from, so even the generated sentence is checkable.
 *
 * Tier 3 — ROLLUP (R-1/P-1 summary lines).
 *   Keeps the template shape AND the tier's existing honest tail: this page
 *   carries summary figures only because the ingested book has no matching
 *   R-2/P-40 detail for this line (or the book is not ingested yet).
 *
 * The rendered card declares its tier in `data-what-source` so the gate can
 * assert that a dossier program's card is dossier-sourced — i.e. that the
 * template stub is really gone and did not quietly come back.
 */

import type { DossierClaim, DossierFile } from "@/lib/dossier";
import { serviceOrgName } from "@/lib/program-tier";

/** Plain-language label for exhibit_family values (answer-strip copy). */
export function answerFamilyPlain(family: string): string {
  switch (family.toLowerCase()) {
    case "rdte":
      return "research & development";
    case "procurement":
      return "procurement";
    case "om":
    case "o&m":
      return "operations & maintenance";
    case "milpers":
      return "military personnel";
    case "budget":
      return "budget"; // rollup tier with no classifiable workbook lines
    default:
      return family.toUpperCase();
  }
}

/**
 * Character budget for the hoisted dossier text. The answer strip must fit
 * entirely inside a 390×844 viewport with the breadcrumbs, the (often
 * two-line) program title and the badge row above it — gate 16 measures
 * exactly that. One claim is always taken; the second joins it only if the
 * pair stays within budget.
 *
 * MEASURED, not guessed. At 390×844 the strip's bottom edge sat at 361px on
 * /program/ATA000/ with one claim — 350px of headroom. At ~45 characters per
 * 19px line, 420 characters is ~10 lines ≈ 190px, which clears the fold with
 * room for a two-line title above. Across the 50 dossiers the longest single
 * first claim is 405 characters (also inside the budget) and 20 of the 50
 * first-pairs fit, including the F-35 pair the PM quoted.
 */
export const DOSSIER_CARD_CHAR_BUDGET = 420;

/** Maximum claims hoisted, however short they are (spec: "first one or two"). */
export const DOSSIER_CARD_MAX_CLAIMS = 2;

export interface WhatItIsDossier {
  source: "dossier";
  /** Verbatim dossier claims (text + citation), in dossier order. */
  claims: DossierClaim[];
}

export interface WhatItIsFields {
  source: "fields";
  /** The assembled sentence(s). */
  text: string;
  /**
   * fact_id of the workbook line the account clause was read from — null when
   * the program has no workbook line carrying an account title (then the
   * sentence simply omits the account clause).
   */
  accountFactId: string | null;
}

export interface WhatItIsRollup {
  source: "rollup";
  /** The template sentence (title + family + org). */
  text: string;
  /** The tier's honest tail — why this page carries summary figures only. */
  tail: string;
}

export type WhatItIsCard = WhatItIsDossier | WhatItIsFields | WhatItIsRollup;

/**
 * Pick the dossier claims that fit the card. Always at least the first claim
 * (a card is never empty when a dossier exists); at most
 * DOSSIER_CARD_MAX_CLAIMS; stops before exceeding the character budget.
 */
export function hoistDossierClaims(
  claims: readonly DossierClaim[],
  budget: number = DOSSIER_CARD_CHAR_BUDGET,
): DossierClaim[] {
  if (claims.length === 0) return [];
  const picked: DossierClaim[] = [claims[0]];
  let used = claims[0].text.length;
  for (let i = 1; i < claims.length && picked.length < DOSSIER_CARD_MAX_CLAIMS; i++) {
    const next = claims[i];
    if (used + 1 + next.text.length > budget) break;
    picked.push(next);
    used += 1 + next.text.length;
  }
  return picked;
}

/** Minimal shape of a workbook budget line this module reads. */
export interface AccountSource {
  account_title: string;
  fact_id: string;
  /** Preferred when several lines disagree: the most recent request year. */
  fy?: number | null;
}

/**
 * The account title to cite, and the workbook row it came from. Prefers the
 * highest fiscal year present (the current request), then first-seen order —
 * deterministic either way. Returns null when no line carries an account.
 */
export function pickAccountSource(
  lines: readonly AccountSource[],
): AccountSource | null {
  let best: AccountSource | null = null;
  for (const line of lines) {
    const title = (line.account_title ?? "").trim();
    if (!title || !line.fact_id) continue;
    if (best === null) {
      best = line;
      continue;
    }
    const a = line.fy ?? -Infinity;
    const b = best.fy ?? -Infinity;
    if (a > b) best = line;
  }
  return best;
}

export interface FieldCardInput {
  peBli: string;
  title: string;
  /** Raw org code (humanized here — never rendered raw). */
  org: string;
  exhibitFamily: string;
  /** Workbook budget lines (account title source). */
  budgetLines: readonly AccountSource[];
  /** Distinct J-book project rows on this page (0 when the line has none). */
  projectCount: number;
}

/**
 * Assemble the field-generated sentence. Deterministic, no invention: every
 * clause is a field this page already renders elsewhere.
 *
 *   "F-35 (ATA000) is an Air Force procurement line funded in the Aircraft
 *    Procurement, Air Force account. Its FY2026 J-book detail breaks the line
 *    into 7 projects."
 */
export function buildFieldCard(input: FieldCardInput): WhatItIsFields {
  const org = serviceOrgName(input.org) || "DoD";
  const family = answerFamilyPlain(input.exhibitFamily);
  const article = /^[aeiou]/i.test(org) ? "an" : "a";
  const account = pickAccountSource(input.budgetLines);

  let text = `${input.title} (${input.peBli}) is ${article} ${org} ${family} line`;
  text += account
    ? ` funded in the ${account.account_title.trim()} account.`
    : ` in the FY2026 budget request.`;

  if (input.projectCount > 0) {
    text +=
      input.projectCount === 1
        ? " Its J-book detail breaks the line into 1 project."
        : ` Its J-book detail breaks the line into ${input.projectCount} projects.`;
  }

  return { source: "fields", text, accountFactId: account?.fact_id ?? null };
}

export interface RollupCardInput {
  title: string;
  /** Already-humanized org (rollupProgramRow humanizes service codes). */
  org: string;
  exhibitFamily: string;
  /** Service code from the sidecar (drives the tail wording). */
  serviceOrg: string;
  /** isIngestedServiceOrg(serviceOrg) — injected so this module stays pure. */
  serviceIngested: boolean;
}

/**
 * The rollup card: the template sentence PLUS the tier's existing honest tail
 * (the same distinction the description/justification empty states draw).
 */
export function buildRollupCard(input: RollupCardInput): WhatItIsRollup {
  const org = serviceOrgName(input.org) || "DoD";
  const family = answerFamilyPlain(input.exhibitFamily);
  const article = /^[aeiou]/i.test(org) ? "an" : "a";
  const service = serviceOrgName(input.serviceOrg) || "service";
  const tail = input.serviceIngested
    ? `Summary figures only: the ${service} FY2026 book is ingested but carries no R-2/P-40 detail for this line.`
    : `Summary figures only: the ${service} detail book is not yet ingested.`;
  return {
    source: "rollup",
    text: `${input.title} — ${article} ${org} ${family} line in the FY2026 R-1/P-1 workbooks.`,
    tail,
  };
}

export interface WhatItIsInput extends FieldCardInput {
  tier: "full" | "rollup";
  /** The page's gated dossier, when it has one. */
  dossier: DossierFile | null;
  serviceOrg: string;
  serviceIngested: boolean;
}

/** Decide the card. Dossier wins; rollup keeps its tail; fields otherwise. */
export function whatItIsCard(input: WhatItIsInput): WhatItIsCard {
  const claims = input.dossier
    ? hoistDossierClaims(input.dossier.dossier.what_it_is.claims)
    : [];
  if (claims.length > 0) return { source: "dossier", claims };
  if (input.tier === "rollup") {
    return buildRollupCard({
      title: input.title,
      org: input.org,
      exhibitFamily: input.exhibitFamily,
      serviceOrg: input.serviceOrg,
      serviceIngested: input.serviceIngested,
    });
  }
  return buildFieldCard(input);
}
