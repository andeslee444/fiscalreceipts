/**
 * Tests for Task 8a — dossier rendering (cited-or-absent).
 *
 * - parseDossier: structural validation of the wrapped dossier shape.
 * - validateDossierCitations: fact_ids must resolve in citations.json; urls
 *   must be cached research snapshots; ANY violation throws (loud build
 *   error — the site must not render ungated content silently).
 * - dossierFactIds: warehouse fact_ids feed the page citation slice.
 * - <ProgramDossier>: claims render with their citation chips — fact chips
 *   open the citation panel via the existing context, url chips are external
 *   links with the snapshot-title tooltip + retrieved note. Empty sections
 *   render nothing (zero placeholder text).
 */

import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import {
  parseDossier,
  validateDossierCitations,
  dossierFactIds,
  type DossierFile,
} from "@/lib/dossier";
import { ProgramDossier } from "@/components/program-dossier";
import { CitationPanelContext } from "@/components/cite";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FACT_ID = "abc123def4567890";
const SNAP_URL =
  "https://www.defensenews.com/2026/06/10/example-hypersonics-article/";

function fixtureDossier(): DossierFile {
  return {
    pe_bli: "0603183D8Z",
    model: "claude-opus-4-8",
    collected_at: "2026-06-13T00:00:00+00:00",
    dossier: {
      what_it_is: {
        claims: [
          {
            text: "The Joint Hypersonics Transition Office coordinates hypersonic technology development.",
            citation: { fact_id: FACT_ID },
          },
        ],
      },
      why_it_matters: {
        claims: [
          {
            text: "FY2026 funding doubles the prior year request.",
            citation: { fact_id: FACT_ID },
          },
        ],
      },
      players: {
        claims: [
          {
            text: "Lobbying filings referenced the program in 2025.",
            citation: { fact_id: FACT_ID },
          },
        ],
      },
      recent_developments: {
        claims: [
          {
            text: "A June 2026 article reported a new flight test.",
            citation: { url: SNAP_URL },
          },
        ],
      },
    },
  };
}

const CITATION_IDS = new Set([FACT_ID]);
const SNAPSHOT_URLS = new Set([SNAP_URL]);

// ── parseDossier ─────────────────────────────────────────────────────────────

describe("parseDossier", () => {
  it("accepts the wrapped fixture shape", () => {
    const raw = JSON.parse(JSON.stringify(fixtureDossier()));
    const file = parseDossier(raw, "0603183D8Z");
    expect(file.pe_bli).toBe("0603183D8Z");
    expect(file.dossier.what_it_is.claims).toHaveLength(1);
  });

  it("REJECTS a pe_bli mismatch", () => {
    const raw = JSON.parse(JSON.stringify(fixtureDossier()));
    expect(() => parseDossier(raw, "9999999999")).toThrow(/REJECTED/);
  });

  it("REJECTS a missing section", () => {
    const raw = JSON.parse(JSON.stringify(fixtureDossier())) as Record<
      string,
      Record<string, unknown>
    >;
    delete raw.dossier.players;
    expect(() => parseDossier(raw, "0603183D8Z")).toThrow(/players/);
  });

  it("REJECTS a claim with empty text", () => {
    const raw = JSON.parse(JSON.stringify(fixtureDossier()));
    raw.dossier.what_it_is.claims[0].text = "  ";
    expect(() => parseDossier(raw, "0603183D8Z")).toThrow(/empty text/);
  });

  it("REJECTS a claim with both fact_id and url", () => {
    const raw = JSON.parse(JSON.stringify(fixtureDossier()));
    raw.dossier.what_it_is.claims[0].citation = {
      fact_id: FACT_ID,
      url: SNAP_URL,
    };
    expect(() => parseDossier(raw, "0603183D8Z")).toThrow(
      /exactly one of fact_id \| url/,
    );
  });

  it("REJECTS a claim with no citation", () => {
    const raw = JSON.parse(JSON.stringify(fixtureDossier()));
    raw.dossier.what_it_is.claims[0].citation = {};
    expect(() => parseDossier(raw, "0603183D8Z")).toThrow(/REJECTED/);
  });
});

