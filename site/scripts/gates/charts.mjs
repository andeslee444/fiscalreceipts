/**
 * gate 6 — a11y, CHART + NOTE-REGISTER LEGS (PM Sprint 3 Task 4)
 *
 * The static half of both contracts lives in gate 2 (render-static (ch)/(nk)):
 * markers, <desc>, caption, [data-amount], document order. It cannot see the
 * two things that decide whether a reader can actually USE the chart:
 *
 *   (c1) REACHABLE TABLE VIEW. Every [data-chart] must expose its data as a
 *        real table a keyboard can get to. Either the table is already
 *        visible, or its <summary> toggle is focusable and OPENING IT WITH
 *        THE KEYBOARD (Tab-free: focus() + Enter) reveals a table with
 *        non-zero layout boxes. An ARIA-only or CSS-clipped "table" fails.
 *
 *   (c2) THE TABLE MAY NOT BREAK THE PHONE. With EVERY chart table open at
 *        390×844, the document must still not scroll horizontally — the
 *        table has to scroll inside its own container. Gate 3's mobile leg
 *        measures with the tables closed and is blind to this by
 *        construction.
 *
 *   (n1) TWO VISUALLY DISTINCT REGISTERS. Honest scope disclosure and
 *        caution-about-a-number must not share a palette. Measured on the
 *        COMPOSITED colours the reader sees (canvas probe, same technique as
 *        the P1-1 underline check): caution borders are warm (r−b ≥ 30,
 *        the amber family); scope borders are not (r−b ≤ 12); and the two
 *        backgrounds differ by more than rounding.
 *
 * NON-VACUITY. Each sampled page declares how many charts it must have; a
 * page that renders none FAILS rather than passing on an empty set. Both
 * note registers must be found across the sample.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

/** Minimum warmth (r−b) of a caution border; maximum for a scope border. */
const CAUTION_WARMTH_MIN = 30;
const SCOPE_WARMTH_MAX = 12;
/** Minimum RGB distance between the two registers' backgrounds. */
const BG_DISTANCE_MIN = 6;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Deterministic sample pages. The flow diagram renders on the 17 crosswalked
 * programs only, and the inferred-lineage caution note on the handful of PEs
 * whose sidecar carries an inferred rail entry — both are read from the
 * sidecars so the sample follows the data instead of a hard-coded slug.
 */
export function computeChartSamples() {
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const detDir = path.join(jsonDir, "program_details");
  const sorted = [...programs].sort((a, b) => a.pe_bli.localeCompare(b.pe_bli));

  // The 17 crosswalked programs are exactly the flows sidecars.
  const flowProgram =
    fs
      .readdirSync(path.join(jsonDir, "flows"))
      .filter((n) => n.endsWith(".json") && n !== "index.json")
      .map((n) => n.replace(/\.json$/, ""))
      .sort()[0] ?? null;

  let inferredProgram = null;
  for (const p of sorted) {
    const detPath = path.join(detDir, `${p.pe_bli}.json`);
    if (!fs.existsSync(detPath)) continue;
    let doc;
    try {
      doc = readJson(detPath);
    } catch {
      continue;
    }
    if (!inferredProgram) {
      const rail = doc?.lineage?.rail;
      const entries = [
        ...(rail?.predecessors ?? []),
        ...(rail?.successors ?? []),
      ];
      if (entries.some((e) => e?.confidence === "inferred")) {
        inferredProgram = p.pe_bli;
        break;
      }
    }
  }

  const districtCode =
    fs
      .readdirSync(path.join(jsonDir, "districts"))
      .filter((n) => n.endsWith(".json") && n !== "index.json")
      .map((n) => n.replace(/\.json$/, ""))
      .sort()[0] ?? "AK-00";

  return {
    // Any program page carries the trajectory charts; the flow program
    // carries three, which is the widest case.
    chartProgram: flowProgram ?? sorted[0]?.pe_bli,
    inferredProgram,
    districtCode,
  };
}

