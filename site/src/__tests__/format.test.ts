import { describe, it, expect } from "vitest";
import { formatAmount, exactTitle } from "@/lib/format";

describe("formatAmount", () => {
  // ── Plan-specified test cases ──────────────────────────────────────────────
  it("thousands 1234567 → $1.23B", () => {
    // 1,234,567 * 1000 = $1,234,567,000 = $1.234...B → <10B → 2 dec
    expect(formatAmount(1234567, "USD thousands")).toBe("$1.23B");
  });

  it("millions 280.494 → $280.5M", () => {
    // 280.494 * 1e6 = $280,494,000 → ≥10M → 1 dec
    expect(formatAmount(280.494, "USD millions")).toBe("$280.5M");
  });

  // ── Units are NEVER inferred from magnitude ────────────────────────────────
  it("same number, different units → different display", () => {
    const val = 1000;
    const t = formatAmount(val, "USD thousands"); // $1M
    const m = formatAmount(val, "USD millions");  // $1B
    const u = formatAmount(val, "USD");           // $1K
    expect(t).toBe("$1.00M");
    expect(m).toBe("$1.00B");
    expect(u).toBe("$1.00K");
    // All three are different — units drive scale, not magnitude
    expect(t).not.toBe(m);
    expect(t).not.toBe(u);
    expect(m).not.toBe(u);
  });

  // ── Billions ───────────────────────────────────────────────────────────────
  it("≥10B → 1 decimal", () => {
    // 15000 millions = $15B → ≥10B → 1 dec
    expect(formatAmount(15000, "USD millions")).toBe("$15.0B");
  });

  it("<10B → 2 decimals", () => {
    // 5000 millions = $5B → <10B → 2 dec
    expect(formatAmount(5000, "USD millions")).toBe("$5.00B");
  });

  it("≥100B → 1 decimal (hundreds of billions)", () => {
    // 135361.939 millions ≈ $135.4B → ≥10B → 1 dec
    expect(formatAmount(135361.939, "USD millions")).toBe("$135.4B");
  });

  // ── Millions ───────────────────────────────────────────────────────────────
  it("≥10M → 1 decimal", () => {
    // 45000 thousands = $45M → ≥10M → 1 dec
    expect(formatAmount(45000, "USD thousands")).toBe("$45.0M");
  });

  it("<10M → 2 decimals", () => {
    // 5000 thousands = $5M → <10M → 2 dec
    expect(formatAmount(5000, "USD thousands")).toBe("$5.00M");
  });

  // ── Thousands ────────────────────────────────────────────────────────────
  it("≥10K → 1 decimal", () => {
    // 15000 USD = $15K → ≥10K → 1 dec
    expect(formatAmount(15000, "USD")).toBe("$15.0K");
  });

  it("<10K → 2 decimals", () => {
    // 5000 USD = $5K → <10K → 2 dec
    expect(formatAmount(5000, "USD")).toBe("$5.00K");
  });

  // ── Sub-thousand ─────────────────────────────────────────────────────────
  it("sub-thousand → integer dollars", () => {
    expect(formatAmount(500, "USD")).toBe("$500");
  });

  it("zero → $0", () => {
    expect(formatAmount(0, "USD thousands")).toBe("$0");
  });

  // ── Negative values ───────────────────────────────────────────────────────
  it("negative millions", () => {
    // -280.494 millions → -$280.5M
    expect(formatAmount(-280.494, "USD millions")).toBe("-$280.5M");
  });

  // ── Specific budget values from real data ─────────────────────────────────
  it("280494 USD thousands (budget line) → $280.5M", () => {
    // Real value from 0601101E budget_lines
    expect(formatAmount(280494, "USD thousands")).toBe("$280.5M");
  });
});

describe("exactTitle", () => {
  it("renders exact source value with units label", () => {
    expect(exactTitle(280494, "USD thousands")).toBe("$280,494 (USD thousands)");
  });

  it("includes decimal for non-integer values", () => {
    expect(exactTitle(280.494, "USD millions")).toBe("$280.494 (USD millions)");
  });

  it("large USD value with commas", () => {
    expect(exactTitle(135361939903.34, "USD")).toContain("$135,361,939,903.34");
  });

  it("zero value", () => {
    expect(exactTitle(0, "USD millions")).toBe("$0 (USD millions)");
  });
});
