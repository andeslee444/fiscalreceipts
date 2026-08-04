import { describe, it, expect } from "vitest";
import {
  formatAmount,
  formatAmountNoCurrency,
  exactTitle,
  usdEquivalence,
  districtDisplayLabel,
} from "@/lib/format";

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

  // ── Trillions (§P1-6) ─────────────────────────────────────────────────────
  // The ladder used to stop at B, so the /district/ geography grand total
  // ($3,657,411,328,834.89) rendered "$3657.4B" — a figure no reader parses.
  describe("trillions", () => {
    it("PM repro: the dim_geography grand total → $3.66T", () => {
      expect(formatAmount(3_657_411_328_834.89, "USD")).toBe("$3.66T");
    });

    it("just below the boundary stays in B", () => {
      expect(formatAmount(999_900_000_000, "USD")).toBe("$999.9B");
    });

    it("exactly $1T rolls over", () => {
      expect(formatAmount(1_000_000_000_000, "USD")).toBe("$1.00T");
    });

    it("one dollar below $1T promotes rather than printing $1000.0B", () => {
      expect(formatAmount(999_999_999_999, "USD")).toBe("$1.00T");
    });

    it("$1.5T → $1.50T (<10 → 2 decimals)", () => {
      expect(formatAmount(1_500_000_000_000, "USD")).toBe("$1.50T");
    });

    it("≥$10T → 1 decimal", () => {
      expect(formatAmount(12_345_000_000_000, "USD")).toBe("$12.3T");
    });

    it("negative trillions keep the sign", () => {
      expect(formatAmount(-3_657_411_328_834.89, "USD")).toBe("-$3.66T");
    });

    it("units still drive scale — 3,657,411,328 USD thousands is also $3.66T", () => {
      expect(formatAmount(3_657_411_328.83489, "USD thousands")).toBe("$3.66T");
      expect(formatAmount(3_657_411.32883489, "USD millions")).toBe("$3.66T");
    });

    it("zero is unaffected by the new rung", () => {
      expect(formatAmount(0, "USD")).toBe("$0");
    });

    it("no output ever carries a mantissa ≥ 1000 below the top rung", () => {
      // Rounding must not manufacture "$1000.0B" out of a value that rounds
      // up across a rung boundary — it promotes instead.
      expect(formatAmount(999_999_999_999.99, "USD")).toBe("$1.00T");
      expect(formatAmount(999_999_999.999, "USD")).toBe("$1.00B");
      expect(formatAmount(999_999.9999, "USD")).toBe("$1.00M");
    });
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

describe("formatAmountNoCurrency", () => {
  // SVG flow-diagram labels must stay outside the render gate's currency
  // regex (\$[\d,]+…) — no '$' may appear in the output (Task 6b).
  it("strips the dollar sign from compact output", () => {
    expect(formatAmountNoCurrency(619_000_000, "USD")).toBe("619.0M");
  });

  it("USD thousands scale to millions label", () => {
    expect(formatAmountNoCurrency(335_700, "USD thousands")).toBe("335.7M");
  });

  it("billions with two decimals under 10", () => {
    expect(formatAmountNoCurrency(1_234_567_890, "USD")).toBe("1.23B");
  });

  it("negative keeps sign, loses currency", () => {
    expect(formatAmountNoCurrency(-280.494, "USD millions")).toBe("-280.5M");
  });

  it("never contains a dollar sign", () => {
    for (const v of [1, 999, 12_345, 9_999_999, 123_456_789_000, 3.66e12]) {
      expect(formatAmountNoCurrency(v, "USD")).not.toContain("$");
    }
  });

  it("rolls over to T like the currency ladder (§P1-6)", () => {
    expect(formatAmountNoCurrency(3_657_411_328_834.89, "USD")).toBe("3.66T");
    expect(formatAmountNoCurrency(-1_500_000_000_000, "USD")).toBe("-1.50T");
  });
});

describe("usdEquivalence", () => {
  it("USD millions ≥ 1000 → compact equivalence", () => {
    // Judge finding: card says $3.08B, panel said "3,080.000 USD millions"
    expect(usdEquivalence(3080, "USD millions")).toBe("= $3.08B");
  });

  it("USD millions < 1000 → null (already legible)", () => {
    expect(usdEquivalence(280.494, "USD millions")).toBeNull();
  });

  it("USD thousands ≥ 1000 → compact equivalence (§P1-9)", () => {
    // PM repro: the workbook drawer headline read "$5.57B  USD thousands".
    // The recorded numerals stay primary; this is the reconciling aside.
    expect(usdEquivalence(5_565_655, "USD thousands")).toBe("= $5.57B");
    expect(usdEquivalence(3_080_000, "USD thousands")).toBe("= $3.08B");
    expect(usdEquivalence(280_494, "USD thousands")).toBe("= $280.5M");
  });

  it("USD thousands < 1000 → null (already legible)", () => {
    expect(usdEquivalence(847, "USD thousands")).toBeNull();
  });

  it("other units → null (never infer scale from magnitude)", () => {
    expect(usdEquivalence(3_080_000_000, "USD")).toBeNull();
    expect(usdEquivalence(9716, "hhi")).toBeNull();
    expect(usdEquivalence(1234, null)).toBeNull();
  });

  it("non-finite recorded values → null", () => {
    expect(usdEquivalence(Number("not-a-number"), "USD millions")).toBeNull();
  });

  it("negative ≥$1B magnitude keeps the sign", () => {
    expect(usdEquivalence(-1500, "USD millions")).toBe("= -$1.50B");
  });

  it("trillion-scale millions get the T equivalence (§P1-6)", () => {
    expect(usdEquivalence(3_657_411.32883489, "USD millions")).toBe("= $3.66T");
  });
});

describe("districtDisplayLabel", () => {
  it("numbered districts pass through unchanged", () => {
    expect(districtDisplayLabel("TX-12")).toBe("TX-12");
    expect(districtDisplayLabel("CA-11")).toBe("CA-11");
  });

  it("00 → at-large", () => {
    expect(districtDisplayLabel("AK-00")).toBe("AK (at-large)");
    expect(districtDisplayLabel("DE-00")).toBe("DE (at-large)");
    expect(districtDisplayLabel("VT-00")).toBe("VT (at-large)");
  });

  it("90/98/99 → undistricted", () => {
    expect(districtDisplayLabel("DC-98")).toBe("DC (undistricted)");
    expect(districtDisplayLabel("CA-90")).toBe("CA (undistricted)");
    expect(districtDisplayLabel("NY-99")).toBe("NY (undistricted)");
  });

  it("unrecognized shapes pass through untouched", () => {
    expect(districtDisplayLabel("PR-98X")).toBe("PR-98X");
    expect(districtDisplayLabel("undefined")).toBe("undefined");
  });
});
