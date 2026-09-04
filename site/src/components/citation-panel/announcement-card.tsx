"use client";

/**
 * announcement-card.tsx — Display card for announcement citations (#71).
 *
 * The evidence behind an 'announcement+lexicon' budget→award link: a
 * defense.gov daily Contracts article that names BOTH the contract number and
 * the program. Shows:
 *   - The article link (the durable public artifact)
 *   - The Wayback snapshot of the copy the verification actually read, when
 *     one exists — the article defense.gov serves today may differ
 *   - That copy's sha256, so the archived bytes are checkable
 *   - What the citation does and does not assert
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
}

interface AnnouncementCardProps {
  url: string;
  body: AnnouncementBody;
}

export function AnnouncementCard({ url, body }: AnnouncementCardProps) {
  const sha = body.sha256 ?? null;

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

      <p className="text-xs text-muted-foreground leading-relaxed">
        The announcement names both this contract and this program; the link to
        the budget line is an inference from that naming, not a figure quoted
        from the announcement. Contract dollars come from award data, not from
        this article.
      </p>
    </div>
  );
}
