/**
 * AnnouncementCard tests (ROADMAP #71 — announcement as a first-class kind).
 *
 * Links found via the defense.gov daily Contracts corpus used to cite a
 * generic derived crosswalk row; they now carry the article itself, the
 * Wayback snapshot of the copy the verification read, and that copy's sha256.
 *
 * The absence cases matter as much as the happy path: an article with no
 * archived copy must SAY so rather than render an empty archive link, and a
 * citation whose kind label went missing would silently degrade the panel.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import {
  AnnouncementCard,
  matchBasisPhrase,
} from "@/components/citation-panel/announcement-card";
import { parseAnnouncementBody } from "@/components/citation-panel/panel";
import { isAnnouncement } from "@/lib/citations";
import type { AnnouncementCitation, Citation } from "@/lib/data";

const ARTICLE_URL =
  "https://www.defense.gov/News/Contracts/Contract/Article/1006508/";
const ARCHIVE_URL =
  "https://web.archive.org/web/20250510074748/" + ARTICLE_URL;
const SHA = "a".repeat(64);
const FORMULA =
  "crosswalk link: pe_bli=0601101E matched to award PIID HR001124C0001" +
  " via method='announcement+lexicon', confidence='high'" +
  " (dollars live at award grain in fct_award_transactions)";

describe("AnnouncementCard", () => {
  it("renders the defense.gov article link under the announcement kind", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: ARCHIVE_URL, sha256: SHA }}
      />,
    );

    const card = container.querySelector('[data-cite-kind="announcement"]');
    expect(card).not.toBeNull();

    const link = container.querySelector<HTMLAnchorElement>(
      '[data-testid="announcement-article-link"]',
    );
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(ARTICLE_URL);
    expect(link!.textContent).toContain("defense.gov article 1006508");
    expect(link!.getAttribute("rel")).toContain("noopener");
    expect(link!.getAttribute("target")).toBe("_blank");
  });

  it("names the source in words, not only by URL", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: null, sha256: null }}
      />,
    );
    expect(container.textContent).toContain(
      "Official DoD contract announcement",
    );
  });

  it("links the Wayback snapshot and shows the archived copy's sha256", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: ARCHIVE_URL, sha256: SHA }}
      />,
    );

    const archive = container.querySelector<HTMLAnchorElement>(
      '[data-testid="announcement-archive-link"]',
    );
    expect(archive).not.toBeNull();
    expect(archive!.getAttribute("href")).toBe(ARCHIVE_URL);
    expect(
      container.querySelector('[data-testid="announcement-sha256"]')!.textContent,
    ).toContain(SHA);
  });

  it("says an article was never archived instead of rendering a dead link", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: null, sha256: null }}
      />,
    );

    expect(
      container.querySelector('[data-testid="announcement-archive-link"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="announcement-sha256"]'),
    ).toBeNull();
    expect(container.textContent).toContain("No archived copy");
  });

  it("states that the link is an inference, not a quoted figure", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: ARCHIVE_URL, sha256: SHA }}
      />,
    );
    expect(container.textContent).toContain("inference");
  });

  it("never claims the announcement names the program", () => {
    // The sentence this replaced ("The announcement names both this contract
    // and this program") was false for every basis except exact-name — 518 of
    // the 708 published links (re-measured 2026-09-04).
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{
          article_id: "1006508",
          archive_url: ARCHIVE_URL,
          sha256: SHA,
          match_basis: "llm-description",
        }}
      />,
    );
    expect(container.textContent).not.toContain("names both this contract");
    expect(container.textContent).toContain("names this contract");
    expect(container.textContent).toContain("Matched by: LLM-judged description");
  });

  it("renders the link's method and confidence tier when the row carries it", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: null, sha256: null }}
        formula={FORMULA}
      />,
    );
    const el = container.querySelector('[data-testid="announcement-formula"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("announcement+lexicon");
    expect(el!.textContent).toContain("'high'");
  });

  it("renders no method block when the row carries no formula", () => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{ article_id: "1006508", archive_url: null, sha256: null }}
      />,
    );
    expect(
      container.querySelector('[data-testid="announcement-formula"]'),
    ).toBeNull();
  });
});

describe("AnnouncementCard match basis", () => {
  const basisText = (match_basis: string | null | undefined) => {
    const { container } = render(
      <AnnouncementCard
        url={ARTICLE_URL}
        body={{
          article_id: "1006508",
          archive_url: ARCHIVE_URL,
          sha256: SHA,
          match_basis,
        }}
      />,
    );
    return container.querySelector('[data-testid="announcement-match-basis"]')!
      .textContent;
  };

  // One case per basis the pipeline emits — a token that fell through to a
  // flattering default would be an overclaim on a real citation.
  it("says 'exact program name' for exact-name", () => {
    expect(basisText("exact-name")).toBe("Matched by: exact program name");
  });

  it("says 'normalized designator' for designator-normalized", () => {
    expect(basisText("designator-normalized")).toBe(
      "Matched by: normalized designator",
    );
  });

  it("says 'LLM-judged alias' for llm-alias", () => {
    expect(basisText("llm-alias")).toBe("Matched by: LLM-judged alias");
  });

  it("says 'LLM-judged designator variant' for llm-designator-variant", () => {
    expect(basisText("llm-designator-variant")).toBe(
      "Matched by: LLM-judged designator variant",
    );
  });

  it("says 'LLM-judged description' for llm-description", () => {
    expect(basisText("llm-description")).toBe(
      "Matched by: LLM-judged description",
    );
  });

  it("says 'exact subaward description' for subaward-description-exact", () => {
    expect(basisText("subaward-description-exact")).toBe(
      "Matched by: exact subaward description",
    );
  });

  it("says 'basis not recorded' when the packet recorded none", () => {
    // Hundreds of published links recorded no basis at all. The card says so
    // plainly rather than naming one: "not recorded" is the honest answer,
    // and it is not a weaker synonym for 'exact-name'.
    expect(basisText(null)).toBe("Matched by: basis not recorded");
    expect(basisText(undefined)).toBe("Matched by: basis not recorded");
    expect(basisText("   ")).toBe("Matched by: basis not recorded");
  });

  it("shows an unknown basis verbatim instead of relabelling it", () => {
    expect(basisText("some-future-basis")).toBe("Matched by: some-future-basis");
  });

  it("degrades to 'basis not recorded' for a non-string match_basis instead of throwing", () => {
    // AnnouncementBody types match_basis as string | null | undefined, but the
    // value crosses a JSON boundary at runtime — a malformed export row could
    // hand this a number or object. .trim() on that would throw and take the
    // whole citation panel down with it.
    expect(basisText(42 as unknown as string)).toBe(
      "Matched by: basis not recorded",
    );
  });
});

describe("announcement citation kind", () => {
  // Typed as AnnouncementCitation, not `as unknown as Citation`: the cast
  // defeated the very interface this fixture is supposed to exercise, so a
  // field the exporter stopped emitting would not have shown up here.
  const ANNOUNCEMENT_CITATION: AnnouncementCitation = {
    kind: "announcement",
    amount_text: null,
    amount_thousands: null,
    bottom_pt: null,
    cells: null,
    formula: FORMULA,
    hosted_pdf_url: null,
    inputs: null,
    official_url: ARTICLE_URL,
    page_height: null,
    page_number: null,
    page_width: null,
    query_body: JSON.stringify({
      archive_url: ARCHIVE_URL,
      article_id: "1006508",
      match_basis: "designator-normalized",
      sha256: SHA,
    }),
    recorded_value: null,
    resolution: null,
    retrieved_at: null,
    sha256: SHA,
    sheet: null,
    top_pt: null,
    units: null,
    x0: null,
    x1: null,
    xml_path: null,
  };

  it("is recognised by the type guard the panel dispatches on", () => {
    expect(isAnnouncement(ANNOUNCEMENT_CITATION)).toBe(true);
    // The negative case is a real DerivedCitation (the tier these rows were
    // promoted out of), not the announcement fixture with its kind swapped —
    // that object satisfies neither interface.
    const derived: Citation = {
      ...ANNOUNCEMENT_CITATION,
      kind: "derived",
      formula: FORMULA,
      inputs: "[]",
      recorded_value: "high",
      sha256: null,
    };
    expect(isAnnouncement(derived)).toBe(false);
  });

  it("carries a footnote source label (no fall-through to an unlabelled tier)", async () => {
    const { footnoteInputFromCitation } = await import("@/lib/footnote");
    const input = footnoteInputFromCitation(
      ANNOUNCEMENT_CITATION,
      "abcd1234abcd1234",
      {},
    );
    expect(input.sourceLabel).toBe("Official DoD contract announcement");
    expect(input.officialUrl).toBe(ARTICLE_URL);
    expect(input.sha256).toBe(SHA);
  });
});

// ── M7: the degraded path — a body that cannot be read ──────────────────────
//
// parseAnnouncementBody returns null for a query_body the panel cannot trust,
// and CitationBody then renders "This announcement citation could not be
// read." rather than an AnnouncementCard with a blank article id. Every
// not-null branch was tested; the null branch — the one a reader actually
// meets when an export goes wrong — was not.
describe("parseAnnouncementBody — the unusable-body path", () => {
  it("returns null for an absent body", () => {
    expect(parseAnnouncementBody(null)).toBeNull();
    expect(parseAnnouncementBody("")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseAnnouncementBody("{not json")).toBeNull();
  });

  it("returns null when article_id is missing, empty or not a string", () => {
    expect(parseAnnouncementBody(JSON.stringify({}))).toBeNull();
    expect(parseAnnouncementBody(JSON.stringify({ article_id: "" }))).toBeNull();
    expect(parseAnnouncementBody(JSON.stringify({ article_id: 1006508 }))).toBeNull();
    expect(parseAnnouncementBody("null")).toBeNull();
  });

  it("parses a usable body and keeps an absent basis absent", () => {
    const body = parseAnnouncementBody(
      JSON.stringify({ article_id: "1006508", sha256: "a".repeat(64) }),
    );
    expect(body).toEqual({
      article_id: "1006508",
      archive_url: null,
      sha256: "a".repeat(64),
      match_basis: null,
    });
    // …and an absent basis reaches the reader as "not recorded", never as a
    // default that flatters the link.
    expect(matchBasisPhrase(body!.match_basis)).toBe("basis not recorded");
  });
});
