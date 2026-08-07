/**
 * feed-headline.test.tsx — ROADMAP backlog #44: every dollar figure a feed
 * headline prints reaches the reader with a citation affordance.
 *
 * The headline is a sentence the export pipeline composes, on the site's
 * syndication surface. While it was one flat string its ~40 dollar tokens were
 * the only site-computed figures a reader could not click through to a source,
 * and the `data-source-text="headline"` marker exempted them from the gate
 * that would have said so.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { FeedHeadline } from "@/components/feed-headline";
import type { FeedCard } from "@/lib/data";

function card(over: Partial<FeedCard> = {}): FeedCard {
  return {
    event_type: "new_entrant",
    family_key: "ACME CORP",
    figure_fact_id: "f".repeat(16),
    figure_units: "dollars",
    figure_value: 3_100_000,
    fiscal_year: 2025,
    headline: "ACME CORP new defense contractor (first award FY2025, $3.1M total)",
    headline_segments: [
      { text: "ACME CORP new defense contractor (first award FY2025, " },
      { amount: "$3.1M", fact_id: "f".repeat(16) },
      { text: " total)" },
    ],
    organization: null,
    pe_bli: null,
    program_url: null,
    title: null,
    why_url: "/methodology/#feed-new_entrant",
    basis: null,
    fy: null,
    measure: null,
    edition: null,
    magnitude: null,
    ...over,
  };
}

describe("<FeedHeadline>", () => {
  it("renders the whole sentence, unchanged", () => {
    const { container } = render(<FeedHeadline card={card()} />);
    expect(container.textContent).toBe(
      "ACME CORP new defense contractor (first award FY2025, $3.1M total)",
    );
  });

  it("wraps each dollar token in a prose cite carrying its fact id", () => {
    const { container } = render(<FeedHeadline card={card()} />);
    const cites = container.querySelectorAll("[data-prose-cite]");
    expect(cites.length).toBe(1);
    expect(cites[0].textContent).toBe("$3.1M");
    expect(cites[0].getAttribute("data-fact-id")).toBe("f".repeat(16));
  });

  it("never marks a headline figure with data-amount", () => {
    // render-static (a0) forbids [data-amount] inside a [data-source-text]
    // subtree; the prose cite is the sanctioned anchor there.
    const { container } = render(<FeedHeadline card={card()} />);
    expect(container.querySelectorAll("[data-amount]").length).toBe(0);
  });

  it("renders the token VERBATIM, never re-derived from the fact", () => {
    // A request-vs-actuals gap prints |delta| beside the word "below" while
    // the fact it cites is the signed value — re-formatting from the fact
    // would print a minus sign the sentence already said in words.
    const gap = card({
      event_type: "request_vs_actuals_gap",
      figure_value: -1_200_000,
      headline:
        "Some Program FY2023 actuals came in $1.2B below the PB2023 request (per the PB2025 book)",
      headline_segments: [
        { text: "Some Program FY2023 actuals came in " },
        { amount: "$1.2B", fact_id: "a".repeat(16) },
        { text: " below the PB2023 request (per the PB2025 book)" },
      ],
    });
    const { container } = render(<FeedHeadline card={gap} />);
    expect(container.querySelector("[data-prose-cite]")!.textContent).toBe("$1.2B");
  });

  it("links only the leading text run, so no cite nests inside an anchor", () => {
    const linked = card({
      pe_bli: "0601101E",
      program_url: "/program/0601101E/",
      title: "Defense Research Sciences",
      headline: "Defense Research Sciences new defense contractor (first award FY2025, $3.1M total)",
      headline_segments: [
        { text: "Defense Research Sciences new defense contractor (first award FY2025, " },
        { amount: "$3.1M", fact_id: "f".repeat(16) },
        { text: " total)" },
      ],
    });
    const { container } = render(
      <FeedHeadline card={linked} href="/program/0601101E/" />,
    );
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toContain("/program/0601101E");
    expect(anchor.querySelectorAll("[data-prose-cite]").length).toBe(0);
    expect(container.querySelectorAll("[data-prose-cite]").length).toBe(1);
  });

  it("falls back to flat text on a pre-#44 sidecar rather than inventing a fact", () => {
    // The token is then unanchored, which render-static leg (b) fails on —
    // an honest failure, not a silent exemption.
    const old = card({ headline_segments: undefined });
    const { container } = render(<FeedHeadline card={old} />);
    expect(container.textContent).toContain("$3.1M");
    expect(container.querySelectorAll("[data-prose-cite]").length).toBe(0);
  });

  it("renders a headline with no money as plain prose", () => {
    const hhi = card({
      event_type: "concentration_shift",
      headline: "Defense Research Sciences award concentration HHI=8662 (2020)",
      headline_segments: [
        { text: "Defense Research Sciences award concentration HHI=8662 (2020)" },
      ],
    });
    const { container } = render(<FeedHeadline card={hhi} />);
    expect(container.querySelectorAll("[data-prose-cite]").length).toBe(0);
    expect(screen.getByText(/HHI=8662/)).toBeTruthy();
  });
});
