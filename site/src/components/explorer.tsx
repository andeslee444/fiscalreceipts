"use client";

/**
 * DuckDB-WASM data explorer.
 *
 * Lazy-init: nothing DuckDB-related loads until the user clicks
 * "Start the engine" or runs a canned query.  This keeps /data's
 * initial load light for the perf_gate (LCP < 2.5s, TBT < 300ms).
 *
 * The engine initialises once (module singleton in lib/duckdb.ts).
 * Queries are read-only — DuckDB-WASM has no write-back capability
 * against HTTP-registered files.
 */

import React from "react";
import { useAssetUrl } from "@/components/asset-config";
import {
  getDuckDB,
  registerDatasets,
  runQuery,
  resultToCsv,
  terminateDuckDB,
  ROW_CAP,
  type QueryResult,
  type DatasetName,
} from "@/lib/duckdb";
import { TRAJECTORY_FY_LABEL } from "@/lib/site";
import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";

// ── Dataset metadata ──────────────────────────────────────────────────────────

interface DatasetMeta {
  name: DatasetName;
  rowCount: number;
  description: string;
}

// Row counts from site_meta — pass in as prop so this stays a pure client component
// with no server imports.
interface ExplorerProps {
  datasets: DatasetMeta[];
}

// ── Canned queries ────────────────────────────────────────────────────────────

type CannedQuery = {
  label: string;
  sql: string;
};

