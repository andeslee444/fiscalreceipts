"use client";

/**
 * search.ts — Tier-1 quick search via MiniSearch
 *
 * Builds a MiniSearch index once client-side from /json-lite/search_quick.json.
 * Fields: title, pe_bli, org. Stored: title, url, kind, dollars.
 * Options: prefix:true, fuzzy:0.2, boost:{title:2}.
 * Results grouped by kind: Programs / Companies / Agencies / Pages.
 * Recents stored in localStorage (max 5).
 */

import MiniSearch from "minisearch";

import {
  aliasHitsForQuery,
  aliasMatchesForQuery,
  aliasesForPeBli,
} from "./aliases";

// "static", "feed", "district" and "alias" are emitted by export_site's
// search_quick.json; everything that isn't program/company/agency groups
// under "pages" (see quickSearch below).
export type SearchDocKind =
  | "program"
  | "company"
  | "agency"
  | "page"
  | "static"
  | "feed"
  | "district"
  | "alias";

export interface SearchDoc {
  id: string;
  kind: SearchDocKind;
  title: string;
  pe_bli?: string;
  org?: string;
  url: string;
  dollars?: number | null;
}

export interface SearchResult {
  id: string;
  kind: SearchDocKind;
  title: string;
  url: string;
  dollars?: number | null;
  /** Highlighted HTML string for the title */
  titleHtml: string;
  score: number;
  /** Curated "also known as" names (§P1-4 alias table) — chip source. */
  aka?: string[];
  /**
   * The alias the QUERY equalled, when it did ("Sentinel"). Present so ⌘K and
   * the /programs/ filter render the identical chip string through
   * lib/aliases aliasChipText — the two used to word the same fact
   * differently, and the table's version named the matched alias twice.
   */
  akaMatched?: string;
}

export interface GroupedResults {
  programs: SearchResult[];
  companies: SearchResult[];
  agencies: SearchResult[];
  pages: SearchResult[];
}

// 2 per group keeps tier-1 results compact (max 8 total across 4 groups)
// so pagefind (tier-2) results appear within the gate's top-5 window for
// deep-tier eval cases. For quick-tier cases, the expected result is still
// within the top-3 (position 0-1 in its group).
const MAX_PER_GROUP = 2;
const RECENTS_KEY = "govbudget-search-recents";
const MAX_RECENTS = 5;

// ── Kind → group label (Fix H1, 2026-07-28) ──────────────────────────────────
// Proper category labels — the old `kind + "s"` naive pluralization emitted
// "Companys" / "Agencys" in the palette's per-row category line.

const KIND_GROUP_LABELS: Record<string, string> = {
  program: "Programs",
  company: "Companies",
  agency: "Agencies",
  district: "Districts",
  alias: "Alias",
  // page-like kinds all group under "Pages" in the palette
  page: "Pages",
  static: "Pages",
  feed: "Pages",
};

/** Display label for a search-doc kind. Unknown kinds fall back to the
 *  capitalized kind itself — never a naive `+ "s"` plural. */
