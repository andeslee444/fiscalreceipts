import React from "react";

/**
 * SwarmHero — 'drones' category motif (Task 8a).
 * 12 small chevrons drifting (CSS transform keyframes `hero-drift`,
 * compositor-only). Server component; <desc> never <title> (recon §H).
 */

const DOTS: { x: number; y: number; delay: number; dur: number; s: number }[] = [
  { x: 70, y: 78, delay: 0.0, dur: 6.4, s: 1.0 },
  { x: 150, y: 36, delay: 1.1, dur: 7.6, s: 0.8 },
  { x: 225, y: 92, delay: 2.3, dur: 6.9, s: 1.1 },
  { x: 305, y: 52, delay: 0.6, dur: 8.0, s: 0.7 },
  { x: 380, y: 84, delay: 1.8, dur: 7.1, s: 1.0 },
  { x: 450, y: 30, delay: 3.0, dur: 6.6, s: 0.9 },
  { x: 525, y: 70, delay: 0.3, dur: 7.8, s: 1.2 },
  { x: 600, y: 44, delay: 2.6, dur: 6.2, s: 0.8 },
  { x: 660, y: 90, delay: 1.4, dur: 7.4, s: 1.0 },
  { x: 715, y: 58, delay: 3.4, dur: 6.8, s: 0.9 },
  { x: 545, y: 100, delay: 4.1, dur: 7.2, s: 0.7 },
  { x: 120, y: 105, delay: 2.0, dur: 8.2, s: 1.1 },
];

export function SwarmHero() {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      focusable="false"
    >
      <desc>
        Decorative drone-swarm motif: small chevrons drifting slowly across the
        header background.
      </desc>
      {DOTS.map((d, i) => (
        <path
          key={i}
          d={`M ${d.x - 6 * d.s} ${d.y + 3 * d.s} L ${d.x} ${d.y - 3 * d.s} L ${d.x + 6 * d.s} ${d.y + 3 * d.s}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5 * d.s}
          strokeLinecap="round"
          className="hero-swarm-dot"
          style={{
            animationDelay: `${d.delay}s`,
            animationDuration: `${d.dur}s`,
          }}
        />
      ))}
    </svg>
  );
}
