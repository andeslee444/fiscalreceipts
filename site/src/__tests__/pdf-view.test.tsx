/**
 * pdf-view tests (PDF clarity/speed pass):
 *   1. Ranged transport — getDocument called with rangeChunkSize /
 *      disableAutoFetch / disableStream and the resolved asset URL
 *   2. Loading UX — page-shaped skeleton with explicit "Loading page N…"
 *   3. Ready state — canvas.pdf-page-fade.is-ready + highlight +
 *      Enlarge button (data-testid="pdf-enlarge")
 *   4. Document cache — reopening the same URL does not re-fetch
 *   5. Zoom overlay — opens as an aria-modal dialog with zoom controls,
 *      closes on Escape
 *   6. Degraded fallback — data-degraded="pdf" on load failure (G3 contract)
 *
 * PDF.js is mocked (jsdom has no canvas 2D context / worker); the mock
 * mirrors the v6 surface pdf-view uses: getDocument → { promise, destroy },
 * doc.getPage → page.getViewport / page.render → { promise, cancel }.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { JbookPdfCitation } from "@/lib/data";

const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock,
}));

function makeFakePdf() {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 792 * scale,
      height: 612 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  };
  return { getPage: async () => page };
}

/** Unique-URL citation per test — the module-level doc cache in pdf-view
 *  persists across tests, so each test gets its own cache key. */
function makeCitation(sha: string): JbookPdfCitation {
  return {
    kind: "jbook_pdf",
    amount_text: "79.440",
    amount_thousands: null,
    bottom_pt: 167.47,
    cells: null,
    formula: null,
    hosted_pdf_url: `/pdfs/${sha}.pdf#page=51`,
    inputs: null,
    official_url: "https://example.mil/jbook.pdf#page=51",
    page_height: 612,
    page_number: 51,
    page_width: 792,
    query_body: null,
    recorded_value: null,
    resolution: "unique",
    retrieved_at: "2026-06-10T12:00:00Z",
    sha256: sha,
    sheet: null,
    top_pt: 158.47,
    units: "USD millions",
    x0: 235.23,
    x1: 267.75,
    xml_path: null,
  };
}

beforeAll(() => {
  // jsdom has no ResizeObserver — fire synchronously with a fixed width so
  // the component measures its container and starts rendering.
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe() {
      this.cb(
        [
          {
            contentRect: { width: 640, height: 480 },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  getDocumentMock.mockReset();
  getDocumentMock.mockImplementation(() => ({
    promise: Promise.resolve(makeFakePdf()),
    destroy: () => Promise.resolve(),
  }));
});

describe("PdfView — ranged transport + cache", () => {
  it("calls getDocument with range-transport options and the resolved URL", async () => {
    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    render(<PdfView citation={makeCitation("sha-transport")} />);

    await screen.findByTestId("pdf-enlarge");

    expect(getDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/assets/pdfs/sha-transport.pdf", // fragment stripped, default base
        rangeChunkSize: 262144,
        disableAutoFetch: true,
        // true, or PDF.js streams the whole file alongside range requests
        disableStream: true,
      }),
    );
  });

  it("reuses the cached document — same URL never re-fetched", async () => {
    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    const citation = makeCitation("sha-cache");

    const first = render(<PdfView citation={citation} />);
    await screen.findByTestId("pdf-enlarge");
    first.unmount();

    render(<PdfView citation={citation} />);
    await screen.findByTestId("pdf-enlarge");

    const callsForUrl = getDocumentMock.mock.calls.filter(
      (c) => (c[0] as { url: string }).url === "/assets/pdfs/sha-cache.pdf",
    );
    expect(callsForUrl).toHaveLength(1);
  });
});

describe("PdfView — loading and ready states", () => {
  it("shows a page-shaped skeleton with 'Loading page N…' while fetching", async () => {
    getDocumentMock.mockImplementation(() => ({
      promise: new Promise(() => {}), // never resolves
      destroy: () => Promise.resolve(),
    }));
    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    const { container } = render(
      <PdfView citation={makeCitation("sha-loading")} />,
    );

    expect(
      await screen.findByTestId("pdf-loading-skeleton"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading page 51…")).toBeInTheDocument();
    // canvas mounted but not yet is-ready (receiptmoment gate contract)
    const canvas = container.querySelector("canvas.pdf-page-fade");
    expect(canvas).not.toBeNull();
    expect(canvas!.classList.contains("is-ready")).toBe(false);
    // no enlarge button before the page is ready
    expect(screen.queryByTestId("pdf-enlarge")).toBeNull();
  });

  it("ready state: is-ready canvas, highlight, and Enlarge button", async () => {
    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    const { container } = render(
      <PdfView citation={makeCitation("sha-ready")} />,
    );

    const enlarge = await screen.findByTestId("pdf-enlarge");
    expect(enlarge).toBeInTheDocument();
    expect(enlarge).toHaveAttribute("aria-haspopup", "dialog");

    expect(
      container.querySelector("canvas.pdf-page-fade.is-ready"),
    ).not.toBeNull();
    expect(screen.getByTestId("pdf-highlight")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-loading-skeleton")).toBeNull();
  });

  it("degraded fallback: data-degraded='pdf' when the document fails to load", async () => {
    getDocumentMock.mockImplementation(() => ({
      promise: Promise.reject(new Error("UnexpectedResponseException")),
      destroy: () => Promise.resolve(),
    }));
    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    const { container } = render(
      <PdfView citation={makeCitation("sha-degraded")} />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-degraded="pdf"]')).not.toBeNull();
    });
    expect(
      screen.getByText("couldn't load the PDF — open the official source"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-enlarge")).toBeNull();
  });
});

describe("PdfView — zoom overlay", () => {
  it("Enlarge opens an aria-modal dialog with zoom controls; Esc closes it", async () => {
    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    render(<PdfView citation={makeCitation("sha-overlay")} />);

    fireEvent.click(await screen.findByTestId("pdf-enlarge"));

    const overlay = await screen.findByTestId("pdf-zoom-overlay");
    expect(overlay).toHaveAttribute("role", "dialog");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("pdf-zoom-in")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-zoom-out")).toBeInTheDocument();

    // Overlay renders its own canvas at fit-to-width (separate portal —
    // outside the citation-panel selector scope used by the gates).
    await waitFor(() => {
      expect(overlay.querySelector("canvas.pdf-page-fade")).not.toBeNull();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("pdf-zoom-overlay")).toBeNull();
    });
  });

  it("zoom-in re-renders the page at a larger scale (not CSS scaling)", async () => {
    const renderCalls: number[] = [];
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({
        width: 792 * scale,
        height: 612 * scale,
      }),
      render: ({ viewport }: { viewport: { width: number } }) => {
        renderCalls.push(viewport.width);
        return { promise: Promise.resolve(), cancel: () => {} };
      },
    };
    getDocumentMock.mockImplementation(() => ({
      promise: Promise.resolve({ getPage: async () => page }),
      destroy: () => Promise.resolve(),
    }));

    const { PdfView } = await import("@/components/citation-panel/pdf-view");
    render(<PdfView citation={makeCitation("sha-zoom")} />);

    fireEvent.click(await screen.findByTestId("pdf-enlarge"));
    await screen.findByTestId("pdf-zoom-overlay");
    await waitFor(() => expect(renderCalls.length).toBeGreaterThanOrEqual(2));
    const baseline = renderCalls[renderCalls.length - 1];

    fireEvent.click(screen.getByTestId("pdf-zoom-in"));
    await waitFor(() => {
      expect(renderCalls[renderCalls.length - 1]).toBeGreaterThan(baseline);
    });
  });
});
