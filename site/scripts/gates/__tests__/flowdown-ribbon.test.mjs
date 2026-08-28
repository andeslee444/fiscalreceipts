/**
 * Unit tests for gate 22 leg (g)'s path measurement (ROADMAP #29(c)).
 *
 * The leg's whole claim is "we measured the ribbon the browser will paint,
 * not the geometry the exporter meant to lay out". These tests hold the
 * measurement to that: the parser is fed the output of the SITE'S OWN
 * ribbonPath() — the exact function the renderer calls — and must recover the
 * band it was given, must NOTICE when one face is thicker than the other, and
 * must throw rather than silently report a number for a path shape it does not
 * understand. A parser that quietly returns something plausible for an
 * unrecognised path is how a gate goes vacuous.
 */

import { describe, it, expect } from "vitest";
import { onPathPoints, ribbonFaces } from "../flowdown.mjs";
import { ribbonPath } from "@/components/flow-chart/geometry";

describe("onPathPoints", () => {
  it("keeps only the points the curve passes through, not the controls", () => {
    // 4 on-path points from an M + 2 C's + 1 L (6 control points dropped).
    const pts = onPathPoints(ribbonPath(10, 90, [4, 12, 20, 28]));
    expect(pts).toEqual([
      [10, 4],
      [90, 20],
      [90, 28],
      [10, 12],
    ]);
  });

  it("throws on a command it cannot measure rather than guessing", () => {
    expect(() => onPathPoints("M 0,0 q 5 5 10 0")).toThrow(/measures absolute/);
    expect(() => onPathPoints("m 0,0 L 5,5")).toThrow(/measures absolute/);
  });
});

describe("ribbonFaces", () => {
  it("recovers both faces of a real ribbonPath band", () => {
    const f = ribbonFaces(ribbonPath(10, 90, [4, 12, 20, 28]));
    expect(f.source).toBeCloseTo(8, 6);
    expect(f.target).toBeCloseTo(8, 6);
  });

  it("catches a band that is thicker at one end — the shape a value encodes", () => {
    const f = ribbonFaces(ribbonPath(10, 90, [4, 12, 20, 44]));
    expect(f.source).toBeCloseTo(8, 6);
    expect(f.target).toBeCloseTo(24, 6);
  });

  it("distinguishes two bands of different thickness", () => {
    const thin = ribbonFaces(ribbonPath(0, 100, [0, 8, 0, 8]));
    const fat = ribbonFaces(ribbonPath(0, 100, [0, 30, 0, 30]));
    expect(thin.source).not.toBeCloseTo(fat.source, 3);
  });

  it("throws when the faces are not two points each (shape changed)", () => {
    expect(() => ribbonFaces("M 0,0 L 10,0 L 10,10 Z")).toThrow(
      /on-path points|2\+2/,
    );
  });
});
