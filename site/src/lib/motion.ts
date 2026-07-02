/**
 * motion.ts — JS mirror of the site motion tokens.
 *
 * SOURCE OF TRUTH for CSS is src/app/globals.css (`:root` --motion-* and
 * --ease-* custom properties). This module mirrors the numeric millisecond
 * values for JS consumers (inline-style calc() construction, timeouts that
 * must match a transition). Keep the two in sync — the G7 motion gate
 * (scripts/gates/motion.mjs) allows ms literals ONLY in globals.css and this
 * file, so every other module must consume MOTION or var(--motion-*).
 *
 * Universal module (no server-only guard): imported by both server components
 * (hero motifs) and client components.
 */
export const MOTION = {
  /** Hover/focus feedback, small fades. CSS: var(--motion-fast). */
  fast: 150,
  /** Standard UI transitions (panel fades, crossfades). CSS: var(--motion-base). */
  base: 220,
  /** Entrances/reveals, panel slide-in. CSS: var(--motion-slow). */
  slow: 320,
  /** Story beat for data narratives (follow-the-dollar, hero motifs). CSS: var(--motion-story). */
  story: 600,
} as const;

/**
 * Express an absolute duration (in seconds) as a story-token multiple:
 * `calc(var(--motion-story) * N)`. Used by decorative SVG motifs whose
 * per-node durations vary for organic feel — the CSS var keeps them on the
 * token system (and collapses under prefers-reduced-motion).
 */
export function storyBeats(seconds: number): string {
  const beats = (seconds * 1000) / MOTION.story;
  // Round to 2dp — decorative variance, not a timing contract.
  return `calc(var(--motion-story) * ${Math.round(beats * 100) / 100})`;
}
