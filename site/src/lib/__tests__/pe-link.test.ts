import { describe, it, expect } from "vitest";

import {
  PE_TOKEN_RE,
  findPeLinks,
  segmentBody,
  projectAnchorId,
  type BodySegment,
} from "@/lib/pe-link";

const PE_SET = new Set([
  "0601101E",
  "0601122E",
  "0602025E",
  "0604250D8Z",
  "1160403BB",
]);

function tokensOf(text: string): string[] {
  return [...text.matchAll(new RegExp(PE_TOKEN_RE.source, "g"))].map((m) => m[0]);
}

describe("PE_TOKEN_RE", () => {
  it("matches the real PE shapes (7 digits + letter + up to 2 alnum)", () => {
    expect(tokensOf("funded in PE 0601122E next year")).toEqual(["0601122E"]);
    expect(tokensOf("see 0604250D8Z and 1160403BB")).toEqual([
      "0604250D8Z",
      "1160403BB",
    ]);
  });

  it("does not match BLI codes or plain numbers", () => {
    expect(tokensOf("2012C130J")).toEqual([]); // BLI, not PE-shaped
    expect(tokensOf("000042")).toEqual([]); // numeric BLI
    expect(tokensOf("$1,234,567 in FY2026")).toEqual([]);
    expect(tokensOf("12345678")).toEqual([]);
  });
});

describe("findPeLinks", () => {
  it("links only tokens present in the known PE set", () => {
    const links = findPeLinks(
      "funded in PE 0601122E and PE 9999999Z, Project X",
      PE_SET,
    );
    expect(links).toHaveLength(1);
    expect(links[0].token).toBe("0601122E");
    expect(links[0].href).toBe("/program/0601122E/");
  });

  it("excludes self-references", () => {
    const links = findPeLinks("this is PE 0601101E itself", PE_SET, {
      selfPe: "0601101E",
    });
    expect(links).toHaveLength(0);
  });

  it("resolves 'PE X, Project Y' references to project anchors when the project exists", () => {
    const projects = (pe: string) =>
      pe === "0601122E" ? new Set(["EMR-01"]) : new Set<string>();
    const links = findPeLinks(
      "will be funded in PE 0601122E, Project EMR-01 and PE 0602025E, Project MSL-05.",
      PE_SET,
      { projectsByPe: projects },
    );
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe("/program/0601122E/#project-EMR-01");
    // MSL-05 not in 0602025E's project set → plain program link, never a
    // fake anchor.
    expect(links[1].href).toBe("/program/0602025E/");
  });

  it("returns offsets that slice the token exactly", () => {
    const body = "Beginning in FY 2026, funded in PE 0601122E, Project EMR-01.";
    const [link] = findPeLinks(body, PE_SET);
    expect(body.slice(link.start, link.end)).toBe("0601122E");
  });
});

describe("segmentBody", () => {
  it("splits a body around links, preserving every character", () => {
    const body = "abc 0601122E def";
    const segs = segmentBody(body, [
      { start: 4, end: 12, kind: "pe", href: "/program/0601122E/" },
    ]);
    expect(segs.map((s: BodySegment) => s.text).join("")).toBe(body);
    expect(segs).toHaveLength(3);
    expect(segs[1]).toMatchObject({ kind: "pe", text: "0601122E" });
  });

  it("handles multiple links with adjacent text and links at both ends", () => {
    const body = "$25.000 million and $14.220 million";
    const segs = segmentBody(body, [
      { start: 0, end: 15, kind: "amount", factId: "aaaaaaaaaaaaaaaa" },
      { start: 20, end: 35, kind: "amount", factId: "bbbbbbbbbbbbbbbb" },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(body);
    expect(segs.filter((s) => s.kind === "amount")).toHaveLength(2);
    expect(segs[0].text).toBe("$25.000 million");
    expect(segs[1].text).toBe(" and ");
    expect(segs[2].text).toBe("$14.220 million");
  });

  it("drops out-of-range and overlapping ranges instead of corrupting text", () => {
    const body = "short";
    const segs = segmentBody(body, [
      { start: 0, end: 3, kind: "amount", factId: "aaaaaaaaaaaaaaaa" },
      { start: 2, end: 5, kind: "pe", href: "/program/x/" }, // overlaps → dropped
      { start: 10, end: 20, kind: "pe", href: "/program/y/" }, // out of range → dropped
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(body);
    expect(segs.filter((s) => s.kind !== "text")).toHaveLength(1);
  });
});

describe("projectAnchorId", () => {
  it("builds DOM-safe project anchor ids", () => {
    expect(projectAnchorId("EMR-01")).toBe("project-EMR-01");
    expect(projectAnchorId("MD45")).toBe("project-MD45");
    expect(projectAnchorId("A B/C")).toBe("project-A_B_C");
  });
});
