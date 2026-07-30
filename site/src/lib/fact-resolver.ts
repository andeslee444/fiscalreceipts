/**
 * fact-resolver.ts — pure logic behind the /fact/{id} permalink page
 * (PM Sprint 1 Task 5, spec §P0-4.1).
 *
 * The deployed route is a Vercel rewrite (`/fact/:id` → `/fact/` — see
 * site/public/vercel.json) in front of the static /fact/ page, whose client
 * component parses the id back out of location.pathname and resolves it from
 * the same cite-shard files the citation panel uses. Full per-fact SSG
 * (134k+ pages) is deliberately deferred — the rewrite + client resolver is
 * the locked Sprint-1 design.
 *
 * ID FORMS: the public id is fid[:8] (the Receipts chip / drawer footer /
 * footnote permalink form); the full id is 16 hex. Any 8..16-hex prefix is
 * accepted and resolved by prefix scan within the id's shard (shard key =
 * first two hex chars, so every prefix ≥2 chars stays inside one shard).
 *
 * COLLISION RULE: fid8 prefixes are NOT guaranteed unique — today's corpus
 * has 2 colliding pairs in 134,896 ids (d00d34ec, c0f55cec). A prefix that
 * matches multiple 16-hex ids returns ALL matches (sorted by factId); the
 * page renders each with a disambiguation note instead of guessing.
 *
 * This module is client-safe and pure (types only from lib/citations.ts).
 */

import type { Citation, CitationsMap } from "@/lib/citations";

/** Accepted permalink id: 8..16 lowercase hex chars (a fid or fid prefix). */
const FACT_ID_RE = /^[0-9a-f]{8,16}$/;

/** `/fact/{id}` pathname (trailing slash tolerated), case-insensitive. */
const FACT_PATH_RE = /\/fact\/([0-9a-fA-F]{8,16})\/?$/;

/**
 * Extract the fact id from a /fact permalink location.
 * The `/fact/{id}` path segment (the rewrite form) wins; `?id=` is the
 * fallback that works without the rewrite (local static serving).
 * Returns the lowercase id, or null when neither carries a valid id.
 */
export function parseFactPermalinkId(
  pathname: string,
  search: string,
): string | null {
  const pathMatch = pathname.match(FACT_PATH_RE);
  if (pathMatch) return pathMatch[1].toLowerCase();

  const query = new URLSearchParams(search).get("id");
  if (query) {
    const id = query.trim().toLowerCase();
    if (FACT_ID_RE.test(id)) return id;
  }
  return null;
}

/** One resolved fact: its full 16-hex id + citation payload. */
export interface FactMatch {
  factId: string;
  citation: Citation;
}

/**
 * Resolve an id (16-hex exact or shorter prefix) against its shard.
 * Returns ALL matches sorted by factId — length 0 (not found), 1 (the
 * normal case), or 2+ (fid-prefix collision; render each with a
 * disambiguation note). A null shard resolves [] — the CALLER must
 * distinguish fetch failure (shard === null) from an honest no-match.
 */
export function resolveFactMatches(
  shard: CitationsMap | null,
  id: string,
): FactMatch[] {
  if (!shard) return [];
  if (id.length === 16) {
    const citation = shard[id];
    return citation ? [{ factId: id, citation }] : [];
  }
  return Object.keys(shard)
    .filter((factId) => factId.startsWith(id))
    .sort()
    .map((factId) => ({ factId, citation: shard[factId] }));
}
