"use client";

/**
 * fact-resolver.tsx — client resolver for /fact/{id} permalinks
 * (PM Sprint 1 Task 5, spec §P0-4.1).
 *
 * Design (locked): the deployed route is a Vercel rewrite (`/fact/:id` →
 * `/fact/`, site/public/vercel.json) in front of this single static page;
 * the id is parsed back out of location.pathname (`?id=` fallback works
 * without the rewrite) and resolved from the SAME cite-shard files the
 * citation panel uses (/json/cite-shards/{id[:2]}.json). Full per-fact SSG
 * is deferred. Accepts 8-hex public ids (prefix scan; ALL matches render
 * when a prefix collides — 2 colliding fid8 pairs exist in today's corpus)
 * and 16-hex full ids (exact lookup).
 *
 * Renders exactly what the citation payload provides — value with unit,
 * document title, locator, full SHA-256, retrieval date, official-source
 * link, hosted-PDF link, derived formula + input permalinks, and (when the
 * payload carries pe_bli) an "Appears on" /program/{pe}/#fact-{id} parent
 * link. Fields the payload lacks are omitted, never guessed.
 *
 * SUPERSEDE DISPLAY (spec §P0-4.5): deliberately ABSENT. Citation payloads
 * carry no superseded flag today — superseded warehouse rows are fenced out
 * of the export entirely (export_site.py `where not … superseded`), so a
 * resolvable fact id is by construction current. When the exporter starts
 * shipping superseded facts WITH a marker + successor pointer, render the
 * correction + link here; until then there is nothing honest to show.
 */