export function kindGroupLabel(kind: string): string {
  return KIND_GROUP_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

// ── Alphanumeric normalization (§P1-4) ───────────────────────────────────────
// Users type "F35", "B21", "KC46", "F15EX"; titles say "F-35", "B-21 Raider",
// "KC-46A". Each doc gets a synthetic `title_norm` field with per-word
// punctuation stripped ("F-35 Modifications" → "f35 modifications") so the
// collapsed form is an EXACT index token — while the original title field
// keeps all existing match behavior.

/** Word-level normalization: lowercase, strip non-alphanumerics inside each
 *  whitespace-separated word. "F-35 C2D2" → "f35 c2d2".
 *
 *  Null-tolerant since Wave 5, and the reason is a blast radius nobody would
 *  have chosen. Two program docs shipped with `title: null` (Navy P-40 lines
 *  the FY2026 P-1 display omits, so the mart had no workbook name for them);
 *  `null.toLowerCase()` threw inside buildIndex()'s addAll, buildIndex()
 *  rejected, quickSearch() rejected, and the palette's tier-1 effect caught
 *  the rejection and rendered an empty list — for EVERY query on the site.
 *  Search silently degraded to pagefind-only and gate 5 fell to 49%.
 *
 *  The data defect is fixed at source (dim_programs falls back to the
 *  J-book's own LineItemTitle), so this is not papering over it. It is the
 *  refusal to let one missing string take down the index: a doc with no
 *  title still gets indexed on its pe_bli and org and stays reachable. */
export function normalizeAlnumWords(s: string | null | undefined): string {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join(" ");
}

type IndexedDoc = SearchDoc & { title_norm: string };

// ── Module-level singleton ────────────────────────────────────────────────────

let indexPromise: Promise<MiniSearch<IndexedDoc>> | null = null;

// url → title map over the SAME quick-index docs (Fix H2, 2026-07-28): lets
// deep-search (pagefind) hits display the page's real title instead of its
// raw URL path when the URL is a quick-index doc (e.g. /program/<pe>/).
let urlTitles: Map<string, string> | null = null;

// id → doc map — alias injection (§P1-4) resolves "p:{peBli}" targets here.
let docsById: Map<string, SearchDoc> | null = null;

function buildIndex(): Promise<MiniSearch<IndexedDoc>> {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const res = await fetch("/json-lite/search_quick.json");
    if (!res.ok) throw new Error(`Failed to fetch search index: ${res.status}`);
    const data = (await res.json()) as { docs: SearchDoc[] };

    const ms = new MiniSearch<IndexedDoc>({
      idField: "id",
      fields: ["title", "title_norm", "pe_bli", "org"],
      storeFields: ["title", "url", "kind", "dollars", "pe_bli"],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { title: 2, title_norm: 2 },
      },
    });

    ms.addAll(
      data.docs.map((d) => ({ ...d, title_norm: normalizeAlnumWords(d.title) })),
    );
    urlTitles = new Map(data.docs.map((d) => [d.url, d.title]));
    docsById = new Map(data.docs.map((d) => [d.id, d]));
    return ms;
  })();

  return indexPromise;
}

/** Normalize a pagefind-style URL to the quick-index url shape:
 *  path only, no `index.html` suffix, with a trailing slash. */
