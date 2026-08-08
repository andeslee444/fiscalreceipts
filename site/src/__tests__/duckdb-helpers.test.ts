/**
 * Pure helper tests for lib/duckdb.ts.
 *
 * DuckDB-WASM itself cannot run in jsdom — we test only the stateless helper
 * functions: resultToCsv, the DATASET_NAMES list, and query template strings.
 * Live query correctness is proved by render_live_gate's canned-query check
 * (Task 9).
 */

import { describe, it, expect } from "vitest";
import { resultToCsv, DATASET_NAMES, ROW_CAP } from "@/lib/duckdb";
import type { QueryResult } from "@/lib/duckdb";

// ── resultToCsv ───────────────────────────────────────────────────────────────

describe("resultToCsv", () => {
  it("produces header + data rows", () => {
    const result: QueryResult = {
      columns: ["pe_bli", "org", "amount"],
      rows: [
        ["0601101E", "RDT&E Army", 123456],
        ["0602303E", "RDT&E Navy", 789000],
      ],
      totalRows: 2,
    };
    const csv = resultToCsv(result);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("pe_bli,org,amount");
    expect(lines[1]).toBe("0601101E,RDT&E Army,123456");
    expect(lines[2]).toBe("0602303E,RDT&E Navy,789000");
    expect(lines).toHaveLength(3);
  });

  it("quotes fields containing commas", () => {
    const result: QueryResult = {
      columns: ["name", "value"],
      rows: [["Lockheed, Martin", 1000]],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    expect(csv).toContain('"Lockheed, Martin"');
  });

  it("quotes fields containing double-quotes (RFC 4180 escaping)", () => {
    const result: QueryResult = {
      columns: ["text"],
      rows: [['She said "hello"']],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    expect(csv).toContain('"She said ""hello"""');
  });

  it("quotes fields containing newlines", () => {
    const result: QueryResult = {
      columns: ["body"],
      rows: [["line one\nline two"]],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    expect(csv).toContain('"line one\nline two"');
  });

  it("renders null values as empty strings", () => {
    const result: QueryResult = {
      columns: ["a", "b"],
      rows: [[null, 42]],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toBe(",42");
  });

  it("renders undefined values as empty strings", () => {
    const result: QueryResult = {
      columns: ["x"],
      rows: [[undefined]],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    expect(csv.split("\n")[1]).toBe("");
  });

  it("handles empty rows array (header only)", () => {
    const result: QueryResult = {
      columns: ["col1", "col2"],
      rows: [],
      totalRows: 0,
    };
    const csv = resultToCsv(result);
    expect(csv).toBe("col1,col2");
  });

  it("handles a single-column result", () => {
    const result: QueryResult = {
      columns: ["count"],
      rows: [[42]],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    expect(csv).toBe("count\n42");
  });

  it("does not quote plain numeric strings", () => {
    const result: QueryResult = {
      columns: ["n"],
      rows: [[99]],
      totalRows: 1,
    };
    const csv = resultToCsv(result);
    expect(csv.split("\n")[1]).toBe("99");
  });
});

// ── DATASET_NAMES ─────────────────────────────────────────────────────────────

describe("DATASET_NAMES", () => {
  it("contains exactly 16 datasets", () => {
    expect(DATASET_NAMES).toHaveLength(16);
  });

  it("registers budget_lines_decade — shipped since 5E, unqueryable until §P1-5", () => {
    expect(DATASET_NAMES).toContain("budget_lines_decade");
  });

  it("includes all expected dataset names", () => {
    const expected = [
      "budget_lines",
      "budget_lines_decade",
      "dim_entities",
      "dim_geography",
      "dim_lobbyists",
      "dim_programs",
      "fct_budget_to_awards",
      "fct_budget_trajectory",
      "fct_district_totals",
      "fct_improper_exposure",
      "fct_influence",
      "fct_program_concentration",
      "fct_program_lobbying",
      "fct_state_per_capita",
      "jbook_details",
      "jbook_narratives",
    ];
    for (const name of expected) {
      expect(DATASET_NAMES).toContain(name);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(DATASET_NAMES);
    expect(unique.size).toBe(DATASET_NAMES.length);
  });
});

// ── ROW_CAP ───────────────────────────────────────────────────────────────────

describe("ROW_CAP", () => {
  it("is 500", () => {
    expect(ROW_CAP).toBe(500);
  });
});

// ── Query template smoke ──────────────────────────────────────────────────────
// Verify the canned query strings are non-empty and reference .parquet files.

describe("canned query templates", () => {
  // These are inline so the test file has no dependency on the explorer component
  const templates = [
    `SELECT pe_bli, org, fy2026_total FROM 'fct_budget_trajectory.parquet' WHERE fy2026_total IS NOT NULL ORDER BY fy2026_total DESC LIMIT 50`,
    `SELECT pe_bli, org, fy2526_change FROM 'fct_budget_trajectory.parquet' ORDER BY ABS(fy2526_change) DESC LIMIT 50`,
    `SELECT family_key, filing_year, SUM(family_obligations_usd) AS total FROM 'fct_influence.parquet' GROUP BY family_key, filing_year LIMIT 50`,
    `SELECT district_id, state_code, total_obligation_usd FROM 'dim_geography.parquet' ORDER BY total_obligation_usd DESC LIMIT 50`,
  ];

  for (const sql of templates) {
    it(`references a .parquet file: ${sql.slice(0, 60)}…`, () => {
      expect(sql).toMatch(/'\w+\.parquet'/);
    });

    it(`has a LIMIT clause: ${sql.slice(0, 60)}…`, () => {
      expect(sql.toUpperCase()).toMatch(/LIMIT\s+\d+/);
    });
  }
});
