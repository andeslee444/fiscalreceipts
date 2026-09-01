"use client";

/**
 * doc-toc.tsx — the "On this page" rail for document routes.
 *
 * WHY IT EXISTS.  Two site-wide rules meet badly on a document page.  The spine
 * pins every route's <h1> to one left edge (gate 3 leg s1 fails the build if a
 * route drifts off it), and --measure caps prose at 54ch so a line stays inside
 * the 80 characters WCAG 1.4.8 AAA allows.  Left edge pinned plus width capped
 * means a 501px column of text with ~1,100px of nothing to its right, which is
 * what /about/ and /methodology/ looked like.  An index page fills that space
 * with a second column; a document cannot — you would read to the bottom and
 * scroll back up.  So the space becomes navigation instead, which is what the
 * space is for on every documentation site.
 *
 * IDS ARE MINTED, NEVER OVERWRITTEN.  Most headings on these routes ship without
 * an id (0/6 on /about/, 1/9 on /methodology/, 0/21 on /glossary/), so the rail
 * assigns one from the heading text.  It must never touch an id that already
 * exists: /methodology/#verification and the three #coverage-* anchors are
 * load-bearing — gate 14 asserts them, and external links point at them.  So the
 * rule is add-only, and a minted id also takes care not to collide with one that
 * is already in the document.
 *
 * WHY CLIENT-SIDE.  The alternative is hand-writing ids onto ~130 headings
 * across five routes, which is a large diff that rots the moment someone adds a
 * section.  Reading the headings out of the rendered document keeps the rail
 * correct for a heading nobody remembered to register.  The server renders
 * nothing (items starts empty), so the first client render matches the server
 * and there is no hydration mismatch.
 *
 * DESKTOP ONLY, on purpose.  The rail is hidden below 1024px in CSS — see
 * .doc-toc in globals.css.  It exists to spend horizontal space that only a
 * desktop viewport has; on a phone there is none to spend, and a 43-entry list
 * above the article would push the article itself under the fold.
 */

import { useEffect, useState } from "react";

type TocItem = { id: string; text: string; level: 2 | 3 };

/** A heading shorter than this is decoration, not a section. */
const MIN_HEADING_CHARS = 2;

/** Below this many sections a rail is noise — the page is already scannable. */
const MIN_ITEMS = 3;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function DocToc() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let observer: IntersectionObserver | null = null;

    // Read the rendered document just after mount, not in the effect body.
    // Two reasons. The rail is derived from DOM that OTHER components own, so it
    // has to wait for them to have rendered — /methodology/ and /coverage/ both
    // mount client islands inside the prose. And it keeps setState inside a
    // callback, which is the shape asset-config.tsx already uses and the shape
    // react-hooks/set-state-in-effect asks for.
    //
    // setTimeout, NOT requestAnimationFrame. rAF does not fire while the tab is
    // hidden, so a page opened in a background tab (cmd-click, or a restored
    // session) would render no rail until it was focused — measured, not
    // guessed: document.hidden was true and the rAF callback had not run 150ms
    // later while the timeout had. A timer owes nothing to the compositor.
    const timer = window.setTimeout(() => {
      const root = document.querySelector("[data-doc-prose]");
      if (!root) return;

      const headings = [...root.querySelectorAll("h2, h3")] as HTMLElement[];
      const found: TocItem[] = [];
      const taken = new Set<string>();

      for (const el of headings) {
        // A heading inside a figure or an interactive island is a LABEL, not a
        // section of the document. /lineage/ is the worked example: one real h2
        // and fifty-five h3s that are legend captions inside the flow diagram —
        // a rail listing those would be worse than the empty space it replaces.
        // Anything that should not be navigable says so with data-toc-skip.
        if (el.closest("figure, aside, [data-toc-skip]")) continue;

        const text = (el.textContent || "").trim();
        if (text.length < MIN_HEADING_CHARS) continue;

        // Add-only: an id that already exists is someone else's contract.
        let id = el.id;
        if (!id) {
          const base = slugify(text) || "section";
          id = base;
          for (let n = 2; taken.has(id) || document.getElementById(id); n += 1) {
            id = `${base}-${n}`;
          }
          el.id = id;
          // Clear the sticky header when the anchor is jumped to, matching the
          // scroll-mt-20 the hand-written anchors on these routes already use.
          el.classList.add("scroll-mt-20");
        }
        if (taken.has(id)) continue;
        taken.add(id);
        found.push({ id, text, level: el.tagName === "H3" ? 3 : 2 });
      }

      setItems(found);
      if (found.length < MIN_ITEMS) return;

      // Mark the section currently being read. rootMargin pulls the trigger
      // line just under the sticky header so a heading counts as "current" when
      // it reaches the top of the readable area, not the top of the viewport.
      observer = new IntersectionObserver(
        (entries) => {
          const onscreen = entries.filter((e) => e.isIntersecting);
          if (onscreen.length === 0) return;
          onscreen.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
          setActiveId(onscreen[0].target.id);
        },
        { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
      );
      for (const { id } of found) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    });

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);

  if (items.length < MIN_ITEMS) return null;

  return (
    <nav className="doc-toc" aria-label="On this page">
      <p className="doc-toc-title">On this page</p>
      <ol className="doc-toc-list">
        {items.map((item) => (
          <li key={item.id} data-level={item.level}>
            <a
              href={`#${item.id}`}
              className="doc-toc-link"
              aria-current={activeId === item.id ? "true" : undefined}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
