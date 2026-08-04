"use client";

/**
 * DuckDB-WASM singleton — client-only.
 *
 * Module-level promise guarantees the database is initialised exactly once,
 * even when React StrictMode double-invokes effects.  The promise is shared
 * across every component that calls getDuckDB().
 *
 * Bundles are self-hosted under /duckdb/ (copied from node_modules by
 * scripts/prepare-assets.mjs).  Never use the COI bundle — it requires
 * Cross-Origin-Isolation headers that break the same-origin gate server.
 *
 * registerDatasets() registers every parquet file via HTTP — DuckDB-WASM
 * fetches only the byte-ranges it needs (columnar pushdown).
 */

import * as duckdb from "@duckdb/duckdb-wasm";

import { DATASET_NAMES } from "./dataset-names";

// ── Bundle manifests ──────────────────────────────────────────────────────────

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: "/duckdb/duckdb-mvp.wasm",
    mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
  },
  eh: {
    mainModule: "/duckdb/duckdb-eh.wasm",
    mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
  },
};

// ── Singleton ──────────────────────────────────────────────────────────────────

let _dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Returns a promise that resolves to the initialised AsyncDuckDB instance.
 * Safe to call multiple times — the db is created exactly once per page load.
 */
export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? null);
      return db;
    })();
  }
  return _dbPromise;
}

// ── Dataset registration ───────────────────────────────────────────────────────

/**
 * The dataset name registry lives in the UNIVERSAL lib/dataset-names module —
 * this file is `"use client"`, so its runtime exports become client references
 * when a server component imports them. Re-exported here for existing callers.
 */
export { DATASET_NAMES, type DatasetName } from "./dataset-names";

/**
 * Register all datasets with the given db instance so queries can reference
 * them as `'{name}.parquet'`.
 *
 * @param db        – the initialised AsyncDuckDB instance
 * @param assetBase – resolved base URL (from useAssetUrl / config.json),
 *                   e.g. "/assets" or "https://r2.example.com"
 * @param names     – datasets to register; defaults to the full registry.
 *                   The Explorer passes the shipped-manifest names so the
 *                   queryable set is the build's set, not a stale literal.
 */
export async function registerDatasets(
  db: duckdb.AsyncDuckDB,
  assetBase: string,
  names: readonly string[] = DATASET_NAMES,
): Promise<void> {
  const base = assetBase.replace(/\/$/, "");
  await Promise.all(
    names.map((name) =>
      db.registerFileURL(
        `${name}.parquet`,
        `${base}/data/${name}.parquet`,
        duckdb.DuckDBDataProtocol.HTTP,
        false,
      ),
    ),
  );
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  totalRows: number; // before cap
}

const ROW_CAP = 500;

/**
 * Open a connection, run sql, return up to ROW_CAP rows.
 * The connection is closed after each query (stateless, read-only).
 */
export async function runQuery(
  db: duckdb.AsyncDuckDB,
  sql: string,
): Promise<QueryResult> {
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    const schema = result.schema;
    const columns = schema.fields.map((f) => f.name);
    const allRows = result.toArray();
    const totalRows = allRows.length;
    const capped = allRows.slice(0, ROW_CAP);
    const rows = capped.map((row) =>
      columns.map((col) => {
        const v = (row as Record<string, unknown>)[col];
        // Convert BigInt → number for JSON-safe rendering
        return typeof v === "bigint" ? Number(v) : v;
      }),
    );
    return { columns, rows, totalRows };
  } finally {
    await conn.close();
  }
}

// ── CSV serialisation ─────────────────────────────────────────────────────────

/**
 * Serialize a QueryResult to a CSV string.
 * Pure function — safe to unit-test without duckdb.
 */
export function resultToCsv(result: QueryResult): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // Quote fields containing comma, newline, or double-quote
    if (s.includes(",") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [
    result.columns.map(escape).join(","),
    ...result.rows.map((row) => row.map(escape).join(",")),
  ];
  return lines.join("\n");
}

export { ROW_CAP };

// ── Teardown ──────────────────────────────────────────────────────────────────

/**
 * Terminate the DuckDB singleton — closes the db and its worker.
 * Call from an unmount effect when the Explorer is removed from the page.
 * Nulls _dbPromise so a remount re-initialises cleanly.
 */
export async function terminateDuckDB(): Promise<void> {
  if (!_dbPromise) return;
  const promise = _dbPromise;
  _dbPromise = null;
  try {
    const db = await promise;
    await db.terminate();
  } catch {
    // ignore — already terminated or never fully initialised
  }
}
