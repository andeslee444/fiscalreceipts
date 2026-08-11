/**
 * hhi-band.mjs — DOJ/FTC Herfindahl-Hirschman Index concentration bands.
 *
 * SINGLE SOURCE for the three-way band vocabulary rendered by:
 *   - src/components/program-concentration.tsx  (the /program/{peBli}/
 *     "Contractor Concentration" badge — the destination page a homepage/
 *     feed concentration claim links to)
 *   - src/app/page.tsx                           (homepage lede gloss)
 *   - src/components/feed-headline.tsx           (per-card scope note,
 *     rendered on both the homepage lede and every /feed/ card)
 *   - scripts/gates/feed.mjs                     (leg l: claim vs. the
 *     destination page it links to)
 *
 * Plain .mjs, not .ts, ON PURPOSE. scripts/gates/*.mjs run under plain Node
 * and cannot import .ts modules — see src/lib/format.ts's COMPACT_RUNGS
 * comment, which hand-mirrors a constant into feed-model.mjs for exactly
 * this reason and leans on a vitest parity sweep to catch drift between the
 * two copies. Backlog #48 hit the same failure mode from the other
 * direction: BASIS_LABEL was mirrored between src/lib/basis.ts and
 * scripts/gates/basis.mjs, and the site copy went stale while the gate copy
 * (correctly) moved on. Making the HHI band function .mjs from the start
 * means every consumer — TS pages via `import ... from "@/lib/hhi-band.mjs"`
 * (the site already does this for feed-model.mjs) and the gate script via a
 * plain relative import — share the literal same function. There is no
 * mirror to forget to update twice.
 *
 * BANDS. Standard DOJ/FTC Horizontal Merger Guidelines convention:
 *   HHI <  1,500              unconcentrated    ("Competitive")
 *   1,500 <= HHI <  2,500     moderately concentrated
 *   HHI >= 2,500               highly concentrated
 *
 * 2,500 is the "highly concentrated" FLOOR, not a "near-monopoly" line —
 * four EQUAL-share firms alone produce exactly 2,500 (4 * 25^2 = 2,500), and
 * nobody calls four equal competitors a near-monopoly. The site previously
 * split on `value >= 2500` into "a near-monopoly concentration score" for
 * one side and, for EVERYTHING below that (including genuinely low, truly
 * competitive values), "a high supplier-concentration score" — both
 * editorial overstatements with no defensible anchor at the boundary. This
 * module carries no editorial adjectives, only the standard vocabulary.
 */

export const HHI_MODERATE_MIN = 1500;
export const HHI_CONCENTRATED_MIN = 2500;

/**
 * @typedef {{ key: "competitive" | "moderate" | "concentrated", label: string }} HhiBand
 */

/**
 * @param {number} value
 * @returns {HhiBand}
 */
export function hhiBand(value) {
  if (value >= HHI_CONCENTRATED_MIN) {
    return { key: "concentrated", label: "Highly Concentrated" };
  }
  if (value >= HHI_MODERATE_MIN) {
    return { key: "moderate", label: "Moderately Concentrated" };
  }
  return { key: "competitive", label: "Competitive" };
}
