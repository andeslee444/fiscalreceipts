/**
 * Unit tests for gate 21 leg (n) — a shared BLI code's members own their own
 * awards (ROADMAP #70), and the leg is not vacuous.
 *
 * The floor is the reason this file exists. Legs 1–3 of runSplitKeyAwardsLeg
 * (no PIID on two siblings; award_count == the sidecar's rows; the bare stub
 * owns nothing) are all perfectly satisfied by a corpus in which every member
 * page shows ZERO awards — which is precisely what split_key drift between
 * the mart and the sidecar writer produces. The leg's first standalone run
 * printed "0 member page(s) carry 0 award row(s)" and PASSED. These tests
 * pin that it cannot do so again.
 *
 * Synthetic pe_bli codes are used throughout so the leg's stub-HTML check
 * finds nothing in site/out and the tests do not depend on a build.
 *
 * Run via `npm test` (vitest).
 */

import { describe, it, expect } from "vitest";
import { runSplitKeyAwardsLeg } from "../program-skeleton.mjs";

/** Shape of the real corpus this branch publishes, transposed onto synthetic
 *  codes: 13 shared codes, 7 member pages carrying 86 award rows in total
 *  (0145-PANMC 3, 2101-WPN 23, 3010-SCN 5, 3010-OPN 3, 3050-OPN 50,
 *  3215-OPN 1, 4217-OPN 1 — measured 2026-09-04 from budget_line_awards). */
const LIVE_SHAPE = [
  ["TA", [0, 3]],
  ["TB", [0, 23]],
  ["TC", [5, 3]],
  ["TD", [0, 50]],
  ["TE", [0, 1]],
  ["TF", [0, 1]],
  ["TG", [0, 0]],
  ["TH", [0, 0]],
  ["TI", [0, 0]],
  ["TJ", [0, 0]],
  ["TK", [0, 0]],
  ["TL", [0, 0]],
  ["TM", [0, 0, 0]],
];

/** Build {programs, sidecars} from [[pe, [awardsPerMember…]], …]. */
function corpus(shape, { piidPerMember = false } = {}) {
  const programs = [];
  const sidecars = new Map();
  let piid = 0;
  for (const [pe, counts] of shape) {
    counts.forEach((n, i) => {
      const slug = `${pe}-M${i}`;
      const awards = [];
      for (let k = 0; k < n; k++) {
        awards.push({
          award_piid: piidPerMember ? `PIID-${pe}-${k}` : `PIID-${++piid}`,
          recipient_name: "ACME",
          confidence: "medium",
        });
      }
      programs.push({ pe_bli: pe, slug, award_count: n });
      sidecars.set(slug, { awards });
    });
  }
  return { programs, sidecars };
}

function run(shape, opts) {
  const { programs, sidecars } = corpus(shape, opts);
  const errors = [];
  const notes = [];
  runSplitKeyAwardsLeg({ errors, notes, sidecars, programs });
  return { errors, notes };
}

describe("leg n — non-vacuity floor", () => {
  it("passes on the corpus this branch publishes and says what it saw", () => {
    const { errors, notes } = run(LIVE_SHAPE);
    expect(errors).toEqual([]);
    expect(notes[0]).toContain("13 shared BLI code(s) checked");
    expect(notes[0]).toContain("7 member page(s) carry 86 award row(s)");
  });

  it("FAILS when every member page shows zero awards", () => {
    // The drift shape: the links exist in the mart, reach no page, and legs
    // 1-3 have nothing to object to.
    const zeroed = LIVE_SHAPE.map(([pe, counts]) => [pe, counts.map(() => 0)]);
    const { errors, notes } = run(zeroed);
    expect(notes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("only 0 shared-code member page(s) carry 0 award row(s)");
    expect(errors[0]).toContain("do not lower it to fit the build");
  });

  it("FAILS when one key's links stop reaching their page", () => {
    // Only the 50-row member goes dark: 6 pages / 36 rows — above the page
    // floor, below the row floor, and still green on legs 1-3.
    const partial = LIVE_SHAPE.map(([pe, counts]) =>
      pe === "TD" ? [pe, counts.map(() => 0)] : [pe, counts],
    );
    const { errors } = run(partial);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("6 shared-code member page(s) carry 36 award row(s)");
  });

  it("still reports the real defects it was written for", () => {
    // Same PIID on both members of one code — the #56 fusion shape.
    const { errors } = run(LIVE_SHAPE, { piidPerMember: true });
    const fused = errors.filter((e) => e.includes("is listed on BOTH"));
    expect(fused.length).toBeGreaterThan(0);
    expect(fused[0]).toContain("their money is never combined");
  });

  // 2026-09-04, final review I4: this case used to PASS with a friendly note.
  // Every check in the leg is satisfied by a corpus with no shared codes, so
  // "there are none" and "the exporter stopped emitting them" were the same
  // observation — and the second is the regression the leg exists for.
  it("FAILS when programs.json carries no shared codes at all", () => {
    const { errors, notes } = run([["TA", [3]]]);
    expect(notes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("carries 0 shared BLI code(s) (floor 10");
    expect(errors[0]).toContain("do not lower the floor");
  });

  it("FAILS just below the shared-code floor and passes at it", () => {
    const nine = LIVE_SHAPE.slice(0, 9);
    expect(run(nine).errors[0]).toContain("carries 9 shared BLI code(s) (floor 10");
    // Ten codes clears the universe floor; the award floors still apply and
    // are met by this slice (7 pages / 86 rows all sit in the first ten).
    const ten = LIVE_SHAPE.slice(0, 10);
    expect(run(ten).errors).toEqual([]);
  });
});
