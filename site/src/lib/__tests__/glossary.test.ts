import { describe, it, expect } from "vitest";
import { GLOSSARY } from "../glossary";

// URL-safe anchor id: lowercase letters, digits, hyphens only — matches
// what /glossary/#id and a future citation-drawer deep link can both use
// without percent-encoding.
const URL_SAFE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("GLOSSARY", () => {
  it("is non-empty", () => {
    expect(GLOSSARY.length).toBeGreaterThan(0);
  });

  it("gives every entry a non-empty term, expansion, and definition", () => {
    for (const entry of GLOSSARY) {
      expect(entry.term.trim().length, `${entry.id}: term`).toBeGreaterThan(0);
      expect(entry.expansion.trim().length, `${entry.id}: expansion`).toBeGreaterThan(0);
      expect(entry.definition.trim().length, `${entry.id}: definition`).toBeGreaterThan(0);
    }
  });

  it("gives every entry a URL-safe id", () => {
    for (const entry of GLOSSARY) {
      expect(entry.id, entry.id).toMatch(URL_SAFE_ID_RE);
    }
  });

  it("has unique ids", () => {
    const ids = GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique terms (case-insensitive) — no two entries claim the same stamped term", () => {
    const terms = GLOSSARY.map((e) => e.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("defines TOA (ROADMAP #60 — the term stamped on ~80,000 figures sitewide)", () => {
    const toa = GLOSSARY.find((e) => e.id === "toa");
    expect(toa).toBeDefined();
    expect(toa?.expansion.toLowerCase()).toContain("total obligational authority");
  });
});
