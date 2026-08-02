/**
 * aliases.test.ts — program alias table (PM review §P1-4, Sprint 2 Task 1)
 *
 * The alias table is hand-curated and evidence-backed: every alias maps to a
 * pe_bli whose program payload (json-lite/program_details/{pe}.json) names the
 * alias. Scope: PROGRAM aliases only — separate from the LDA-cited
 * data-seeds/search_aliases.csv seeds (kind:'alias' quick-index docs).
 */

import { describe, it, expect } from "vitest";
import {
  PROGRAM_ALIASES,
  aliasMatchesForQuery,
  aliasesForPeBli,
  alnumKey,
} from "@/lib/aliases";

describe("alnumKey", () => {
  it("collapses to lowercase alphanumerics", () => {
    expect(alnumKey("F-35")).toBe("f35");
    expect(alnumKey("LGM-35A")).toBe("lgm35a");
    expect(alnumKey("Golden Dome")).toBe("goldendome");
    expect(alnumKey("  SM-6 ")).toBe("sm6");
  });
});

describe("PROGRAM_ALIASES table", () => {
  it("every entry has a pe_bli, /program/ url, ≥1 alias, and evidence", () => {
    expect(PROGRAM_ALIASES.length).toBeGreaterThan(0);
    for (const e of PROGRAM_ALIASES) {
      expect(e.peBli).toBeTruthy();
      expect(e.url).toBe(`/program/${e.peBli}/`);
      expect(e.aliases.length).toBeGreaterThan(0);
      expect(e.evidence).toBeTruthy();
    }
  });

  it("alias keys are unique per target (no same alias→same pe twice)", () => {
    const seen = new Set<string>();
    for (const e of PROGRAM_ALIASES) {
      for (const a of e.aliases) {
        const key = `${alnumKey(a)}→${e.peBli}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("aliasMatchesForQuery — full-query normalized match", () => {
  it("Sentinel → GBSD EMD 0605238F (the PM's exact repro)", () => {
    const hits = aliasMatchesForQuery("Sentinel");
    expect(hits.map((h) => h.peBli)).toContain("0605238F");
  });

  it("GBSD and LGM-35A also resolve to 0605238F", () => {
    expect(aliasMatchesForQuery("GBSD").map((h) => h.peBli)).toContain("0605238F");
    expect(aliasMatchesForQuery("LGM-35A").map((h) => h.peBli)).toContain("0605238F");
    expect(aliasMatchesForQuery("lgm35a").map((h) => h.peBli)).toContain("0605238F");
  });

  it("JSF → F-35 (ATA000)", () => {
    expect(aliasMatchesForQuery("JSF").map((h) => h.peBli)).toContain("ATA000");
  });

  it("Raider → B-21 Raider procurement line (B02100)", () => {
    expect(aliasMatchesForQuery("Raider").map((h) => h.peBli)).toContain("B02100");
  });

  it("B-21 maps to both the procurement (B02100) and RDT&E (0604015F) lines", () => {
    const pes = aliasMatchesForQuery("B-21").map((h) => h.peBli);
    expect(pes).toContain("B02100");
    expect(pes).toContain("0604015F");
  });

  it("SM-6 → Standard Missile Improvements (0604366N)", () => {
    expect(aliasMatchesForQuery("SM-6").map((h) => h.peBli)).toContain("0604366N");
    expect(aliasMatchesForQuery("sm6").map((h) => h.peBli)).toContain("0604366N");
  });

  it("Golden Dome → AEGIS BMD (0603892C)", () => {
    expect(aliasMatchesForQuery("Golden Dome").map((h) => h.peBli)).toContain(
      "0603892C",
    );
  });

  it("does NOT trigger on partial-query matches ('Sentinel Mods' is not the alias 'Sentinel')", () => {
    expect(aliasMatchesForQuery("Sentinel Mods")).toEqual([]);
  });

  it("returns [] for empty and unknown queries", () => {
    expect(aliasMatchesForQuery("")).toEqual([]);
    expect(aliasMatchesForQuery("   ")).toEqual([]);
    expect(aliasMatchesForQuery("zzzznotanalias")).toEqual([]);
  });
});

describe("aliasesForPeBli — chip source", () => {
  it("0605238F carries Sentinel / GBSD / LGM-35A", () => {
    const a = aliasesForPeBli("0605238F");
    expect(a).toContain("Sentinel");
    expect(a).toContain("GBSD");
    expect(a).toContain("LGM-35A");
  });

  it("returns null for programs without aliases", () => {
    expect(aliasesForPeBli("0601101E")).toBeNull();
  });
});