import React, { useContext, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { CitationPanelProvider } from "@/components/citation-panel";
import { CitationPanelContext } from "@/components/cite";
import { useAssetUrl } from "@/components/asset-config";
import { fetchCitationShard, shardPrefix } from "@/lib/cite-shards";
import {
  parseFactPermalinkId,
  resolveFactMatches,
  type FactMatch,
} from "@/lib/fact-resolver";
import {
  footnoteInputFromCitation,
  type FootnoteInput,
} from "@/lib/footnote";
import type { Citation } from "@/lib/citations";
import { SITE_NAME } from "@/lib/site";

// ── Resolution state machine ────────────────────────────────────────────────

type ResolverState =
  | { status: "idle" } // no id in the URL — explainer only (also the SSG state)
  | { status: "loading"; id: string }
  | { status: "resolved"; id: string; matches: FactMatch[] }
  | { status: "error"; id: string }; // shard unreachable — degraded, never fake

export function FactResolver() {
  const [state, setState] = useState<ResolverState>({ status: "idle" });

  useEffect(() => {
    const id = parseFactPermalinkId(
      window.location.pathname,
      window.location.search,
    );
    if (!id) return; // stay on the explainer
    let cancelled = false;
    // Deferred one microtask so the effect body performs no synchronous
    // setState (react-hooks/set-state-in-effect); the functional updater
    // guards the race — a shard resolution that somehow lands first is never
    // clobbered back to "loading".
    queueMicrotask(() => {
      if (cancelled) return;
      setState((prev) =>
        prev.status === "idle" ? { status: "loading", id } : prev,
      );
    });
    fetchCitationShard(shardPrefix(id)).then((shard) => {
      if (cancelled) return;
      if (!shard) {
        setState({ status: "error", id });
        return;
      }
      setState({ status: "resolved", id, matches: resolveFactMatches(shard, id) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = state.status === "resolved" ? state.matches : [];
  const citationsMap = Object.fromEntries(
    matches.map((m) => [m.factId, m.citation]),
  );

  return (
    <CitationPanelProvider citations={citationsMap}>
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Fact permalink</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Every figure on {SITE_NAME} carries a permanent fact id linking it to
          its source receipt.
        </p>

        {state.status === "loading" && (
          <div
            data-testid="fact-loading"
            className="animate-pulse space-y-2 mb-10"
            aria-label="Resolving fact"
          >
            <div className="h-2 w-3/5 rounded bg-border" aria-hidden="true" />
            <div className="h-2 w-full rounded bg-border" aria-hidden="true" />
            <p className="pt-1 text-xs text-muted-foreground">
              Resolving fact #{state.id}…
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div
            data-testid="fact-error"
            role="alert"
            className="mb-10 rounded-lg border border-destructive/40 bg-destructive/5 p-5"
          >
            <p className="text-sm font-medium">
              Couldn&apos;t load the citation data for fact{" "}
              <span className="font-mono">#{state.id}</span>.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check your connection and reload — the underlying receipt has not
              gone anywhere.
            </p>
          </div>
        )}

        {state.status === "resolved" && matches.length === 0 && (
          <div
            data-testid="fact-not-found"
            className="mb-10 rounded-lg border border-border bg-muted/40 p-5"
          >
            <p className="text-sm font-medium">
              No fact <span className="font-mono">#{state.id}</span> in the
              current corpus.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check the id for typos (8 or 16 hex characters). Fact ids appear
              in Receipts-mode chips, the citation drawer footer, and copied
              footnotes.
            </p>
          </div>
        )}

        {state.status === "resolved" && matches.length > 1 && (
          <p
            data-testid="fact-collision-note"
            className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            {matches.length} facts share the 8-character prefix{" "}
            <span className="font-mono">#{state.id}</span> — all are shown
            below. Use the full 16-character id to disambiguate.
          </p>
        )}

        {matches.map((m) => (
          <FactCard key={m.factId} factId={m.factId} citation={m.citation} />
        ))}

        <Explainer />
      </div>
    </CitationPanelProvider>
  );
}

// ── Explainer (the bare-/fact/ content; also the SSG-rendered state) ────────

function Explainer() {
  return (
    <section data-testid="fact-explainer" className="mt-4 space-y-3">
      <h2 className="text-lg font-semibold">How fact permalinks work</h2>
      <p className="text-sm text-muted-foreground leading-6">
        <span className="font-mono">/fact/{"{id}"}</span> resolves a fact id to
        the receipt behind it: the recorded value, the official source
        document, the exact page or cells, the document&apos;s SHA-256, and
        the retrieval date. Both the short public id (8 characters, shown on
        Receipts-mode chips and in the citation drawer) and the full
        16-character id resolve.
      </p>
      <p className="text-sm text-muted-foreground leading-6">
        Corrections follow a supersede-not-delete policy — see the{" "}
        <a href="/about/" className="underline underline-offset-2">
          corrections policy
        </a>{" "}
        and{" "}
        <a href="/methodology/" className="underline underline-offset-2">
          methodology
        </a>
        .
      </p>
    </section>
  );
}

// ── FactCard — one resolved fact ────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  jbook_pdf: "Budget Justification PDF",
  workbook: "Budget Workbook",
  lda_filing: "LDA Lobbying Filing",
  derived: "Derived Figure",
  usaspending: "USAspending Query",
  state_soql: "State Open Data Query",
  state_file: "State Source File",
  jbook_narrative: "J-book Narrative",
};

function FactCard({
  factId,
  citation,
}: {
  factId: string;
  citation: Citation;
}) {
  const { openPanel } = useContext(CitationPanelContext);
  const assetUrl = useAssetUrl();

  // One derivation for value/title/locator/permalink — the SAME builder the
  // copy-as-footnote path uses (lib/footnote.ts), so this page can never
  // disagree with the footnote about what the payload says. No figure
  // context exists here, so fy/row-name are honestly absent.
  const input: FootnoteInput = footnoteInputFromCitation(citation, factId, {
    origin: window.location.origin,
  });

  // Parent link — ONLY when the payload itself carries pe_bli (P0-4 "appears
  // on"). Today's shards do not carry it yet; the exporter now emits it, so
  // the link lights up at the next export without a site change.
  const peBli = (citation as { pe_bli?: string | null }).pe_bli ?? null;

  const kindLabel = KIND_LABELS[citation.kind] ?? citation.kind;

  return (
    <article
      data-testid="fact-card"
      className="mb-6 rounded-lg border border-border p-5"
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
          {kindLabel}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          fact #{factId.slice(0, 8)}
        </span>
      </header>

      {input.valueText && (
        <p className="mb-3 text-2xl font-semibold tracking-tight">
          {input.valueText}
        </p>
      )}

      <dl className="space-y-1.5 text-sm">
        <Row label="Full fact id">
          <span className="font-mono">{factId}</span>{" "}
          <CopyButton text={factId} label="Copy full fact id" />
        </Row>
        <Row label="Permalink">
          <span className="font-mono break-all">{input.permalink}</span>{" "}
          <CopyButton text={input.permalink} label="Copy permalink" />
        </Row>
        {input.docTitle && (
          <Row label="Document">
            {input.docTitle}
            {input.publisher ? ` — ${input.publisher}` : null}
          </Row>
        )}
        {input.locator && (input.locator.exhibit || input.locator.page != null) && (
          <Row label="Location">
            {[
              input.locator.exhibit,
              input.locator.page != null ? `p. ${input.locator.page}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </Row>
        )}
        {input.locator && (input.locator.sheet || input.locator.cells) && (
          <Row label="Location">
            {[
              input.locator.sheet ? `sheet ${input.locator.sheet}` : null,
              input.locator.cells ? `cells ${input.locator.cells}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </Row>
        )}
        {input.formula && <Row label="Derived as">{input.formula}</Row>}
        {(input.inputFactIds?.length ?? 0) > 0 && (
          <Row label="Inputs">
            <span className="flex flex-wrap gap-1.5">
              {input.inputFactIds!.map((fid) => (
                <a
                  key={fid}
                  href={`/fact/${fid.slice(0, 8)}`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs underline underline-offset-2"
                >
                  #{fid.slice(0, 8)}
                </a>
              ))}
            </span>
          </Row>
        )}
        {citation.sha256 && (
          <Row label="SHA-256">
            <span className="font-mono text-xs break-all">
              {citation.sha256}
            </span>{" "}
            <CopyButton text={citation.sha256} label="Copy SHA-256" />
          </Row>
        )}
        {input.retrievedAt && <Row label="Retrieved">{input.retrievedAt}</Row>}
        {peBli && (
          <Row label="Appears on">
            <a
              href={`/program/${peBli}/#fact-${factId}`}
              className="underline underline-offset-2"
            >
              /program/{peBli}/
            </a>
          </Row>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
        <button
          type="button"
          data-testid="fact-view-source"
          onClick={() => openPanel(factId)}
          className="rounded-md border border-border px-2.5 py-1.5 font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          View source excerpt
        </button>
        {citation.official_url && (
          <a
            href={citation.official_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            Official source
            <span className="sr-only">(opens in new tab)</span>
          </a>
        )}
        {citation.hosted_pdf_url && (
          <a
            href={assetUrl(citation.hosted_pdf_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            Hosted PDF
            {citation.page_number != null ? ` (page ${citation.page_number})` : ""}
            <span className="sr-only">(opens in new tab)</span>
          </a>
        )}
      </div>
    </article>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// ── CopyButton — small clipboard affordance (matches the panel's pattern) ───

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — leave the text selectable instead.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className="inline-flex translate-y-[1px] items-center text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
