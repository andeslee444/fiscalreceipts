import { describe, it, expect } from "vitest";
import { evidenceKindLabel, evidenceKindTitle } from "@/lib/evidence";

describe("evidenceKindLabel (#52) — no row renders without saying its tier", () => {
  it("labels the three qualifying tiers distinctly", () => {
    expect(evidenceKindLabel("pe_literal")).toBe("PE code cited directly");
    expect(evidenceKindLabel("alias")).toBe("matched a known alias");
    expect(evidenceKindLabel("multi_token")).toBe("matched 2+ title words");
  });

  it("never crashes on missing/unknown data — falls back to a labelled unknown", () => {
    expect(evidenceKindLabel(null)).toBe("unclassified match");
    expect(evidenceKindLabel(undefined)).toBe("unclassified match");
    expect(evidenceKindLabel("something_new")).toBe("unclassified match");
  });

  it("evidenceKindTitle gives a distinct, non-empty rationale per tier", () => {
    const kinds = ["pe_literal", "alias", "multi_token"] as const;
    const titles = kinds.map((k) => evidenceKindTitle(k));
    for (const t of titles) expect(t.length).toBeGreaterThan(20);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("multi_token's rationale states the >=2-word rule (the actual #52 fix)", () => {
    expect(evidenceKindTitle("multi_token")).toMatch(/two distinct/i);
  });
});
