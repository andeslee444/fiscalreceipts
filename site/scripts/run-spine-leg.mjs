#!/usr/bin/env node
/**
 * run-spine-leg.mjs — standalone runner for gate 3's layout-spine leg
 * (ROADMAP #42). Serves out/ like the verify suite, runs runSpineLeg once,
 * prints PASS/NOTES/ERRORS, exits 0/1.
 *
 * Sibling of run-mobile-leg.mjs, and there for the same reason: a new leg
 * earns its keep by being run against a genuinely broken artifact before it
 * is run against a fixed one, and the full suite is a six-minute round trip.
 */

import { startServer } from "./serve-static.mjs";
import { runSpineLeg } from "./gates/spine.mjs";

const server = await startServer(4183);
try {
  const res = await runSpineLeg({ baseUrl: server.url });
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
