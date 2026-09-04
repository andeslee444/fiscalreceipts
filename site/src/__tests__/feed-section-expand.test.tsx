/**
 * feed-section-expand.test.tsx — Task 6 (#73): /feed/ sections expand in
 * place past the FEED_SECTION_CAP digest cap, client-side.
 *
 * Contract under test (task-6-brief.md Step 1, task-6-addendum.md ruling 1):
 *   - Collapsed state renders [data-feed-truncation-note] (gate 23 leg g4
 *     reads this attribute against the static HTML) and a "Show all N"
 *     button.
 *   - Clicking the button fetches /json/feed.json (plain same-origin fetch,
 *     mirroring ProgramAwards.handleExpand), filters `cards` by
 *     `event_type`, and renders every card past `shown` via the
 *     <FeedCardItemClient> twin.
 *   - The truncation note disappears once expanded.
 *   - A failed fetch surfaces an error state without crashing.
 *   - companySlug/hasProgramPage for the newly-rendered cards resolve off
 *     the section-scoped lookup props, exactly like feed/page.tsx resolves
 *     them server-side for the statically-rendered cards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { FeedSectionExpand } from "@/components/feed-section-expand";
import type { FeedCard } from "@/lib/data";

function card(pe_bli: string, overrides: Partial<FeedCard> = {}): FeedCard {
  return {
    event_type: "concentration_shift",
    family_key: null,
    figure_fact_id: "f".repeat(16),
    figure_units: "hhi",
    figure_value: 5000,
    fiscal_year: 2022,
    headline: `${pe_bli} award concentration HHI=5000 (2022)`,
    headline_segments: [
      { text: `${pe_bli} award concentration HHI=5000 (2022)` },
    ],
    organization: null,
    pe_bli,
    program_url: `/program/${pe_bli}/`,
    title: pe_bli,
    why_url: "/methodology/#feed-concentration_shift",
    basis: null,
    fy: null,
    measure: null,
    edition: null,
    magnitude: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** 90 concentration_shift cards, ordered — mirrors feed.json's shape. */
function ninetyCards(): FeedCard[] {
  return Array.from({ length: 90 }, (_, i) =>
    card(String(i).padStart(4, "0")),
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<FeedSectionExpand> — collapsed state", () => {
  it("renders the truncation note and a Show all button", () => {
    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={75}
        total={90}
        programPeBlis={[]}
        companySlugByFamilyKey={{}}
      />,
    );
    const note = container.querySelector("[data-feed-truncation-note]");
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("75");
    expect(note!.textContent).toContain("90");
    expect(screen.getByRole("button", { name: /show all 90/i })).toBeInTheDocument();
  });

  it("renders no [data-feed-card] before expansion", () => {
    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={75}
        total={90}
        programPeBlis={[]}
        companySlugByFamilyKey={{}}
      />,
    );
    expect(container.querySelectorAll("[data-feed-card]").length).toBe(0);
  });
});

describe("<FeedSectionExpand> — expand", () => {
  it("fetches feed.json, renders the 15 cards past the cap, and hides the truncation note", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.resolve(
            jsonResponse({ cards: ninetyCards(), total: 90, scope_qualifier: null }),
          )
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={75}
        total={90}
        programPeBlis={["0075", "0089"]}
        companySlugByFamilyKey={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /show all 90/i }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-feed-card]").length).toBe(15);
    });

    expect(fetchMock).toHaveBeenCalledWith("/json/feed.json");
    expect(container.querySelector("[data-feed-truncation-note]")).toBeNull();
    // The first rendered card is index 75 (0-based), not index 0 — the
    // expand continues the same magnitude-ranked sequence, it does not
    // restart it.
    expect(container.textContent).toContain("0075");
    expect(container.textContent).not.toContain("0000 award concentration");
  });

  it("resolves hasProgramPage from the programPeBlis lookup prop", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.resolve(
            jsonResponse({ cards: ninetyCards(), total: 90, scope_qualifier: null }),
          )
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={75}
        total={90}
        programPeBlis={["0075"]}
        companySlugByFamilyKey={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show all 90/i }));
    await waitFor(() => {
      expect(container.querySelectorAll("[data-feed-card]").length).toBe(15);
    });

    // 0075 is in programPeBlis -> "view program" link renders.
    const links = Array.from(container.querySelectorAll("a")).filter((a) =>
      a.textContent?.includes("view program"),
    );
    expect(links.length).toBe(1);
    // next/link normalizes the trailing slash away under jsdom — the same
    // reason feed-headline.test.tsx asserts with toContain, not toBe.
    expect(links[0].getAttribute("href")).toContain("/program/0075");
  });

  it("surfaces an error state on a failed fetch, without crashing", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.reject(new Error("network down"))
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={75}
        total={90}
        programPeBlis={[]}
        companySlugByFamilyKey={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show all 90/i }));

    await waitFor(() => {
      expect(container.textContent).toMatch(/failed to load/i);
    });
    // Truncation note stays — the section never actually expanded.
    expect(container.querySelector("[data-feed-truncation-note]")).not.toBeNull();
    expect(container.querySelectorAll("[data-feed-card]").length).toBe(0);
  });

  it("companySlug resolves from companySlugByFamilyKey for family_key-driven cards", async () => {
    const cards = [
      card("", {
        event_type: "new_entrant",
        pe_bli: null,
        program_url: null,
        family_key: "ACME CORP",
        headline: "ACME CORP new defense contractor",
        headline_segments: [{ text: "ACME CORP new defense contractor" }],
        figure_units: "dollars",
        figure_value: 2_000_000,
        why_url: "/methodology/#feed-new_entrant",
      }),
    ];
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.resolve(
            jsonResponse({ cards, total: 1, scope_qualifier: null }),
          )
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="new_entrant"
        shown={0}
        total={1}
        programPeBlis={[]}
        companySlugByFamilyKey={{ "ACME CORP": "acme-corp" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show all 1/i }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-feed-card]").length).toBe(1);
    });
    const companyLink = Array.from(container.querySelectorAll("a")).find((a) =>
      (a.getAttribute("href") ?? "").includes("/company/acme-corp"),
    );
    expect(companyLink).not.toBeUndefined();
    expect(companyLink!.textContent).toBe("ACME CORP");
  });
});
