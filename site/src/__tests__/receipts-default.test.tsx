/**
 * P1-1 — Receipts mode defaults ON; toggle relabeled "Fact IDs"
 * (PM-review Sprint 1 Task 6, spec §P1-1 "Default state").
 *
 * Contract:
 *  - First visit (no stored preference): fact-id chips are VISIBLE — the
 *    server renders them and the first client render matches (no flash, no
 *    layout jump on the default path).
 *  - The toggle controls chip VISIBILITY only; citations stay clickable
 *    either way. Label "Fact IDs", accessible name "Show fact IDs".
 *  - User choice persists BOTH ways in localStorage ('1' on / '0' off —
 *    absence means default ON). Opted-out users have chips removed on mount.
 *  - The chip is a SIBLING of [data-amount], never inside it: gate 23 and
 *    the render gates parse the [data-amount] element's text as one currency
 *    figure, and server-rendered chip text inside the span would null every
 *    parse.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Cite } from "@/components/cite";
import { ReceiptsProvider, ReceiptsToggle } from "@/components/receipts-toggle";

const CitedAmount = () => (
  <Cite
    value={100}
    units="USD millions"
    dataset="test_dataset"
    factId="abc123def456789f"
  />
);

beforeEach(() => {
  window.localStorage.clear();
});

describe("Receipts default ON (spec §P1-1)", () => {
  it("first visit (no stored preference): chips render immediately", () => {
    const { container } = render(
      <ReceiptsProvider>
        <CitedAmount />
      </ReceiptsProvider>,
    );
    // Synchronous assertion on the FIRST render: the default path must not
    // flash (server HTML and initial client render both show the chip).
    expect(container.querySelector("[data-receipts-chip]")).not.toBeNull();
  });

  it("stored opt-out ('0') hides chips after mount", async () => {
    window.localStorage.setItem("receipts-mode", "0");
    const { container } = render(
      <ReceiptsProvider>
        <CitedAmount />
      </ReceiptsProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector("[data-receipts-chip]")).toBeNull(),
    );
  });

  it("stored opt-in ('1') keeps chips visible", async () => {
    window.localStorage.setItem("receipts-mode", "1");
    const { container } = render(
      <ReceiptsProvider>
        <CitedAmount />
      </ReceiptsProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector("[data-receipts-chip]")).not.toBeNull(),
    );
  });

  it("dense cells (chip={false}) suppress the fact-id chip even with receipts ON", () => {
    // The years matrix alone holds ~13k cited cells — default-ON must not
    // blanket dense grids with id chips. chip={false} already declares
    // "provenance stated at section level" for the basis chip; the fact-id
    // chip follows the same contract. The figure itself stays clickable.
    const { container } = render(
      <ReceiptsProvider>
        <Cite
          value={100}
          units="USD millions"
          dataset="test_dataset"
          factId="abc123def456789f"
          chip={false}
        />
      </ReceiptsProvider>,
    );
    expect(container.querySelector("[data-receipts-chip]")).toBeNull();
    expect(container.querySelector("[data-amount]")).toHaveAttribute(
      "role",
      "button",
    );
  });

  it("chip is a SIBLING of [data-amount] — the amount text stays gate-parseable", () => {
    const { container } = render(
      <ReceiptsProvider>
        <CitedAmount />
      </ReceiptsProvider>,
    );
    const amount = container.querySelector("[data-amount]")!;
    expect(amount.querySelector("[data-receipts-chip]")).toBeNull();
    // Exactly the shape gate 23's normalizeAmount() accepts: `$X.XM`.
    expect((amount.textContent ?? "").trim()).toMatch(
      /^\$[\d,]+(\.\d+)?\s*[KMBT]?$/,
    );
    expect(container.querySelector("[data-receipts-chip]")).not.toBeNull();
  });
});

describe('Toggle — "Fact IDs" / "Show fact IDs" (visibility only)', () => {
  it('is labeled "Fact IDs" with accessible name "Show fact IDs", pressed by default', () => {
    const { getByRole } = render(
      <ReceiptsProvider>
        <ReceiptsToggle />
      </ReceiptsProvider>,
    );
    const btn = getByRole("button", { name: "Show fact IDs" });
    expect(btn.textContent).toBe("Fact IDs");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("toggle OFF persists '0' and hides chips; toggle ON persists '1' and shows them", async () => {
    const { container, getByRole } = render(
      <ReceiptsProvider>
        <ReceiptsToggle />
        <CitedAmount />
      </ReceiptsProvider>,
    );
    const btn = getByRole("button", { name: "Show fact IDs" });

    fireEvent.click(btn);
    expect(window.localStorage.getItem("receipts-mode")).toBe("0");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(container.querySelector("[data-receipts-chip]")).toBeNull(),
    );

    fireEvent.click(btn);
    expect(window.localStorage.getItem("receipts-mode")).toBe("1");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(container.querySelector("[data-receipts-chip]")).not.toBeNull(),
    );
  });

  it("citations stay clickable regardless of chip visibility", async () => {
    // The toggle controls chip VISIBILITY only — the figure's own
    // click-to-open-citation wiring must survive chips-off.
    window.localStorage.setItem("receipts-mode", "0");
    const { container } = render(
      <ReceiptsProvider>
        <CitedAmount />
      </ReceiptsProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector("[data-receipts-chip]")).toBeNull(),
    );
    const figure = container.querySelector("[data-amount]")!;
    expect(figure).toHaveAttribute("role", "button");
    expect(figure).toHaveAttribute("tabindex", "0");
  });
});
