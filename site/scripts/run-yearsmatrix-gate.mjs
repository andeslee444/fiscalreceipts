#!/usr/bin/env node
/**
 * run-yearsmatrix-gate.mjs — standalone G8 runner (regression proof when the
 * data bundle is re-exported). Serves out/ like the verify suite, runs
 * runYearsMatrixGate once, prints PASS/NOTES/ERRORS, exits 0/1.
 */

import { startServer } from "./serve-static.mjs";
import { runYearsMatrixGate } from "./gates/yearsmatrix.mjs";

const server = await startServer(4181);
try {
  const res = await runYearsMatrixGate({ baseUrl: server.url });
  console.log(`PASS: ${res.pass}`);
  console.log("NOTES:");
  for (const n of res.notes) console.log(`  ${n}`);
  if (res.errors.length) {
    console.log("ERRORS:");
    for (const e of res.errors) console.log(`  ✗ ${e}`);
  }
  process.exitCode = res.pass ? 0 : 1;
} finally {
  await server.close();
}
