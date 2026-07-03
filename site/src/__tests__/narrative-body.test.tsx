import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import { NarrativeBody } from "@/components/narrative-body";
import { CitationPanelContext } from "@/components/cite";
import type { PeLinkIndex } from "@/lib/data";

const peIndex: PeLinkIndex = {
  has: (pe) => pe === "0601122E" || pe === "0602025E",
  projects: (pe) => (pe === "0601122E" ? new Set(["EMR-01"]) : new Set()),
};

function renderWithPanel(ui: React.ReactElement, openPanel = vi.fn()) {
  render(
    <CitationPanelContext.Provider value={{ openPanel }}>
      {ui}
    </CitationPanelContext.Provider>,
  );
  return openPanel;
}

describe("NarrativeBody — prose amount links (§2c)", () => {
  const body =
    "The request includes $14.220 million of discretionary and $25.000 million of mandatory funding.";
  const amountLinks = [
    { start: 21, end: 36, fact_id: "aaaaaaaaaaaaaaaa", token: "$14.220 million" },
    { start: 58, end: 73, fact_id: "bbbbbbbbbbbbbbbb", token: "$25.000 million" },
  ];

  it("renders multiple amount links at their recorded offsets with adjacent text intact", () => {
    renderWithPanel(
      <NarrativeBody body={body} amountLinks={amountLinks} peIndex={peIndex} selfPe="0601101E" />,
    );
    const cites = screen.getAllByRole("button");
    expect(cites).toHaveLength(2);
    expect(cites[0]).toHaveTextContent("$14.220 million");
    expect(cites[1]).toHaveTextContent("$25.000 million");
    // Every prose cite is data-prose-cite, NEVER data-amount (render-static
    // a0 forbids data-amount inside data-source-text).
    for (const c of cites) {
      expect(c).toHaveAttribute("data-prose-cite");
      expect(c).toHaveAttribute("data-fact-id");
      expect(c).not.toHaveAttribute("data-amount");
    }
    // Full body text preserved character-for-character.
    expect(document.body.textContent).toContain(
      "of discretionary and",
    );
  });

  it("opens the citation panel with the recorded fact_id on click", () => {
    const openPanel = renderWithPanel(
      <NarrativeBody body={body} amountLinks={amountLinks} peIndex={peIndex} />,
    );
    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(openPanel).toHaveBeenCalledWith("bbbbbbbbbbbbbbbb");
  });

  it("drops a link whose token no longer matches the body slice (defense-in-depth)", () => {
    renderWithPanel(
      <NarrativeBody
        body={body}
        amountLinks={[
          { start: 21, end: 36, fact_id: "cccccccccccccccc", token: "$99.999 million" },
        ]}
        peIndex={peIndex}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).toContain("$14.220 million");
  });
});

describe("NarrativeBody — PE mention links (§2a)", () => {
  it("links known PE tokens, resolving project references to anchors", () => {
    renderWithPanel(
      <NarrativeBody
        body="Beginning in FY 2026, this program will be funded in PE 0601122E, Project EMR-01 and PE 0602025E, Project MSL-05."
        peIndex={peIndex}
        selfPe="0601101E"
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/program/0601122E/#project-EMR-01");
    expect(links[0]).toHaveTextContent("0601122E");
    // MSL-05 is not a project of 0602025E → plain program link.
    expect(links[1]).toHaveAttribute("href", "/program/0602025E/");
  });

  it("leaves self-references and unknown PEs as plain text", () => {
    renderWithPanel(
      <NarrativeBody
        body="PE 0601101E continues; PE 9999999Z is classified."
        peIndex={peIndex}
        selfPe="0601101E"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders amount links and PE links together without overlap corruption", () => {
    renderWithPanel(
      <NarrativeBody
        body="$1.000 million moves to PE 0601122E."
        amountLinks={[
          { start: 0, end: 14, fact_id: "dddddddddddddddd", token: "$1.000 million" },
        ]}
        peIndex={peIndex}
        selfPe="0601101E"
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("$1.000 million");
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/program/0601122E/",
    );
  });
});
