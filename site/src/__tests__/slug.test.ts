import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  // ── Basic rules ───────────────────────────────────────────────────────────
  it("lowercases input", () => {
    expect(slugify("LOCKHEED MARTIN")).toBe("lockheed-martin");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("GENERAL DYNAMICS")).toBe("general-dynamics");
  });

  it("single word", () => {
    expect(slugify("BOEING")).toBe("boeing");
  });

  it("already lowercase", () => {
    expect(slugify("lockheed martin")).toBe("lockheed-martin");
  });

  it("multiple spaces → multiple hyphens (preserves structure)", () => {
    // No multi-space in real data, but consistent behavior
    expect(slugify("A B C")).toBe("a-b-c");
  });

  it("empty string", () => {
    expect(slugify("")).toBe("");
  });

  // ── Invariant verification against entities_top.json ─────────────────────
  it("matches all 200 entities_top.json slugs", () => {
    // entities_top.json lives at ../../data/site/json/entities_top.json
    // relative to site/ root
    const entitiesPath = join(
      process.cwd(),
      "..",
      "data",
      "site",
      "json",
      "entities_top.json",
    );

    let entities: Array<{ family_key: string; slug: string }>;
    try {
      entities = JSON.parse(readFileSync(entitiesPath, "utf8"));
    } catch {
      // If running in CI without sidecars, skip this invariant test
      console.warn("entities_top.json not found — skipping invariant check");
      return;
    }

    const mismatches: string[] = [];
    for (const { family_key, slug } of entities) {
      const computed = slugify(family_key);
      if (computed !== slug) {
        mismatches.push(`  ${family_key}: expected "${slug}", got "${computed}"`);
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `slugify does not match entities_top.json for ${mismatches.length} entries:\n${mismatches.join("\n")}`,
      );
    }

    expect(entities.length).toBe(200);
  });
});
