/**
 * Task 3 (Phase 5D) — lazy citation shards in the panel.
 *
 * Contract under test (plan Task 3):
 *   1. lib/cite-shards.ts — fact-id miss triggers exactly ONE fetch of
 *      /json/cite-shards/{fact_id[:2]}.json; the shard is cached (Map) so a
 *      second lookup in the same shard does NO fetch; concurrent lookups are
 *      single-flighted (one fetch, both resolve); a failed fetch resolves
 *      null AND is not poison-cached (a later lookup may retry).
 *   2. CitationPanelProvider — openPanel(factId) with a fact_id missing from
 *      the embedded slice fetches its shard, then renders the citation card
 *      exactly as if it had been embedded; a fetch failure surfaces the
 *      degraded state ([data-degraded="citation"]) instead of a silent no-op;
 *      the embedded fast path does NOT fetch (zero behavior change).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React, { useContext } from "react";

import {
  shardPrefix,
  shardUrl,
  fetchCitationShard,
  resolveCitationFromShards,
  __resetCiteShardCache,
} from "@/lib/cite-shards";
import { CitationPanelProvider } from "@/components/citation-panel";
import { CitationPanelContext } from "@/components/cite";
import type { CitationsMap } from "@/lib/citations";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const WORKBOOK_CITATION = {
  kind: "workbook" as const,
  amount_text: null,
  amount_thousands: 99500,
  bottom_pt: null,
  cells: "P19",
  formula: null,
  hosted_pdf_url: null,
  inputs: null,
  official_url: "https://example.gov/workbook.xlsx",
  page_height: null,
  page_number: null,
  page_width: null,
  query_body: null,
  recorded_value: null,
  resolution: null,
  retrieved_at: "2026-06-10T12:00:00Z",
  sha256: "worksheetsha256",
  sheet: "Exhibit R-2A",
  top_pt: null,
  units: "USD thousands",
  x0: null,
  x1: null,
  xml_path: null,
};

// Two fact ids in the SAME shard ("ab"), one in another shard ("cd").
const FID_A = "ab11111111111111";
const FID_B = "ab22222222222222";
const FID_OTHER = "cd33333333333333";

function shardResponse(map: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(map),
  } as unknown as Response;
}

function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    json: () => Promise.reject(new Error("no body")),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetCiteShardCache();
  // Default: reject unknown fetches (asset-config's /config.json catches its
  // own rejection and falls back — the tests below override per-scenario).
  fetchMock = vi.fn(() => Promise.reject(new Error("unmocked fetch")));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. lib/cite-shards ───────────────────────────────────────────────────────

describe("cite-shards lib", () => {
  it("shardPrefix / shardUrl derive the shard from fact_id[:2]", () => {
    expect(shardPrefix(FID_A)).toBe("ab");
    expect(shardUrl(FID_A)).toBe("/json/cite-shards/ab.json");
  });

  it("a miss triggers exactly one shard fetch and resolves the citation", async () => {
    fetchMock.mockResolvedValueOnce(
      shardResponse({ [FID_A]: WORKBOOK_CITATION, [FID_B]: WORKBOOK_CITATION }),
    );

    const citation = await resolveCitationFromShards(FID_A);
    expect(citation).toMatchObject({ kind: "workbook", sheet: "Exhibit R-2A" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/json/cite-shards/ab.json");
  });

  it("second lookup in the same shard does NOT fetch again (cached Map)", async () => {
    fetchMock.mockResolvedValueOnce(
      shardResponse({ [FID_A]: WORKBOOK_CITATION, [FID_B]: WORKBOOK_CITATION }),
    );

    await resolveCitationFromShards(FID_A);
    const second = await resolveCitationFromShards(FID_B);
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("concurrent lookups in the same shard are single-flighted", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveFetch = res;
      }),
    );

    const p1 = resolveCitationFromShards(FID_A);
    const p2 = resolveCitationFromShards(FID_B);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      shardResponse({ [FID_A]: WORKBOOK_CITATION, [FID_B]: WORKBOOK_CITATION }),
    );
    const [c1, c2] = await Promise.all([p1, p2]);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("distinct shards fetch independently", async () => {
    fetchMock
      .mockResolvedValueOnce(shardResponse({ [FID_A]: WORKBOOK_CITATION }))
      .mockResolvedValueOnce(shardResponse({ [FID_OTHER]: WORKBOOK_CITATION }));

    await resolveCitationFromShards(FID_A);
    await resolveCitationFromShards(FID_OTHER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/json/cite-shards/cd.json");
  });

  it("a fact_id absent from its (valid) shard resolves null; shard stays cached", async () => {
    fetchMock.mockResolvedValueOnce(shardResponse({ [FID_B]: WORKBOOK_CITATION }));

    const miss = await resolveCitationFromShards(FID_A);
    expect(miss).toBeNull();
    // Same-shard hit uses the cache — no second fetch.
    const hit = await resolveCitationFromShards(FID_B);
    expect(hit).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetch failure resolves null and is NOT poison-cached (retry allowed)", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(shardResponse({ [FID_A]: WORKBOOK_CITATION }));

    const failed = await fetchCitationShard("ab");
    expect(failed).toBeNull();

    const retried = await resolveCitationFromShards(FID_A);
    expect(retried).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP error status resolves null (degraded, never fake success)", async () => {
    fetchMock.mockResolvedValueOnce(notFoundResponse());
    const res = await fetchCitationShard("ab");
    expect(res).toBeNull();
  });
});

// ── 2. Panel integration ─────────────────────────────────────────────────────

/** Button that calls openPanel(factId) via the panel context. */
function OpenCitation({ factId }: { factId: string }) {
  const { openPanel } = useContext(CitationPanelContext);
  return (
    <button type="button" onClick={() => openPanel(factId)}>
      open {factId}
    </button>
  );
}

