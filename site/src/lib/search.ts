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

export type SearchDocKind = "program" | "company" | "agency" | "page";

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
}

export interface GroupedResults {
  programs: SearchResult[];
  companies: SearchResult[];
  agencies: SearchResult[];
  pages: SearchResult[];
}

const MAX_PER_GROUP = 5;
const RECENTS_KEY = "govbudget-search-recents";
const MAX_RECENTS = 5;

// ── Module-level singleton ────────────────────────────────────────────────────

let indexPromise: Promise<MiniSearch<SearchDoc>> | null = null;

function buildIndex(): Promise<MiniSearch<SearchDoc>> {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const res = await fetch("/json-lite/search_quick.json");
    if (!res.ok) throw new Error(`Failed to fetch search index: ${res.status}`);
    const data = (await res.json()) as { docs: SearchDoc[] };

    const ms = new MiniSearch<SearchDoc>({
      idField: "id",
      fields: ["title", "pe_bli", "org"],
      storeFields: ["title", "url", "kind", "dollars"],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { title: 2 },
      },
    });

    ms.addAll(data.docs);
    return ms;
  })();

  return indexPromise;
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
  // Escape terms for regex safety, then apply to escaped HTML text
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escapeHtml(text).replace(
    new RegExp(`(${escaped.map((t) => escapeHtml(t)).join("|")})`, "gi"),
    (m) => `<mark>${m}</mark>`,
  );
}

function escapeHtml(s: string): string {
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
  const raw = ms.search(query);

  // Extract query terms for highlighting
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const toResult = (r: (typeof raw)[number]): SearchResult => ({
    id: r.id as string,
    kind: (r.kind ?? "page") as SearchDocKind,
    title: r.title as string,
    url: r.url as string,
    dollars: r.dollars as number | null | undefined,
    titleHtml: highlightTerms(r.title as string, terms),
    score: r.score,
  });

  const groups: GroupedResults = { programs: [], companies: [], agencies: [], pages: [] };

  for (const r of raw) {
    const kind = (r.kind ?? "page") as SearchDocKind;
    const group = kind === "program"
      ? groups.programs
      : kind === "company"
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
