#!/usr/bin/env node
/**
 * run-mobile-leg.mjs — standalone runner for gate 3's mobile-viewport leg
 * (390×844, PM Sprint 3 Task 1 / backlog #31). Serves out/ like the verify
 * suite, runs runMobileLeg once, prints PASS/NOTES/ERRORS, exits 0/1.
 *
 * Used to record the proof-can-fail: revert a Sprint 2 mobile treatment in a
 * scratch copy of the built artifact, run this, restore, run again.
 */

import { startServer } from "./serve-static.mjs";
import { runMobileLeg } from "./gates/mobile.mjs";

const server = await startServer(4182);
try {
  const res = await runMobileLeg({ baseUrl: server.url });
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
