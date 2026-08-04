/**
 * PM-review Sprint 2 Task 4 (spec §P1-9) — the workbook tier of the citation
 * drawer.
 *
 * The PM's repro: /program/ATA000/ → click $5.57B in the P-1 table. Seven
 * defects, each with a test below:
 *
 *  1. UNIT CONTRADICTS VALUE — the header read "$5.57B  USD thousands" and the
 *     raw 5,565,655 appeared nowhere. Adopt the PDF tier's pattern:
 *     "5,565,655  USD thousands  (= $5.57B)".
 *  2. NO CELL PREVIEW — render the cited cells plus surrounding rows as a
 *     table, from the build-time sidecar (lib/workbook-cells.ts).
 *  3. THREE CELLS, NO ARITHMETIC — show each cell's own value and the
 *     operation joining them: O839 a + O840 b + O841 c = 5,565,655.
 *  4. AMBIGUOUS CELL REFS — 'O' vs '0'. Cell refs render with the column
 *     letter in its own element + a spelled-out title, and the .cell-ref class
 *     (slashed-zero where the font carries the feature — see globals.css).
 *  5. DUPLICATE "Official source" — the card's copy is gone; the panel footer
 *     keeps the single link.
 *  6. HASH TRUNCATED, NO COPY — the footer's SHA-256 gains a copy control.
 *  7. NO DOCUMENT IDENTITY — the drawer names the document + edition via
 *     documentTitleFromUrl.
 *
 * Fixtures are the REAL FY2026 p1_display.xlsx rows for fact 5b532c52d3ebb4c2
 * (workbook sha 4d965906…, sheet "Exhibit P-1", cells O839,O840,O841).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  WorkbookCard,
  amountBasisLine,
} from "@/components/citation-panel/workbook-card";
import { CitationPanelProvider } from "@/components/citation-panel/panel";
import { CitationPanelContext } from "@/components/cite";
import {
  fetchWorkbookPreview,
  previewSumsToTotal,
  __resetWorkbookCellsCache,
  type WorkbookPreview,
} from "@/lib/workbook-cells";
import type { WorkbookCitation } from "@/lib/citations";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FID = "5b532c52d3ebb4c2";
const SINGLE_FID = "00e2b1c4d5f60718";

const F35_CITATION: WorkbookCitation = {
  kind: "workbook",
  amount_text: null,
  amount_thousands: 5565655,
  bottom_pt: null,
  cells: "O839,O840,O841",
  formula: null,
  hosted_pdf_url: null,
  inputs: null,
  official_url:
    "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/p1_display.xlsx",
  page_height: null,
  page_number: null,
  page_width: null,
  query_body: null,
  recorded_value: null,
  resolution: null,
  retrieved_at: "2026-06-10T16:08:15.686145-04:00",
  sha256: "4d965906ad91aa8b7d6d5f891a0717ac25ace6c18f3d50df07ebde611774a9c0",
  sheet: "Exhibit P-1",
  top_pt: null,
  units: "USD thousands",
  x0: null,
  x1: null,
  xml_path: null,
};

const SINGLE_CITATION: WorkbookCitation = {
  ...F35_CITATION,
  amount_thousands: 306347,
  cells: "J4",
  sheet: "Exhibit R-1",
};

const F35_PREVIEW: WorkbookPreview = {
  sheet: "Exhibit P-1",
  col: "O",
  col_header: "FY 2024 Actuals Amount",
  units: "USD thousands",
  total: 5565655,
  rows: [
    { r: 837, code: "B02100", title: "B-21 Raider", note: "C (FY 2025 for FY 2026) (M)", flag: "Non-Add" },
    { r: 838, code: "B02100", title: "B-21 Raider", note: "C (FY 2026 for FY 2027) (M)", flag: "Non-Add" },
    { r: 839, code: "ATA000", title: "F-35", note: "Weapon System Cost", flag: "Add", v: 5493772, cited: true },
    { r: 840, code: "ATA000", title: "F-35", note: "Less: Advance Procurement (PY)", flag: "Add", v: -246702, cited: true },
    { r: 841, code: "ATA000", title: "F-35", note: "Advance Procurement (CY)", flag: "Add", v: 318585, cited: true },
    { r: 842, code: "ATA000", title: "F-35", note: "C (FY 2024 for FY 2025) (M)", flag: "Non-Add", v: 318585 },
    { r: 843, code: "ATA000", title: "F-35", note: "C (FY 2025 for FY 2026) (M)", flag: "Non-Add" },
  ],
};

const SINGLE_PREVIEW: WorkbookPreview = {
  sheet: "Exhibit R-1",
  col: "J",
  col_header: "FY 2019 (Base + OCO)",
  units: "USD thousands",
  total: 306347,
  rows: [
    { r: 3, code: "0601101A", title: "In-House Laboratory Independent Research", v: 11391 },
    { r: 4, code: "0601102A", title: "Defense Research Sciences", v: 306347, cited: true },
    { r: 5, code: "0601103A", title: "University Research Initiatives", v: 84512 },
  ],
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetWorkbookCellsCache();
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u === "/json/workbook-cells/5b.json") {
      return Promise.resolve(jsonResponse({ [FID]: F35_PREVIEW }));
    }
    if (u === "/json/workbook-cells/00.json") {
      return Promise.resolve(jsonResponse({ [SINGLE_FID]: SINGLE_PREVIEW }));
    }
    if (u.startsWith("/json/workbook-cells/")) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    // The panel's AssetConfigProvider resolves the asset base at mount.
    if (u.endsWith("/config.json")) {
      return Promise.resolve(jsonResponse({ assetBaseUrl: "/assets" }));
    }
    return Promise.reject(new Error(`unmocked fetch ${u}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── lib/workbook-cells ───────────────────────────────────────────────────────

describe("lib/workbook-cells", () => {
  it("fetches the fact's two-hex shard and caches it", async () => {
    const p1 = await fetchWorkbookPreview(FID);
    expect(p1?.col).toBe("O");
    await fetchWorkbookPreview(FID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/json/workbook-cells/5b.json");
  });

  it("resolves null for a fact absent from an otherwise valid shard", async () => {
    expect(await fetchWorkbookPreview("5bffffffffffffff")).toBeNull();
  });

  it("resolves null on a failed shard fetch and does NOT poison the cache", async () => {
    expect(await fetchWorkbookPreview("ffffffffffffffff")).toBeNull();
    expect(await fetchWorkbookPreview("ffffffffffffffff")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // retried, not cached
  });

  it("previewSumsToTotal verifies the cited cells add to the citation amount", () => {
    expect(previewSumsToTotal(F35_PREVIEW)).toBe(true);
    expect(previewSumsToTotal(SINGLE_PREVIEW)).toBe(true);
    expect(
      previewSumsToTotal({ ...F35_PREVIEW, total: 5565654 }),
    ).toBe(false);
  });
});

// ── §P1-9.1 — the unit must not contradict the value ─────────────────────────

describe("workbook drawer — amount line (§P1-9.1)", () => {
  it("shows the RAW recorded value, its units, and the compact equivalence", () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const amount = screen.getByTestId("workbook-amount");

    expect(amount.textContent).toContain("5,565,655");
    expect(amount.textContent).toContain("USD thousands");
    expect(amount.textContent).toContain("$5.57B");
    // the defect: the compact figure standing alone as the headline
    expect(
      screen.getByTestId("workbook-amount-value").textContent,
    ).toBe("5,565,655");
  });

  it("matches the PDF tier's shape: value, unit, then '(= $X)'", () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const text = screen.getByTestId("workbook-amount").textContent ?? "";
    expect(text.replace(/\s+/g, " ").trim()).toBe(
      "5,565,655 USD thousands (= $5.57B)",
    );
  });

  it("omits the equivalence when the raw thousands figure is already legible", () => {
    render(
      <WorkbookCard
        citation={{ ...F35_CITATION, amount_thousands: 847 }}
        factId={FID}
      />,
    );
    expect(screen.queryByTestId("workbook-amount-usd")).toBeNull();
    expect(screen.getByTestId("workbook-amount-value").textContent).toBe("847");
  });
});

// ── §P1-9.7 — document identity ──────────────────────────────────────────────

describe("workbook drawer — document identity (§P1-9.7)", () => {
  it("names the document and edition (documentTitleFromUrl)", () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const doc = screen.getByTestId("workbook-document");
    expect(doc.textContent).toContain(
      "FY2026 Department of Defense Budget: Procurement Programs (P-1)",
    );
  });

  it("still names the sheet and cells (the citation's own locator)", () => {
    const { container } = render(
      <WorkbookCard citation={F35_CITATION} factId={FID} />,
    );
    expect(container.textContent).toContain("Exhibit P-1");
    for (const cell of ["O839", "O840", "O841"]) {
      expect(container.textContent).toContain(cell);
    }
  });

  it("falls back gracefully when the source URL is unknown", () => {
    render(
      <WorkbookCard
        citation={{ ...F35_CITATION, official_url: null }}
        factId={FID}
      />,
    );
    // No invented title — the sheet line still identifies the locator.
    expect(screen.queryByTestId("workbook-document")).toBeNull();
    expect(document.body.textContent).toContain("Exhibit P-1");
  });
});

// ── §P1-9.4 — cell refs must not read as zeros ───────────────────────────────

describe("workbook drawer — cell-ref disambiguation (§P1-9.4)", () => {
  it("splits the column letter from the row number and spells it out", () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const ref = screen.getAllByTestId("cell-ref")[0];

    expect(ref.getAttribute("data-cell")).toBe("O839");
    // the whole ref stays copy-pasteable as one token
    expect(ref.textContent).toBe("O839");
    // the letter is its own element, so it can be styled apart from digits
    expect(ref.querySelector("[data-cell-col]")?.textContent).toBe("O");
    // and the ambiguity is resolved in words for anyone who still squints
    expect(ref.getAttribute("title")).toContain("column O");
    expect(ref.getAttribute("title")).toContain("row 839");
  });

  it("applies the slashed-zero/tabular class to cell refs", () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    expect(screen.getAllByTestId("cell-ref")[0].className).toContain("cell-ref");
  });
});

// ── §P1-9.2 / §P1-9.3 — preview table + arithmetic ───────────────────────────

describe("workbook drawer — cell preview (§P1-9.2)", () => {
  it("renders the cited rows plus their workbook context", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);

    const table = await screen.findByTestId("workbook-preview");
    const rows = table.querySelectorAll("[data-testid='workbook-preview-row']");
    expect(rows).toHaveLength(7);
    expect([...rows].map((r) => r.getAttribute("data-row"))).toEqual([
      "837", "838", "839", "840", "841", "842", "843",
    ]);
  });

  it("marks exactly the cited rows, and shows each cell's own value", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const table = await screen.findByTestId("workbook-preview");

    const cited = [
      ...table.querySelectorAll("[data-testid='workbook-preview-row'][data-cited='true']"),
    ];
    expect(cited.map((r) => r.getAttribute("data-row"))).toEqual(["839", "840", "841"]);
    expect(cited.map((r) => r.querySelector("[data-cell-value]")?.textContent)).toEqual([
      "5,493,772",
      "−246,702",
      "318,585",
    ]);
  });

  it("labels the value column with its letter AND its workbook header", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const table = await screen.findByTestId("workbook-preview");
    const header = table.querySelector("thead")?.textContent ?? "";
    expect(header).toContain("O");
    expect(header).toContain("FY 2024 Actuals Amount");
  });

  it("shows row labels from the workbook, including the Non-Add memo flag", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const table = await screen.findByTestId("workbook-preview");
    expect(table.textContent).toContain("Weapon System Cost");
    expect(table.textContent).toContain("Less: Advance Procurement (PY)");
    expect(table.textContent).toContain("B-21 Raider"); // context row
    expect(table.textContent).toContain("Non-Add");
  });

  it("renders a blank cell as an em dash, never as zero", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const table = await screen.findByTestId("workbook-preview");
    const row843 = table.querySelector("[data-row='843'] [data-cell-value]");
    expect(row843?.textContent).toBe("—");
    expect(row843?.getAttribute("data-cell-value")).toBe("");
  });

  it("degrades explicitly when the preview shard is unreachable", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId="ffffffffffffffff" />);
    await waitFor(() =>
      expect(screen.getByTestId("workbook-preview-unavailable")).toBeTruthy(),
    );
    expect(screen.queryByTestId("workbook-preview")).toBeNull();
    // the download path is still offered — degraded, never dead
    expect(document.body.textContent).toContain("Download workbook");
  });
});

describe("workbook drawer — per-cell arithmetic (§P1-9.3)", () => {
  it("shows each cell, its value, the operator, and the sum", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const line = await screen.findByTestId("workbook-arithmetic");
    const text = (line.textContent ?? "").replace(/\s+/g, " ").trim();

    // A recorded NEGATIVE renders as a subtraction, not "+ −246,702" ("plus
    // negative" — visual-judge fix round). The signed value as recorded stays
    // available on the title attribute and in the preview table below.
    expect(text).toBe(
      "O839 5,493,772 − O840 246,702 + O841 318,585 = 5,565,655",
    );
    expect(text).not.toContain("+ −");
  });

  it("keeps the recorded sign of a negative addend reachable", async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const line = await screen.findByTestId("workbook-arithmetic");
    const titles = Array.from(line.querySelectorAll("[title]")).map((n) =>
      n.getAttribute("title"),
    );
    expect(titles).toContain("recorded as −246,702");
  });

  it("omits the arithmetic line for a single-cell citation", async () => {
    render(<WorkbookCard citation={SINGLE_CITATION} factId={SINGLE_FID} />);
    await screen.findByTestId("workbook-preview");
    expect(screen.queryByTestId("workbook-arithmetic")).toBeNull();
  });

  it("refuses to print arithmetic that does not add up", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/workbook-cells/5b.json"
        ? Promise.resolve(
            jsonResponse({
              [FID]: {
                ...F35_PREVIEW,
                rows: F35_PREVIEW.rows.map((r) =>
                  r.r === 839 ? { ...r, v: 1 } : r,
                ),
              },
            }),
          )
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    await screen.findByTestId("workbook-preview");
    expect(screen.queryByTestId("workbook-arithmetic")).toBeNull();
  });
});

// ── §P1-9.5 / §P1-9.6 — panel chrome ─────────────────────────────────────────

/** Opens the drawer for a fact through the provider's own context. */
function OpenCitation({ factId }: { factId: string }) {
  const { openPanel } = React.useContext(CitationPanelContext);
  return (
    <button type="button" onClick={() => openPanel(factId)}>
      open
    </button>
  );
}

