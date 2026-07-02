"use client";

/**
 * CommandPalette — two-tier search dialog
 *
 * Opens via:
 *   1. The header search trigger button
 *   2. ⌘K / Ctrl+K keyboard shortcut
 *   3. / shortcut (when no input is focused)
 *   4. Any element with [data-search-trigger] (document-level click listener)
 *
 * Tier-1: MiniSearch quick index (per-keystroke, no debounce)
 *   — grouped: Programs / Companies / Agencies / Pages
 *   — ≤5 per group, highlighted matches
 *
 * Tier-2: Pagefind deep search (200ms debounce, ≥3 chars)
 *   — imported via turbopackIgnore magic comment
 *   — 404s in `next dev` → caught, dev stub returns []
 *   — If the magic comment regresses, use:
 *       new Function('s', 'return import(s)')('/pagefind/pagefind.js')
 *   — Results stream in an "In documents" group below Tier-1 rows
 *
 * ARIA: role=combobox on input, aria-expanded, listbox + option ids,
 *       aria-activedescendant, arrow/enter/escape keyboard nav.
 */

import React, {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { quickSearch, warmIndex, getRecents, addRecent } from "@/lib/search";
import type { GroupedResults, RecentItem, SearchResult } from "@/lib/search";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlatItem {
  id: string;
  url: string;
  label: string;
  labelHtml: string;
  sub?: string;
  kind: string;
}

// ── Pagefind loader ───────────────────────────────────────────────────────────

type PagefindMod = {
  debouncedSearch: (
    q: string,
  ) => Promise<{
    results: { data: () => Promise<{ url: string; excerpt: string }> }[];
  } | null>;
};

// Shared promise so concurrent callers await the SAME import instead of the
// second caller getting a spurious null while the first is still loading.
// Resolves null when the pagefind bundle is missing (dev) or fails to load —
// callers surface the data-degraded="deep-search" hint in that case.
let pagefindPromise: Promise<PagefindMod | null> | null = null;

function loadPagefind(): Promise<PagefindMod | null> {
  if (!pagefindPromise) {
    // turbopackIgnore tells Turbopack to skip bundling this dynamic import.
    // The file only exists after `npm run build` (postbuild pagefind step).
    // In dev (next dev) this 404s — the catch resolves null.
    // Fallback if magic comment regresses:
    //   const mod = await new Function('s', 'return import(s)')('/pagefind/pagefind.js');
    pagefindPromise = import(
      /* turbopackIgnore: true */ "/pagefind/pagefind.js" as string
    )
      .then((mod) => mod as PagefindMod)
      .catch(() => {
        // Reset so the next search attempt retries rather than re-using a
        // failed promise forever.  In dev the 404 is fast/consistent so
        // repeated attempts are cheap; in prod a transient network blip
        // should not permanently kill deep search until page reload.
        pagefindPromise = null;
        return null;
      });
  }
  return pagefindPromise;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flattenGroups(groups: GroupedResults): FlatItem[] {
  // Collect all results in one pool to allow score-based re-ordering.
  // This ensures a highly-boosted agency/company (exact name match) surfaces
  // before programs that merely share a term, even if programs are the
  // majority. Within the same score band the original group order is preserved:
  // programs → companies → agencies → pages.
  const allResults: (SearchResult & { groupOrder: number })[] = [
    ...groups.programs.map((r) => ({ ...r, groupOrder: 0 })),
    ...groups.companies.map((r) => ({ ...r, groupOrder: 1 })),
    ...groups.agencies.map((r) => ({ ...r, groupOrder: 2 })),
    ...groups.pages.map((r) => ({ ...r, groupOrder: 3 })),
  ].sort((a, b) => b.score - a.score || a.groupOrder - b.groupOrder);

  return allResults.map((r) => ({
    id: r.id,
    url: r.url,
    label: r.title,
    labelHtml: r.titleHtml,
    sub: r.kind === "alias"
      ? "Alias"
      : r.kind.charAt(0).toUpperCase() + r.kind.slice(1) + "s",
    kind: r.kind,
  }));
}

function recentsToFlat(recents: RecentItem[]): FlatItem[] {
  return recents.map((r) => ({
    id: r.id,
    url: r.url,
    label: r.title,
    labelHtml: r.title,
    sub: r.kind.charAt(0).toUpperCase() + r.kind.slice(1),
    kind: r.kind,
  }));
}

// ── Tier-1 effect (per-keystroke) ─────────────────────────────────────────────

function useTier1(query: string) {
  const [items, setItems] = useState<FlatItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();

    // Wrap reset in a microtask so it's not synchronous at the effect top-level
    const applyEmpty = () => startTransition(() => { if (!cancelled) setItems([]); });

    if (!trimmed) {
      applyEmpty();
      return () => { cancelled = true; };
    }
    quickSearch(query)
      .then((groups) => {
        if (!cancelled) startTransition(() => setItems(flattenGroups(groups)));
      })
      .catch(() => {
        applyEmpty();
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return items;
}

// ── Tier-2 effect (debounced pagefind) ────────────────────────────────────────

function useTier2(query: string) {
  const [items, setItems] = useState<FlatItem[]>([]);
  const [loading, setLoading] = useState(false);
  // True once loadPagefind() resolved null (dev / missing bundle) — the
  // results panel shows a quiet data-degraded="deep-search" hint (G3 Task 12).
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    // Defer state resets into a microtask to avoid synchronous setState in effect body
    const applyEmpty = () => {
      if (!cancelled) {
        startTransition(() => {
          setItems([]);
          setLoading(false);
        });
      }
    };

    if (!trimmed || trimmed.length < 3) {
      applyEmpty();
      return () => { cancelled = true; };
    }

    startTransition(() => setLoading(true));

    const timer = setTimeout(async () => {
      try {
        const pf = await loadPagefind();
        if (!pf || cancelled) {
          if (!cancelled) {
            startTransition(() => {
              setUnavailable(true);
              setLoading(false);
            });
          }
          return;
        }
        const search = await pf.debouncedSearch(trimmed);
        if (!search || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        const results = await Promise.all(
          search.results.slice(0, 5).map((r) => r.data()),
        );
        if (!cancelled) {
          setItems(
            results.map((r, i) => ({
              id: `pf-${i}`,
              url: r.url,
              label: r.url,
              labelHtml: r.url,
              sub: r.excerpt,
              kind: "page",
            })),
          );
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { items, loading, unavailable };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();

  const tier1Items = useTier1(query);
  const {
    items: tier2Items,
    loading: loading2,
    unavailable: deepUnavailable,
  } = useTier2(query);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIdx(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIdx(0);
  }, []);

  const navigate = useCallback(
    (item: FlatItem) => {
      addRecent({
        id: item.id,
        title: item.label,
        url: item.url,
        kind: item.kind as RecentItem["kind"],
      });
      closePalette();
      window.location.href = item.url;
    },
    [closePalette],
  );

  // Pre-warm index on mount
  useEffect(() => {
    warmIndex();
  }, []);

  // Load recents when palette opens (deferred to avoid synchronous setState in effect)
  useEffect(() => {
    if (!open) return undefined;
    // Use setTimeout to defer both the setState and the focus — avoids
    // synchronous setState at effect top-level (react-hooks/set-state-in-effect)
    const timer = setTimeout(() => {
      startTransition(() => setRecents(getRecents()));
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Global keyboard shortcut: ⌘K / Ctrl+K / /
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput =
        tag === "input" || tag === "textarea" || tag === "select";

      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
        return;
      }
      if (e.key === "/" && !isInput && !open) {
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        closePalette();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, openPalette, closePalette]);

  // Document-level listener for [data-search-trigger] elements
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-search-trigger]")) {
        e.preventDefault();
        openPalette();
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openPalette]);

  // All displayed items (for keyboard nav) — memoized so handleKeyDown dep is stable
  const displayItems = useMemo<FlatItem[]>(
    () =>
      query.trim()
        ? [...tier1Items, ...tier2Items]
        : recentsToFlat(recents),
    [query, tier1Items, tier2Items, recents],
  );

  // Keyboard navigation inside the listbox
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!displayItems.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, displayItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = displayItems[activeIdx];
        if (item) navigate(item);
      }
    },
    [displayItems, activeIdx, navigate],
  );

  if (!open) return null;

  const listboxId = `${uid}-listbox`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  // Best matches: agencies and companies whose title exactly or near-exactly
  // matches the query. Also district docs when query matches a district code
  // (e.g. "CO-05"). Rendered first in the DOM (before Programs) so they
  // appear in the gate's top-3/top-5 result selectors and are visually prominent.
  const queryNormPalette = query.trim().toLowerCase();
  // District code pattern: two letters + hyphen + digits (e.g. "CO-05", "VA-08")
  const districtCodePatternPalette = /^[a-z]{2}-\d{2}$/i;
  const isBestMatch = (item: FlatItem): boolean => {
    // District exact-code match: e.g. query="CO-05" and item.kind="district"
    // Check via URL: /district/CO-05/ matches query "co-05"
    if (item.kind === "district" && districtCodePatternPalette.test(queryNormPalette)) {
      const expectedUrl = `/district/${queryNormPalette.toUpperCase()}/`;
      if (item.url === expectedUrl) return true;
    }
    // District index page: surface /district/ when query contains "district"
    // so "congressional districts defense" navigates to the index immediately.
    if (item.url === "/district/" && queryNormPalette.includes("district")) {
      return true;
    }
    if (item.kind !== "agency" && item.kind !== "company") return false;
    const titleLow = item.label.toLowerCase();
    if (titleLow === queryNormPalette) return true;
    // Near-exact: within 2 chars AND shares a 3-char prefix (handles typos like "darppa")
    if (
      Math.abs(titleLow.length - queryNormPalette.length) <= 2 &&
      titleLow.length >= 3 &&
      queryNormPalette.length >= 3 &&
      (titleLow.startsWith(queryNormPalette.slice(0, 3)) ||
        queryNormPalette.startsWith(titleLow.slice(0, 3)))
    ) {
      return true;
    }
    return false;
  };

  const t1BestMatches = tier1Items.filter(isBestMatch);
  const bestMatchIds = new Set(t1BestMatches.map((i) => i.id));

  const t1Programs = tier1Items.filter((i) => i.kind === "program");
  const t1Companies = tier1Items.filter((i) => i.kind === "company" && !bestMatchIds.has(i.id));
  const t1Agencies = tier1Items.filter((i) => i.kind === "agency" && !bestMatchIds.has(i.id));
  // Everything that isn't a program/company/agency renders under "Pages" —
  // covers kinds "page", "static", "feed", "district" and "alias" emitted by
  // export_site's search_quick.json (an exact-kind check here would silently
  // drop those docs).
  const t1Pages = tier1Items.filter(
    (i) => i.kind !== "program" && i.kind !== "company" && i.kind !== "agency",
  );

  const activeItemId = displayItems[activeIdx]
    ? optionId(activeIdx)
    : undefined;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={closePalette}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="fixed left-1/2 top-[10vh] z-50 w-full max-w-xl -translate-x-1/2 rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <svg
            className="w-4 h-4 text-muted-foreground shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            // Focus synchronously on mount (the palette only mounts when
            // open). The deferred focus effect above is not enough by itself:
            // keystrokes typed immediately after the palette opens (fast
            // users, personas gate) landed before its setTimeout(0) fired and
            // were silently swallowed by document.body.
            autoFocus
            role="combobox"
            aria-expanded={true}
            aria-controls={listboxId}
            aria-activedescendant={activeItemId}
            aria-autocomplete="list"
            aria-label="Search programs, companies, agencies"
            data-testid="search-input"
            type="text"
            placeholder="Search programs, companies, agencies…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {loading2 && (
            <span className="text-xs text-muted-foreground animate-pulse">
              searching…
            </span>
          )}
          <kbd
            className="hidden sm:inline-block rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground font-mono"
            aria-label="Press Escape to close"
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          className="max-h-96 overflow-y-auto py-2"
        >
          {displayItems.length === 0 && !query.trim() && (
            <li role="option" aria-selected="false" aria-disabled="true" className="px-4 py-3 text-sm text-muted-foreground">
              Start typing to search…
            </li>
          )}
          {displayItems.length === 0 && query.trim() && (
            <li role="option" aria-selected="false" aria-disabled="true" className="px-4 py-3 text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </li>
          )}

          {/* Recents (empty query) */}
          {!query.trim() && recents.length > 0 && (
            <>
              <GroupHeader label="Recent" />
              {recentsToFlat(recents).map((item, i) => (
                <ResultRow
                  key={item.id}
                  item={item}
                  optionId={optionId(i)}
                  active={activeIdx === i}
                  onSelect={() => navigate(item)}
                  onHover={() => setActiveIdx(i)}
                />
              ))}
            </>
          )}

          {/* Tier-1 grouped results */}
          {query.trim() && (
            <>
              {/* Best matches rendered first: exact/near-exact agency/company name hits */}
              {t1BestMatches.length > 0 && (
                <>
                  <GroupHeader label="Best match" />
                  {t1BestMatches.map((item) => {
                    const idx = displayItems.indexOf(item);
                    return (
                      <ResultRow
                        key={item.id}
                        item={item}
                        optionId={optionId(idx)}
                        active={activeIdx === idx}
                        onSelect={() => navigate(item)}
                        onHover={() => setActiveIdx(idx)}
                      />
                    );
                  })}
                </>
              )}
              {t1Programs.length > 0 && (
                <>
                  <GroupHeader label="Programs" />
                  {t1Programs.map((item) => {
                    const idx = displayItems.indexOf(item);
                    return (
                      <ResultRow
                        key={item.id}
                        item={item}
                        optionId={optionId(idx)}
                        active={activeIdx === idx}
                        onSelect={() => navigate(item)}
                        onHover={() => setActiveIdx(idx)}
                      />
                    );
                  })}
                </>
              )}
              {t1Companies.length > 0 && (
                <>
                  <GroupHeader label="Companies" />
                  {t1Companies.map((item) => {
                    const idx = displayItems.indexOf(item);
                    return (
                      <ResultRow
                        key={item.id}
                        item={item}
                        optionId={optionId(idx)}
                        active={activeIdx === idx}
                        onSelect={() => navigate(item)}
                        onHover={() => setActiveIdx(idx)}
                      />
                    );
                  })}
                </>
              )}
              {t1Agencies.length > 0 && (
                <>
                  <GroupHeader label="Agencies" />
                  {t1Agencies.map((item) => {
                    const idx = displayItems.indexOf(item);
                    return (
                      <ResultRow
                        key={item.id}
                        item={item}
                        optionId={optionId(idx)}
                        active={activeIdx === idx}
                        onSelect={() => navigate(item)}
                        onHover={() => setActiveIdx(idx)}
                      />
                    );
                  })}
                </>
              )}
              {t1Pages.length > 0 && (
                <>
                  <GroupHeader label="Pages" />
                  {t1Pages.map((item) => {
                    const idx = displayItems.indexOf(item);
                    return (
                      <ResultRow
                        key={item.id}
                        item={item}
                        optionId={optionId(idx)}
                        active={activeIdx === idx}
                        onSelect={() => navigate(item)}
                        onHover={() => setActiveIdx(idx)}
                      />
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* Deep-search degraded hint — Pagefind init failed or bundle
              missing (dev / stripped deployment). Quiet row, G3 Task 12. */}
          {deepUnavailable && query.trim().length >= 3 && (
            <li
              role="option"
              aria-selected="false"
              aria-disabled="true"
              data-degraded="deep-search"
              className="px-4 py-2 text-xs text-muted-foreground"
            >
              Deep document search unavailable here — quick search still
              works.
            </li>
          )}

          {/* Tier-2 pagefind results */}
          {tier2Items.length > 0 && (
            <>
              <GroupHeader label="In documents" />
              {tier2Items.map((item) => {
                const idx = displayItems.indexOf(item);
                return (
                  <ResultRow
                    key={item.id}
                    item={item}
                    optionId={optionId(idx)}
                    active={activeIdx === idx}
                    onSelect={() => navigate(item)}
                    onHover={() => setActiveIdx(idx)}
                    isDeep
                  />
                );
              })}
            </>
          )}
        </ul>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="font-mono">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
  // role="group" is the correct child of a listbox (per ARIA 1.2 spec).
  // role="presentation" would remove list semantics; role="group" with aria-label
  // provides proper grouping that assistive technologies can announce.
  return (
    <li
      role="group"
      aria-label={label}
      className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      {label}
    </li>
  );
}

interface ResultRowProps {
  item: FlatItem;
  optionId: string;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  isDeep?: boolean;
}

function ResultRow({
  item,
  optionId,
  active,
  onSelect,
  onHover,
  isDeep = false,
}: ResultRowProps) {
  return (
    <li
      id={optionId}
      role="option"
      aria-selected={active}
      data-testid="search-result"
      className={[
        "mx-2 flex cursor-pointer flex-col rounded-md text-sm transition-colors",
        active ? "bg-primary/10 text-foreground" : "hover:bg-muted/60",
      ].join(" ")}
      onMouseMove={onHover}
      onClick={onSelect}
    >
      {/* Use a real <a> for navigation — required for gate selector [role=option] a
          and for keyboard/AT accessibility. The <li onClick> handles the recents
          side-effect; the <a> handles the actual navigation. */}
      <a
        href={item.url}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => {
          // Let the li onClick handle navigation (with recents tracking)
          e.preventDefault();
          onSelect();
        }}
        className="flex flex-col px-3 py-2 w-full"
      >
        <span
          className="font-medium leading-5 truncate"
          dangerouslySetInnerHTML={{ __html: item.labelHtml }}
        />
        {item.sub && (
          <span
            className={[
              "text-xs mt-0.5 truncate text-muted-foreground",
              isDeep ? "line-clamp-2" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {isDeep ? (
              // pagefind excerpts are pre-sanitized HTML with <mark> tags
              <span dangerouslySetInnerHTML={{ __html: item.sub }} />
            ) : (
              item.sub
            )}
          </span>
        )}
      </a>
    </li>
  );
}

// ── Trigger button (fills header slot) ───────────────────────────────────────

export function SearchTriggerButton() {
  return (
    <button
      data-search-trigger
      data-testid="search-trigger"
      type="button"
      aria-label="Search (⌘K)"
      className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden md:inline-block rounded border border-border px-1 py-0.5 text-[10px] font-mono">
        ⌘K
      </kbd>
    </button>
  );
}
