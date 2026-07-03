#!/usr/bin/env node
/**
 * run-flowdown-gate.mjs — standalone G9 runner (pre-failure records +
 * planted-corruption proofs). Serves out/ like the verify suite, runs
 * runFlowdownGate once, prints PASS/NOTES/ERRORS, exits 0/1.
 */

import { startServer } from "./serve-static.mjs";
import { runFlowdownGate } from "./gates/flowdown.mjs";

const server = await startServer(4179);
try {
  const res = await runFlowdownGate({ baseUrl: server.url });
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
