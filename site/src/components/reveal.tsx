"use client";

/**
 * <Reveal> — scroll-triggered once-reveal wrapper (Phase 5C Task 11, Goal 6).
 *
 * IntersectionObserver, fires ONCE: children start translated 12px down at
 * opacity 0 and settle when they enter the viewport (CSS in globals.css:
 * .reveal / .is-revealed, tokens var(--motion-slow) + var(--ease-decelerate),
 * compositor-only transform/opacity).
 *
 * SSR-safe by construction:
 *  - Server HTML carries NO .reveal class — content is fully visible without
 *    JS (search crawlers, no-JS readers, print).
 *  - After hydration, elements ALREADY inside the viewport are left alone
 *    (no hide-then-fade flash); only below-viewport elements are armed.
 *  - prefers-reduced-motion neutralizes .reveal entirely (globals.css) so
 *    content is visible, never parked at opacity 0.
 *
 * Stagger: pass the item's list index — the transition delay steps by 60ms,
 * capped at 5 steps (300ms) so long lists don't crawl.
 *
 * Observer: module-level singleton shared across all <Reveal> instances.
 * One IntersectionObserver + Map<Element, callback> instead of one-per-mount.
 * Created lazily on first client use; guarded against SSR.
 */

import React, { useEffect, useRef, useState } from "react";

const STAGGER_STEP_MS = 60; // one motion beat between siblings
const STAGGER_MAX_STEPS = 5; // cap: 5 × 60ms = 300ms

/** Transition delay in ms for the item at `index` (capped stagger). */
export function staggerDelayMs(index: number): number {
  return Math.min(Math.max(index, 0), STAGGER_MAX_STEPS) * STAGGER_STEP_MS;
}

type RevealState = "static" | "armed" | "revealed";

// ---------------------------------------------------------------------------
// Module-level shared observer
// ---------------------------------------------------------------------------

/** Callbacks keyed by the element they watch. */
const registry = new Map<Element, () => void>();

/** Lazily-created singleton — undefined until first client mount. */
let sharedObserver: IntersectionObserver | undefined;

function getObserver(): IntersectionObserver | undefined {
  if (typeof window === "undefined") return undefined;
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cb = registry.get(entry.target);
            if (cb) {
              cb();
              sharedObserver!.unobserve(entry.target);
              registry.delete(entry.target);
            }
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0 },
    );
  }
  return sharedObserver;
}

// ---------------------------------------------------------------------------

export function Reveal({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  /** List position for staggered entrances (capped at 5 steps). */
  index?: number;
  /** Extra classes for the wrapper div (layout: h-full etc.). */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RevealState>("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    // Already on screen at hydration → stay static (no flash).
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;

    setState("armed");

    const observer = getObserver();
    if (!observer) return;

    registry.set(el, () => setState("revealed"));
    observer.observe(el);

    return () => {
      observer.unobserve(el);
      registry.delete(el);
    };
  }, []);

  const classes = [
    className,
    state !== "static" ? "reveal" : null,
    state === "revealed" ? "is-revealed" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const delay = staggerDelayMs(index);

  return (
    <div
      ref={ref}
      className={classes || undefined}
      style={
        state !== "static" && delay > 0
          ? { transitionDelay: `${delay}ms` }
          : undefined
      }
    >
      {children}
    </div>
  );
}
