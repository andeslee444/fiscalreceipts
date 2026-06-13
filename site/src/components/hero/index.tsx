import React from "react";
import type { HeroCategory } from "@/lib/data";
import { SwarmHero } from "./swarm";
import { TrajectoryHero } from "./trajectory";
import { ConstellationHero } from "./constellation";
import { HullHero } from "./hull";
import { NetworkHero } from "./network";
import { FlowHero } from "./flow";

/**
 * CategoryHero (Task 8a) — subtle background layer for program headers on
 * the top-50 dossier pages. Category → motif:
 *
 *   drones        → SwarmHero          (animated)
 *   hypersonics   → TrajectoryHero     (animated)
 *   space         → ConstellationHero  (animated)
 *   shipbuilding  → HullHero           (animated)
 *   cyber         → NetworkHero        (animated)
 *   default       → FlowHero           (STATIC — no animation, by decision)
 *
 * All motifs are pure server-rendered SVG; animation is CSS-only
 * (transform/opacity keyframes in globals.css — compositor-safe) so animated
 * and non-animated program pages reference the IDENTICAL chunk set
 * (animation gate, recon §I). prefers-reduced-motion kills all animation via
 * the `.hero-anim *` rule in globals.css. Tasteful constraints: low contrast
 * (muted color at low opacity), behind text, ≤24 animated nodes per motif.
 */

const HERO_BY_CATEGORY: Record<HeroCategory, React.ComponentType> = {
  drones: SwarmHero,
  hypersonics: TrajectoryHero,
  space: ConstellationHero,
  shipbuilding: HullHero,
  cyber: NetworkHero,
  default: FlowHero,
};

export function CategoryHero({ category }: { category: HeroCategory }) {
  const Hero = HERO_BY_CATEGORY[category] ?? FlowHero;
  return (
    <div
      className="hero-anim pointer-events-none absolute inset-0 select-none overflow-hidden text-muted-foreground opacity-[0.16]"
      aria-hidden="true"
      data-hero-category={category}
    >
      <Hero />
    </div>
  );
}
