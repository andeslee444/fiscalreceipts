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

  // ── K.5: the footer states what is ON SCREEN, never "all" ────────────────
  //
  // /json/feed.json is a separate asset from the built page, so a partial
  // deploy can leave the page ahead of the file. The footer must then say how
  // many cards are actually rendered — and (final review M8) the first `shown`
  // cards are SERVER-rendered and stay on screen regardless of what came back,
  // so the honest number is `shown + extraCards.length`, not the fetch's own
  // count.
  it("says 'Showing 3 of 5' when the shipped feed.json is short of `total`", async () => {
    // total=5 (what the page was built from), but the fetched file carries
    // only 4 cards for this event type — one past the 3 already on screen.
    const cards = [0, 1, 2, 3].map((i) => card(String(i).padStart(4, "0")));
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.resolve(jsonResponse({ cards, total: 4, scope_qualifier: null }))
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={3}
        total={5}
        programPeBlis={[]}
        companySlugByFamilyKey={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show all 5/i }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-feed-card]").length).toBe(1);
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Showing 4 of 5 cards in this section.");
    expect(text).not.toContain("Showing all");
  });

  it("counts the server-rendered cards too when the fetch returns fewer than `shown`", async () => {
    // The M8 shape: feed.json is BEHIND the page and carries 3 cards where the
    // page already renders 3 server-side. extraCards is empty, but 3 cards are
    // on screen — the footer used to say "Showing 3 of 5" only by accident and
    // said "Showing 2 of 5" whenever the file was shorter still.
    const cards = [0, 1].map((i) => card(String(i).padStart(4, "0")));
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.resolve(jsonResponse({ cards, total: 2, scope_qualifier: null }))
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={3}
        total={5}
        programPeBlis={[]}
        companySlugByFamilyKey={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show all 5/i }));

    await waitFor(() => {
      expect(container.textContent).toContain("cards in this section.");
    });
    // 3 server-rendered + 0 fetched past the cap = 3 on screen, not 2.
    expect(container.textContent).toContain("Showing 3 of 5 cards in this section.");
    expect(container.textContent).not.toContain("Showing 2 of 5");
    expect(container.textContent).not.toContain("Showing all");
  });

  // ── K.3: two hidden cards sharing a pe_bli must not collide on key ───────
  it("renders two cards sharing a pe_bli without a duplicate-key warning", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // Same pe_bli, same event_type — the shape that would collide if the key
    // were `${event_type}-${pe_bli}`. React reports duplicate keys through
    // console.error, so a silent regression here is a spy assertion, not a
    // visible failure.
    const cards = [
      card("0001"),
      card("0002"),
      card("0002"),
    ];
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/feed.json"
        ? Promise.resolve(jsonResponse({ cards, total: 3, scope_qualifier: null }))
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );

    const { container } = render(
      <FeedSectionExpand
        eventType="concentration_shift"
        shown={1}
        total={3}
        programPeBlis={[]}
        companySlugByFamilyKey={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show all 3/i }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-feed-card]").length).toBe(2);
    });
    const keyWarnings = consoleError.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((msg) => /same key|duplicate key|unique "key"/i.test(msg));
    expect(keyWarnings).toEqual([]);
    consoleError.mockRestore();
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
