/**
 * cite-shards.ts — lazy citation resolution via sharded slices (Phase 5D).
 *
 * The exporter emits data/site/json/cite-shards/{fact_id[:2]}.json — 256
 * shards that together contain EVERY citations.json row (same row schema as
 * the embedded per-page slices; verified by G8 leg d). prepare-assets.mjs
 * copies them to public/json/cite-shards/, so they are served same-origin at
 * /json/cite-shards/{prefix}.json (NOT under /assets — the citation panel
 * must keep resolving even when the heavy asset bundle is degraded).
 *
 * The citation panel uses resolveCitationFromShards() as its fetch-on-miss
 * path: a fact_id absent from the page's embedded slice fetches its shard,
 * caches it (module-level Map, single-flight per shard), and resolves the
 * citation row. Failures resolve null — callers surface the degraded state;
 * failed fetches are NOT poison-cached, so a later click may retry.
 *
 * This module is client-safe (no server-only imports; types come from
 * lib/citations.ts type re-exports, which erase at runtime).
 */

import type { Citation, CitationsMap } from "@/lib/citations";

/** Same-origin base path for the shard files (copied by prepare-assets). */
export const CITE_SHARD_BASE = "/json/cite-shards";

/** Shard key for a fact_id — its first two hex chars. */
export function shardPrefix(factId: string): string {
  return factId.slice(0, 2);
}

/** Same-origin URL of the shard containing factId. */
export function shardUrl(factId: string): string {
  return `${CITE_SHARD_BASE}/${shardPrefix(factId)}.json`;
}

// Module-level cache: prefix → in-flight/settled shard promise.
// Successful shards (including valid shards that lack a requested fact_id)
// stay cached forever — shard contents are immutable per build. Failed
// fetches remove themselves so the next lookup retries.
const shardCache = new Map<string, Promise<CitationsMap | null>>();

/**
 * Fetch (or reuse) the shard for a two-hex prefix. Single-flight: concurrent
 * callers share one fetch. Resolves null on any failure (HTTP error, network
 * error, malformed JSON) — never throws.
 */
export function fetchCitationShard(prefix: string): Promise<CitationsMap | null> {
  const cached = shardCache.get(prefix);
  if (cached) return cached;

  const promise: Promise<CitationsMap | null> = fetch(
    `${CITE_SHARD_BASE}/${prefix}.json`,
  )
    .then((res) => {
      if (!res.ok) throw new Error(`shard ${prefix} returned HTTP ${res.status}`);
      return res.json() as Promise<CitationsMap>;
    })
    .catch(() => {
      // Drop the failed entry so a later lookup can retry (mirrors the PDF
      // document-cache pattern: rejected loads must not poison the cache).
      if (shardCache.get(prefix) === promise) {
        shardCache.delete(prefix);
      }
      return null;
    });

  shardCache.set(prefix, promise);
  return promise;
}

/**
 * Resolve a citation row by fact_id via its shard.
 * Returns null when the shard is unreachable OR the fact_id has no citation
 * row (zero-amount facts) — callers must treat null as "cannot cite",
 * never as success.
 */
export async function resolveCitationFromShards(
  factId: string,
): Promise<Citation | null> {
  const shard = await fetchCitationShard(shardPrefix(factId));
  if (!shard) return null;
  return shard[factId] ?? null;
}

/** Test hook — clears the module-level shard cache. */
export function __resetCiteShardCache(): void {
  shardCache.clear();
}
