/**
 * feed-card-item-parity.test.tsx — Task 6 (#73), addendum ruling 2.
 *
 * <FeedCardItemClient> (feed-card-item-client.tsx) is a client-safe TWIN of
 * <FeedCardItem> (feed-card-item.tsx), built because two of the pieces
 * FeedCardItem renders — <FeedHeadline> and <Fy26SplitNote> — transitively
 * `import "server-only"` (via src/lib/data.ts and src/lib/coverage.ts
 * respectively) and cannot be imported into a "use client" module without
 * breaking the Next.js client bundle build. See feed-card-item-client.tsx's
 * doc comment for the full explanation.
 *
 * This test is the parity contract: for the SAME (card, companySlug,
 * hasProgramPage) triple, the two components must render byte-identical
 * HTML. Three fixtures exercise the paths that differ between the server
 * source and the client twin's reimplementation:
 *
 *   1. A plain title-led concentration_shift card (no money in the
 *      headline, no reconciliation split) — the common case.
 *   2. A yoy_swing card with fy26_split.has_reconciliation, disc AND
 *      reconciliation both set, and a headline carrying a dollar token
 *      (headline_segments with an amount run) — exercises FeedHeadlineClient's
 *      ProseCite path AND Fy26SplitNoteClient's full branch (both Cites,
 *      the recon-chip, the disc-pct-change span).
 *   3. A code-led "legacy" headline (headline starts with the card's own
 *      pe_bli code, title === pe_bli) — the one case where the server's
 *      feedHeadlineSegments() would consult getPrograms() and the client
 *      twin deliberately does not (see that file's doc comment). Pinned
 *      here so a future divergence is caught.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { FeedCardItem } from "@/components/feed-card-item";
import { FeedCardItemClient } from "@/components/feed-card-item-client";
import type { FeedCard } from "@/lib/data";

function renderBoth(
  card: FeedCard,
  companySlug: string | null,
  hasProgramPage: boolean,
) {
  const server = render(
    <FeedCardItem card={card} companySlug={companySlug} hasProgramPage={hasProgramPage} />,
  );
  const client = render(
    <FeedCardItemClient card={card} companySlug={companySlug} hasProgramPage={hasProgramPage} />,
  );
  return { serverHtml: server.container.innerHTML, clientHtml: client.container.innerHTML };
}

describe("<FeedCardItemClient> parity with <FeedCardItem>", () => {
  it("renders identical HTML for a plain concentration_shift card", () => {
    const card: FeedCard = {
      event_type: "concentration_shift",
      family_key: null,
      figure_fact_id: "a".repeat(16),
      figure_units: "hhi",
      figure_value: 8662.294,
      fiscal_year: 2020,
      headline: "Defense Research Sciences award concentration HHI=8662 (2020)",
      headline_segments: [
        { text: "Defense Research Sciences award concentration HHI=8662 (2020)" },
      ],
      organization: null,
      pe_bli: "0601101E",
      program_url: "/program/0601101E/",
      title: "Defense Research Sciences",
      why_url: "/methodology/#feed-concentration_shift",
      basis: null,
      fy: null,
      measure: null,
      edition: null,
      magnitude: {
        kind: "single",
        units: "dollars",
        from: null,
        to: { label: "FY2020 matched obligations", fy: 2020, value: 25_351_139_885.2, fact_id: "b".repeat(16) },
        delta: null,
        pct_change: null,
      },
    };
    const { serverHtml, clientHtml } = renderBoth(card, null, true);
    expect(clientHtml).toBe(serverHtml);
  });

  it("renders identical HTML for a yoy_swing card with a full reconciliation split and a money token in the headline", () => {
    const card: FeedCard = {
      event_type: "yoy_swing",
      family_key: null,
      figure_fact_id: "c".repeat(16),
      figure_units: "pct_change",
      figure_value: -61.29,
      fiscal_year: 2026,
      headline: "MEDIUM UNMANNED SURFACE VEHICLES decreased 61% FY25→26 (to $39.4M)",
      headline_segments: [
        { text: "MEDIUM UNMANNED SURFACE VEHICLES decreased 61% FY25→26 (to " },
        { amount: "$39.4M", fact_id: "d".repeat(16) },
        { text: ")" },
      ],
      organization: "N",
      pe_bli: "0605512N",
      program_url: "/program/0605512N/",
      title: "MEDIUM UNMANNED SURFACE VEHICLES",
      why_url: "/methodology/#feed-yoy_swing",
      basis: "toa",
      fy: 2026,
      measure: "change",
      edition: 2026,
      magnitude: {
        kind: "pair",
        units: "thousands_usd",
        from: { label: "FY2025", fy: 2025, value: 101_838, fact_id: "e".repeat(16) },
        to: { label: "FY2026", fy: 2026, value: 39_426, fact_id: "f".repeat(16) },
        delta: { label: "change", fy: 2026, value: -62_412, fact_id: "c".repeat(16) },
        pct_change: -61.29,
      },
      fy26_split: {
        disc_k: 10_000,
        recon_k: 29_426,
        total_k: 39_426,
        recon_share: 0.746,
        disc_pct_change: -20.5,
        has_reconciliation: true,
        disc: {
          v: 10_000,
          units: "USD thousands",
          dataset: "budget_lines",
          fid: "1".repeat(16),
          public_id: "11111111",
          basis: "toa",
          fy: 2026,
          measure: "disc-request",
          edition: 2026,
        },
        reconciliation: {
          v: 29_426,
          units: "USD thousands",
          dataset: "budget_lines",
          fid: "2".repeat(16),
          public_id: "22222222",
          basis: "toa",
          fy: 2026,
          measure: "reconciliation-request",
          edition: 2026,
        },
      },
    };
    const { serverHtml, clientHtml } = renderBoth(card, null, true);
    expect(clientHtml).toBe(serverHtml);
    // Sanity: the branch we actually meant to exercise fired on both sides.
    expect(serverHtml).toContain("data-fy26-recon-chip");
    expect(serverHtml).toContain("data-fy26-disc-pct-change");
    expect(serverHtml).toContain("data-prose-cite");
  });

  it("renders identical HTML for a code-led legacy headline whose title equals its own code", () => {
    // Real corpus shape (2026-09-04): pe_bli "LRASM0" cards carry
    // card.title === "LRASM0" === card.pe_bli — feedDisplayHeadline's
    // getPrograms() swap is a no-op for these, which is exactly why the
    // client twin can skip it. See feed-card-item-client.tsx.
    const card: FeedCard = {
      event_type: "concentration_shift",
      family_key: null,
      figure_fact_id: "3".repeat(16),
      figure_units: "hhi",
      figure_value: 10000,
      fiscal_year: 2017,
      headline: "LRASM0 award concentration HHI=10000 (2017)",
      headline_segments: [
        { text: "LRASM0 award concentration HHI=10000 (2017)" },
      ],
      organization: null,
      pe_bli: "LRASM0",
      program_url: "/program/LRASM0/",
      title: "LRASM0",
      why_url: "/methodology/#feed-concentration_shift",
      basis: null,
      fy: null,
      measure: null,
      edition: null,
      magnitude: {
        kind: "single",
        units: "dollars",
        from: null,
        to: { label: "FY2017 matched obligations", fy: 2017, value: 502_331_712.88, fact_id: "4".repeat(16) },
        delta: null,
        pct_change: null,
      },
    };
    const { serverHtml, clientHtml } = renderBoth(card, null, true);
    expect(clientHtml).toBe(serverHtml);
  });

  it("renders identical HTML for a family_key-driven new_entrant card with a company link", () => {
    const card: FeedCard = {
      event_type: "new_entrant",
      family_key: "ACME CORP",
      figure_fact_id: "5".repeat(16),
      figure_units: "dollars",
      figure_value: 3_100_000,
      fiscal_year: 2025,
      headline: "ACME CORP new defense contractor (first award FY2025, $3.1M total)",
      headline_segments: [
        { text: "ACME CORP new defense contractor (first award FY2025, " },
        { amount: "$3.1M", fact_id: "6".repeat(16) },
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
    };
    const { serverHtml, clientHtml } = renderBoth(card, "acme-corp", false);
    expect(clientHtml).toBe(serverHtml);
    // next/link normalizes the trailing slash away under jsdom.
    expect(serverHtml).toContain('href="/company/acme-corp"');
  });

  it("renders identical HTML for a new_entrant card with no company page (data-no-company-page)", () => {
    const card: FeedCard = {
      event_type: "new_entrant",
      family_key: "OBSCURE LLC",
      figure_fact_id: "7".repeat(16),
      figure_units: "dollars",
      figure_value: 1_500_000,
      fiscal_year: 2025,
      headline: "OBSCURE LLC new defense contractor (first award FY2025, $1.5M total)",
      headline_segments: [
        { text: "OBSCURE LLC new defense contractor (first award FY2025, " },
        { amount: "$1.5M", fact_id: "8".repeat(16) },
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
    };
    const { serverHtml, clientHtml } = renderBoth(card, null, false);
    expect(clientHtml).toBe(serverHtml);
    expect(serverHtml).toContain("data-no-company-page");
  });
});