async function openWorkbookDrawer() {
  render(
    <CitationPanelProvider citations={{ [FID]: F35_CITATION } as never}>
      <OpenCitation factId={FID} />
    </CitationPanelProvider>,
  );
  screen.getByText("open").click();
  return await screen.findByTestId("citation-panel");
}

describe("workbook drawer — panel chrome (§P1-9.5, §P1-9.6)", () => {
  it("renders the Official source link exactly once (§P1-9.5)", async () => {
    const panel = await openWorkbookDrawer();
    await screen.findByTestId("workbook-preview");

    const links = [...panel.querySelectorAll("a")].filter(
      (a) => a.getAttribute("href") === F35_CITATION.official_url,
    );
    expect(links).toHaveLength(1);
    expect(panel.querySelectorAll("[data-testid='official-source']")).toHaveLength(1);
  });

  it("offers a copy control for the full SHA-256 (§P1-9.6)", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const panel = await openWorkbookDrawer();
    const btn = panel.querySelector<HTMLButtonElement>(
      "[data-testid='copy-hash']",
    );
    expect(btn).toBeTruthy();
    btn!.click();
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(F35_CITATION.sha256),
    );
  });

  it("keeps the .xlsx download", () => {
    const { container } = render(
      <WorkbookCard citation={F35_CITATION} factId={FID} />,
    );
    const link = [...container.querySelectorAll("a")].find((a) =>
      /Download workbook/i.test(a.textContent ?? ""),
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toContain(`${F35_CITATION.sha256}.xlsx`);
  });

  it("the card itself carries no second Official-source link", () => {
    const { container } = render(
      <WorkbookCard citation={F35_CITATION} factId={FID} />,
    );
    const links = [...container.querySelectorAll("a")].filter(
      (a) => a.getAttribute("href") === F35_CITATION.official_url,
    );
    expect(links).toHaveLength(0);
  });
});


