import React from "react";
import { storyBeats } from "@/lib/motion";

/**
 * TrajectoryHero — 'hypersonics' category motif (Task 8a).
 * Static boost-glide arcs + 5 streaks translating along a shallow diagonal
 * (CSS transform/opacity keyframes `hero-rise`, compositor-only).
 * Server component; <desc> never <title> (recon §H).
 */

const ARCS = [
  "M 0 110 Q 240 18 560 44 T 800 28",
  "M 0 96 Q 280 30 600 60 T 800 48",
  "M 0 118 Q 220 48 520 72 T 800 60",
];

const STREAKS: { x: number; y: number; delay: number; dur: number }[] = [
  { x: 60, y: 96, delay: 0.0, dur: 5.2 },
  { x: 200, y: 70, delay: 1.6, dur: 6.0 },
  { x: 340, y: 86, delay: 3.1, dur: 5.6 },
  { x: 470, y: 58, delay: 0.9, dur: 6.4 },
  { x: 90, y: 52, delay: 2.4, dur: 5.8 },
];

export function TrajectoryHero() {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      focusable="false"
    >
      <desc>
        Decorative hypersonic-trajectory motif: shallow glide arcs with faint
        streaks travelling along them.
      </desc>
      {ARCS.map((d, i) => (
        <path
          key={`arc-${i}`}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.8}
          strokeDasharray="1 5"
        />
      ))}
      {STREAKS.map((s, i) => (
        <line
          key={`streak-${i}`}
          x1={s.x}
          y1={s.y}
          x2={s.x + 22}
          y2={s.y - 6}
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          className="hero-streak"
          style={{
            animationDelay: `${s.delay}s`,
            animationDuration: storyBeats(s.dur),
          }}
        />
      ))}
    </svg>
  );
}
