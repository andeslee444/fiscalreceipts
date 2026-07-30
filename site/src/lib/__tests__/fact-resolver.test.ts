/**
 * fact-resolver.ts — pure id-parsing + shard-resolution logic behind the
 * /fact/{id} permalink page (PM Sprint 1 Task 5, spec §P0-4).
 *
 * Contract under test:
 *   parseFactPermalinkId(pathname, search)
 *     - `/fact/{id}` path segment wins; `?id=` is the fallback
 *     - accepts 8-hex public ids AND 16-hex full ids (any 8..16-hex prefix),
 *       case-insensitive, normalized to lowercase; trailing slash tolerated
 *     - anything else (short, non-hex, absent) → null
 *   resolveFactMatches(shard, id)
 *     - 16-hex id → exact key lookup
 *     - shorter id → PREFIX scan (the collision rule: fid8 prefixes are NOT
 *       guaranteed unique — today's corpus has 2 colliding pairs — so ALL
 *       matches return, sorted by factId, and the page renders each with a
 *       disambiguation note)
 *     - null/missing shard → [] (caller distinguishes fetch failure)
 */

import { describe, it, expect } from "vitest";
import {
  parseFactPermalinkId,
  resolveFactMatches,
} from "@/lib/fact-resolver";
import type { Citation, CitationsMap } from "@/lib/citations";

const CIT_A = { kind: "workbook", units: "USD thousands" } as unknown as Citation;
const CIT_B = { kind: "jbook_pdf", units: "USD millions" } as unknown as Citation;

describe("parseFactPermalinkId", () => {
  it("parses an 8-hex public id from the pathname", () => {
    expect(parseFactPermalinkId("/fact/bb54b165", "")).toBe("bb54b165");
  });

  it("parses a 16-hex full id from the pathname (trailing slash tolerated)", () => {
    expect(parseFactPermalinkId("/fact/bb54b1658b2746cb/", "")).toBe(
      "bb54b1658b2746cb",
    );
  });

  it("lowercases uppercase hex", () => {
    expect(parseFactPermalinkId("/fact/BB54B165", "")).toBe("bb54b165");
  });

  it("falls back to ?id= when the pathname carries no id", () => {
    expect(parseFactPermalinkId("/fact/", "?id=bb54b1658b2746cb")).toBe(
      "bb54b1658b2746cb",
    );
  });

  it("pathname id wins over ?id=", () => {
    expect(parseFactPermalinkId("/fact/bb54b165", "?id=deadbeef")).toBe(
      "bb54b165",
    );
  });

  it("rejects non-hex ids", () => {
    expect(parseFactPermalinkId("/fact/zzznothex", "")).toBeNull();
    expect(parseFactPermalinkId("/fact/", "?id=zzznothex1")).toBeNull();
  });

  it("rejects ids shorter than 8 or longer than 16 hex chars", () => {
    expect(parseFactPermalinkId("/fact/bb54b1", "")).toBeNull();
    expect(
      parseFactPermalinkId("/fact/bb54b1658b2746cb0", ""), // 17 chars
    ).toBeNull();
  });

  it("returns null for the bare /fact/ page with no id anywhere", () => {
    expect(parseFactPermalinkId("/fact/", "")).toBeNull();
    expect(parseFactPermalinkId("/fact", "")).toBeNull();
  });
});

describe("resolveFactMatches", () => {
  const shard: CitationsMap = {
    bb54b1658b2746cb: CIT_A,
    bb54b165ffffffff: CIT_B,
    bb99999999999999: CIT_A,
  };

  it("16-hex id resolves by exact key", () => {
    const m = resolveFactMatches(shard, "bb54b1658b2746cb");
    expect(m).toHaveLength(1);
    expect(m[0].factId).toBe("bb54b1658b2746cb");
    expect(m[0].citation).toBe(CIT_A);
  });

  it("16-hex miss returns []", () => {
    expect(resolveFactMatches(shard, "bb00000000000000")).toHaveLength(0);
  });

  it("8-hex unique prefix resolves to its one fact", () => {
    const m = resolveFactMatches(shard, "bb999999");
    expect(m).toHaveLength(1);
    expect(m[0].factId).toBe("bb99999999999999");
  });

  it("8-hex COLLIDING prefix returns ALL matches sorted by factId", () => {
    const m = resolveFactMatches(shard, "bb54b165");
    expect(m.map((x) => x.factId)).toEqual([
      "bb54b1658b2746cb",
      "bb54b165ffffffff",
    ]);
  });

  it("8-hex no-match returns []", () => {
    expect(resolveFactMatches(shard, "bb111111")).toHaveLength(0);
  });

  it("null shard returns [] (fetch failure handled by the caller)", () => {
    expect(resolveFactMatches(null, "bb54b165")).toHaveLength(0);
  });
});
