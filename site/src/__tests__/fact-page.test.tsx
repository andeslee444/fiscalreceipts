/**
 * /fact/{id} resolver page (PM Sprint 1 Task 5, spec §P0-4.1).
 *
 * Contract under test (client resolver — the locked design decision: Vercel
 * rewrite `/fact/:id` → `/fact/` + this client component; full per-fact SSG
 * deferred):
 *   - no id (bare /fact/) → explainer, NO shard fetch
 *   - ?id={16-hex} → fetches /json/cite-shards/{id[:2]}.json, renders the
 *     citation payload's fields: value WITH unit, document title, locator,
 *     full sha256, retrieved date, official-source link, /fact/{fid8}
 *     permalink, kind label
 *   - /fact/{fid8} pathname form works identically (prefix resolution)
 *   - 8-hex prefix matching TWO 16-hex ids → BOTH rendered + disambiguation
 *     note (the collision rule; today's corpus has 2 colliding fid8 pairs)
 *   - resolvable shard, no match → honest not-found state
 *   - shard fetch failure → degraded state (never fake success)
 *   - payload pe_bli present → "Appears on" /program/{pe}/#fact-{id} link;
 *     absent → no parent link (payloads gain pe_bli at the next export)
 *   - derived payload → formula + input-fact permalinks
 *   - NO supersede display: citation payloads carry no superseded flag today
 *     (superseded rows are fenced out of the export entirely) — the page
 *     renders nothing about supersession rather than faking it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { FactResolver } from "@/app/fact/fact-resolver";
import { __resetCiteShardCache } from "@/lib/cite-shards";

// ── Fixtures (real bb54b165 payload shape from today's corpus) ──────────────

const PDF_FID = "bb54b1658b2746cb";
const PDF_CITATION = {
  amount_text: "5,247.070",
  amount_thousands: null,
  bottom_pt: 227.75,
  cells: null,
  formula: null,
  hosted_pdf_url: "/pdfs/528d1441ffff.pdf#page=55",
  inputs: null,
  kind: "jbook_pdf",
  official_url:
    "https://www.saffm.hq.af.mil/Portals/84/documents/FY26/FY26%20Air%20Force%20Aircraft%20Procurement%20Vol%20I.pdf#page=55",
  page_height: 612.0,
  page_number: 55,
  page_width: 792.0,
  query_body: null,
  recorded_value: null,
  resolution: "unique",
  retrieved_at: "2026-07-05T01:16:15.825537-04:00",
  sha256: "528d14414585406684021e04e74632cccf4b40f8ba039f89f8af1ddebc7bc01e",
  sheet: null,
  top_pt: 220.75,
  units: "USD millions",
  x0: 236.6,
  x1: 267.7,
  xml_path: null,
};

const DERIVED_FID = "bb0000a9552f3fec";
const DERIVED_CITATION = {
  ...PDF_CITATION,
  amount_text: null,
  kind: "derived",
  formula: "PB2025 FY2025 request - PB2024 FY2024 request",
  inputs: '["dca4c4d92c633300", "7373db25cb83b652"]',
  recorded_value: "142.000",
  units: "USD thousands",
  official_url: null,
  hosted_pdf_url: null,
  sha256: null,
  page_number: null,
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Route the fetch mock: /config.json (AssetConfigProvider's legitimate
 * runtime-config fetch) always succeeds; cite-shard URLs serve `shard`
 * (an Error value rejects, simulating a network failure).
 */
function mockFetchWithShard(shard: Record<string, unknown> | Error) {
  fetchMock.mockImplementation((url: string) => {
    if (url === "/config.json") {
      return Promise.resolve(jsonResponse({ assetBaseUrl: "/assets" }));
    }
    if (shard instanceof Error) return Promise.reject(shard);
    return Promise.resolve(jsonResponse(shard));
  });
}

/** The cite-shard fetches made (config.json excluded). */
function shardFetches(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/cite-shards/"));
}

function setUrl(path: string) {
  window.history.replaceState({}, "", path);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetCiteShardCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUrl("/");
});

