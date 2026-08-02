/**
 * pagefind-text-separators.test.tsx — excerpt-concatenation fix
 * (PM review §P1-4, Sprint 2 Task 1)
 *
 * PM repro: a "Lockheed" deep-search snippet read
 * "126 unique entity identifiersTotal obligations: $135.4Bme…" — adjacent
 * header <span>s carry no whitespace text node between them, so Pagefind's
 * text extraction (and any text-content consumer) concatenates the fragments.
 *
 * These tests render the REAL pages with the real exported data and assert
 * the rendered textContent carries separators at every fragment boundary.
 * Also asserts the filing page ships its Pagefind title metadata so deep
 * results are titled "Client — Registrant, YYYY QN" instead of the URL path.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

describe("company page header — text separators (PM repro: lockheed-martin)", () => {
  async function renderCompany() {
    const { default: CompanyPage } = await import("@/app/company/[slug]/page");
    const el = await CompanyPage({
      params: Promise.resolve({ slug: "lockheed-martin" }),
    });
    return render(el as React.ReactElement);
  }

  it("does NOT concatenate 'identifiers' into 'Total obligations'", async () => {
    const { container } = await renderCompany();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/identifiersTotal/);
    expect(text).toMatch(/unique entity identifiers\s+Total obligations:/);
  }, 30000);

  it("does NOT concatenate the obligation figure into the confidence chip", async () => {
    const { container } = await renderCompany();
    const text = container.textContent ?? "";
    // the old markup rendered "...$135.4Bmedium confidence"
    expect(text).not.toMatch(/\dmedium confidence/);
    expect(text).not.toMatch(/\dBmedium/);
  }, 30000);
});

describe("filing page — text separators + pagefind title meta (real data)", () => {
  const UUID = "55078848-5151-45f3-9172-a82fd75f9323";

  async function renderFiling() {
    const { default: FilingPage } = await import("@/app/filing/[uuid]/page");
    const el = await FilingPage({ params: Promise.resolve({ uuid: UUID }) });
    return render(el as React.ReactElement);
  }

  it("header spans carry separators (no 'LLCYear:' / '2025Period:' junctions)", async () => {
    const { container } = await renderFiling();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/LLCYear:/);
    expect(text).not.toMatch(/\dPeriod:/);
    expect(text).not.toMatch(/QuarterType:/);
  }, 30000);

  it("ships data-pagefind-meta title = 'Client — Registrant, YYYY QN'", async () => {
    const { container } = await renderFiling();
    const metaEl = container.querySelector("[data-pagefind-meta]");
    expect(metaEl).not.toBeNull();
    const spec = metaEl!.getAttribute("data-pagefind-meta")!;
    // attribute-sourced meta: title[<attr>]
    const m = spec.match(/^title\[(.+)\]$/);
    expect(m).not.toBeNull();
    expect(metaEl!.getAttribute(m![1])).toBe(
      "LOCKHEED MARTIN CORPORATION — MICHAEL BEST STRATEGIES LLC, 2025 Q4",
    );
  }, 30000);
});
