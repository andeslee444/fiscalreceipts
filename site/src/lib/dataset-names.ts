/**
 * Explorer dataset name registry — UNIVERSAL (no "use client", no server-only).
 *
 * Lives apart from lib/duckdb.ts on purpose: that module is `"use client"`, so
 * its runtime exports become client references when imported from a server
 * component (a `new Set(DATASET_NAMES)` there fails with "function is not
 * iterable"). The /data/ page needs these names at build time to cross-check
 * the shipped manifest, so they live here and duckdb.ts re-exports them.
 *
 * This is the canned-query / type registry, NOT the inventory. The shipped
 * inventory is data/site/json/datasets.json (row counts, byte sizes, row-grain
 * scope sentences), emitted from the parquets the export actually wrote.
 * /data/page.tsx throws at build time if the two disagree, so a mart cannot
 * ship queryable-but-undocumented or documented-but-unqueryable
 * (budget_lines_decade was the latter from Phase 5E until PM Sprint 2 §P1-5).
 */

export const DATASET_NAMES = [
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
] as const;

export type DatasetName = (typeof DATASET_NAMES)[number];
