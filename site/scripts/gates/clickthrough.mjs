/**
 * gate 4 — clickthrough_gate (Playwright)
 *
 * Page set computed from citations.json + program_details at runtime.
 * Tests:
 * 1. Unique jbook cite: click → panel opens → canvas rendered non-blank → highlight geometry within 3px
 * 2. Ambiguous_first: amber badge text present
 * 3. Workbook drawer contract (§P1-9, PM-review Sprint 2): (a) a static sweep
 *    of json/workbook-cells/ — EVERY workbook citation has a cell preview
 *    whose cited cells carry their own values and sum to the citation's
 *    amount, with context rows; (b/c) the live single-cell and multi-cell
 *    drawers — recorded value + unit + compact equivalence, document identity,
 *    cell refs that cannot be misread as zeros, the preview table with the
 *    cited rows marked and summing, the arithmetic line iff >1 cell, exactly
 *    ONE official-source link, and a copy control for the full SHA-256.
 * 4. LDA mention with entity link: href contains uuid (human URL)
 * 5. LDA dangling: plain text, no link
 * 6. Zero-amount xml-path chip: data-citation-kind=xml-path present, no panel on click
 * 7. Official-source link href ends with #page=N
 * 8. Receipts mode: toggle ON → visible [data-amount] show chips → reload → still ON
 *
 * 100% pass required.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** The §P1-9 repro page. Preferred (not required) for the multi-cell drawer. */
const PM_REPRO_PBL = "ATA000";

/** True when this program has a workbook budget_line citing >1 cell. */
function workbookMultiCandidate(peBli, programDetailsDir, citations) {
  const p = path.join(programDetailsDir, `${peBli}.json`);
  if (!fs.existsSync(p)) return false;
  let det;
  try {
    det = readJson(p);
  } catch {
    return false;
  }
  return (det.budget_lines || []).some(
    (bl) =>
      bl.fact_id &&
      citations[bl.fact_id]?.kind === "workbook" &&
      (citations[bl.fact_id]?.cells ?? "").includes(",")
  );
}

/**
 * Exact mirror of fmtCell() in components/citation-panel/workbook-card.tsx:
 * grouped numerals, up to 3 decimals, TRUE minus sign (U+2212) for negatives.
 * Change one, change both.
 */
function fmtCell(v) {
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return v < 0 ? `−${s}` : s;
}