describe("FactResolver", () => {
  it("bare /fact/ renders the explainer and fetches no shard", () => {
    setUrl("/fact/");
    mockFetchWithShard({});
    render(<FactResolver />);
    expect(screen.getByTestId("fact-explainer")).toBeInTheDocument();
    expect(shardFetches()).toHaveLength(0);
  });

  it("?id={16-hex} resolves the fact and renders the payload fields", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchWithShard({ [PDF_FID]: PDF_CITATION });
    render(<FactResolver />);

    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    expect(shardFetches()).toEqual(["/json/cite-shards/bb.json"]);

    const card = screen.getByTestId("fact-card");
    const text = card.textContent ?? "";
    // value WITH unit (amount_text + units word)
    expect(text).toContain("$5,247.070 million");
    // document TITLE (not filename)
    expect(text).toContain("FY2026 Air Force Aircraft Procurement, Vol. I");
    // locator: exhibit + page
    expect(text).toContain("Exhibit P-40");
    expect(text).toContain("p. 55");
    // FULL sha256 (not the 8-char prefix)
    expect(text).toContain(PDF_CITATION.sha256);
    // retrieved date
    expect(text).toContain("2026-07-05");
    // the permalink (fid8 form)
    expect(text).toContain("/fact/bb54b165");
    // kind label
    expect(text).toContain("Budget Justification PDF");
    // official-source link
    const official = card.querySelector(
      `a[href="${PDF_CITATION.official_url}"]`,
    );
    expect(official).not.toBeNull();
  });

  it("/fact/{fid8} pathname form resolves via prefix match", async () => {
    setUrl("/fact/bb54b165");
    mockFetchWithShard({ [PDF_FID]: PDF_CITATION });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("fact-card").textContent).toContain(PDF_FID);
  });

  it("colliding fid8 prefix renders BOTH facts + a disambiguation note", async () => {
    const twin = `${PDF_FID.slice(0, 8)}ffffffff`;
    setUrl(`/fact/${PDF_FID.slice(0, 8)}`);
    mockFetchWithShard({ [PDF_FID]: PDF_CITATION, [twin]: DERIVED_CITATION });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getAllByTestId("fact-card")).toHaveLength(2),
    );
    expect(screen.getByTestId("fact-collision-note")).toBeInTheDocument();
  });

  it("resolvable shard without the id renders the honest not-found state", async () => {
    setUrl("/fact/bb00000000000000");
    mockFetchWithShard({ [PDF_FID]: PDF_CITATION });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-not-found")).toBeInTheDocument(),
    );
  });

  it("shard fetch failure renders the degraded state, never fake success", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchWithShard(new Error("network down"));
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-error")).toBeInTheDocument(),
    );
  });

  it("renders the 'Appears on' parent link when the payload carries pe_bli", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchWithShard({ [PDF_FID]: { ...PDF_CITATION, pe_bli: "ATA000" } });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    const link = screen
      .getByTestId("fact-card")
      .querySelector(`a[href="/program/ATA000/#fact-${PDF_FID}"]`);
    expect(link).not.toBeNull();
  });

  it("omits the parent link when the payload has no pe_bli (today's shards)", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchWithShard({ [PDF_FID]: PDF_CITATION });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    const links = Array.from(
      screen.getByTestId("fact-card").querySelectorAll("a[href]"),
    ).map((a) => a.getAttribute("href") ?? "");
    expect(links.some((h) => h.startsWith("/program/"))).toBe(false);
  });

  it("derived facts render the formula + input-fact permalinks", async () => {
    setUrl(`/fact/?id=${DERIVED_FID}`);
    mockFetchWithShard({ [DERIVED_FID]: DERIVED_CITATION });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    const card = screen.getByTestId("fact-card");
    expect(card.textContent).toContain(
      "PB2025 FY2025 request - PB2024 FY2024 request",
    );
    expect(card.querySelector('a[href="/fact/dca4c4d9"]')).not.toBeNull();
    expect(card.querySelector('a[href="/fact/7373db25"]')).not.toBeNull();
  });
});
