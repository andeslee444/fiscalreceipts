"use client";

/**
 * ProgramMentions — lobbying disclosure mentions.
 *
 * SSG renders first 25 rows. Client expand fetches /json-lite/program_details/{pe_bli}.json.
 *
 * Per plan:
 *   - matched_term chip
 *   - snippet + …
 *   - human filing link via humanLdaUrl(filing_url)
 *   - client_name links to /company/{slug}/ ONLY when family_key is in linkableKeys set
 *   - else plain text
 */

import { useState } from "react";
import type { ProgramDetails } from "@/lib/data";

// Inline ProgramMention type to avoid importing server-only data.ts
// Note: family_key can be null (dangling entity — 2,781 / 32,780 lobbying rows)
interface ProgramMention {
  client_name: string;
  description_snippet: string;
  family_key: string | null;
  filing_url: string;
  filing_uuid: string;
  filing_year: string;
  matched_term: string;
}

/** Derive the human-readable LDA filing URL from the API URL. */
function humanLdaUrl(officialUrl: string | null | undefined): string | null {
  if (!officialUrl) return null;
  const match = officialUrl.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  if (!match) return null;
  const uuid = match[0].toLowerCase();
  return `https://lda.senate.gov/filings/public/filing/${uuid}/print/`;
}

const CAP = 25;

interface ProgramMentionsProps {
  /** First 25 mentions (SSG-rendered) */
  initialMentions: ProgramMention[];
  /** Total mention count */
  totalCount: number;
  /** pe_bli for client-side fetch */
  peBli: string;
  /**
   * Set of family_keys that are linkable (present in entities_top.json).
   * Passed from the server component to avoid re-fetching.
   */
  linkableKeys: Set<string>;
}

function MentionRow({
  mention,
  linkableKeys,
}: {
  mention: ProgramMention;
  linkableKeys: Set<string>;
}) {
  const humanUrl = humanLdaUrl(mention.filing_url);
  // family_key can be null (dangling entity) — treat as not linkable
  const isLinkable =
    mention.family_key != null && linkableKeys.has(mention.family_key);
  const companySlug = mention.family_key
    ? mention.family_key.toLowerCase().replace(/ /g, "-")
    : "";

  return (
    <div className="border-b border-border/50 py-3">
      <div className="flex flex-wrap items-start gap-2 mb-1">
        {/* Client name */}
        <span className="font-medium text-foreground text-sm">
          {isLinkable ? (
            <a
              href={`/company/${encodeURIComponent(companySlug)}/`}
              className="text-primary hover:underline"
            >
              {mention.client_name}
            </a>
          ) : (
            mention.client_name
          )}
        </span>

        {/* Matched term chip */}
        <span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">
          {mention.matched_term}
        </span>

        {/* Filing year */}
        <span className="text-xs text-muted-foreground">{mention.filing_year}</span>
      </div>

      {/* Snippet */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {mention.description_snippet}
        {mention.description_snippet && !mention.description_snippet.endsWith("…") && (
          <span aria-hidden="true">…</span>
        )}
      </p>

      {/* Filing link */}
      {humanUrl && (
        <a
          href={humanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline mt-1 inline-block"
        >
          View filing ↗
        </a>
      )}
    </div>
  );
}

export function ProgramMentions({
  initialMentions,
  totalCount,
  peBli,
  linkableKeys,
}: ProgramMentionsProps) {
  const [expanded, setExpanded] = useState(false);
  const [allMentions, setAllMentions] = useState<ProgramMention[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (totalCount === 0) {
    return null;
  }

  const hasMore = totalCount > CAP;
  const displayedMentions =
    expanded && allMentions ? allMentions : initialMentions;

  async function handleExpand() {
    if (allMentions) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/json-lite/program_details/${peBli}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: ProgramDetails = await resp.json();
      setAllMentions(data.mentions);
      setExpanded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="mentions-heading" className="mb-8">
      <h2
        id="mentions-heading"
        className="text-lg font-semibold mb-1 text-foreground"
      >
        Lobbying Mentions
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        {hasMore && !expanded
          ? `Showing ${initialMentions.length} of ${totalCount}`
          : `${displayedMentions.length} mention${displayedMentions.length !== 1 ? "s" : ""}`}
        {" "}from the Senate LDA disclosure database.
      </p>

      <div>
        {displayedMentions.map((mention, i) => (
          <MentionRow
            key={`${mention.filing_uuid}-${i}`}
            mention={mention}
            linkableKeys={linkableKeys}
          />
        ))}
      </div>

      {hasMore && !expanded && (
        <div className="mt-3">
          {error && (
            <p className="text-xs text-red-600 mb-2">
              Failed to load: {error}
            </p>
          )}
          <button
            onClick={handleExpand}
            disabled={loading}
            className="text-sm text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Loading…"
              : `Show all ${totalCount} mentions`}
          </button>
        </div>
      )}
    </section>
  );
}