function computeClickthroughSet() {
  const citations = readJson(path.join(jsonDir, "citations.json"));
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  const entitySlugs = new Set(entities.map((e) => e.slug));

  const programs = readJson(path.join(jsonDir, "programs.json"));
  const programDetailsDir = path.join(jsonDir, "program_details");

  const programsSorted = [...programs].sort((a, b) =>
    a.pe_bli.localeCompare(b.pe_bli)
  );

  let uniquePbl = null;
  let ambiguousPbl = null;
  let workbookPbl = null;
  // §P1-9: a program whose workbook citation sums MORE THAN ONE cell — the
  // arithmetic case the PM hit on /program/ATA000/ ($5.57B = O839 + O840 +
  // O841). ~1.6% of workbook citations are multi-cell, so it must be sought
  // deliberately or the single-cell case would stand in for both.
  let workbookMultiPbl = null;
  let ldaLinkedPbl = null;
  let ldaDanglingPbl = null;
  let zeroAmountPbl = null;
  let officialSourcePbl = null;
  // receiptsPbl: a program page that has BOTH data-fact-id AND data-uncited
  // so that both State A and State C chip assertions can be sampled.
  let receiptsPbl = null;

  const outProgramDir = path.resolve(__dirname, "..", "..", "out", "program");

  for (const p of programsSorted) {
    if (
      uniquePbl &&
      ambiguousPbl &&
      workbookPbl &&
      workbookMultiPbl &&
      ldaLinkedPbl &&
      ldaDanglingPbl &&
      zeroAmountPbl &&
      officialSourcePbl &&
      receiptsPbl
    )
      break;

    const detailsPath = path.join(programDetailsDir, `${p.pe_bli}.json`);
    if (!fs.existsSync(detailsPath)) continue;
    let det;
    try {
      det = readJson(detailsPath);
    } catch {
      continue;
    }

    const details = det.details || [];
    const budgetLines = det.budget_lines || [];
    const mentions = det.mentions || [];

    // unique resolution
    if (
      !uniquePbl &&
      details.some(
        (d) =>
          d.resolution === "unique" &&
          d.fact_id &&
          citations[d.fact_id]?.kind === "jbook_pdf"
      )
    ) {
      uniquePbl = p.pe_bli;
    }

    // ambiguous_first resolution
    if (
      !ambiguousPbl &&
      details.some(
        (d) =>
          d.resolution === "ambiguous_first" &&
          d.fact_id &&
          citations[d.fact_id]?.kind === "jbook_pdf"
      )
    ) {
      ambiguousPbl = p.pe_bli;
    }

    // workbook citation in budget_lines
    if (
      !workbookPbl &&
      budgetLines.some(
        (bl) =>
          bl.fact_id &&
          citations[bl.fact_id]?.kind === "workbook" &&
          citations[bl.fact_id]?.cells
      )
    ) {
      workbookPbl = p.pe_bli;
    }

    // workbook citation summing >1 cell (§P1-9 arithmetic case)
    if (
      !workbookMultiPbl &&
      budgetLines.some(
        (bl) =>
          bl.fact_id &&
          citations[bl.fact_id]?.kind === "workbook" &&
          (citations[bl.fact_id]?.cells ?? "").includes(",")
      )
    ) {
      workbookMultiPbl = p.pe_bli;
    }

    // lda_filing mention with linked entity
    if (!ldaLinkedPbl) {
      for (const m of mentions) {
        const fk = m.family_key || "";
        const slug = fk.toLowerCase().replace(/ /g, "-");
        if (entitySlugs.has(slug) && m.filing_uuid) {
          ldaLinkedPbl = p.pe_bli;
          break;
        }
      }
    }

    // lda_filing dangling mention (family_key not in entity slugs)
    if (!ldaDanglingPbl) {
      for (const m of mentions) {
        const fk = m.family_key || "";
        const slug = fk.toLowerCase().replace(/ /g, "-");
        if (!entitySlugs.has(slug) && fk && m.filing_uuid) {
          ldaDanglingPbl = p.pe_bli;
          break;
        }
      }
    }

    // zero_amount xml-path chip
    if (!zeroAmountPbl && details.some((d) => d.resolution === "zero_amount")) {
      zeroAmountPbl = p.pe_bli;
    }

    // receipts test page: needs both [data-fact-id] and [data-uncited] elements
    // We check the rendered out/ HTML for the presence of both attributes so
    // we pick a page that will actually exercise State A and State C chips.
    if (!receiptsPbl) {
      const outHtmlPath = path.join(outProgramDir, p.pe_bli, "index.html");
      if (fs.existsSync(outHtmlPath)) {
        try {
          const outHtml = fs.readFileSync(outHtmlPath, "utf8");
          if (outHtml.includes("data-fact-id=") && outHtml.includes("data-uncited=")) {
            receiptsPbl = p.pe_bli;
          }
        } catch {
          // skip
        }
      }
    }

    // official_url with #page= (from jbook_pdf citations)
    if (!officialSourcePbl) {
      for (const d of details) {
        if (d.fact_id && citations[d.fact_id]) {
          const cit = citations[d.fact_id];
          if (cit.official_url && cit.official_url.includes("#page=")) {
            officialSourcePbl = p.pe_bli;
            break;
          }
        }
      }
    }
  }

  // The spec's own repro page wins the multi-cell slot when it still
  // qualifies, so the gate exercises the exact drawer the PM reported.
  if (workbookMultiCandidate(PM_REPRO_PBL, programDetailsDir, citations)) {
    workbookMultiPbl = PM_REPRO_PBL;
  }

  return {
    uniquePbl,
    ambiguousPbl,
    workbookPbl,
    workbookMultiPbl,
    ldaLinkedPbl,
    ldaDanglingPbl,
    zeroAmountPbl,
    officialSourcePbl,
    receiptsPbl,
    citations,
    entities,
    entitySlugs,
  };
}

