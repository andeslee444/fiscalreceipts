import { describe, it, expect } from "vitest";
import { humanLdaUrl, extractLdaUuid } from "@/lib/citations";

describe("humanLdaUrl", () => {
  // ── Real UUID extraction ───────────────────────────────────────────────────
  it("extracts UUID from LDA API URL and builds human URL", () => {
    const apiUrl =
      "https://lda.senate.gov/api/v1/filings/84df56d3-5214-4054-854d-944d8af49389/";
    const expected =
      "https://lda.senate.gov/filings/public/filing/84df56d3-5214-4054-854d-944d8af49389/print/";
    expect(humanLdaUrl(apiUrl)).toBe(expected);
  });

  it("extracts UUID from real filing URL in program mentions", () => {
    const apiUrl =
      "https://lda.senate.gov/api/v1/filings/25010ccf-ae87-4723-91e0-ed906eeb69a8/";
    const expected =
      "https://lda.senate.gov/filings/public/filing/25010ccf-ae87-4723-91e0-ed906eeb69a8/print/";
    expect(humanLdaUrl(apiUrl)).toBe(expected);
  });

  // ── Null / empty input ────────────────────────────────────────────────────
  it("returns null for null input", () => {
    expect(humanLdaUrl(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(humanLdaUrl(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(humanLdaUrl("")).toBeNull();
  });

  // ── Malformed input ───────────────────────────────────────────────────────
  it("returns null for URL with no UUID", () => {
    expect(humanLdaUrl("https://lda.senate.gov/api/v1/filings/")).toBeNull();
  });

  it("returns null for completely unrelated URL", () => {
    expect(humanLdaUrl("https://example.com/no-uuid-here")).toBeNull();
  });

  it("returns null for a non-UUID hex string", () => {
    // Not hyphenated in UUID format
    expect(humanLdaUrl("https://example.com/abc123def456")).toBeNull();
  });

  // ── UUID normalization ────────────────────────────────────────────────────
  it("lowercases the UUID in the output", () => {
    const apiUrl =
      "https://lda.senate.gov/api/v1/filings/84DF56D3-5214-4054-854D-944D8AF49389/";
    const result = humanLdaUrl(apiUrl);
    expect(result).toContain("84df56d3-5214-4054-854d-944d8af49389");
  });

  // ── Path structure ────────────────────────────────────────────────────────
  it("output URL ends with /print/", () => {
    const apiUrl =
      "https://lda.senate.gov/api/v1/filings/84df56d3-5214-4054-854d-944d8af49389/";
    expect(humanLdaUrl(apiUrl)).toMatch(/\/print\/$/);
  });

  it("output URL uses lda.senate.gov/filings/public/filing/ path", () => {
    const apiUrl =
      "https://lda.senate.gov/api/v1/filings/84df56d3-5214-4054-854d-944d8af49389/";
    expect(humanLdaUrl(apiUrl)).toContain("lda.senate.gov/filings/public/filing/");
  });
});

describe("extractLdaUuid", () => {
  it("extracts UUID from API URL", () => {
    const apiUrl =
      "https://lda.senate.gov/api/v1/filings/84df56d3-5214-4054-854d-944d8af49389/";
    expect(extractLdaUuid(apiUrl)).toBe(
      "84df56d3-5214-4054-854d-944d8af49389",
    );
  });

  it("returns null for no UUID", () => {
    expect(extractLdaUuid("https://lda.senate.gov/api/v1/filings/")).toBeNull();
  });

  it("returns null for null", () => {
    expect(extractLdaUuid(null)).toBeNull();
  });
});