function cannedQueriesFor(name: DatasetName): CannedQuery[] {
  const t = (sql: string): string => sql.trim();

  switch (name) {
    case "fct_budget_trajectory":
      return [
        {
          label: "Top programs by FY26 total",
          sql: t(`
SELECT pe_bli, organization, fy2026_total
FROM 'fct_budget_trajectory.parquet'
WHERE fy2026_total IS NOT NULL
ORDER BY fy2026_total DESC
LIMIT 50
          `),
        },
        {
          label: `Biggest movers ${TRAJECTORY_FY_LABEL}`,
          sql: t(`
SELECT pe_bli, org,
       fy2526_change,
       ROUND(fy2526_pct_change, 1) AS pct_change
FROM 'fct_budget_trajectory.parquet'
WHERE fy2526_change IS NOT NULL
ORDER BY ABS(fy2526_change) DESC
LIMIT 50
          `),
        },
      ];

    case "budget_lines":
      return [
        {
          label: "Top programs by FY26 request",
          sql: t(`
SELECT pe_bli, exhibit, account_title,
       SUM(amount_thousands) AS total_thousands
FROM 'budget_lines.parquet'
WHERE amount_type = 'fy_2026_request'
GROUP BY pe_bli, exhibit, account_title
ORDER BY total_thousands DESC
LIMIT 50
          `),
        },
      ];

    case "fct_influence":
      return [
        {
          label: "Lobbying totals by family + year",
          sql: t(`
SELECT family_key, filing_year,
       SUM(family_obligations_usd) AS total_obligations_usd,
       COUNT(*) AS filing_count
FROM 'fct_influence.parquet'
GROUP BY family_key, filing_year
ORDER BY total_obligations_usd DESC
LIMIT 50
          `),
        },
      ];

    case "fct_program_lobbying":
      return [
        {
          label: "Most-lobbied programs",
          sql: t(`
SELECT pe_bli, COUNT(*) AS mention_count,
       COUNT(DISTINCT family_key) AS distinct_families
FROM 'fct_program_lobbying.parquet'
GROUP BY pe_bli
ORDER BY mention_count DESC
LIMIT 50
          `),
        },
      ];

    case "dim_geography":
      return [
        {
          label: "Districts by total obligation",
          sql: t(`
SELECT pop_state, pop_district, total_obligation
FROM 'dim_geography.parquet'
ORDER BY total_obligation DESC
LIMIT 50
          `),
        },
      ];

    case "dim_entities":
      return [
        {
          label: "Top contractors by obligation",
          sql: t(`
SELECT family_key, display_name, total_obligation, worst_confidence
FROM 'dim_entities.parquet'
ORDER BY total_obligation DESC
LIMIT 50
          `),
        },
      ];

    case "dim_programs":
      return [
        {
          label: "Programs with most projects",
          sql: t(`
SELECT pe_bli, org, title, project_count, fy2024_actual_millions
FROM 'dim_programs.parquet'
ORDER BY project_count DESC
LIMIT 50
          `),
        },
      ];

    case "jbook_details":
      return [
        {
          label: "Largest jbook line items",
          sql: t(`
SELECT pe_bli, project_number, project_title, scenario,
       amount_millions, resolution
FROM 'jbook_details.parquet'
WHERE amount_millions IS NOT NULL
ORDER BY amount_millions DESC
LIMIT 50
          `),
        },
      ];

    case "fct_budget_to_awards":
      return [
        {
          label: "Top award recipients",
          sql: t(`
SELECT recipient_name, COUNT(*) AS award_count
FROM 'fct_budget_to_awards.parquet'
GROUP BY recipient_name
ORDER BY award_count DESC
LIMIT 50
          `),
        },
      ];

    case "fct_program_concentration":
      return [
        {
          label: "Most concentrated programs (HHI)",
          sql: t(`
SELECT pe_bli, hhi, family_count, top_family
FROM 'fct_program_concentration.parquet'
ORDER BY hhi DESC
LIMIT 50
          `),
        },
      ];

    case "fct_state_per_capita":
      return [
        {
          label: "Per-capita obligation by jurisdiction",
          sql: t(`
SELECT jurisdiction, fiscal_year, amount_per_capita, total_amount_usd
FROM 'fct_state_per_capita.parquet'
ORDER BY amount_per_capita DESC
LIMIT 50
          `),
        },
      ];

    case "fct_improper_exposure":
      return [
        {
          label: "Agencies with highest improper payment exposure",
          sql: t(`
SELECT agency_code, program_count, derived_improper_amount_usd,
       weighted_rate_pct, latest_fiscal_year
FROM 'fct_improper_exposure.parquet'
ORDER BY derived_improper_amount_usd DESC
LIMIT 50
          `),
        },
      ];

    default:
      // dim_lobbyists, jbook_narratives — sensible generic fallback
      return [
        {
          label: "Preview (first 50 rows)",
          sql: `SELECT * FROM '${name}.parquet' LIMIT 50`,
        },
      ];
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function Explorer({ datasets }: ExplorerProps) {
  const assetUrl = useAssetUrl();

  // Engine state
  const [engineState, setEngineState] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [engineError, setEngineError] = React.useState<string | null>(null);
  const dbRef = React.useRef<AsyncDuckDB | null>(null);

  // Terminate the DuckDB singleton on unmount to release worker + WASM memory.
  React.useEffect(() => {
    return () => {
      terminateDuckDB().catch(() => {});
    };
  }, []);

  // Dataset / query state
  const [selectedDataset, setSelectedDataset] = React.useState<DatasetName>(
    datasets[0]?.name ?? "budget_lines",
  );
  const [customSql, setCustomSql] = React.useState<string>("");
  const [queryState, setQueryState] = React.useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const [queryError, setQueryError] = React.useState<string | null>(null);
  const [queryResult, setQueryResult] = React.useState<QueryResult | null>(
    null,
  );

  const canned = cannedQueriesFor(selectedDataset);

  // ── Engine init ──────────────────────────────────────────────────────────
  /**
   * Initialise the DuckDB engine and register all datasets.
   * Returns the ready db, or null if already loading/errored.
   */
  async function ensureEngine(): Promise<AsyncDuckDB | null> {
    if (dbRef.current) return dbRef.current;
    if (engineState === "error") return null;

    setEngineState("loading");
    try {
      const db = await getDuckDB();
      // assetUrl('') → `${assetBase}` (the raw base, e.g. "/assets" or "https://r2.example.com")
      const assetBase = assetUrl("").replace(/\/$/, "") || "/assets";
      await registerDatasets(db, assetBase);
      dbRef.current = db;
      setEngineState("ready");
      return db;
    } catch (err) {
      setEngineError(String(err));
      setEngineState("error");
      return null;
    }
  }

  async function initEngine() {
    await ensureEngine();
  }

  // ── Query runner ─────────────────────────────────────────────────────────
  /** Ensure engine is ready, then execute sql and update result state. */
  async function runSql(sql: string) {
    const db = await ensureEngine();
    if (!db) return;

    setQueryState("running");
    setQueryError(null);
    setQueryResult(null);

    try {
      const result = await runQuery(db, sql);
      setQueryResult(result);
      setQueryState("done");
    } catch (err) {
      setQueryError(String(err));
      setQueryState("error");
    }
  }

  // ── Copy as CSV ──────────────────────────────────────────────────────────
  function copyAsCsv() {
    if (!queryResult) return;
    const csv = resultToCsv(queryResult);
    navigator.clipboard.writeText(csv).catch(() => {
      // Fallback: create a blob download
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedDataset}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Dataset change handler — resets query state inline so no setState-in-effect.
  function handleDatasetChange(name: DatasetName) {
    setSelectedDataset(name);
    setCustomSql("");
    setQueryResult(null);
    setQueryState("idle");
    setQueryError(null);
  }

  return (
    <div className="space-y-6">
      {/* Engine status banner */}
      {engineState === "idle" && (
        <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-4 bg-muted/40">
          <p className="text-sm text-muted-foreground">
            Queries run entirely in your browser — no data leaves your machine.
            The DuckDB-WASM engine loads on demand (~4 MB).
          </p>
          <button
            onClick={initEngine}
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start the engine
          </button>
        </div>
      )}

      {engineState === "loading" && (
        <div className="rounded-lg border border-border p-4 bg-muted/40">
          <p className="text-sm text-muted-foreground animate-pulse">
            Loading DuckDB-WASM engine&hellip;
          </p>
        </div>
      )}

      {engineState === "error" && (
        <div className="rounded-lg border border-destructive p-4 bg-destructive/10">
          <p className="text-sm font-medium text-destructive">
            Engine failed to load
          </p>
          <pre className="mt-2 text-xs text-destructive whitespace-pre-wrap">
            {engineError}
          </pre>
        </div>
      )}

      {engineState === "ready" && (
        <div className="rounded-lg border border-green-600/30 p-3 bg-green-600/10">
          <p className="text-sm text-green-700 dark:text-green-400">
            Engine ready — queries run in your browser, no server involved.
          </p>
        </div>
      )}

      {/* Dataset picker */}
      <div>
        <label
          htmlFor="dataset-select"
          className="block text-sm font-medium mb-2"
        >
          Dataset
        </label>
        <select
          id="dataset-select"
          value={selectedDataset}
          onChange={(e) => handleDatasetChange(e.target.value as DatasetName)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {datasets.map((ds) => (
            <option key={ds.name} value={ds.name}>
              {ds.name}{" "}
              {ds.rowCount != null
                ? `(${ds.rowCount.toLocaleString("en-US")} rows)`
                : ""}
            </option>
          ))}
        </select>
        {datasets.find((d) => d.name === selectedDataset)?.description && (
          <p className="mt-1 text-xs text-muted-foreground">
            {datasets.find((d) => d.name === selectedDataset)!.description}
          </p>
        )}
      </div>

      {/* Canned queries */}
      <div>
        <p className="text-sm font-medium mb-2">Canned queries</p>
        <div className="flex flex-wrap gap-2">
          {canned.map((q) => (
            <button
              key={q.label}
              data-testid="canned-query"
              onClick={() => {
                setCustomSql(q.sql);
                runSql(q.sql);
              }}
              disabled={queryState === "running"}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* Free-form SQL */}
      <div>
        <label htmlFor="sql-input" className="block text-sm font-medium mb-2">
          SQL (read-only)
        </label>
        <textarea
          id="sql-input"
          value={customSql}
          onChange={(e) => setCustomSql(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={`SELECT * FROM '${selectedDataset}.parquet' LIMIT 50`}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => runSql(customSql || `SELECT * FROM '${selectedDataset}.parquet' LIMIT 50`)}
            disabled={queryState === "running"}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {queryState === "running" ? "Running…" : "Run query"}
          </button>
          {queryResult && (
            <button
              onClick={copyAsCsv}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Copy as CSV
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {queryState === "error" && queryError && (
        <div className="rounded-lg border border-destructive p-4 bg-destructive/10">
          <p className="text-sm font-semibold text-destructive mb-1">
            Query error
          </p>
          <pre className="text-xs text-destructive whitespace-pre-wrap overflow-x-auto">
            {queryError}
          </pre>
        </div>
      )}

      {/* Results table */}
      {queryState === "done" && queryResult && (
        <div>
          {queryResult.totalRows > ROW_CAP && (
            <p className="text-xs text-muted-foreground mb-2">
              Showing first {ROW_CAP.toLocaleString("en-US")} of{" "}
              {queryResult.totalRows.toLocaleString("en-US")} rows — add a{" "}
              <code>LIMIT</code> clause or{" "}
              <button onClick={copyAsCsv} className="underline">
                copy as CSV
              </button>{" "}
              to get all.
            </p>
          )}
          {queryResult.totalRows === 0 && (
            <p className="text-sm text-muted-foreground">
              Query returned 0 rows.
            </p>
          )}
          {queryResult.rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table
                data-testid="query-results"
                className="min-w-full text-xs"
              >
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {queryResult.columns.map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queryResult.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-1.5 text-foreground whitespace-nowrap max-w-[300px] truncate"
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          {cell === null ? (
                            <span className="text-muted-foreground italic">
                              NULL
                            </span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
