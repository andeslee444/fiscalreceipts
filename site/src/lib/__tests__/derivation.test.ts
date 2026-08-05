/**
 * derivation — §P2-8 reproducible strips.
 *
 * The point of the module is that the printed equation CLOSES. So the tests
 * check closure on the two real defects, not just the happy path.
 */
import { describe, it, expect } from "vitest";
import {
  reproducibleSum,
  reproducibleDifference,
  toMillions,
} from "../derivation";

describe("toMillions", () => {
  it("normalises every recorded unit to the one printed unit", () => {
    expect(toMillions(5_283_300, "USD thousands")).toBeCloseTo(5283.3, 6);
    expect(toMillions(5283.3, "USD millions")).toBeCloseTo(5283.3, 6);
    expect(toMillions(5_283_300_000, "USD")).toBeCloseTo(5283.3, 6);
  });
});

describe("reproducibleDifference — the /program/ATA000/ strip", () => {
  it("closes the asked-vs-spent arithmetic the spec caught open", () => {
    // The real ATA000 shape: request $5.28B, actuals $5.57B, delta $286.5M.
    const request = toMillions(5_283_300, "USD thousands");
    const actuals = toMillions(5_569_800, "USD thousands");
    const r = reproducibleDifference(actuals, request, actuals - request);
    expect(r).not.toBeNull();
    expect(Number(r!.a.replace(/,/g, "")) - Number(r!.b.replace(/,/g, ""))).toBeCloseTo(
      Number(r!.delta.replace(/,/g, "")),
      9,
    );
    expect(r!.unitLabel).toBe("USD millions");
  });

  it("uses the SMALLEST precision that closes", () => {
    const r = reproducibleDifference(100.25, 50.15, 50.1);
    expect(r!.a).toBe("100.25");
    expect(r!.b).toBe("50.15");
    expect(r!.delta).toBe("50.10");
  });

  it("prints the subtrahend unsigned — the operator carries the sign", () => {
    const r = reproducibleDifference(10, 3, 7);
    expect(r!.b).toBe("3.0");
    expect(r!.b.startsWith("-")).toBe(false);
  });
});

describe("reproducibleSum — the /companies/ addend equations", () => {
  it("closes SAIC, whose compact addends visibly do not add up", () => {
    // $7.44B + $324.5K displayed as "= $7.45B": the compact sum reads $7.44B.
    const members = [7_436_551_142.29, 324_533.0].map((v) => toMillions(v, "USD"));
    const total = toMillions(7_436_875_675.29, "USD");
    const r = reproducibleSum(members, total);
    expect(r).not.toBeNull();
    const nums = r!.parts.map((p) => Number(p.replace(/,/g, "")));
    expect(nums.reduce((a, b) => a + b, 0)).toBeCloseTo(
      Number(r!.total.replace(/,/g, "")),
      9,
    );
  });

  it("closes a three-addend family", () => {
    const parts = [3_520_000_000, 3_310_000_000, 332_100_000].map((v) =>
      toMillions(v, "USD"),
    );
    const total = toMillions(7_162_100_000, "USD");
    const r = reproducibleSum(parts, total);
    expect(r).not.toBeNull();
    const nums = r!.parts.map((p) => Number(p.replace(/,/g, "")));
    expect(nums.reduce((a, b) => a + b, 0)).toBeCloseTo(
      Number(r!.total.replace(/,/g, "")),
      9,
    );
  });

  it("returns null rather than print an equation that does not close", () => {
    // A genuine disagreement: the parts do not sum to the total at ANY
    // precision, so there is nothing honest to print.
    expect(reproducibleSum([1, 2], 4)).toBeNull();
  });

  it("never hands a raw float to the formatter — output is derived from the rounding", () => {
    const r = reproducibleSum([0.1, 0.2], 0.30000000000000004);
    expect(r).not.toBeNull();
    expect(r!.parts).toEqual(["0.1", "0.2"]);
    expect(r!.total).toBe("0.3");
  });
});
