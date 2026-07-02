"use client";

/**
 * ProgramAwards — award recipients table.
 *
 * SSG renders first 25 rows. Client expand button fetches the full
 * /json-lite/program_details/{pe_bli}.json and renders the remainder.
 * json-lite is same-origin under /json-lite/ — plain fetch, no useAssetUrl.
 */

import { useState } from "react";
import type { ProgramAward, ProgramDetails } from "@/lib/data";

const CAP = 25;

interface ProgramAwardsProps {
  /** First 25 awards (SSG-rendered) */
  initialAwards: ProgramAward[];
  /** Total award count (from programs.json) */
  totalCount: number;
  /** pe_bli for client-side fetch */
  peBli: string;
  /**
   * Server-rendered coverage/scope note (e.g. <CoverageNote id="company-awards">)
   * shown under the heading. Passed as a node because CoverageNote is a
   * server component and this table is a client component.
   */
  scopeNote?: React.ReactNode;
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    high: "bg-green-100 text-green-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-red-100 text-red-800",
  };
  const cls = colors[confidence.toLowerCase()] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}
      title={`Match confidence: ${confidence}`}
    >
      {confidence}
    </span>
  );
}

function AwardRow({ award }: { award: ProgramAward }) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      <td className="py-2 pr-3 text-foreground">{award.recipient_name}</td>
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
        {award.award_piid}
      </td>
      <td className="py-2">
        <ConfidenceBadge confidence={award.confidence} />
      </td>
    </tr>
  );
}

export function ProgramAwards({
  initialAwards,
  totalCount,
  peBli,
  scopeNote,
}: ProgramAwardsProps) {
  const [expanded, setExpanded] = useState(false);
  const [allAwards, setAllAwards] = useState<ProgramAward[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (totalCount === 0) {
    return null;
  }

  const hasMore = totalCount > CAP;
  const displayedAwards = expanded && allAwards ? allAwards : initialAwards;

  async function handleExpand() {
    if (allAwards) {
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
      setAllAwards(data.awards);
      setExpanded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="awards-heading" className="mb-8">
      <h2
        id="awards-heading"
        className="text-lg font-semibold mb-1 text-foreground"
      >
        Related Awards
      </h2>
      {scopeNote && <div className="mb-2">{scopeNote}</div>}
      {hasMore && !expanded && (
        <p className="text-xs text-muted-foreground mb-3">
          Showing {initialAwards.length} of {totalCount}{" "}award records
          (R&amp;D performer crosswalk — see{" "}
          <a href="/methodology/" className="underline hover:text-foreground">
            methodology
          </a>
          )
        </p>
      )}
      {expanded && (
        <p className="text-xs text-muted-foreground mb-3">
          Showing all {displayedAwards.length} award records
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="text-left py-2 pr-3 font-medium text-muted-foreground">
                Recipient
              </th>
              <th scope="col" className="text-left py-2 pr-3 font-medium text-muted-foreground">
                PIID
              </th>
              <th scope="col" className="text-left py-2 font-medium text-muted-foreground">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {displayedAwards.map((award, i) => (
              <AwardRow key={`${award.award_piid || 'row'}-${i}`} award={award} />
            ))}
          </tbody>
        </table>
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
              : `Show all ${totalCount} awards`}
          </button>
        </div>
      )}
    </section>
  );
}
