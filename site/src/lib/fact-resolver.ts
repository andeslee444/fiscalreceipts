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

// ── Sidecar figure lookup (visual-judge M2 — semantic labels) ───────────────
//
// A cold-loaded /fact/{id} shows only what the citation payload carries
// ("$5,247.070 million") — no program/FY/measure/basis. When the payload has
// pe_bli, the page fetches the program sidecar the site already serves
// (/json-lite/program_details/{pe}.json — the same public path
// program-awards/program-mentions fetch) and locates the figure whose
// fid/public_id matches. These helpers are the pure half: defensive JSON
// traversal, NO fabrication — an id with no sidecar figure resolves null and
// the page renders the citation payload alone.

/** The declared figure context a sidecar carries for one fact id. */
export interface SidecarFigureContext {
  fy: number | string | null;
  measure: string | null;
  basis: string | null;
  edition: number | null;
  units: string | null;
  value: number | null;
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Rec)
    : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** True when the row's fid/fact_id (or public_id) identifies factId. */
function idMatches(row: Rec, factId: string): boolean {
  const fid = str(row.fid) ?? str(row.fact_id);
  if (fid === factId) return true;
  const publicId = str(row.public_id);
  return publicId !== null && publicId === factId.slice(0, 8);
}

function contextFrom(
  row: Rec,
  overrides: Partial<SidecarFigureContext> = {},
): SidecarFigureContext {
  return {
    fy: num(row.fy) ?? str(row.fy),
    measure: str(row.measure),
    basis: str(row.basis),
    edition: num(row.edition),
    units: str(row.units),
    value: num(row.value) ?? num(row.v),
    ...overrides,
  };
}

/**
 * Locate the figure matching factId across the sidecar's figure collections
 * (summary cards → decade series → workbook budget lines → J-book details →
 * declared reconciliation members → book diff). Sources that structurally
 * omit units get the dataset's declared units (the SAME declaration the
 * rendering components make: decade points and the book diff are USD
 * thousands, reconciliation members carry their own units). Returns null
 * when no collection carries the id — the caller renders the citation
 * payload alone, never a guessed context.
 */
export function findSidecarFigure(
  sidecar: unknown,
  factId: string,
): SidecarFigureContext | null {
  const root = asRec(sidecar);
  if (!root) return null;
  const summary = asRec(root.summary);
  const summaryEdition = summary ? num(summary.edition) : null;

  // 1 · summary.cards — the union cards (fy/measure/basis/units/value/edition)
  for (const c of asArr(summary?.cards)) {
    const row = asRec(c);
    if (row && idMatches(row, factId)) return contextFrom(row);
  }

  // 2 · decade_series.{actuals,enacted,request} — USD thousands by dataset
  // contract (fct_decade_series; decade-trajectory.tsx declares the same).
  const decade = asRec(root.decade_series);
  for (const kind of ["actuals", "enacted", "request"]) {
    for (const p of asArr(decade?.[kind])) {
      const row = asRec(p);
      if (row && idMatches(row, factId))
        return contextFrom(row, { units: "USD thousands" });
    }
  }

  // 3 · budget_lines — workbook rows (amount_thousands + declared units)
  for (const b of asArr(root.budget_lines)) {
    const row = asRec(b);
    if (row && idMatches(row, factId))
      return contextFrom(row, { value: num(row.amount_thousands) });
  }

  // 4 · details — R-2/P-40 J-book rows (amount_millions + declared units)
  for (const d of asArr(root.details)) {
    const row = asRec(d);
    if (row && idMatches(row, factId))
      return contextFrom(row, { value: num(row.amount_millions) });
  }

  // 5 · summary.reconciliation — both declared members; entry carries
  // fy/measure, member carries value/units, basis is the member's side.
  for (const r of asArr(summary?.reconciliation)) {
    const entry = asRec(r);
    if (!entry) continue;
    for (const [side, basis] of [
      ["toa", "toa"],
      ["detail", "jbook-detail"],
    ] as const) {
      const member = asRec(entry[side]);
      if (member && idMatches(member, factId)) {
        return contextFrom(member, {
          fy: num(entry.fy) ?? str(entry.fy),
          measure: str(entry.measure),
          basis,
          edition: summaryEdition,
        });
      }
    }
  }

  // 6 · book_diff — the minted request-vs-actuals delta (USD thousands, the
  // same declaration decade-trajectory.tsx renders it with).
  const bookDiff = asRec(root.book_diff);
  if (bookDiff && idMatches(bookDiff, factId)) {
    return contextFrom(bookDiff, {
      units: "USD thousands",
      value: num(bookDiff.delta),
    });
  }

  return null;
}

/**
 * Program title for a PE from the search-quick payload ({docs: [...]}) —
 * the public /json-lite/search_quick.json the search UI already fetches.
 * Null when absent (the header renders the code alone — no fabrication).
 */
export function programTitleFromQuick(
  quick: unknown,
  peBli: string,
): string | null {
  const root = asRec(quick);
  for (const d of asArr(root?.docs)) {
    const row = asRec(d);
    if (!row) continue;
    if (str(row.kind) === "program" && str(row.pe_bli) === peBli) {
      return str(row.title);
    }
  }
  return null;
}