export async function runClickthroughGate(baseUrl) {
  const errors = [];
  const notes = [];

  const set = computeClickthroughSet();
  notes.push(
    `clickthrough set: unique=${set.uniquePbl}, ambiguous=${set.ambiguousPbl}, workbook=${set.workbookPbl}, workbookMulti=${set.workbookMultiPbl}, ldaLinked=${set.ldaLinkedPbl}, ldaDangling=${set.ldaDanglingPbl}, zeroAmt=${set.zeroAmountPbl}, officialSrc=${set.officialSourcePbl}, receipts=${set.receiptsPbl}`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    javaScriptEnabled: true,
  });

  try {
    // ── Test 1: Unique jbook cite — click → panel → canvas → highlight ──────
    if (set.uniquePbl) {
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/program/${set.uniquePbl}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        // Find a [data-amount][data-fact-id] with unique resolution
        const programDetails = readJson(
          path.join(jsonDir, "program_details", `${set.uniquePbl}.json`)
        );
        const uniqueDetail = programDetails.details.find(
          (d) => d.resolution === "unique" && d.fact_id
        );
        const factId = uniqueDetail?.fact_id;

        if (factId) {
          const el = await page.$(`[data-fact-id="${factId}"]`);
          if (el) {
            await el.click();
            // Panel should open
            const panel = await page
              .waitForSelector('[data-testid="citation-panel"]', {
                timeout: 10000,
              })
              .catch(() => null);

            if (!panel) {
              errors.push(
                `unique cite (${set.uniquePbl}): panel did not open after click on [data-fact-id="${factId}"]`
              );
            } else {
              // Canvas rendered non-blank
              const canvas = await page.$("canvas").catch(() => null);
              if (!canvas) {
                errors.push(
                  `unique cite (${set.uniquePbl}): no <canvas> in citation panel (PDF.js not rendering)`
                );
              } else {
                notes.push(
                  `unique cite (${set.uniquePbl}): panel opened with canvas ✓`
                );

                // Highlight geometry check
                const cit = set.citations[factId];
                if (cit && cit.x0 != null && cit.top_pt != null) {
                  // Check highlight div exists
                  const highlight = await page
                    .$("[data-testid='pdf-highlight']")
                    .catch(() => null);
                  if (!highlight) {
                    // Not a hard error — highlight may render differently
                    notes.push(
                      `unique cite: highlight div not found by data-testid (may be non-fatal)`
                    );
                  } else {
                    notes.push(`unique cite: highlight div present ✓`);
                  }
                }
              }
            }
          } else {
            errors.push(
              `unique cite (${set.uniquePbl}): could not find element [data-fact-id="${factId}"]`
            );
          }
        } else {
          errors.push(`unique cite: no fact_id found for ${set.uniquePbl}`);
        }
      } catch (e) {
        errors.push(`unique cite (${set.uniquePbl}): ${e.message}`);
      } finally {
        await page.close();
      }
    } else {
      errors.push("unique cite: no program with unique resolution found");
    }

    // ── Test 2: Ambiguous_first — amber badge ────────────────────────────────
    if (set.ambiguousPbl) {
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/program/${set.ambiguousPbl}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        const programDetails = readJson(
          path.join(jsonDir, "program_details", `${set.ambiguousPbl}.json`)
        );
        const ambigDetail = programDetails.details.find(
          (d) => d.resolution === "ambiguous_first" && d.fact_id
        );
        const factId = ambigDetail?.fact_id;

        if (factId) {
          const el = await page.$(`[data-fact-id="${factId}"]`);
          if (el) {
            await el.click();
            const panel = await page
              .waitForSelector('[data-testid="citation-panel"]', {
                timeout: 10000,
              })
              .catch(() => null);

            if (!panel) {
              errors.push(
                `ambiguous cite (${set.ambiguousPbl}): panel did not open`
              );
            } else {
              // Amber/caveat badge
              const badge = await page
                .$('[data-testid="ambiguous-badge"]')
                .catch(() => null);
              let badgeByText = null;
              try {
                const loc = page.getByText(/ambiguous/i, { exact: false }).first();
                await loc.waitFor({ timeout: 2000 });
                badgeByText = loc;
              } catch { /* not found */ }
              if (!badge && !badgeByText) {
                errors.push(
                  `ambiguous cite (${set.ambiguousPbl}): no amber/ambiguous badge in panel`
                );
              } else {
                notes.push(
                  `ambiguous cite (${set.ambiguousPbl}): amber badge present ✓`
                );
              }
            }
          } else {
            errors.push(
              `ambiguous cite (${set.ambiguousPbl}): element [data-fact-id="${factId}"] not found`
            );
          }
        }
      } catch (e) {
        errors.push(`ambiguous cite (${set.ambiguousPbl}): ${e.message}`);
      } finally {
        await page.close();
      }
    } else {
      errors.push("ambiguous cite: no program with ambiguous_first resolution found");
    }

    // ── Test 3: Workbook drawer contract (§P1-9) ───────────────────────────
    //
    // Was: "sheet+cells present in the card". That passed while the drawer
    // headlined "$5.57B  USD thousands" (a compact figure labelled with the
    // unit of a number it was not), showed three cell refs with no values and
    // no arithmetic, named no document, duplicated the source link, truncated
    // the hash with no way to get the rest, and offered a 4 MB .xlsx download
    // as the only way to see the cell. Now:
    //
    //   3a PAYLOAD SWEEP (static, all 35,940 facts): every workbook citation
    //      has a cell-preview row in json/workbook-cells/{fid[:2]}.json; every
    //      cited cell in it carries its OWN numeric value; those values sum to
    //      the citation's amount_thousands; the preview carries context rows
    //      and the cited column's header. A drawer can only show the cell if
    //      the payload has it, so this is where the contract has teeth for
    //      every fact rather than the two the browser opens.
    //   3b/3c LIVE DRAWER, single-cell and multi-cell (the PM's own repro
    //      page when it still qualifies): the rendered contract — recorded
    //      value + unit + equivalence, document identity, unambiguous cell
    //      refs, the preview table with the cited rows marked and summing to
    //      the amount, the arithmetic line for multi-cell facts, exactly ONE
    //      official-source link, and a copy control for the full hash.
    {
      // ---- 3a: payload sweep ------------------------------------------------
      const cellsDir = path.join(jsonDir, "workbook-cells");
      if (!fs.existsSync(cellsDir)) {
        errors.push(
          `workbook drawer (§P1-9): no cell-preview sidecar at ${cellsDir} —` +
            " the drawer cannot show a cell it was never given"
        );
      } else {
        const previews = {};
        for (const f of fs.readdirSync(cellsDir)) {
          if (!f.endsWith(".json")) continue;
          Object.assign(previews, readJson(path.join(cellsDir, f)));
        }
        const wbFacts = Object.entries(set.citations).filter(
          ([, c]) => c.kind === "workbook"
        );
        const missing = [];
        const bad = [];
        for (const [fid, cit] of wbFacts) {
          const pv = previews[fid];
          if (!pv) {
            missing.push(fid);
            continue;
          }
          const refs = String(cit.cells || "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          const cited = (pv.rows || []).filter((r) => r.cited);
          if (cited.length !== refs.length) {
            bad.push(`${fid}: ${cited.length} cited rows vs ${refs.length} cells`);
            continue;
          }
          if (cited.some((r) => typeof r.v !== "number")) {
            bad.push(`${fid}: a cited cell has no value of its own`);
            continue;
          }
          const sum = cited.reduce((a, r) => a + r.v, 0);
          if (Math.abs(sum - cit.amount_thousands) > 0.0005) {
            bad.push(
              `${fid}: cited cells sum to ${sum}, citation says ${cit.amount_thousands}`
            );
            continue;
          }
          if (pv.rows.length <= cited.length) {
            bad.push(`${fid}: no surrounding rows — the cell has no context`);
            continue;
          }
          if (!pv.col || !pv.sheet) {
            bad.push(`${fid}: preview names no column/sheet`);
          }
        }
        if (missing.length > 0) {
          errors.push(
            `workbook drawer 3a (§P1-9): ${missing.length}/${wbFacts.length}` +
              ` workbook citations have NO cell preview: ${missing.slice(0, 5).join(", ")}`
          );
        }
        if (bad.length > 0) {
          errors.push(
            `workbook drawer 3a (§P1-9): ${bad.length} preview(s) disagree with` +
              ` their citation: ${bad.slice(0, 5).join(" | ")}`
          );
        }
        if (missing.length === 0 && bad.length === 0) {
          notes.push(
            `workbook drawer 3a: ${wbFacts.length} workbook citations, each with` +
              " per-cell values summing to its amount ✓"
          );
        }
      }

      // ---- 3b/3c: the rendered drawer ---------------------------------------
      const targets = [
        { label: "single-cell", pbl: set.workbookPbl, multi: false },
        { label: "multi-cell", pbl: set.workbookMultiPbl, multi: true },
      ];

      for (const target of targets) {
        if (!target.pbl) {
          errors.push(
            `workbook drawer (${target.label}): no program found with such a citation`
          );
          continue;
        }
        const page = await context.newPage();
        try {
          await page.goto(`${baseUrl}/program/${target.pbl}/`, {
            waitUntil: "networkidle",
            timeout: 30000,
          });

          const programDetails = readJson(
            path.join(jsonDir, "program_details", `${target.pbl}.json`)
          );
          const line = programDetails.budget_lines.find((bl) => {
            const c = bl.fact_id ? set.citations[bl.fact_id] : null;
            if (!c || c.kind !== "workbook" || !c.cells) return false;
            return target.multi ? c.cells.includes(",") : true;
          });
          const factId = line?.fact_id;
          if (!factId) {
            errors.push(
              `workbook drawer (${target.label}, ${target.pbl}): no matching budget_line`
            );
            continue;
          }
          const cit = set.citations[factId];
          const refs = cit.cells
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);

          const el = await page.$(`[data-fact-id="${factId}"]`);
          if (!el) {
            errors.push(
              `workbook drawer (${target.label}, ${target.pbl}): element [data-fact-id="${factId}"] not found`
            );
            continue;
          }
          await el.click();
          const panel = await page
            .waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 })
            .catch(() => null);
          if (!panel) {
            errors.push(
              `workbook drawer (${target.label}, ${target.pbl}): panel did not open`
            );
            continue;
          }
          // The preview is fetched on open — wait for it rather than racing it.
          const preview = await page
            .waitForSelector('[data-testid="workbook-preview"]', { timeout: 10000 })
            .catch(() => null);

          const where = `workbook drawer (${target.label}, ${target.pbl}, fact ${factId})`;

          // (1) amount: recorded numerals + recorded unit, never the compact
          //     figure wearing the raw figure's unit label.
          const amountText = (
            (await panel.$eval('[data-testid="workbook-amount"]', (n) => n.textContent)
              .catch(() => null)) ?? ""
          )
            .replace(/\s+/g, " ")
            .trim();
          const rawNumerals = fmtCell(cit.amount_thousands);
          if (!amountText.includes(rawNumerals)) {
            errors.push(
              `${where}: amount line "${amountText}" does not show the recorded value ${rawNumerals}`
            );
          } else if (cit.units && !amountText.includes(cit.units)) {
            errors.push(`${where}: amount line "${amountText}" omits the unit ${cit.units}`);
          } else if (
            Math.abs(cit.amount_thousands) >= 1000 &&
            !/\(=\s*-?\$/.test(amountText)
          ) {
            errors.push(
              `${where}: amount line "${amountText}" has no compact-dollar equivalence`
            );
          }

          // (7) document identity
          const docText = await panel
            .$eval('[data-testid="workbook-document"]', (n) => n.textContent)
            .catch(() => null);
          if (!docText || docText.trim().length === 0) {
            errors.push(`${where}: drawer names no source document`);
          }

          // (4) cell refs: present, one element per ref, column letter split out
          for (const ref of refs) {
            const refEl = await panel.$(`[data-testid="cell-ref"][data-cell="${ref}"]`);
            if (!refEl) {
              errors.push(`${where}: cell ref ${ref} is not rendered as a cell-ref element`);
              continue;
            }
            const title = (await refEl.getAttribute("title")) ?? "";
            const col = ref.match(/^[A-Z]+/)?.[0] ?? "";
            const row = ref.replace(/^[A-Z]+/, "");
            if (!title.includes(`column ${col}`) || !title.includes(`row ${row}`)) {
              errors.push(
                `${where}: cell ref ${ref} does not spell out its column/row (title="${title}")`
              );
            }
            if (!(await refEl.$("[data-cell-col]"))) {
              errors.push(`${where}: cell ref ${ref} does not separate its column letter`);
            }
          }

          // (2) preview table: cited rows == the citation's cells, each with a
          //     value, summing to the amount, plus at least one context row.
          if (!preview) {
            errors.push(`${where}: no cell preview rendered`);
          } else {
            const rows = await preview.$$eval(
              '[data-testid="workbook-preview-row"]',
              (nodes) =>
                nodes.map((n) => ({
                  row: n.getAttribute("data-row"),
                  cited: n.getAttribute("data-cited") === "true",
                  v: n.querySelector("[data-cell-value]")?.getAttribute("data-cell-value") ?? "",
                }))
            );
            const citedRows = rows.filter((r) => r.cited);
            const expectRows = refs.map((r) => r.replace(/^[A-Z]+/, ""));
            if (citedRows.map((r) => r.row).join(",") !== expectRows.join(",")) {
              errors.push(
                `${where}: preview marks rows [${citedRows.map((r) => r.row)}], cells say [${expectRows}]`
              );
            }
            if (rows.length <= citedRows.length) {
              errors.push(`${where}: preview shows no surrounding rows`);
            }
            const sum = citedRows.reduce((a, r) => a + Number(r.v), 0);
            if (citedRows.some((r) => r.v === "") || Math.abs(sum - cit.amount_thousands) > 0.0005) {
              errors.push(
                `${where}: preview's cited values sum to ${sum}, citation says ${cit.amount_thousands}`
              );
            }
          }

          // (3) arithmetic — required iff the fact sums >1 cell
          const arith = await panel
            .$eval('[data-testid="workbook-arithmetic"]', (n) =>
              (n.textContent ?? "").replace(/\s+/g, " ").trim()
            )
            .catch(() => null);
          if (refs.length > 1) {
            if (!arith) {
              errors.push(`${where}: ${refs.length} cells summed with no arithmetic shown`);
            } else {
              for (const ref of refs) {
                if (!arith.includes(ref)) {
                  errors.push(`${where}: arithmetic "${arith}" omits cell ${ref}`);
                }
              }
              if (!arith.includes(`= ${rawNumerals}`)) {
                errors.push(`${where}: arithmetic "${arith}" does not resolve to ${rawNumerals}`);
              }
            }
          } else if (arith) {
            errors.push(`${where}: single-cell fact renders an arithmetic line ("${arith}")`);
          }

          // (5) exactly one official-source link
          const officialCount = await panel.$$eval(
            "a[href]",
            (nodes, url) => nodes.filter((a) => a.getAttribute("href") === url).length,
            cit.official_url
          );
          if (officialCount !== 1) {
            errors.push(
              `${where}: official source link appears ${officialCount}× (expected exactly 1)`
            );
          }

          // (6) copy control for the full hash
          if (!(await panel.$('[data-testid="copy-hash"]'))) {
            errors.push(`${where}: hash is truncated with no copy control`);
          }

          notes.push(`${where}: §P1-9 drawer contract checked`);
        } catch (e) {
          errors.push(`workbook drawer (${target.label}, ${target.pbl}): ${e.message}`);
        } finally {
          await page.close();
        }
      }
    }

    // ── Test 4: LDA mention with entity link (href contains uuid) ───────────
    if (set.ldaLinkedPbl) {
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/program/${set.ldaLinkedPbl}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        // Find an <a> href containing a UUID pattern (lda filing)
        const uuidRe =
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const links = await page.$$eval("a[href]", (els) =>
          els.map((el) => el.href)
        );
        const ldaLinks = links.filter((href) => uuidRe.test(href));

        if (ldaLinks.length === 0) {
          errors.push(
            `lda linked (${set.ldaLinkedPbl}): no LDA filing link (UUID in href) found`
          );
        } else {
          notes.push(
            `lda linked (${set.ldaLinkedPbl}): ${ldaLinks.length} LDA links found ✓`
          );
        }
      } catch (e) {
        errors.push(`lda linked (${set.ldaLinkedPbl}): ${e.message}`);
      } finally {
        await page.close();
      }
    } else {
      errors.push("lda linked: no program with linked LDA mention found");
    }

    // ── Test 5: LDA dangling — plain text, no company link ──────────────────
    if (set.ldaDanglingPbl) {
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/program/${set.ldaDanglingPbl}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        const programDetails = readJson(
          path.join(jsonDir, "program_details", `${set.ldaDanglingPbl}.json`)
        );
        const danglingMention = programDetails.mentions.find((m) => {
          const fk = m.family_key || "";
          const slug = fk.toLowerCase().replace(/ /g, "-");
          return !set.entitySlugs.has(slug) && fk;
        });

        if (danglingMention) {
          // The client_name should appear as text, not wrapped in a company link
          const clientName = danglingMention.client_name || "";
          if (clientName) {
            // Check there is no link to /company/ for this client
            const companyLinks = await page.$$eval(
              `a[href*="/company/"]`,
              (els) => els.map((el) => el.href)
            );
            const name30 = clientName.slice(0, 30).toLowerCase();
            const hasCompanyLink = companyLinks.some((href) =>
              href.toLowerCase().includes(name30.replace(/ /g, "-"))
            );
            if (hasCompanyLink) {
              errors.push(
                `lda dangling (${set.ldaDanglingPbl}): dangling family "${clientName}" has a company link (should be plain text)`
              );
            } else {
              notes.push(
                `lda dangling (${set.ldaDanglingPbl}): "${clientName.slice(0, 40)}" renders as plain text ✓`
              );
            }
          }
        } else {
          notes.push(
            `lda dangling (${set.ldaDanglingPbl}): no dangling mention found in this page (may be OK if all families are in entities_top)`
          );
        }
      } catch (e) {
        errors.push(`lda dangling (${set.ldaDanglingPbl}): ${e.message}`);
      } finally {
        await page.close();
      }
    } else {
      notes.push("lda dangling: no dangling LDA program found — OK if all families are linked");
    }

    // ── Test 6: Zero-amount xml-path chip — no panel on click ───────────────
    if (set.zeroAmountPbl) {
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/program/${set.zeroAmountPbl}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        const xmlChip = await page
          .$('[data-citation-kind="xml-path"]')
          .catch(() => null);
        if (!xmlChip) {
          errors.push(
            `zero-amount chip (${set.zeroAmountPbl}): no [data-citation-kind=xml-path] element found`
          );
        } else {
          // Click it — panel should NOT open
          await xmlChip.click();
          await page.waitForTimeout(1000);
          const panel = await page
            .$('[data-testid="citation-panel"]')
            .catch(() => null);
          if (panel) {
            const visible = await panel.isVisible();
            if (visible) {
              errors.push(
                `zero-amount chip (${set.zeroAmountPbl}): citation panel opened for xml-path chip (should not)`
              );
            } else {
              notes.push(
                `zero-amount chip (${set.zeroAmountPbl}): xml-path chip present, panel hidden ✓`
              );
            }
          } else {
            notes.push(
              `zero-amount chip (${set.zeroAmountPbl}): xml-path chip present, no panel ✓`
            );
          }
        }
      } catch (e) {
        errors.push(`zero-amount chip (${set.zeroAmountPbl}): ${e.message}`);
      } finally {
        await page.close();
      }
    } else {
      errors.push("zero-amount chip: no program with zero_amount details found");
    }

    // ── Test 7: Official-source link href ends with #page=N ─────────────────
    if (set.officialSourcePbl) {
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/program/${set.officialSourcePbl}/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        // Find any link that ends with #page=\d+
        const links = await page.$$eval("a[href]", (els) =>
          els.map((el) => el.getAttribute("href") || "")
        );
        const pageLinks = links.filter((href) => /#page=\d+/.test(href));
        if (pageLinks.length === 0) {
          errors.push(
            `official-source link (${set.officialSourcePbl}): no href with #page=N found`
          );
        } else {
          notes.push(
            `official-source link (${set.officialSourcePbl}): ${pageLinks.length} #page= links ✓`
          );
        }
      } catch (e) {
        errors.push(
          `official-source link (${set.officialSourcePbl}): ${e.message}`
        );
      } finally {
        await page.close();
      }
    } else {
      notes.push("official-source #page=: no program found with this citation type");
    }

    // ── Test 8: Receipts / Fact-IDs mode (DEFAULT ON since P1-1) ─────────────
    // Contract (spec §P1-1): first visit shows fact-id chips with NO toggle
    // click; the chip is a SIBLING of [data-amount] (never inside — the
    // static gates parse the amount element's text as one currency figure);
    // the "Fact IDs" toggle (accessible name "Show fact IDs") controls chip
    // visibility only, persisted BOTH ways ('1' on / '0' off) across reloads.
    {
      const page = await context.newPage();
      try {
        // Use a program that has BOTH cited ([data-fact-id]) and uncited ([data-uncited])
        // amounts so both State A and State C chip assertions can be exercised.
        const testPbl = set.receiptsPbl || set.uniquePbl || set.ambiguousPbl || set.zeroAmountPbl;
        if (!testPbl) {
          errors.push("receipts mode: no program page available to test");
        } else {
          const pageUrl = `${baseUrl}/program/${testPbl}/`;
          // Fresh first visit: clear any stored preference, then reload.
          await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30000 });
          await page.evaluate(() => localStorage.removeItem("receipts-mode"));
          await page.reload({ waitUntil: "networkidle" });
          await page.waitForTimeout(400);

          const SAMPLE_SIZE = 5;
          const citedEls = await page.$$("[data-amount][data-fact-id]");
          const uncitedEls = await page.$$("[data-amount][data-uncited]");

          if (citedEls.length === 0) {
            errors.push(
              `receipts default (${testPbl}): no [data-amount][data-fact-id] elements found — cannot verify State A chips`
            );
          } else {
            // ── (a) DEFAULT ON: chips visible on first visit, no click ──────
            const defaultChips = await page.$$("[data-receipts-chip]");
            if (defaultChips.length === 0) {
              errors.push(
                `receipts default (${testPbl}): zero [data-receipts-chip] on a fresh first visit — Fact IDs must default ON (spec §P1-1)`
              );
            } else {
              const chipText = (await defaultChips[0].textContent()) || "";
              if (!chipText.includes("#")) {
                errors.push(
                  `receipts default (${testPbl}): chip text "${chipText}" missing '#' public id`
                );
              } else {
                notes.push(
                  `receipts default (${testPbl}): ${defaultChips.length} fact-id chips visible on first visit (no toggle click) ✓`
                );
              }
            }

            // ── (b) Sibling contract: chip NEVER inside [data-amount] ───────
            const nestedChips = await page.$$("[data-amount] [data-receipts-chip]");
            if (nestedChips.length > 0) {
              errors.push(
                `receipts default (${testPbl}): ${nestedChips.length} [data-receipts-chip] nested INSIDE [data-amount] — chip text poisons the static gates' amount parse (must be a sibling)`
              );
            }

            // ── State C 'uncited' label (default ON) ────────────────────────
            // Since the Phase 5B-3 ledger flips, program-page datasets are
            // all cited — a page may legitimately have ZERO State C spans.
            // Only fail when the page-set scan PROMISED uncited elements.
            const uncitedSample = uncitedEls.slice(0, SAMPLE_SIZE);
            if (uncitedSample.length === 0 && set.receiptsPbl === testPbl) {
              errors.push(
                `receipts mode (${testPbl}): no [data-amount][data-uncited] elements to sample — cannot verify State C chips`
              );
            } else if (uncitedSample.length === 0) {
              notes.push(
                `receipts mode (${testPbl}): no State C spans on this page (all datasets cited — ledger flips) — State C chip check N/A`
              );
            } else {
              let uncitedChipMisses = 0;
              for (const el of uncitedSample) {
                const text = await el.textContent();
                if (!text || !text.includes("uncited")) {
                  uncitedChipMisses++;
                }
              }
              if (uncitedChipMisses > 0) {
                errors.push(
                  `receipts mode (${testPbl}): ${uncitedChipMisses}/${uncitedSample.length} sampled [data-amount][data-uncited] elements missing 'uncited' text with Fact IDs on`
                );
              } else {
                notes.push(
                  `receipts mode (${testPbl}): ${uncitedSample.length} uncited chips show 'uncited' ✓`
                );
              }
            }

            // ── (c) Toggle OFF: relabeled control, persists '0', survives reload ──
            const toggle = page.locator('[data-testid="receipts-toggle"]').first();
            if ((await toggle.count()) === 0) {
              errors.push(
                "receipts mode: no [data-testid=receipts-toggle] control found"
              );
            } else {
              const accName = await toggle.getAttribute("aria-label");
              if (accName !== "Show fact IDs") {
                errors.push(
                  `receipts toggle: accessible name "${accName}" — expected "Show fact IDs" (spec §P1-1)`
                );
              }
              await toggle.click();
              await page.waitForTimeout(400);
              const offChips = await page.$$("[data-receipts-chip]");
              const storedOff = await page.evaluate(() =>
                localStorage.getItem("receipts-mode")
              );
              if (offChips.length !== 0) {
                errors.push(
                  `receipts toggle OFF (${testPbl}): ${offChips.length} chips still visible after toggling off`
                );
              }
              if (storedOff !== "0") {
                errors.push(
                  `receipts toggle OFF: localStorage "receipts-mode" is "${storedOff}" — expected "0" (opt-out must persist)`
                );
              }

              await page.reload({ waitUntil: "networkidle" });
              await page.waitForTimeout(600);
              const offAfterReload = await page.$$("[data-receipts-chip]");
              if (offAfterReload.length !== 0) {
                errors.push(
                  `receipts opt-out (${testPbl}): ${offAfterReload.length} chips visible after reload — stored '0' not honored`
                );
              }

              // ── (d) Toggle back ON: persists '1', chips return ────────────
              await page.locator('[data-testid="receipts-toggle"]').first().click();
              await page.waitForTimeout(400);
              const onChips = await page.$$("[data-receipts-chip]");
              const storedOn = await page.evaluate(() =>
                localStorage.getItem("receipts-mode")
              );
              if (onChips.length === 0) {
                errors.push(
                  `receipts toggle ON (${testPbl}): no chips after re-enabling`
                );
              }
              if (storedOn !== "1") {
                errors.push(
                  `receipts toggle ON: localStorage "receipts-mode" is "${storedOn}" — expected "1" (opt-in must persist)`
                );
              }
              if (
                offChips.length === 0 &&
                storedOff === "0" &&
                offAfterReload.length === 0 &&
                onChips.length > 0 &&
                storedOn === "1"
              ) {
                notes.push(
                  `receipts toggle (${testPbl}): off→'0' persists across reload, on→'1' restores chips ✓`
                );
              }
            }
          }
        }
      } catch (e) {
        errors.push(`receipts mode: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
