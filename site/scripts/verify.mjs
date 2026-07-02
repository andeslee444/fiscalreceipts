#!/usr/bin/env node
/**
 * verify.mjs — gate suite orchestrator for phases 5B-2 and 5B-3.
 *
 * Starts one local server (port 4173), runs gates 1-6 in order,
 * then spawns npx lhci autorun as gate 7.
 * Phase 5B-3 gates 8-12 run statically (no server needed).
 *
 * Output format: `gate N name: ...details → PASS` / `gate N name: ...details → FAIL`
 * Exit: 0 if all gates pass, 1 otherwise.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");

// ── Gate imports ─────────────────────────────────────────────────────────────
import { startServer } from "./serve-static.mjs";
import { runBuildGate } from "./gates/build.mjs";
import { runRenderStaticGate } from "./gates/render-static.mjs";
import { runRenderLiveGate } from "./gates/render-live.mjs";
import { runClickthroughGate } from "./gates/clickthrough.mjs";
import { runSearchGate } from "./gates/search.mjs";
import { runA11yGate } from "./gates/a11y.mjs";
// Phase 5B-3 gates (static — no server required)
import { runFeedGate } from "./gates/feed.mjs";
import { runDistrictGate } from "./gates/district.mjs";
import { runFilingGate } from "./gates/filing.mjs";
import { runOgGate } from "./gates/og.mjs";
import { runAnimationGate } from "./gates/animation.mjs";
// Phase 5C gates
import { runLinkgraphGate } from "./gates/linkgraph.mjs";
import { runCoverageGate } from "./gates/coverage.mjs";
import { runDegradedGate } from "./gates/degraded.mjs";
import { runAnswerfoldGate } from "./gates/answerfold.mjs";

const PORT = 4173;

function printGate(n, name, result) {
  const status = result.pass ? "PASS" : "FAIL";
  const details =
    result.notes.slice(0, 3).join("; ") +
    (result.errors.length > 0
      ? `; ERRORS: ${result.errors.slice(0, 5).join(" | ")}`
      : "");
  console.log(`gate ${n} ${name}: ${details} → ${status}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      console.log(`  ✗ ${e}`);
    }
  }
  return result.pass;
}

/** Run `npx lhci autorun` as gate 7. Returns true if exit code 0. */
function runLhci() {
  return new Promise((resolve) => {
    const lhci = spawn(
      "npx",
      ["lhci", "autorun", `--config=${path.join(siteRoot, "lighthouserc.cjs")}`],
      {
        cwd: siteRoot,
        stdio: "inherit",
        shell: true,
      }
    );
    lhci.on("close", (code) => {
      resolve(code === 0);
    });
    lhci.on("error", (e) => {
      console.error("gate 7 perf: lhci spawn error:", e.message);
      resolve(false);
    });
  });
}

