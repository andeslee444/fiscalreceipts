/**
 * Tests for the three-state <Cite> contract.
 *
 * Gate spec (render_static_gate):
 *   State A: [data-amount][data-fact-id]
 *   State B: [data-amount][data-citation-kind="xml-path"][data-xml-path]
 *   State C: [data-amount][data-uncited="true"]
 *
 * These tests verify the DOM attributes exactly so the gate script can rely on them.
 */

import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Cite, CitationPanelContext, ReceiptsContext } from "@/components/cite";

describe("Cite three-state contract", () => {
  // ── State A: cited ─────────────────────────────────────────────────────────
  describe("State A — factId provided (cited)", () => {
    it("renders data-amount attribute", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" factId="abc123def456" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toBeNull();
    });

    it("renders data-fact-id with the provided factId", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" factId="abc123def4567890" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-fact-id", "abc123def4567890");
    });

    it("does NOT have data-uncited or data-citation-kind attributes", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" factId="abc123def456" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-uncited");
      expect(el).not.toHaveAttribute("data-citation-kind");
    });

    it("displays the formatted amount", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" factId="abc123" />,
      );
      // 280494 thousands = $280.5M
      expect(container.textContent).toContain("$280.5M");
    });

    it("has exactTitle in title attribute", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" factId="abc123" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("title");
      const title = el!.getAttribute("title")!;
      expect(title).toContain("280,494");
      expect(title).toContain("USD thousands");
    });

    it("calls openPanel with factId on click", async () => {
      let calledWith: string | null = null;
      const { container } = render(
        <CitationPanelContext.Provider
          value={{ openPanel: (id) => { calledWith = id; } }}
        >
          <Cite value={100} units="USD millions" factId="test-fact-001" />
        </CitationPanelContext.Provider>,
      );
      const el = container.querySelector("[data-amount]") as HTMLElement;
      el.click();
      expect(calledWith).toBe("test-fact-001");
    });

    it("has role='button' and tabIndex=0 for keyboard accessibility", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" factId="abc123def456" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("role", "button");
      expect(el).toHaveAttribute("tabindex", "0");
    });

    it("calls openPanel on Enter keydown", () => {
      let calledWith: string | null = null;
      const { container } = render(
        <CitationPanelContext.Provider
          value={{ openPanel: (id) => { calledWith = id; } }}
        >
          <Cite value={100} units="USD millions" factId="test-fact-enter" />
        </CitationPanelContext.Provider>,
      );
      const el = container.querySelector("[data-amount]") as HTMLElement;
      fireEvent.keyDown(el, { key: "Enter" });
      expect(calledWith).toBe("test-fact-enter");
    });
  });

  // ── State B: xml-path ──────────────────────────────────────────────────────
  describe("State B — xmlPath provided, no factId (zero-amount chip)", () => {
    it("renders data-amount attribute", () => {
      const { container } = render(
        <Cite
          value={0}
          units="USD millions"
          xmlPath="ProgramElement[0]/Project[4]"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toBeNull();
    });

    it("renders data-citation-kind='xml-path'", () => {
      const { container } = render(
        <Cite
          value={0}
          units="USD millions"
          xmlPath="ProgramElement[0]/Project[4]"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-citation-kind", "xml-path");
    });

    it("renders data-xml-path with the provided path", () => {
      const path = "ProgramElement[0]/Project[4]";
      const { container } = render(
        <Cite value={0} units="USD millions" xmlPath={path} />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-xml-path", path);
    });

    it("does NOT have data-fact-id or data-uncited", () => {
      const { container } = render(
        <Cite value={0} units="USD millions" xmlPath="ProgramElement[0]" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-fact-id");
      expect(el).not.toHaveAttribute("data-uncited");
    });

    it("shows the xml path in a chip", () => {
      const path = "ProgramElement[0]/Project[4]";
      const { container } = render(
        <Cite value={0} units="USD millions" xmlPath={path} />,
      );
      // The chip span inside should show the path text
      expect(container.textContent).toContain(path);
    });

    it("factId takes precedence over xmlPath (A wins)", () => {
      const { container } = render(
        <Cite
          value={100}
          units="USD millions"
          factId="fact-wins"
          xmlPath="ProgramElement[0]"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-fact-id", "fact-wins");
      expect(el).not.toHaveAttribute("data-citation-kind");
    });
  });

  // ── State C: uncited ───────────────────────────────────────────────────────
  describe("State C — no factId, no xmlPath (uncited)", () => {
    it("renders data-amount attribute", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toBeNull();
    });

    it("renders data-uncited='true'", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-uncited", "true");
    });

    it("does NOT have data-fact-id or data-citation-kind", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-fact-id");
      expect(el).not.toHaveAttribute("data-citation-kind");
    });

    it("renders the ⁂ symbol", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" />,
      );
      expect(container.textContent).toContain("⁂");
    });

    it("shows tooltip with 'citation tier pending — see methodology'", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" />,
      );
      // The ⁂ span has the title
      const chip = container.querySelector('[title*="citation tier pending"]');
      expect(chip).not.toBeNull();
    });

    it("displays formatted amount", () => {
      const { container } = render(
        // 1597049 thousands = $1.60B → <10B → 2 dec → $1.60B
        <Cite value={1597049} units="USD thousands" />,
      );
      expect(container.textContent).toContain("$1.60B");
    });

    it("null factId and null xmlPath → State C", () => {
      const { container } = render(
        <Cite value={100} units="USD millions" factId={null} xmlPath={null} />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-uncited", "true");
    });
  });

  // ── Receipts mode ─────────────────────────────────────────────────────────
  describe("receipts mode", () => {
    it("State A shows short fact-id chip when receipts ON", () => {
      const factId = "abc123def456789f";
      const { container } = render(
        <ReceiptsContext.Provider value={{ receiptsOn: true }}>
          <Cite value={100} units="USD millions" factId={factId} />
        </ReceiptsContext.Provider>,
      );
      // Short ID = last 8 chars of factId: "456789f" is only 7 chars; last 8 = "f456789f"
      expect(container.textContent).toContain("#f456789f");
    });

    it("State A does NOT show chip when receipts OFF", () => {
      const factId = "abc123def456789f";
      const { container } = render(
        <ReceiptsContext.Provider value={{ receiptsOn: false }}>
          <Cite value={100} units="USD millions" factId={factId} />
        </ReceiptsContext.Provider>,
      );
      expect(container.textContent).not.toContain("#f456789f");
    });

    it("State C shows a single 'uncited' chip when receipts ON", () => {
      const { container } = render(
        <ReceiptsContext.Provider value={{ receiptsOn: true }}>
          <Cite value={100} units="USD millions" />
        </ReceiptsContext.Provider>,
      );
      // Single chip contains both ⁂ and 'uncited' text
      expect(container.textContent).toContain("uncited");
      // Exactly one aria-hidden span (the chip) — not two
      const chips = container.querySelectorAll('[aria-hidden="true"]');
      expect(chips.length).toBe(1);
      expect(chips[0].textContent).toContain("⁂");
      expect(chips[0].textContent).toContain("uncited");
    });
  });
});
