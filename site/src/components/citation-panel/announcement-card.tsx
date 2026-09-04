"use client";

/**
 * announcement-card.tsx — Display card for announcement citations (#71).
 *
 * The evidence behind an 'announcement+lexicon' budget→award link: a
 * defense.gov daily Contracts article naming the contract, matched to a
 * program on a recorded basis. Shows:
 *   - The article link (the durable public artifact)
 *   - The Wayback snapshot of the copy the verification actually read, when
 *     one exists — the article defense.gov serves today may differ
 *   - That copy's sha256, so the archived bytes are checkable
 *   - HOW the program was matched, in words (match_basis)
 *   - The link's method and confidence tier (formula), as the derived row
 *     this replaced used to state
 *
 * The match basis is load-bearing, not decoration. Only 'exact-name' means
 * the announcement named the program as written — 190 of the 708 published
 * links (re-measured 2026-09-04). The other 518 (194 matched through a
 * normalised designator or an LLM judgement, 324 with NO recorded basis at
 * all) must not be shown a card claiming the announcement named the program:
 * for those 324 the card says "basis not recorded", which is the honest
 * answer and not a weaker synonym for exact-name.
 *
 * Archive fields are optional on purpose: not every article was archived, and
 * this card renders the absence rather than inventing a snapshot.
 */

import React from "react";
import { ExternalLink } from "lucide-react";

export interface AnnouncementBody {
  article_id: string;
  archive_url?: string | null;
  sha256?: string | null;
  /** How the announcement's program text was matched to this PE; null when
   *  the verification packet recorded no basis. */
  match_basis?: string | null;
}

interface AnnouncementCardProps {
  url: string;
  body: AnnouncementBody;
  /** The link's provenance sentence (crosswalk method + confidence tier),
   *  carried over from the derived row this citation replaced. */
  formula?: string | null;
}

/**
 * Reader-facing phrase for each match basis the pipeline emits. Every phrase
 * completes the sentence "Matched by: …".
 *
 * An unrecognised token renders VERBATIM rather than falling back to a
 * flattering default — a new basis added upstream must show up as an odd
 * string a reader can report, never be silently relabelled as an exact match.
 */
const MATCH_BASIS_PHRASES: Record<string, string> = {
  "exact-name": "exact program name",
  "designator-normalized": "normalized designator",
  "llm-alias": "LLM-judged alias",
  "llm-designator-variant": "LLM-judged designator variant",
  "llm-description": "LLM-judged description",
  "subaward-description-exact": "exact subaward description",
};

export function matchBasisPhrase(basis: unknown): string {
  const token = typeof basis === "string" ? basis.trim() : "";
  if (!token) return "basis not recorded";
  return MATCH_BASIS_PHRASES[token] ?? token;
}

export function AnnouncementCard({ url, body, formula }: AnnouncementCardProps) {
  const sha = body.sha256 ?? null;
  const basisPhrase = matchBasisPhrase(body.match_basis);

  return (
    <div
      className="space-y-3"
      data-cite-kind="announcement"
      data-testid="announcement-card"
    >
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
          Source
        </span>
        <p className="text-sm font-medium">Official DoD contract announcement</p>
      </div>

      {/* The article — prominent action */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="announcement-article-link"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
      >
        <ExternalLink
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
          aria-hidden="true"
        />
        <span>defense.gov article {body.article_id}</span>
        <span className="sr-only">(opens in new tab)</span>
      </a>

      {/* Raw URL co-cited */}
      <div className="space-y-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Announcement URL
        </span>
        <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed">
          {url}
        </p>
      </div>

      {/* Archived copy — the bytes that were actually read */}
      {body.archive_url ? (
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block">
            Archived copy
          </span>
          <a
            href={body.archive_url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="announcement-archive-link"
            className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2 hover:no-underline"
          >
            Wayback snapshot
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in new tab)</span>
          </a>
          {sha && (
            <p
              className="font-mono text-xs text-muted-foreground break-all"
              data-testid="announcement-sha256"
            >
              sha256 {sha}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No archived copy of this article was captured — the live page above is
          the only source.
        </p>
      )}

      {/* How the program was matched — the claim this citation actually
          supports, which is weaker than "the announcement names it" for every
          basis except the exact one. */}
      <div className="space-y-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block">
          Match basis
        </span>
        <p className="text-sm" data-testid="announcement-match-basis">
          Matched by: {basisPhrase}
        </p>
      </div>

      {/* Method + confidence tier, as the derived row this replaced stated */}
      {formula && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
            Link
          </span>
          <p
            className="rounded bg-muted px-2.5 py-2 font-mono text-xs text-foreground break-words leading-relaxed"
            data-testid="announcement-formula"
          >
            {formula}
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        The announcement names this contract, and this award is linked to the
        program on the basis above — an inference from that match, not a figure
        quoted from the announcement. Contract dollars come from award data,
        not from this article.
      </p>
    </div>
  );
}
