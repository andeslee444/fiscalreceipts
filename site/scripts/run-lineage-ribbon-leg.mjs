#!/usr/bin/env node
/**
 * run-lineage-ribbon-leg.mjs — standalone runner for gate 22 leg (g)
 * (ROADMAP #29(c), the /lineage/ ribbon-honesty leg).
 *
 * Static-only: no browser, no server. Measures the built
 * out/lineage/index.html against data/site/json/lineage_flow.json.
 *
 *   node scripts/run-lineage-ribbon-leg.mjs [htmlPath] [payloadPath]
 *
 * The optional arguments exist to record the proof-can-fail: copy the built
 * page, edit a real defect into the copy, point this at it, and watch the leg
 * fail; then run it with no arguments against the real build and watch it
 * pass.
 */

import { runLineageRibbonLeg } from "./gates/flowdown.mjs";

const [htmlPath, payloadPath] = process.argv.slice(2);
const res = runLineageRibbonLeg({
  htmlPath: htmlPath || undefined,
  payloadPath: payloadPath || undefined,
});
console.log(`PASS: ${res.errors.length === 0}`);
console.log("NOTES:");
for (const n of res.notes) console.log(`  ${n}`);
if (res.errors.length) {
  console.log("ERRORS:");
  for (const e of res.errors) console.log(`  ✗ ${e}`);
}
process.exitCode = res.errors.length === 0 ? 0 : 1;
