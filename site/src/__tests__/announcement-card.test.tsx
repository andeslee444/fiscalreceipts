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

import { AnnouncementCard } from "@/components/citation-panel/announcement-card";
import { isAnnouncement } from "@/lib/citations";
import type { Citation } from "@/lib/data";

const ARTICLE_URL =
  "https://www.defense.gov/News/Contracts/Contract/Article/1006508/";
const ARCHIVE_URL =
  "https://web.archive.org/web/20250510074748/" + ARTICLE_URL;
const SHA = "a".repeat(64);

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
});

describe("announcement citation kind", () => {
  const ANNOUNCEMENT_CITATION = {
    kind: "announcement",
    amount_text: null,
    amount_thousands: null,
    bottom_pt: null,
    cells: null,
    formula: null,
    hosted_pdf_url: null,
    inputs: null,
    official_url: ARTICLE_URL,
    page_height: null,
    page_number: null,
    page_width: null,
    query_body: JSON.stringify({
      archive_url: ARCHIVE_URL,
      article_id: "1006508",
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
  } as unknown as Citation;

  it("is recognised by the type guard the panel dispatches on", () => {
    expect(isAnnouncement(ANNOUNCEMENT_CITATION)).toBe(true);
    expect(
      isAnnouncement({ ...ANNOUNCEMENT_CITATION, kind: "derived" } as Citation),
    ).toBe(false);
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