/**
 * In-page audit of every [data-chart] figure. Runs in the browser so the
 * accessible name and the table's visibility are the ones the reader gets.
 */
function auditCharts() {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll("[data-chart]")].map((fig) => {
    const svg = fig.querySelector('svg[role="img"], svg[role="group"]');
    let name = svg?.getAttribute("aria-label") ?? "";
    const labelledby = svg?.getAttribute("aria-labelledby");
    if (!name && labelledby) {
      name = document.getElementById(labelledby)?.textContent ?? "";
    }
    const desc = fig.querySelector("[data-chart-desc]");
    const table = fig.querySelector("table[data-chart-table]");
    const details = table?.closest("details") ?? null;
    const summary = details?.querySelector("summary") ?? null;
    return {
      id: fig.getAttribute("data-chart"),
      name: name.replace(/\s+/g, " ").trim(),
      hasSvg: Boolean(svg),
      descText: (desc?.textContent ?? "").replace(/\s+/g, " ").trim(),
      descVisible: visible(desc),
      hasTable: Boolean(table),
      captionText: (table?.querySelector("caption")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      amounts: table ? table.querySelectorAll("[data-amount]").length : 0,
      rows: table ? table.querySelectorAll("tbody tr").length : 0,
      tableVisible: visible(table),
      insideDetails: Boolean(details),
      detailsOpen: details ? details.open : null,
      summaryText: (summary?.textContent ?? "").replace(/\s+/g, " ").trim(),
      summaryFocusable: summary
        ? summary.tabIndex >= 0 || summary.tagName === "SUMMARY"
        : false,
    };
  });
}

/** Open every chart table on the page via the keyboard, then report layout. */
function openAllChartTables() {
  const opened = [];
  for (const fig of document.querySelectorAll("[data-chart]")) {
    const table = fig.querySelector("table[data-chart-table]");
    const details = table?.closest("details");
    if (!details || details.open) continue;
    const summary = details.querySelector("summary");
    if (!summary) continue;
    summary.focus();
    const focused = document.activeElement === summary;
    summary.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // Chromium's default <summary> action fires on click for Enter; dispatch
    // it the way the UA does so the check measures the real affordance.
    if (!details.open) summary.click();
    opened.push({
      id: fig.getAttribute("data-chart"),
      focused,
      open: details.open,
      tableVisible: table.getBoundingClientRect().height > 0,
    });
  }
  const de = document.documentElement;
  return {
    opened,
    overflowPx: de.scrollWidth - de.clientWidth,
    innerWidth: window.innerWidth,
  };
}

