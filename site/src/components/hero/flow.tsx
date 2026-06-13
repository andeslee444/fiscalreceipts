import React from "react";

/**
 * FlowHero — 'default' category motif (Task 8a).
 * The STATIC flow motif: appropriation-to-district dots and connectors with
 * NO animation (plan decision: 'default' renders the static motif only).
 * Server component; <desc> never <title> (recon §H).
 */

const STAGES = [120, 280, 440, 600, 730];
const LANES = [38, 62, 86];

export function FlowHero() {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      focusable="false"
    >
      <desc>
        Decorative static flow motif: dots connected left to right, echoing the
        appropriation-to-district money flow. Not animated.
      </desc>
      {LANES.map((y, li) => (
        <g key={`lane-${li}`}>
          <line
            x1={STAGES[0]}
            y1={y}
            x2={STAGES[STAGES.length - 1]}
            y2={y}
            stroke="currentColor"
            strokeWidth={0.6}
            strokeDasharray="2 6"
            opacity={0.6}
          />
          {STAGES.map((x, si) => (
            <circle
              key={`dot-${li}-${si}`}
              cx={x}
              cy={y}
              r={li === 1 ? 2.6 : 2}
              fill="currentColor"
              opacity={0.7}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
