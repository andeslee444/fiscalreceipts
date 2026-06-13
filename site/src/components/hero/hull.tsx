import React from "react";

/**
 * HullHero — 'shipbuilding' category motif (Task 8a).
 * Static hull silhouette with frame ribs + 3 water lines swaying
 * (CSS transform keyframes `hero-wave`, compositor-only).
 * Server component; <desc> never <title> (recon §H).
 */

const RIB_XS = [300, 345, 390, 435, 480, 525];

const WAVES: { y: number; delay: number; dur: number }[] = [
  { y: 92, delay: 0.0, dur: 7.0 },
  { y: 100, delay: 1.4, dur: 8.4 },
  { y: 108, delay: 2.8, dur: 7.7 },
];

function wavePath(y: number): string {
  // Gentle repeating wave across (and past) the viewBox so horizontal sway
  // never exposes an edge.
  const seg = 80;
  let d = `M -120 ${y}`;
  for (let x = -120; x < 920; x += seg) {
    d += ` q ${seg / 4} -6 ${seg / 2} 0 t ${seg / 2} 0`;
  }
  return d;
}

export function HullHero() {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      focusable="false"
    >
      <desc>
        Decorative shipbuilding motif: a hull cross-section under construction
        above gently swaying water lines.
      </desc>
      {/* Hull silhouette (bow to stern) */}
      <path
        d="M 250 38 Q 248 78 286 90 L 540 90 Q 586 80 600 38"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      {/* Keel line */}
      <line x1={262} y1={88} x2={566} y2={88} stroke="currentColor" strokeWidth={0.6} opacity={0.6} />
      {/* Frame ribs */}
      {RIB_XS.map((x, i) => (
        <line
          key={`rib-${i}`}
          x1={x}
          y1={42}
          x2={x}
          y2={88}
          stroke="currentColor"
          strokeWidth={0.7}
          opacity={0.7}
        />
      ))}
      {/* Gantry crane (static) */}
      <path
        d="M 640 90 L 640 22 L 700 22 L 700 90 M 612 22 L 700 22 M 622 22 L 622 34"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.8}
      />
      {/* Water lines (animated sway) */}
      {WAVES.map((w, i) => (
        <path
          key={`wave-${i}`}
          d={wavePath(w.y)}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.9}
          opacity={0.7}
          className="hero-wave"
          style={{
            animationDelay: `${w.delay}s`,
            animationDuration: `${w.dur}s`,
          }}
        />
      ))}
    </svg>
  );
}