/** Composited colour probe — the same technique as the P1-1 underline leg. */
function auditNoteRegisters() {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  function parseColor(str) {
    const m = (str || "").match(
      /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\s*\)/,
    );
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    if (!str || !ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = str;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  function composite(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  }
  function effectiveBackground(el, skipSelf) {
    const layers = [];
    for (let n = skipSelf ? el.parentElement : el; n; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = composite(layers[i], bg);
    return bg;
  }
  return [...document.querySelectorAll("[data-note-kind]")].map((el) => {
    const cs = getComputedStyle(el);
    const under = effectiveBackground(el, true);
    const own = parseColor(cs.backgroundColor);
    const bg = own && own.a < 1 ? composite(own, under) : (own ?? under);
    const bc = parseColor(cs.borderTopColor);
    const border = bc && bc.a < 1 ? composite(bc, bg) : (bc ?? bg);
    return {
      kind: el.getAttribute("data-note-kind"),
      role: el.getAttribute("role"),
      bg: [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)],
      border: [Math.round(border.r), Math.round(border.g), Math.round(border.b)],
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
    };
  });
}

const warmth = (c) => c[0] - c[2];
const distance = (a, b) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * The legs. Callable with the a11y gate's own browser context.
 */
export async function runChartLegs(context, baseUrl, errors, notes) {
  const { chartProgram, inferredProgram, districtCode } = computeChartSamples();

  // ── (c1)/(c2) charts ──────────────────────────────────────────────────────
  const chartPages = [
    {
      label: `/program/${chartProgram}/`,
      url: `${baseUrl}/program/${chartProgram}/`,
      minCharts: 2,
      ready: null,
    },
    {
      label: "/flow/",
      url: `${baseUrl}/flow/`,
      minCharts: 2,
      ready: '[data-testid="flow-chart"]',
    },
    {
      // ROADMAP #29(c). This page's diagram deliberately carries NO figures —
      // no lineage edge states an amount — so its table view is not a
      // supplement to the chart, it is the only place money appears at all.
      // (c1) is therefore load-bearing here in a way it is nowhere else: if
      // the disclosure does not open, the page has no numbers. (c2) is the
      // /flow/ lesson applied before it can repeat — that table shipped with
      // its AMOUNT column pushed out of its own scroll box at 390.
      label: "/lineage/",
      url: `${baseUrl}/lineage/`,
      minCharts: 2,
      ready: "[data-lineage-flow]",
    },
  ];

  for (const pg of chartPages) {
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(pg.url, { waitUntil: "networkidle", timeout: 45000 });
      if (pg.ready) {
        await page.waitForSelector(pg.ready, { timeout: 30000 });
        await page.waitForTimeout(400);
      }
      const charts = await page.evaluate(auditCharts);
      if (charts.length < pg.minCharts) {
        errors.push(
          `P2-3 charts (${pg.label}): ${charts.length} [data-chart] figure(s), expected ≥${pg.minCharts} — the leg is vacuous or the charts stopped rendering`,
        );
      }
      for (const c of charts) {
        const at = `${pg.label} [data-chart="${c.id}"]`;
        if (!c.hasSvg) errors.push(`P2-3 charts (${at}): no svg[role="img"|"group"] inside the figure`);
        if (c.name.length < 10)
          errors.push(`P2-3 charts (${at}): accessible name is "${c.name}" — too short to name the chart`);
        if (c.descText.length < 60)
          errors.push(
            `P2-3 charts (${at}): description is ${c.descText.length} chars — "${c.descText.slice(0, 60)}"`,
          );
        if (!c.descVisible)
          errors.push(`P2-3 charts (${at}): the description has no layout box — it is not shown to sighted readers`);
        if (!c.hasTable) {
          errors.push(`P2-3 charts (${at}): no table[data-chart-table] — the chart has no table view`);
          continue;
        }
        if (c.captionText === "")
          errors.push(`P2-3 charts (${at}): table view has an empty <caption>`);
        if (c.amounts === 0)
          errors.push(`P2-3 charts (${at}): table view carries no [data-amount] — no citation affordance`);
        if (c.rows === 0)
          errors.push(`P2-3 charts (${at}): table view has zero body rows`);
        if (!c.tableVisible && !c.insideDetails)
          errors.push(
            `P2-3 charts (${at}): table view is hidden with no disclosure control — an ARIA-only table is not a table view`,
          );
        if (c.insideDetails && !c.summaryFocusable)
          errors.push(`P2-3 charts (${at}): the table's disclosure control is not keyboard focusable`);
        if (c.insideDetails && c.summaryText === "")
          errors.push(`P2-3 charts (${at}): the table's disclosure control has no label`);
      }
      if (charts.length > 0) {
        notes.push(
          `P2-3 charts (${pg.label}): ${charts.length} chart(s) named + described + table-backed — ${charts
            .map((c) => `${c.id}(${c.rows}r/${c.amounts}$)`)
            .join(", ")} ✓`,
        );
      }

      // (c2) every table open at 390 — the page must still not scroll sideways
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      const mob = await page.evaluate(openAllChartTables);
      for (const o of mob.opened) {
        if (!o.focused)
          errors.push(`P2-3 keyboard (${pg.label} ${o.id}): the table's <summary> could not take focus`);
        if (!o.open || !o.tableVisible)
          errors.push(`P2-3 keyboard (${pg.label} ${o.id}): Enter on the focused control did not reveal the table`);
      }
      if (mob.overflowPx > 1) {
        errors.push(
          `P2-3 mobile (${pg.label}): with every chart table open at 390px the document scrolls ${mob.overflowPx}px sideways — the table must scroll inside its own container, not the page`,
        );
      } else {
        notes.push(
          `P2-3 mobile (${pg.label}): ${mob.opened.length} table(s) opened by keyboard at 390px, 0px page overflow ✓`,
        );
      }
    } catch (e) {
      errors.push(`P2-3 charts (${pg.label}): ${e.message}`);
    } finally {
      await page.close();
    }
  }

  // ── (n1) note registers ───────────────────────────────────────────────────
  const notePages = [
    { label: `/district/${districtCode}/`, url: `${baseUrl}/district/${districtCode}/` },
    { label: "/about/", url: `${baseUrl}/about/` },
  ];
  if (inferredProgram) {
    notePages.push({
      label: `/program/${inferredProgram}/`,
      url: `${baseUrl}/program/${inferredProgram}/`,
    });
  }

  const scope = [];
  const caution = [];
  for (const pg of notePages) {
    const page = await context.newPage();
    try {
      await page.goto(pg.url, { waitUntil: "networkidle", timeout: 45000 });
      const found = await page.evaluate(auditNoteRegisters);
      for (const n of found) {
        (n.kind === "scope" ? scope : caution).push({ ...n, page: pg.label });
      }
    } catch (e) {
      errors.push(`P2-6 registers (${pg.label}): ${e.message}`);
    } finally {
      await page.close();
    }
  }

  if (scope.length === 0 || caution.length === 0) {
    errors.push(
      `P2-6 registers: found ${scope.length} scope and ${caution.length} caution note(s) across ${notePages
        .map((p) => p.label)
        .join(", ")} — both registers must render for the distinction to exist`,
    );
    return;
  }

  for (const s of scope) {
    if (warmth(s.border) > SCOPE_WARMTH_MAX) {
      errors.push(
        `P2-6 registers (${s.page}): a SCOPE note borders rgb(${s.border.join(",")}) — warmth ${warmth(s.border)} > ${SCOPE_WARMTH_MAX}, i.e. still in the amber caution family. Scope disclosure is a credibility asset, not a warning. ("${s.text}")`,
      );
    }
  }
  for (const c of caution) {
    if (warmth(c.border) < CAUTION_WARMTH_MIN) {
      errors.push(
        `P2-6 registers (${c.page}): a CAUTION note borders rgb(${c.border.join(",")}) — warmth ${warmth(c.border)} < ${CAUTION_WARMTH_MIN}, it no longer reads as an alert ("${c.text}")`,
      );
    }
    if (c.role !== "note") {
      errors.push(`P2-6 registers (${c.page}): caution note has role="${c.role}" — expected role="note"`);
    }
  }
  const worstBg = Math.min(
    ...scope.flatMap((s) => caution.map((c) => distance(s.bg, c.bg))),
  );
  if (worstBg < BG_DISTANCE_MIN) {
    errors.push(
      `P2-6 registers: the closest scope/caution background pair differs by ${worstBg} (min ${BG_DISTANCE_MIN}) — the two registers are not visually distinguishable`,
    );
  } else {
    notes.push(
      `P2-6 registers: ${scope.length} scope (border warmth ≤ ${Math.max(
        ...scope.map((s) => warmth(s.border)),
      )}) vs ${caution.length} caution (≥ ${Math.min(
        ...caution.map((c) => warmth(c.border)),
      )}), backgrounds ≥ ${worstBg} apart ✓`,
    );
  }
}
