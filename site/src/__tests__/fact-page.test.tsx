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
 *
 * Visual-judge fix round additions:
 *   - M2 semantic header: payload pe_bli + a sidecar figure matching the
 *     fid → `F-35 (ATA000) · FY2024 · Actuals · P-40 detail · PB2026` +
 *     the drawer's compact-USD equivalence; NO sidecar match → payload-only
 *     render (no fabrication) — both paths tested.
 *   - M3 canonical permalink: the rendered permalink is ALWAYS
 *     https://fiscalreceipts.com/fact/{fid8}, never the (differing) jsdom
 *     runtime origin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { FactResolver, semanticHeaderText } from "@/app/fact/fact-resolver";
import { findSidecarFigure } from "@/lib/fact-resolver";
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

  it("renders the CANONICAL permalink, never the runtime origin (M3)", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchWithShard({ [PDF_FID]: PDF_CITATION });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    // The jsdom origin differs from the canonical origin — the permalink
    // must pin to the canonical one anyway (it is an identifier).
    expect(window.location.origin).not.toBe("https://fiscalreceipts.com");
    expect(screen.getByTestId("fact-card").textContent).toContain(
      "https://fiscalreceipts.com/fact/bb54b165",
    );
    expect(screen.getByTestId("fact-card").textContent).not.toContain(
      window.location.origin,
    );
  });
});

// ── Semantic header (visual-judge M2) ───────────────────────────────────────

/** ATA000 sidecar slice — the real shapes the exporter emits. */
const ATA_SIDECAR = {
  summary: {
    edition: 2026,
    basis_preference: "toa",
    cards: [],
    reconciliation: [
      {
        fy: 2024,
        measure: "actuals",
        toa: {
          v: 5565655.0,
          units: "USD thousands",
          fid: "5b532c52d3ebb4c2",
          public_id: "5b532c52",
          dataset: "fct_decade_series",
        },
        detail: {
          v: 5247.07,
          units: "USD millions",
          fid: PDF_FID,
          public_id: "bb54b165",
          dataset: "jbook_details",
          scenario: "PriorYear",
        },
        delta_thousands: 318585.0,
      },
    ],
  },
  decade_series: {
    actuals: [
      {
        basis: "toa",
        edition: 2026,
        fid: "5b532c52d3ebb4c2",
        fy: 2024,
        measure: "actuals",
        v: 5565655.0,
      },
    ],
  },
  details: [
    {
      fact_id: PDF_FID,
      fy: 2024,
      measure: "actuals",
      basis: "jbook-detail",
      edition: 2026,
      units: "USD millions",
      amount_millions: 5247.07,
      scenario: "PriorYear",
      resolution: "unique",
      xml_path: "LineItem[5]",
    },
  ],
};

const QUICK = {
  docs: [
    {
      id: "p:ATA000",
      kind: "program",
      pe_bli: "ATA000",
      title: "F-35",
      org: "F",
      url: "/program/ATA000/",
      dollars: 1,
    },
  ],
};

/** Route fetches by URL: shard, sidecar, search-quick, config. */
function mockFetchRouted(routes: {
  shard: Record<string, unknown>;
  sidecar?: unknown;
  quick?: unknown;
}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === "/config.json") {
      return Promise.resolve(jsonResponse({ assetBaseUrl: "/assets" }));
    }
    if (url.includes("/cite-shards/")) {
      return Promise.resolve(jsonResponse(routes.shard));
    }
    if (url.includes("/json-lite/program_details/")) {
      return routes.sidecar !== undefined
        ? Promise.resolve(jsonResponse(routes.sidecar))
        : Promise.reject(new Error("no sidecar"));
    }
    if (url.includes("/json-lite/search_quick.json")) {
      return routes.quick !== undefined
        ? Promise.resolve(jsonResponse(routes.quick))
        : Promise.reject(new Error("no quick"));
    }
    return Promise.reject(new Error(`unrouted fetch: ${url}`));
  });
}

describe("FactResolver — semantic header (M2)", () => {
  it("renders program/FY/measure/basis/edition + the equivalence when a sidecar figure matches", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchRouted({
      shard: { [PDF_FID]: { ...PDF_CITATION, pe_bli: "ATA000" } },
      sidecar: ATA_SIDECAR,
      quick: QUICK,
    });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-semantic-header")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("fact-semantic-header").textContent).toBe(
      "F-35 (ATA000) · FY2024 · Actuals · P-40 detail · PB2026",
    );
    // The drawer's compact-USD equivalence line next to the recorded value.
    expect(screen.getByTestId("fact-card").textContent).toContain(
      "(= $5.25B)",
    );
  });

  it("renders the payload alone when the sidecar carries NO matching figure (no fabrication)", async () => {
    setUrl(`/fact/?id=${PDF_FID}`);
    mockFetchRouted({
      shard: { [PDF_FID]: { ...PDF_CITATION, pe_bli: "ATA000" } },
      sidecar: { summary: { edition: 2026, cards: [], reconciliation: [] } },
      quick: QUICK,
    });
    render(<FactResolver />);
    await waitFor(() =>
      expect(screen.getByTestId("fact-card")).toBeInTheDocument(),
    );
    // Let the sidecar fetch settle, then assert the header stayed absent.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("/json-lite/program_details/ATA000.json"),
        ),
      ).toBe(true),
    );
    expect(screen.queryByTestId("fact-semantic-header")).toBeNull();
    // Payload fields still render — degraded to exactly what the payload says.
    expect(screen.getByTestId("fact-card").textContent).toContain(
      "$5,247.070 million",
    );
  });

  it("falls back to the PE code when search-quick has no title (still no guess)", () => {
    const fig = findSidecarFigure(ATA_SIDECAR, PDF_FID)!;
    expect(fig).not.toBeNull();
    expect(semanticHeaderText(fig, null, "ATA000")).toBe(
      "ATA000 · FY2024 · Actuals · P-40 detail · PB2026",
    );
  });

  it("findSidecarFigure declares dataset units for unit-less collections (decade = USD thousands)", () => {
    const fig = findSidecarFigure(ATA_SIDECAR, "5b532c52d3ebb4c2")!;
    expect(fig).not.toBeNull();
    expect(fig.units).toBe("USD thousands");
    expect(fig.basis).toBe("toa");
    expect(fig.fy).toBe(2024);
    expect(fig.value).toBe(5565655.0);
  });

  it("findSidecarFigure resolves reconciliation members with the entry's fy/measure", () => {
    const sidecar = {
      summary: ATA_SIDECAR.summary,
    };
    const fig = findSidecarFigure(sidecar, PDF_FID)!;
    expect(fig).not.toBeNull();
    expect(fig.fy).toBe(2024);
    expect(fig.measure).toBe("actuals");
    expect(fig.basis).toBe("jbook-detail");
    expect(fig.units).toBe("USD millions");
    expect(fig.edition).toBe(2026);
  });

  it("findSidecarFigure returns null for an id in no collection", () => {
    expect(findSidecarFigure(ATA_SIDECAR, "ffffffffffffffff")).toBeNull();
  });
});