describe("CitationPanelProvider — fetch-on-miss", () => {
  it("embedded fast path: no fetch when the fact_id is in the slice", async () => {
    const slice = { [FID_A]: WORKBOOK_CITATION } as unknown as CitationsMap;
    render(
      <CitationPanelProvider citations={slice}>
        <OpenCitation factId={FID_A} />
      </CitationPanelProvider>,
    );

    screen.getByText(`open ${FID_A}`).click();
    await waitFor(() => {
      expect(screen.getByTestId("citation-panel")).toBeInTheDocument();
    });
    expect(screen.getByTestId("citation-panel").textContent).toContain(
      "Exhibit R-2A",
    );
    // /config.json may be fetched by the asset provider — but never a shard.
    const shardCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("cite-shards"),
    );
    expect(shardCalls).toHaveLength(0);
  });

  it("miss: fetches the shard once, then renders the citation card", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("cite-shards")) {
        return Promise.resolve(shardResponse({ [FID_A]: WORKBOOK_CITATION }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    render(
      <CitationPanelProvider citations={{}}>
        <OpenCitation factId={FID_A} />
      </CitationPanelProvider>,
    );

    screen.getByText(`open ${FID_A}`).click();
    await waitFor(() => {
      expect(screen.getByTestId("citation-panel").textContent).toContain(
        "Exhibit R-2A",
      );
    });
    const shardCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("cite-shards"),
    );
    expect(shardCalls).toHaveLength(1);
    expect(shardCalls[0][0]).toBe("/json/cite-shards/ab.json");
  });

  it("second miss in the same shard: no extra fetch (cache hit)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("cite-shards")) {
        return Promise.resolve(
          shardResponse({ [FID_A]: WORKBOOK_CITATION, [FID_B]: WORKBOOK_CITATION }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    render(
      <CitationPanelProvider citations={{}}>
        <OpenCitation factId={FID_A} />
        <OpenCitation factId={FID_B} />
      </CitationPanelProvider>,
    );

    screen.getByText(`open ${FID_A}`).click();
    await waitFor(() => {
      expect(screen.getByTestId("citation-panel").textContent).toContain(
        "Exhibit R-2A",
      );
    });
    screen.getByText(`open ${FID_B}`).click();
    await waitFor(() => {
      expect(screen.getByTestId("citation-panel").textContent).toContain(
        "Exhibit R-2A",
      );
    });

    const shardCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("cite-shards"),
    );
    expect(shardCalls).toHaveLength(1);
  });

  it("fetch failure: panel opens in the degraded state (never fake success)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("cite-shards")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    render(
      <CitationPanelProvider citations={{}}>
        <OpenCitation factId={FID_A} />
      </CitationPanelProvider>,
    );

    screen.getByText(`open ${FID_A}`).click();
    await waitFor(() => {
      expect(
        document.querySelector('[data-degraded="citation"]'),
      ).toBeInTheDocument();
    });
  });
});