describe("workbook drawer — the AMOUNT line declares its basis (fix round)", () => {
  // Both judges: "5,565,655 USD thousands (= $5.57B)" with the only
  // disclosure that it is FY2024 ACTUALS hidden in a column header inside the
  // preview table. A reporter skimming would quote $5.57B as FY2026
  // procurement. Same helper as the inline chip — one vocabulary, not two.

  it("names the fiscal year, the measure and the basis", () => {
    expect(
      amountBasisLine({ fy: 2024, measure: "actuals", basis: "toa", edition: 2026 }),
    ).toBe("FY2024 · actuals · P-1 TOA · PB2026");
  });

  it("leaves an extended measure to the chip rather than saying it twice", () => {
    const line = amountBasisLine({
      fy: 2026,
      measure: "disc-request",
      basis: "toa",
      edition: 2026,
    })!;
    expect(line).toBe("FY2026 · P-1 TOA · discretionary request · PB2026");
    expect(line.match(/request/g)!.length).toBe(1);
  });

  it("renders nothing rather than inventing a basis", () => {
    expect(amountBasisLine(null)).toBeNull();
    expect(amountBasisLine({})).toBeNull();
  });

  it("still says the year when the figure declares no basis token", () => {
    expect(amountBasisLine({ fy: "all-years" })).toBe("all-years");
  });

  it("renders on the card when the clicked figure declared context", async () => {
    render(
      <WorkbookCard
        citation={F35_CITATION}
        factId={FID}
        figure={{ fy: 2024, measure: "actuals", basis: "toa", edition: 2026 }}
      />,
    );
    const el = await screen.findByTestId("workbook-amount-basis");
    expect(el.textContent).toBe("FY2024 · actuals · P-1 TOA · PB2026");
  });

  it("is absent — not fabricated — for a drill-down open with no figure", () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    expect(screen.queryByTestId("workbook-amount-basis")).toBeNull();
  });
});

describe("workbook drawer — the preview's first column names cells", () => {
  it('is headed "Cell", not "Row" — it holds O837, not 837', async () => {
    render(<WorkbookCard citation={F35_CITATION} factId={FID} />);
    const table = await screen.findByTestId("workbook-preview");
    const first = table.querySelector("thead th");
    expect(first?.textContent).toBe("Cell");
  });
});
