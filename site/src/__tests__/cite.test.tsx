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

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Cite, CitationPanelContext, ReceiptsContext } from "@/components/cite";

describe("Cite three-state contract", () => {
  // ── State A: cited ─────────────────────────────────────────────────────────
  describe("State A — factId provided (cited)", () => {
    it("renders data-amount attribute", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" dataset="test_dataset" factId="abc123def456" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toBeNull();
    });

    it("renders data-fact-id with the provided factId", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" dataset="test_dataset" factId="abc123def4567890" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-fact-id", "abc123def4567890");
    });

    it("does NOT have data-uncited or data-citation-kind attributes", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" dataset="test_dataset" factId="abc123def456" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-uncited");
      expect(el).not.toHaveAttribute("data-citation-kind");
    });

    it("displays the formatted amount", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" dataset="test_dataset" factId="abc123" />,
      );
      // 280494 thousands = $280.5M
      expect(container.textContent).toContain("$280.5M");
    });

    it("has exactTitle in title attribute", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" dataset="test_dataset" factId="abc123" />,
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
          <Cite value={100} units="USD millions" dataset="test_dataset" factId="test-fact-001" />
        </CitationPanelContext.Provider>,
      );
      const el = container.querySelector("[data-amount]") as HTMLElement;
      el.click();
      expect(calledWith).toBe("test-fact-001");
    });

    it("has role='button' and tabIndex=0 for keyboard accessibility", () => {
      const { container } = render(
        <Cite value={280494} units="USD thousands" dataset="test_dataset" factId="abc123def456" />,
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
          <Cite value={100} units="USD millions" dataset="test_dataset" factId="test-fact-enter" />
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
          units="USD millions" dataset="test_dataset"
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
          units="USD millions" dataset="test_dataset"
          xmlPath="ProgramElement[0]/Project[4]"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-citation-kind", "xml-path");
    });

    it("renders data-xml-path with the provided path", () => {
      const path = "ProgramElement[0]/Project[4]";
      const { container } = render(
        <Cite value={0} units="USD millions" dataset="test_dataset" xmlPath={path} />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-xml-path", path);
    });

    it("does NOT have data-fact-id or data-uncited", () => {
      const { container } = render(
        <Cite value={0} units="USD millions" dataset="test_dataset" xmlPath="ProgramElement[0]" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-fact-id");
      expect(el).not.toHaveAttribute("data-uncited");
    });

    it("shows a human 'XML' chip label by default — never the raw path", () => {
      const path = "ProgramElement[0]/Project[4]";
      const { container } = render(
        <Cite value={0} units="USD millions" dataset="test_dataset" xmlPath={path} />,
      );
      // Raw anchor paths read like template errors to visitors; the chip shows
      // a human label. The full path stays in data-xml-path + the tooltip.
      expect(container.textContent).toContain("XML");
      expect(container.textContent).not.toContain(path);
      const chip = container.querySelector("[data-amount] span[title]");
      expect(chip?.getAttribute("title")).toContain(path);
    });

    it("factId takes precedence over xmlPath (A wins)", () => {
      const { container } = render(
        <Cite
          value={100}
          units="USD millions" dataset="test_dataset"
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
        <Cite value={1597049} units="USD thousands" dataset="test_dataset" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toBeNull();
    });

    it("renders data-uncited='true'", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" dataset="test_dataset" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-uncited", "true");
    });

    it("does NOT have data-fact-id or data-citation-kind", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" dataset="test_dataset" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-fact-id");
      expect(el).not.toHaveAttribute("data-citation-kind");
    });

    it("renders the ⁂ symbol", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" dataset="test_dataset" />,
      );
      expect(container.textContent).toContain("⁂");
    });

    it("shows tooltip with 'citation tier pending — see methodology'", () => {
      const { container } = render(
        <Cite value={1597049} units="USD thousands" dataset="test_dataset" />,
      );
      // The ⁂ span has the title
      const chip = container.querySelector('[title*="citation tier pending"]');
      expect(chip).not.toBeNull();
    });

    it("displays formatted amount", () => {
      const { container } = render(
        // 1597049 thousands = $1.60B → <10B → 2 dec → $1.60B
        <Cite value={1597049} units="USD thousands" dataset="test_dataset" />,
      );
      expect(container.textContent).toContain("$1.60B");
    });

    it("null factId and null xmlPath → State C", () => {
      const { container } = render(
        <Cite value={100} units="USD millions" dataset="test_dataset" factId={null} xmlPath={null} />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-uncited", "true");
    });
  });

  // ── data-dataset (Phase 5B-3 dataset-ledger contract) ─────────────────────
  describe("data-dataset attribute (required on ALL three states)", () => {
    it("State A emits data-dataset", () => {
      const { container } = render(
        <Cite
          value={100}
          units="USD millions"
          dataset="fct_budget_trajectory"
          factId="abc123def4567890"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-dataset", "fct_budget_trajectory");
    });

    it("State B emits data-dataset", () => {
      const { container } = render(
        <Cite
          value={0}
          units="USD millions"
          dataset="jbook_details"
          xmlPath="ProgramElement[0]/Project[4]"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-dataset", "jbook_details");
    });

    it("State C emits data-dataset", () => {
      const { container } = render(
        <Cite value={100} units="USD" dataset="dim_geography" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-dataset", "dim_geography");
    });
  });

  // ── display override (non-currency figures, e.g. HHI) ─────────────────────
  describe("display override", () => {
    it("renders the display string instead of formatAmount", () => {
      const { container } = render(
        <Cite
          value={4200.4}
          units="USD"
          dataset="fct_program_concentration"
          factId="abc123def4567890"
          display="4200"
        />,
      );
      expect(container.textContent).toContain("4200");
      expect(container.textContent).not.toContain("$");
    });

    it("uses the display string as title", () => {
      const { container } = render(
        <Cite
          value={4200.4}
          units="USD"
          dataset="fct_program_concentration"
          factId="abc123def4567890"
          display="4200"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("title", "4200");
    });
  });

  // ── Receipts mode ─────────────────────────────────────────────────────────
  describe("receipts mode", () => {
    it("State A shows the PUBLIC id (fid[:8] — same id the drawer shows) when receipts ON", () => {
      // P0-4 groundwork: ONE public id per figure. The drawer footer renders
      // factId.slice(0, 8); the Receipts chip must render the SAME id — the
      // live #8b2746cb-vs-#bb54b165 mismatch was two truncations of one id.
      const factId = "abc123def456789f";
      const { container } = render(
        <ReceiptsContext.Provider value={{ receiptsOn: true }}>
          <Cite value={100} units="USD millions" dataset="test_dataset" factId={factId} />
        </ReceiptsContext.Provider>,
      );
      expect(container.textContent).toContain("#abc123de");
      expect(container.textContent).not.toContain("#f456789f");
    });

    it("State A does NOT show chip when receipts OFF", () => {
      const factId = "abc123def456789f";
      const { container } = render(
        <ReceiptsContext.Provider value={{ receiptsOn: false }}>
          <Cite value={100} units="USD millions" dataset="test_dataset" factId={factId} />
        </ReceiptsContext.Provider>,
      );
      expect(container.textContent).not.toContain("#abc123de");
    });

    it("chip click copies the /fact/{fid8} permalink WITHOUT opening the panel (P0-4.3)", async () => {
      // Spec §P0-4.3: the fact permalink lives "behind a click on the
      // Receipts-mode chip" — copy-with-toast, least disruptive. The click
      // must stop propagation so the figure's own openPanel does not fire.
      const factId = "abc123def456789f";
      const openPanel = vi.fn();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      const { container } = render(
        <CitationPanelContext.Provider value={{ openPanel }}>
          <ReceiptsContext.Provider value={{ receiptsOn: true }}>
            <Cite
              value={100}
              units="USD millions"
              dataset="test_dataset"
              factId={factId}
            />
          </ReceiptsContext.Provider>
        </CitationPanelContext.Provider>,
      );
      const chip = container.querySelector(
        "[data-receipts-chip]",
      ) as HTMLElement;
      expect(chip).not.toBeNull();
      fireEvent.click(chip);
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/fact/abc123de`,
      );
      expect(openPanel).not.toHaveBeenCalled();
      // Transient copied feedback appears on the chip.
      await waitFor(() => expect(chip.textContent).toContain("copied"));
    });

    it("clicking the figure itself (not the chip) still opens the panel", () => {
      const factId = "abc123def456789f";
      const openPanel = vi.fn();
      const { container } = render(
        <CitationPanelContext.Provider value={{ openPanel }}>
          <ReceiptsContext.Provider value={{ receiptsOn: true }}>
            <Cite
              value={100}
              units="USD millions"
              dataset="test_dataset"
              factId={factId}
            />
          </ReceiptsContext.Provider>
        </CitationPanelContext.Provider>,
      );
      fireEvent.click(container.querySelector("[data-amount]") as HTMLElement);
      expect(openPanel).toHaveBeenCalledTimes(1);
      expect(openPanel.mock.calls[0][0]).toBe(factId);
    });

    it("State C shows a single 'uncited' chip when receipts ON", () => {
      const { container } = render(
        <ReceiptsContext.Provider value={{ receiptsOn: true }}>
          <Cite value={100} units="USD millions" dataset="test_dataset" />
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

  // ── Basis threading (PM Sprint 1 Task 3, gate 23 legs a1/a2) ──────────────
  describe("basis attributes + chip", () => {
    const basisProps = {
      value: 5565655,
      units: "USD thousands" as const,
      dataset: "fct_decade_series",
      factId: "5b532c52d3ebb4c2",
      basis: "toa" as const,
      fy: 2024,
      measure: "actuals",
      edition: 2026,
    };

    it("renders data-basis / data-fy / data-measure on the amount element (leg a1)", () => {
      const { container } = render(<Cite {...basisProps} entity="ATA000" />);
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-basis", "toa");
      expect(el).toHaveAttribute("data-fy", "2024");
      expect(el).toHaveAttribute("data-measure", "actuals");
      expect(el).toHaveAttribute("data-entity", "ATA000");
    });

    it("renders the attrs on state B (xml-path) figures too", () => {
      const { container } = render(
        <Cite
          value={0}
          units="USD millions"
          dataset="jbook_details"
          xmlPath="LineItem[9]"
          basis="jbook-detail"
          fy={2024}
          measure="actuals"
          edition={2026}
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-basis", "jbook-detail");
      expect(el).toHaveAttribute("data-fy", "2024");
      expect(el).toHaveAttribute("data-measure", "actuals");
    });

    it("renders an always-visible basis chip OUTSIDE the data-amount element", () => {
      // The chip must be a SIBLING: gate 23 parses the [data-amount] element's
      // text as a currency figure — chip text inside it would null the parse
      // and silently blind legs a2/b.
      const { container } = render(<Cite {...basisProps} />);
      const el = container.querySelector("[data-amount]")!;
      expect(el.textContent).toBe("$5.57B");
      expect(container.textContent).toContain("P-1 TOA · PB2026");
    });

    it("labels jbook-detail basis as P-40 detail", () => {
      const { container } = render(
        <Cite
          value={5247.07}
          units="USD millions"
          dataset="jbook_details"
          factId="bb54b1658b2746cb"
          basis="jbook-detail"
          fy={2024}
          measure="actuals"
          edition={2026}
        />,
      );
      expect(container.textContent).toContain("P-40 detail · PB2026");
    });

    it("renders human labels for extended measure tokens", () => {
      const { container } = render(
        <Cite {...basisProps} measure="reconciliation-request" />,
      );
      expect(container.textContent).toContain(
        "P-1 TOA · reconciliation request · PB2026",
      );
    });

    it("suppresses the chip with chip={false} but keeps the attributes", () => {
      const { container } = render(<Cite {...basisProps} chip={false} />);
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-basis", "toa");
      expect(container.textContent).not.toContain("P-1 TOA");
    });

    it("renders no chip when basis is absent (non-budget figures)", () => {
      const { container } = render(
        <Cite
          value={100}
          units="USD"
          dataset="fct_program_concentration"
          factId="abc123def4567890"
          basis="usaspending"
          fy="all-years"
          measure="obligations"
        />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-basis", "usaspending");
      expect(el).toHaveAttribute("data-fy", "all-years");
      expect(container.textContent).not.toContain("TOA");
    });

    it("marks declared reconciliation members with data-reconciliation", () => {
      const { container } = render(<Cite {...basisProps} reconciled />);
      const el = container.querySelector("[data-amount]");
      expect(el).toHaveAttribute("data-reconciliation");
    });

    it("does not emit basis attrs when the props are absent (back-compat)", () => {
      const { container } = render(
        <Cite value={100} units="USD" dataset="d" factId="abc123def4567890" />,
      );
      const el = container.querySelector("[data-amount]");
      expect(el).not.toHaveAttribute("data-basis");
      expect(el).not.toHaveAttribute("data-fy");
      expect(el).not.toHaveAttribute("data-measure");
      expect(el).not.toHaveAttribute("data-reconciliation");
    });
  });
});
