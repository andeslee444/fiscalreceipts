"use client";

/**
 * ProgramMentions — lobbying disclosure mentions.
 *
 * SSG renders first 25 rows. Client expand fetches /json-lite/program_details/{pe_bli}.json.
 *
 * Per plan:
 *   - matched_term chip
 *   - evidence_kind badge (#52) — pe_literal | alias | multi_token; a single
 *     common title word is never sufficient evidence on its own, and every
 *     row now says out loud which tier qualified it (@/lib/evidence)
 *   - snippet + …
 *   - internal /filing/{uuid}/ link (every mention has a filing page) with
 *     the canonical lda.senate.gov link alongside (Phase 5C Goal 2 —
 *     data-filing-mention contract on each row wrapper)
 *   - client_name links to /company/{slug}/ ONLY when family_key is in linkableKeys set
 *   - else plain text
 *
 * DECLARED DEFAULT SORT (§P1-7): filing year DESC, then client, then program
 * title / pe_bli, then filing uuid — set in the exporter's
 * fct_program_lobbying query, NOT re-sorted here (same reason as
 * ProgramAwards: only the first 25 rows exist until the reader expands, so a
 * client sort would order a prefix of a differently-ordered whole). 240 of
 * 244 of these lists were previously in incidental order, which also meant an
 * arbitrary 25 mentions were the ones that shipped in the static HTML.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProgramDetails } from "@/lib/data";
import { PeText } from "@/components/pe-text";
import { formatCount } from "@/lib/format";
import { tidySnippet } from "@/lib/snippet";
import { evidenceKindLabel, evidenceKindTitle } from "@/lib/evidence";

// Inline ProgramMention type to avoid importing server-only data.ts
// Note: family_key can be null (dangling entity — 2,781 / 32,780 lobbying rows)
interface ProgramMention {
  client_name: string;
  description_snippet: string;
  /**
   * (#52) which evidence tier qualified this row: 'pe_literal' | 'alias' |
   * 'multi_token'. A single common title word is never sufficient on its
   * own — see @/lib/evidence for the rendered label.
   */
  evidence_kind: string;
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
   * Array of family_keys that are linkable (present in entities_top.json).
   * Passed as string[] (not Set) because Sets are not serializable across
   * the Next.js App Router server→client boundary.
   */
  linkableKeys: string[];
  /**
   * PE token → program URL for tokens appearing in this page's mentions
   * (Phase 5F §2a universal linking). Server-computed against the full PE
   * page set; serializable (plain record). Tokens outside the map stay
   * plain text.
   */
  peHrefs?: Record<string, string>;
}

function MentionRow({
  mention,
  linkableKeys,
  peSet,
  peHrefs,
}: {
  mention: ProgramMention;
  linkableKeys: Set<string>;
  peSet: { has(pe: string): boolean };
  peHrefs: Record<string, string>;
}) {
  const humanUrl = humanLdaUrl(mention.filing_url);
  // family_key can be null (dangling entity) — treat as not linkable
  const isLinkable =
    mention.family_key != null && linkableKeys.has(mention.family_key);
  const companySlug = mention.family_key
    ? mention.family_key.toLowerCase().replace(/ /g, "-")
    : "";

  return (
    <div
      data-filing-mention
      data-sort-value={String(mention.filing_year)}
      className="border-b border-border/50 py-3"
    >
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

        {/* Matched term chip — links when the term IS another program's PE
            (Phase 5F §2a; self-references stay plain via the peHrefs map). */}
        {peHrefs[mention.matched_term] ? (
          <a
            href={peHrefs[mention.matched_term]}
            className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium hover:bg-blue-200 transition-colors"
            title={`Open program page for ${mention.matched_term}`}
          >
            {mention.matched_term}
          </a>
        ) : (
          <span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">
            {mention.matched_term}
          </span>
        )}

        {/* Filing year */}
        <span className="text-xs text-muted-foreground">{mention.filing_year}</span>

        {/* (#52) evidence tier, on every row — the machine-checked reason
            this row exists, not just what it matched on. A single common
            title word is never sufficient on its own; see @/lib/evidence. */}
        <span
          data-evidence-kind={mention.evidence_kind ?? ""}
          title={evidenceKindTitle(mention.evidence_kind)}
          className="inline-block px-1.5 py-0.5 rounded border border-border text-xs text-muted-foreground"
        >
          {evidenceKindLabel(mention.evidence_kind)}
        </span>
      </div>

      {/* Snippet — PE tokens with pages become internal links (§2a) */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {/* The ellipsis used to be appended blind, so a snippet the exporter
            had already cut mid-word rendered as "…Defe…". tidySnippet cuts
            back to the last whole word first. */}
        {mention.description_snippet && (
          <PeText
            text={tidySnippet(mention.description_snippet)}
            peSet={peSet}
          />
        )}
      </p>

      {/* Filing links — internal filing page + canonical LDA source */}
      <div className="mt-1 flex items-center gap-3 text-xs">
        <Link
          href={`/filing/${mention.filing_uuid}/`}
          className="text-primary hover:underline"
        >
          View filing &rarr;
        </Link>
        {humanUrl && (
          <a
            href={humanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground underline decoration-dotted hover:text-foreground"
          >
            lda.senate.gov ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function ProgramMentions({
  initialMentions,
  totalCount,
  peBli,
  linkableKeys,
  peHrefs = {},
}: ProgramMentionsProps) {
  // Reconstruct as Set inside the client component for O(1) lookup.
  // The prop arrives as string[] because Sets cannot cross the server→client boundary.
  const linkableKeysSet = useMemo(() => new Set(linkableKeys), [linkableKeys]);
  // PE membership for snippet linkification (from the serializable map).
  const peSet = useMemo(
    () => ({ has: (pe: string) => pe in peHrefs }),
    [peHrefs],
  );

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
      // full details file ~tens of KB; acceptable; revisit if payloads grow
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
          ? `Showing ${formatCount(initialMentions.length)} of ${formatCount(totalCount)}`
          : `${formatCount(displayedMentions.length)} mention${displayedMentions.length !== 1 ? "s" : ""}`}
        {" "}from the Senate LDA disclosure database.
      </p>

      {/* §P1-7 sort contract (gate 24 leg f) — declared order, set upstream
          in the fct_program_lobbying ORDER BY. */}
      <div data-sort-table="program-mentions" data-sort-order="filing_year:desc">
        {displayedMentions.map((mention, i) => (
          <MentionRow
            key={`${mention.filing_uuid}-${mention.matched_term}-${i}`}
            mention={mention}
            linkableKeys={linkableKeysSet}
            peSet={peSet}
            peHrefs={peHrefs}
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