// ── validateDossierCitations ─────────────────────────────────────────────────

describe("validateDossierCitations", () => {
  it("passes when every fact_id resolves and every url is a snapshot", () => {
    expect(() =>
      validateDossierCitations(fixtureDossier(), CITATION_IDS, SNAPSHOT_URLS),
    ).not.toThrow();
  });

  it("REJECTS an unresolvable fact_id (loud build error)", () => {
    const file = fixtureDossier();
    file.dossier.why_it_matters.claims[0].citation = {
      fact_id: "ffffffffffffffff",
    };
    expect(() =>
      validateDossierCitations(file, CITATION_IDS, SNAPSHOT_URLS),
    ).toThrow(/does not resolve in citations\.json/);
  });

  it("REJECTS a url that is not a cached snapshot", () => {
    const file = fixtureDossier();
    file.dossier.recent_developments.claims[0].citation = {
      url: "https://example.com/not-a-snapshot/",
    };
    expect(() =>
      validateDossierCitations(file, CITATION_IDS, SNAPSHOT_URLS),
    ).toThrow(/not a cached research snapshot/);
  });
});

// ── dossierFactIds ───────────────────────────────────────────────────────────

describe("dossierFactIds", () => {
  it("collects warehouse fact_ids across all sections (urls excluded)", () => {
    const ids = dossierFactIds(fixtureDossier());
    expect(ids).toEqual([FACT_ID, FACT_ID, FACT_ID]);
  });
});

// ── <ProgramDossier> rendering ───────────────────────────────────────────────

const SNAPSHOT_META = {
  [SNAP_URL]: {
    retrieved_at: "2026-06-13T00:55:48+00:00",
    title: "Example hypersonics article",
  },
};

describe("ProgramDossier", () => {
  it("renders the four section headings and claim texts", () => {
    const { container } = render(
      <ProgramDossier dossier={fixtureDossier()} snapshotMeta={SNAPSHOT_META} />,
    );
    expect(container.textContent).toContain("What it is");
    expect(container.textContent).toContain("Why it matters");
    expect(container.textContent).toContain("Key players");
    expect(container.textContent).toContain("Recent developments");
    expect(container.textContent).toContain(
      "coordinates hypersonic technology development",
    );
  });

  it("fact chips open the citation panel with the claim fact_id", () => {
    let openedWith: string | null = null;
    const { container } = render(
      <CitationPanelContext.Provider
        value={{ openPanel: (id) => { openedWith = id; } }}
      >
        <ProgramDossier
          dossier={fixtureDossier()}
          snapshotMeta={SNAPSHOT_META}
        />
      </CitationPanelContext.Provider>,
    );
    const chip = container.querySelector('[data-dossier-chip="fact"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("data-fact-id", FACT_ID);
    fireEvent.click(chip!);
    expect(openedWith).toBe(FACT_ID);
  });

  it("url chips are external links with snapshot title tooltip + retrieved note", () => {
    const { container } = render(
      <ProgramDossier dossier={fixtureDossier()} snapshotMeta={SNAPSHOT_META} />,
    );
    const chip = container.querySelector('[data-dossier-chip="url"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("href", SNAP_URL);
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", expect.stringContaining("noopener"));
    const tooltip = chip!.getAttribute("title")!;
    expect(tooltip).toContain("Example hypersonics article");
    expect(tooltip).toContain("retrieved 2026-06-13");
    expect(chip!.textContent).toContain("retrieved 2026-06-13");
  });

  it("renders NOTHING for empty sections (zero placeholder text)", () => {
    const file = fixtureDossier();
    file.dossier.recent_developments.claims = [];
    const { container } = render(
      <ProgramDossier dossier={file} snapshotMeta={SNAPSHOT_META} />,
    );
    expect(container.textContent).not.toContain("Recent developments");
    expect(
      container.querySelector('[data-dossier-section="recent_developments"]'),
    ).toBeNull();
  });
});
