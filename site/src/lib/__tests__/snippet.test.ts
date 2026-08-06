import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isTruncatedSnippet, tidySnippet, SNIPPET_CAP } from "@/lib/snippet";

/** The real snippet the judges quoted, verbatim from the shipped sidecar. */
const REAL =
  "Support for civil/military space programs including NASA's Gateway program and nuclear modernization in FY2026/2027 Defe";

describe("tidySnippet — a cut word is not a summary", () => {
  it("cuts the partial word and closes with one ellipsis", () => {
    expect(tidySnippet(REAL)).toBe(
      "Support for civil/military space programs including NASA's Gateway program and nuclear modernization in FY2026/2027…",
    );
  });

  it("only ever REMOVES text — the result is a prefix of the source", () => {
    const out = tidySnippet(REAL).replace(/…$/, "");
    expect(REAL.startsWith(out)).toBe(true);
  });

  it("leaves a complete short description alone — no false ellipsis", () => {
    const short = "Appropriations for the Defense Health Program.";
    expect(tidySnippet(short)).toBe(short);
    expect(isTruncatedSnippet(short)).toBe(false);
  });

  it("leaves a long description that ENDS a sentence alone", () => {
    const full = "x".repeat(SNIPPET_CAP - 1) + ".";
    expect(tidySnippet(full)).toBe(full);
  });

  it("adds exactly one ellipsis, never two", () => {
    expect(tidySnippet(REAL).match(/…/g)).toHaveLength(1);
    expect(tidySnippet(tidySnippet(REAL))).toBe(tidySnippet(REAL));
  });

  it("drops the dangling comma or slash a cut can leave behind", () => {
    const s = "a".repeat(SNIPPET_CAP - 10) + " and, more,";
    expect(tidySnippet(s).endsWith(",…")).toBe(false);
    expect(tidySnippet(s).endsWith("…")).toBe(true);
  });

  it("does not gut a long string that has no late word boundary", () => {
    const noSpaces = "https://example.gov/" + "b".repeat(SNIPPET_CAP);
    const out = tidySnippet(noSpaces);
    // Keeps its characters; only the ellipsis is added.
    expect(out).toBe(noSpaces + "…");
  });

  /**
   * The regression, over the SHIPPED corpus rather than a fixture: not one
   * rendered snippet may end mid-word. "Mid-word" = the last character before
   * the ellipsis is a letter AND the source had a space later than it (i.e. a
   * whole word was available and we cut inside one anyway).
   */
  it("leaves no mid-word cut anywhere in the shipped filings", () => {
    const dir = resolve(__dirname, "../../../../data/site/json/filings");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).slice(0, 600);
    let checked = 0;
    let truncated = 0;
    for (const f of files) {
      let payload: { mentions?: { description_snippet?: string | null }[] };
      try {
        payload = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
      } catch {
        continue;
      }
      for (const m of payload.mentions ?? []) {
        const raw = m.description_snippet;
        if (!raw) continue;
        checked++;
        const out = tidySnippet(raw);
        if (!out.endsWith("…")) continue;
        truncated++;
        const body = out.slice(0, -1);
        // The rendered text must not end INSIDE a word: whatever the source
        // had at the cut point must not be another word character. (Stripped
        // trailing punctuation is fine — "H.R. 4275-" rendering as
        // "H.R. 4275…" ends a whole token.)
        const next = raw.slice(body.length, body.length + 1);
        expect(
          next === "" || !/[A-Za-z0-9]/.test(next),
          `${f}: "${out.slice(-40)}" cuts into "${raw.slice(body.length - 6, body.length + 10)}"`,
        ).toBe(true);
      }
    }
    // Vacuity: the corpus must actually exercise both branches.
    expect(checked).toBeGreaterThan(500);
    expect(truncated).toBeGreaterThan(100);
  });
});