function normalizeDocUrl(url: string): string {
  let u = url;
  // Strip an origin if present (pagefind normally emits path-only URLs).
  try {
    if (/^https?:\/\//i.test(u)) u = new URL(u).pathname;
  } catch {
    // keep as-is
  }
  u = u.replace(/index\.html$/, "");
  if (!u.endsWith("/")) u += "/";
  return u;
}

/**
 * Resolve a URL (e.g. a pagefind deep hit) to its quick-index title, or null
 * when the URL is not a quick-index doc — the caller falls back to the path.
 * Never throws: an index-load failure resolves null.
 */
export async function titleForUrl(url: string): Promise<string | null> {
  try {
    await buildIndex();
  } catch {
    return null;
  }
  return urlTitles?.get(normalizeDocUrl(url)) ?? null;
}

/** Pre-warm the index (call on mount). */
export function warmIndex(): void {
  buildIndex().catch(() => {
    // ignore warm errors — query() will surface them
  });
}

// ── Highlight helper ──────────────────────────────────────────────────────────

function highlightTerms(text: string, terms: string[]): string {
  if (!terms.length) return escapeHtml(text);
  // Escape terms for regex safety, then apply to escaped HTML text.
  // Mixed alphanumeric terms ("f35", "kc46a") additionally tolerate a single
  // hyphen/en-dash between digit/letter boundaries so "F35" highlights "F-35"
  // (§P1-4 normalization).
  const patterns = terms.map((t) => {
    if (/^[a-z0-9]+$/i.test(t) && /\d/.test(t) && /[a-z]/i.test(t)) {
      // Split into digit/letter runs ("f35" → ["f","35"]; "kc46a" →
      // ["kc","46","a"]) and allow one hyphen/en-dash between runs. Runs are
      // pure alphanumerics — no HTML or regex escaping needed.
      const runs = t.match(/\d+|[a-z]+/gi) ?? [t];
      return runs.join("[-–]?");
    }
    return escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return escapeHtml(text).replace(
    new RegExp(`(${patterns.join("|")})`, "gi"),
    (m) => `<mark>${m}</mark>`,
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Run a Tier-1 quick search. NO debounce — caller fires per keystroke.
 * Returns grouped results capped at MAX_PER_GROUP per group.
 *
 * Ranking adjustment: exact-title-match agencies (e.g. "darpa" → DARPA agency)
 * are boosted to score 10000 so they rank above programs that merely have the
 * agency as their org field. This ensures "darpa" → /agency/DARPA/ appears
 * in top results rather than "DARPA Advanced Technology Development" programs.
 */
export async function quickSearch(query: string): Promise<GroupedResults> {
  const empty: GroupedResults = {
    programs: [],
    companies: [],
    agencies: [],
    pages: [],
  };
  if (!query.trim()) return empty;

  const ms = await buildIndex();
  const queryNorm = query.trim().toLowerCase();
  // District code pattern: two uppercase letters + hyphen + digits (e.g. "CO-05")
  const districtCodeRe = /^[A-Z]{2}-\d{2}$/;
  const isDistrictQuery = districtCodeRe.test(query.trim().toUpperCase());

  const applyBoosts = <T extends { score: number } & Record<string, unknown>>(
    r: T,
  ): T => {
    // Same null tolerance as normalizeAlnumWords above: a stored doc whose
    // title is missing must not throw here either (this runs on every hit of
    // every query, so a throw is another whole-search outage).
    const titleLow = ((r.title as string | null | undefined) ?? "").toLowerCase();
    // Exact match boost: agency or company whose title exactly matches the query
    if ((r.kind === "agency" || r.kind === "company") && titleLow === queryNorm) {
      return { ...r, score: 10000 };
    }
    // Near-exact boost: agency or company title starts with query (catches "darpa" → "DARPA")
    // or query starts with title (catches typos like "darppa" matching "DARPA").
    if (r.kind === "agency" || r.kind === "company") {
      const queryLen = queryNorm.length;
      const titleLen = titleLow.length;
      // Require a *strong* head overlap: the shorter of {query, title} must be
      // a near-prefix (minus 1-2 fuzzy chars) of the longer. A 3-char stub is
      // too weak — "general dynamics" and "GENERAL ATOMICS" share "gen" and
      // sit within 2 chars of length, so the old rule wrongly boosted Atomics
      // over the far-better-scoring Dynamics match. Multi-word company names
      // like "GENERAL DYNAMICS CORP" (len 21 vs query 16, diff 5) never
      // qualified for the boost anyway; their raw BM25 score already wins.
      const shorter = queryLen <= titleLen ? queryNorm : titleLow;
      const longer = queryLen <= titleLen ? titleLow : queryNorm;
      const headLen = Math.max(3, shorter.length - 2);
      if (Math.abs(queryLen - titleLen) <= 2 && longer.startsWith(shorter.slice(0, headLen))) {
        return { ...r, score: 5000 };
      }
    }
    // District code boost: when the query looks like a district code (e.g. "CO-05"),
    // boost the matching district doc so it surfaces above programs/companies.
    if (isDistrictQuery && r.kind === "district") {
      const peBli = ((r as Record<string, unknown>).pe_bli as string | undefined) ?? "";
      if (peBli.toUpperCase() === query.trim().toUpperCase()) {
        return { ...r, score: 8000 };
      }
    }
    return r;
  };

  // Two-pass search (§P1-4 — normalize BOTH sides): pass 1 is the query as
  // typed; pass 2 is the alphanumeric-normalized query ("F-35" → "f35") so a
  // punctuated query exact-hits the title_norm tokens. Merged by doc id, max
  // score wins.
  type RawHit = { score: number; id: string } & Record<string, unknown>;
  const merged = new Map<string, RawHit>();
  const addHits = (hits: RawHit[]) => {
    for (const h of hits) {
      const prev = merged.get(h.id);
      if (!prev || h.score > prev.score) merged.set(h.id, h);
    }
  };
  addHits(ms.search(query).map((r) => applyBoosts(r as unknown as RawHit)));
  const normQuery = normalizeAlnumWords(query);
  if (normQuery && normQuery !== queryNorm) {
    addHits(ms.search(normQuery).map((r) => applyBoosts(r as unknown as RawHit)));
  }

  // Alias injection (§P1-4): a full-query alias match ("Sentinel", "JSF",
  // "GBSD") surfaces its program in the Programs tier as an exact-name-grade
  // hit — same band as the best direct program match, so the magnitude
  // tiebreak below decides order WITHIN that band ("Sentinel" → GBSD EMD
  // $4.15B above Sentinel Mods $462M) without ever outranking a stronger
  // direct name match from a different band.
  const aliasEntries = aliasMatchesForQuery(query);
  if (aliasEntries.length > 0) {
    let topProgramScore = 0;
    for (const h of merged.values()) {
      if (h.kind === "program" && h.score > topProgramScore) topProgramScore = h.score;
    }
    const aliasScore = topProgramScore > 0 ? topProgramScore : 100;
    for (const entry of aliasEntries) {
      const id = `p:${entry.peBli}`;
      const doc = docsById?.get(id);
      if (!doc) continue; // corpus drift — alias target not in the quick index
      const prev = merged.get(id);
      if (prev) {
        if (prev.score < aliasScore) merged.set(id, { ...prev, score: aliasScore });
      } else {
        merged.set(id, {
          id,
          kind: doc.kind,
          title: doc.title,
          url: doc.url,
          dollars: doc.dollars,
          pe_bli: doc.pe_bli,
          score: aliasScore,
        });
      }
    }
  }

  const rawAll = [...merged.values()].sort((a, b) => b.score - a.score);

  // Ranking blend (§P1-4): within the Programs tier, name-match relevance
  // still dominates via score BANDS (a new band starts when the score drops
  // below 95% of the band leader); FY26 magnitude only breaks near-ties
  // inside a band. An exact unique name keeps its own higher band, so a
  // bigger program that merely fuzzy-matches can never swamp it.
  const programs = rawAll.filter((r) => r.kind === "program");
  const nonPrograms = rawAll.filter((r) => r.kind !== "program");

  const BAND_RATIO = 0.95;
  let band = -1;
  let bandLeader = Infinity;
  const banded = programs.map((r) => {
    if (r.score < bandLeader * BAND_RATIO) {
      band += 1;
      bandLeader = r.score;
    }
    return { r, band };
  });
  banded.sort((a, b) => {
    if (a.band !== b.band) return a.band - b.band;
    const da = (a.r.dollars as number | null | undefined) ?? -1;
    const db = (b.r.dollars as number | null | undefined) ?? -1;
    if (da !== db) return db - da;
    if (a.r.score !== b.r.score) return b.r.score - a.r.score;
    return a.r.id < b.r.id ? -1 : 1;
  });
  // Rewrite scores strictly decreasing in final program order so downstream
  // score-sorted views (the palette's flattened list) preserve this ordering.
  let prevScore = Infinity;
  const orderedPrograms = banded.map(({ r }) => {
    const s = Math.min(r.score, prevScore - 1e-6);
    prevScore = s;
    return { ...r, score: s };
  });

  // Extract query terms for highlighting
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const toResult = (r: RawHit): SearchResult => {
    const kind = (r.kind ?? "page") as SearchDocKind;
    const peBli =
      (r.pe_bli as string | undefined) ??
      (typeof r.url === "string"
        ? /^\/program\/([^/]+)\/$/.exec(r.url as string)?.[1]
        : undefined);
    const aka =
      kind === "program" && peBli ? aliasesForPeBli(peBli) ?? undefined : undefined;
    // Which alias did the matching — the same full-query-equality judgement
    // the /programs/ filter makes (aliasHitsForQuery), so both chips agree.
    const akaMatched =
      aka && peBli ? aliasHitsForQuery(query).get(peBli)?.matched : undefined;
    return {
      id: r.id,
      kind,
      title: (r.title as string | null | undefined) ?? "",
      url: r.url as string,
      dollars: r.dollars as number | null | undefined,
      titleHtml: highlightTerms((r.title as string | null | undefined) ?? "", terms),
      score: r.score,
      ...(aka ? { aka } : {}),
      ...(akaMatched ? { akaMatched } : {}),
    };
  };

  const groups: GroupedResults = { programs: [], companies: [], agencies: [], pages: [] };

  for (const r of orderedPrograms) {
    if (groups.programs.length < MAX_PER_GROUP) groups.programs.push(toResult(r));
  }
  for (const r of nonPrograms) {
    const kind = (r.kind ?? "page") as SearchDocKind;
    const group = kind === "company"
      ? groups.companies
      : kind === "agency"
        ? groups.agencies
        : groups.pages;
    if (group.length < MAX_PER_GROUP) {
      group.push(toResult(r));
    }
  }

  return groups;
}

// ── Recents ───────────────────────────────────────────────────────────────────

export interface RecentItem {
  id: string;
  title: string;
  url: string;
  kind: SearchDocKind;
}

export function getRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

export function addRecent(item: RecentItem): void {
  try {
    const existing = getRecents().filter((r) => r.id !== item.id);
    const updated = [item, ...existing].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable (SSR safety)
  }
}