async function main() {
  console.log("=== verify-phase5b2+5b3 ===");
  console.log(`site root: ${siteRoot}`);
  console.log("");

  // ── Start server ──────────────────────────────────────────────────────────
  let serverHandle;
  try {
    serverHandle = await startServer(PORT);
    console.log(`server: ${serverHandle.url}`);
  } catch (e) {
    console.error(`FATAL: could not start server on port ${PORT}: ${e.message}`);
    process.exit(1);
  }

  const BASE_URL = serverHandle.url;
  const gateResults = [];

  try {
    // ── Gate 1: build ──────────────────────────────────────────────────────
    console.log("\n--- gate 1 build ---");
    const g1 = await runBuildGate();
    gateResults.push({ n: 1, name: "build", pass: g1.pass });
    printGate(1, "build", g1);

    // ── Gate 2: render-static ─────────────────────────────────────────────
    console.log("\n--- gate 2 render-static ---");
    const g2 = await runRenderStaticGate();
    gateResults.push({ n: 2, name: "render-static", pass: g2.pass });
    printGate(2, "render-static", g2);

    // ── Gate 3: render-live ───────────────────────────────────────────────
    console.log("\n--- gate 3 render-live ---");
    const g3 = await runRenderLiveGate(BASE_URL);
    gateResults.push({ n: 3, name: "render-live", pass: g3.pass });
    printGate(3, "render-live", g3);

    // ── Gate 4: clickthrough ──────────────────────────────────────────────
    console.log("\n--- gate 4 clickthrough ---");
    const g4 = await runClickthroughGate(BASE_URL);
    gateResults.push({ n: 4, name: "clickthrough", pass: g4.pass });
    printGate(4, "clickthrough", g4);

    // ── Gate 5: search ────────────────────────────────────────────────────
    console.log("\n--- gate 5 search ---");
    const g5 = await runSearchGate(BASE_URL);
    gateResults.push({ n: 5, name: "search", pass: g5.pass });
    printGate(5, "search", g5);

    // ── Gate 6: a11y ─────────────────────────────────────────────────────
    console.log("\n--- gate 6 a11y ---");
    const g6 = await runA11yGate(BASE_URL);
    gateResults.push({ n: 6, name: "a11y", pass: g6.pass });
    printGate(6, "a11y", g6);

    // ── Gate 15: degraded (Phase 5C — G3, live) ───────────────────────────
    console.log("\n--- gate 15 degraded ---");
    const g15 = await runDegradedGate({ baseUrl: BASE_URL });
    gateResults.push({ n: 15, name: "degraded", pass: g15.pass });
    printGate(15, "degraded", g15);

    // ── Gate 16: answerfold (Phase 5C — G6, live) ─────────────────────────
    console.log("\n--- gate 16 answerfold ---");
    const g16 = await runAnswerfoldGate({ baseUrl: BASE_URL });
    gateResults.push({ n: 16, name: "answerfold", pass: g16.pass });
    printGate(16, "answerfold", g16);
  } finally {
    // Stop the server before LHCI (LHCI serves its own static dist)
    await serverHandle.close();
    console.log("\nserver: stopped");
  }

  // ── Gate 7: LHCI (perf) ───────────────────────────────────────────────────
  console.log("\n--- gate 7 perf (lhci) ---");
  const g7Pass = await runLhci();
  gateResults.push({ n: 7, name: "perf", pass: g7Pass });
  console.log(`gate 7 perf: lhci autorun → ${g7Pass ? "PASS" : "FAIL"}`);

  // ── Phase 5B-3 static gates (no server needed) ────────────────────────────

  // ── Gate 8: feed ──────────────────────────────────────────────────────────
  console.log("\n--- gate 8 feed ---");
  const g8 = await runFeedGate();
  gateResults.push({ n: 8, name: "feed", pass: g8.pass });
  printGate(8, "feed", g8);

  // ── Gate 9: district ─────────────────────────────────────────────────────
  console.log("\n--- gate 9 district ---");
  const g9 = await runDistrictGate();
  gateResults.push({ n: 9, name: "district", pass: g9.pass });
  printGate(9, "district", g9);

  // ── Gate 10: filing ──────────────────────────────────────────────────────
  console.log("\n--- gate 10 filing ---");
  const g10 = await runFilingGate();
  gateResults.push({ n: 10, name: "filing", pass: g10.pass });
  printGate(10, "filing", g10);

  // ── Gate 11: og ──────────────────────────────────────────────────────────
  console.log("\n--- gate 11 og ---");
  const g11 = await runOgGate();
  gateResults.push({ n: 11, name: "og", pass: g11.pass });
  printGate(11, "og", g11);

  // ── Gate 12: animation ───────────────────────────────────────────────────
  console.log("\n--- gate 12 animation ---");
  const g12 = await runAnimationGate();
  gateResults.push({ n: 12, name: "animation", pass: g12.pass });
  printGate(12, "animation", g12);

  // ── Gate 13: linkgraph (Phase 5C — G1) ───────────────────────────────────
  console.log("\n--- gate 13 linkgraph ---");
  const g13 = await runLinkgraphGate();
  gateResults.push({ n: 13, name: "linkgraph", pass: g13.pass });
  printGate(13, "linkgraph", g13);

  // ── Gate 14: coverage (Phase 5C — G2) ────────────────────────────────────
  console.log("\n--- gate 14 coverage ---");
  const g14 = await runCoverageGate();
  gateResults.push({ n: 14, name: "coverage", pass: g14.pass });
  printGate(14, "coverage", g14);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== summary ===");
  let allPass = true;
  for (const { n, name, pass } of gateResults) {
    console.log(`  gate ${n} ${name}: ${pass ? "PASS" : "FAIL"}`);
    if (!pass) allPass = false;
  }
  console.log(`\noverall: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("verify: unhandled error:", e);
  process.exit(1);
});
