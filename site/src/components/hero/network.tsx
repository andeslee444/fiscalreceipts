import React from "react";
import { storyBeats } from "@/lib/motion";

/**
 * NetworkHero — 'cyber' category motif (Task 8a).
 * Static node-link mesh with 10 nodes pulsing (CSS opacity keyframes
 * `hero-net-pulse` — opacity is compositor-safe). Server component;
 * <desc> never <title> (recon §H).
 */

const NODES: { x: number; y: number; r: number; delay: number; dur: number }[] = [
  { x: 80, y: 60, r: 3.0, delay: 0.0, dur: 4.2 },
  { x: 190, y: 28, r: 2.2, delay: 0.8, dur: 5.0 },
  { x: 230, y: 92, r: 2.6, delay: 1.6, dur: 4.6 },
  { x: 350, y: 50, r: 3.4, delay: 2.4, dur: 4.0 },
  { x: 455, y: 96, r: 2.2, delay: 0.4, dur: 5.4 },
  { x: 500, y: 30, r: 2.8, delay: 1.2, dur: 4.4 },
  { x: 610, y: 70, r: 3.0, delay: 2.0, dur: 4.8 },
  { x: 700, y: 26, r: 2.0, delay: 2.8, dur: 4.3 },
  { x: 745, y: 92, r: 2.6, delay: 3.4, dur: 5.1 },
  { x: 320, y: 110, r: 2.0, delay: 1.0, dur: 4.7 },
];

const EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 5], [3, 9], [4, 5], [4, 6],
  [5, 6], [6, 7], [6, 8], [2, 9], [4, 9], [7, 8],
];

export function NetworkHero() {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      focusable="false"
    >
      <desc>
        Decorative cyber-network motif: a faint node mesh with nodes pulsing in
        the header background.
      </desc>
      {EDGES.map(([a, b], i) => (
        <line
          key={`edge-${i}`}
          x1={NODES[a].x}
          y1={NODES[a].y}
          x2={NODES[b].x}
          y2={NODES[b].y}
          stroke="currentColor"
          strokeWidth={0.6}
          opacity={0.55}
        />
      ))}
      {NODES.map((n, i) => (
        <circle
          key={`node-${i}`}
          cx={n.x}
          cy={n.y}
          r={n.r}
          fill="currentColor"
          className="hero-net-node"
          style={{
            animationDelay: `${n.delay}s`,
            animationDuration: storyBeats(n.dur),
          }}
        />
      ))}
    </svg>
  );
}
