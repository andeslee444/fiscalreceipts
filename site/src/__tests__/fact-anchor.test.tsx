/**
 * fact-anchor — the `#fact-{id}` deep-link handler (PM Sprint 1 Task 5,
 * spec §P0-4.2: "#fact-{id} on any page scrolls to the figure, focuses it,
 * and opens the drawer").
 *
 * Contract under test:
 *   parseFactHash(hash)
 *     - "#fact-{8..16 hex}" → lowercase id; anything else → null
 *   findFactElement(root, id)
 *     - exact [data-fact-id="{id}"] match wins; otherwise the FIRST
 *       [data-fact-id^="{id}"] prefix match in document order (8-hex public
 *       ids are a prefix of the full 16-hex id)
 *   <FactAnchor />
 *     - on mount with a matching location.hash: scrolls the element into
 *       view, applies the temporary highlight class, and SYNTHESIZES A CLICK
 *       on the element — reusing the <Cite> click wiring (figure-context
 *       threading included) instead of calling openPanel directly
 *     - no hash / no matching element → no scroll, no click
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import {
  parseFactHash,
  findFactElement,
  FactAnchor,
  FACT_ANCHOR_HIGHLIGHT_CLASS,
} from "@/components/fact-anchor";

describe("parseFactHash", () => {
  it("parses 8-hex and 16-hex ids", () => {
    expect(parseFactHash("#fact-bb54b165")).toBe("bb54b165");
    expect(parseFactHash("#fact-bb54b1658b2746cb")).toBe("bb54b1658b2746cb");
  });

  it("lowercases", () => {
    expect(parseFactHash("#fact-BB54B165")).toBe("bb54b165");
  });

  it("rejects other hashes", () => {
    expect(parseFactHash("")).toBeNull();
    expect(parseFactHash("#fact-")).toBeNull();
    expect(parseFactHash("#fact-zzz")).toBeNull();
    expect(parseFactHash("#fact-bb54b1")).toBeNull(); // too short
    expect(parseFactHash("#section-2")).toBeNull();
  });
});

describe("findFactElement", () => {
  function dom(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }

  it("prefers the exact data-fact-id match", () => {
    const root = dom(`
      <span data-fact-id="bb54b165ffffffff">wrong</span>
      <span data-fact-id="bb54b1658b2746cb" id="exact">right</span>
    `);
    const el = findFactElement(root, "bb54b1658b2746cb");
    expect(el?.id).toBe("exact");
  });

  it("falls back to the first prefix match in document order (8-hex id)", () => {
    const root = dom(`
      <span data-fact-id="bb54b1658b2746cb" id="first">a</span>
      <span data-fact-id="bb54b1658b2746cb" id="second">b</span>
    `);
    const el = findFactElement(root, "bb54b165");
    expect(el?.id).toBe("first");
  });

  it("returns null when nothing matches", () => {
    const root = dom(`<span data-fact-id="aa00000000000000">x</span>`);
    expect(findFactElement(root, "bb54b165")).toBeNull();
  });
});

describe("<FactAnchor />", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    window.location.hash = "";
  });

  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("scrolls, highlights, and clicks the target figure for #fact-{fid8}", () => {
    window.location.hash = "#fact-bb54b165";
    const onClick = vi.fn();
    const { container } = render(
      <div>
        <span data-fact-id="bb54b1658b2746cb" onClick={onClick} role="button">
          $5.25B
        </span>
        <FactAnchor />
      </div>,
    );
    const target = container.querySelector("[data-fact-id]") as HTMLElement;
    expect(scrollSpy).toHaveBeenCalled();
    expect(target.classList.contains(FACT_ANCHOR_HIGHLIGHT_CLASS)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a #fact- hash", () => {
    const onClick = vi.fn();
    render(
      <div>
        <span data-fact-id="bb54b1658b2746cb" onClick={onClick} role="button">
          $5.25B
        </span>
        <FactAnchor />
      </div>,
    );
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does nothing when no element carries the fact id", () => {
    window.location.hash = "#fact-deadbeef";
    render(
      <div>
        <span data-fact-id="bb54b1658b2746cb" role="button">
          $5.25B
        </span>
        <FactAnchor />
      </div>,
    );
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
