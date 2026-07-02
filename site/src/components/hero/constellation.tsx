import React from "react";
import { storyBeats } from "@/lib/motion";

/**
 * ConstellationHero — 'space' category motif (Task 8a).
 * Static constellation lines + 16 stars twinkling (CSS opacity keyframes
 * `hero-twinkle` — opacity is compositor-safe). Server component;
 * <desc> never <title> (recon §H).
 */

const STARS: { x: number; y: number; r: number; delay: number; dur: number }[] = [
  { x: 50, y: 30, r: 1.6, delay: 0.0, dur: 3.8 },
  { x: 130, y: 76, r: 1.2, delay: 1.2, dur: 4.6 },
  { x: 205, y: 40, r: 1.8, delay: 2.4, dur: 4.0 },
  { x: 280, y: 92, r: 1.0, delay: 0.7, dur: 5.0 },
  { x: 350, y: 28, r: 1.5, delay: 1.9, dur: 4.2 },
  { x: 415, y: 66, r: 2.0, delay: 3.2, dur: 3.6 },
  { x: 490, y: 36, r: 1.2, delay: 0.4, dur: 4.8 },
  { x: 555, y: 88, r: 1.6, delay: 2.0, dur: 4.4 },
  { x: 625, y: 48, r: 1.3, delay: 1.5, dur: 3.9 },
  { x: 695, y: 80, r: 1.8, delay: 2.8, dur: 4.1 },
  { x: 755, y: 34, r: 1.1, delay: 0.9, dur: 4.7 },
  { x: 100, y: 105, r: 1.4, delay: 3.6, dur: 4.3 },
  { x: 245, y: 14, r: 1.0, delay: 1.0, dur: 5.2 },
  { x: 460, y: 104, r: 1.3, delay: 2.2, dur: 4.5 },
  { x: 590, y: 16, r: 1.5, delay: 0.2, dur: 4.0 },
  { x: 720, y: 108, r: 1.2, delay: 3.0, dur: 4.9 },
];

const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 4], [4, 5], [5, 6], [6, 8], [8, 9], [9, 10],
  [3, 5], [7, 8], [12, 2], [13, 7],
];

export function ConstellationHero() {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      focusable="false"
    >
      <desc>
        Decorative satellite-constellation motif: faint linked stars twinkling
        in the header background.
      </desc>
      {LINKS.map(([a, b], i) => (
        <line
          key={`link-${i}`}
          x1={STARS[a].x}
          y1={STARS[a].y}
          x2={STARS[b].x}
          y2={STARS[b].y}
          stroke="currentColor"
          strokeWidth={0.5}
          opacity={0.5}
        />
      ))}
      {STARS.map((s, i) => (
        <circle
          key={`star-${i}`}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="currentColor"
          className="hero-star"
          style={{
            animationDelay: `${s.delay}s`,
            animationDuration: storyBeats(s.dur),
          }}
        />
      ))}
    </svg>
  );
}
