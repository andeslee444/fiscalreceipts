/**
 * gate 21 — program_skeleton_gate (Phase 5F §2d)
 *
 * Every program page — full tier AND rollup tier — renders the SAME ordered
 * section skeleton. Sampled pages from both tiers are checked for:
 *
 * (a) All 12 [data-section] markers present in the canonical order
 *     (independent copy of src/components/program-section.tsx
 *     PROGRAM_SECTIONS — a drift between the two is a real failure).
 * (b) Every [data-section-empty] element carries a non-trivial explanation
 *     (≥ 40 chars — the quiet line must say WHY the section is empty).
 * (c) Rollup pages carry the honest service-J-book note:
 *     [data-coverage="service-books"] whose text names the page's service
 *     (recomputed from the sidecar's service_org) and whose 'roadmap' word
 *     links to /methodology/#coverage-service-books.
 * (d) Full-tier pages with project detail rows expose #project-{n} anchors
 *     (§2a "PE X, Project Y" reference targets).
 * (e) noindex policy: every zero-content page (recomputed predicate: no
 *     details/narratives/awards/mentions and all figures zero) carries
 *     <meta name="robots" content~="noindex">; sampled content pages do NOT.
 * (f) WHAT-IT-IS card is not a template stub (PM Sprint 2, §P1-2) — see
 *     leg f's own block at the bottom of this file.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const jsonDir = path.resolve(siteRoot, "..", "data", "site", "json");

// Independent copy of PROGRAM_SECTIONS (src/components/program-section.tsx).
const CANONICAL_SECTIONS = [
  "answer-strip",
  "figures",
  "trajectory",
  "lineage",
  "description",
  "justification",
  "line-items",
  "follow-dollar",
  "awards",
  "lobbying",
  "oversight",
  "dossier",
  "sources",
];

const SAMPLE_PER_TIER = 8;
const MIN_EMPTY_EXPLANATION_CHARS = 40;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function pageHtmlPath(slug) {
  return path.join(outDir, "program", slug, "index.html");
}

function serviceName(code) {
  return { A: "Army", N: "Navy", F: "Air Force" }[code] ?? (code || "service");
}

/** Independent recompute of the zero-content noindex predicate
 *  (src/lib/program-tier.ts isZeroContentDetails). */
function isZeroContent(d) {
  if (
    (d.details ?? []).length > 0 ||
    (d.narratives ?? []).length > 0 ||
    (d.awards ?? []).length > 0 ||
    (d.mentions ?? []).length > 0
  ) {
    return false;
  }
  const figures = (d.budget_lines ?? []).map((bl) => bl.amount_thousands);
  const t = d.trajectory;
  if (t) {
    for (const v of [t.fy2024_actuals, t.fy2025_total, t.fy2026_total]) {
      if (v !== null && v !== undefined) figures.push(v);
    }
  }
  return figures.every((v) => v === 0);
}

/** First + last N/2 of a sorted list (spread across the alphabet). */
function spreadSample(slugs, n) {
  if (slugs.length <= n) return [...slugs];
  const head = slugs.slice(0, Math.ceil(n / 2));
  const tail = slugs.slice(-Math.floor(n / 2));
  return [...new Set([...head, ...tail])];
}

export async function runProgramSkeletonGate() {
  const errors = [];
  const notes = [];

  const detailsDir = path.join(jsonDir, "program_details");
  if (!fs.existsSync(detailsDir)) {
    errors.push("program-skeleton: data/site/json/program_details missing");
    return { pass: false, errors, notes };
  }
  if (!fs.existsSync(path.join(outDir, "program"))) {
    notes.push("out/program/ not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── Classify sidecars by tier + zero-content ─────────────────────────────
  const fullSlugs = [];
  const rollupSlugs = [];
  const zeroContentSlugs = [];
  const sidecars = new Map();
  for (const f of fs.readdirSync(detailsDir).filter((x) => x.endsWith(".json")).sort()) {
    const slug = f.replace(/\.json$/, "");
    let d;
    try {
      d = readJson(path.join(detailsDir, f));
    } catch {
      errors.push(`program-skeleton: unreadable sidecar ${f}`);
      continue;
    }
    sidecars.set(slug, d);
    (d.tier === "rollup" ? rollupSlugs : fullSlugs).push(slug);
    if (isZeroContent(d)) zeroContentSlugs.push(slug);
  }
  notes.push(
    `universe: ${fullSlugs.length} full + ${rollupSlugs.length} rollup pages, ` +
      `${zeroContentSlugs.length} zero-content (noindex)`
  );

  const sample = [
    ...spreadSample(fullSlugs, SAMPLE_PER_TIER),
    ...spreadSample(rollupSlugs, SAMPLE_PER_TIER),
  ];

  // ── (a)+(b)+(c)+(d) per sampled page ─────────────────────────────────────
  let pagesOk = 0;
  for (const slug of sample) {
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) {
      errors.push(`program-skeleton: sampled page /program/${slug}/ not built`);
      continue;
    }
    const root = parse(fs.readFileSync(p, "utf8"), { comment: false });
    const d = sidecars.get(slug);
    const tier = d.tier === "rollup" ? "rollup" : "full";
    let pageOk = true;

    // (a) canonical section order
    const sections = root
      .querySelectorAll("[data-section]")
      .map((el) => el.getAttribute("data-section"));
    if (JSON.stringify(sections) !== JSON.stringify(CANONICAL_SECTIONS)) {
      pageOk = false;
      const missing = CANONICAL_SECTIONS.filter((s) => !sections.includes(s));
      errors.push(
        `program-skeleton(a): /program/${slug}/ (${tier}) sections != canonical order — ` +
          `got [${sections.join(", ")}]${missing.length ? `; missing: ${missing.join(", ")}` : ""}`
      );
    }

    // (b) empty states carry explanations
    for (const emptyEl of root.querySelectorAll("[data-section-empty]")) {
      const text = (emptyEl.text ?? "").trim();
      if (text.length < MIN_EMPTY_EXPLANATION_CHARS) {
        pageOk = false;
        errors.push(
          `program-skeleton(b): /program/${slug}/ empty state without explanation: "${text.slice(0, 60)}"`
        );
      }
    }

    // (c) rollup honesty note
    if (tier === "rollup") {
      const note = root.querySelector('[data-coverage="service-books"]');
      if (!note) {
        pageOk = false;
        errors.push(
          `program-skeleton(c): /program/${slug}/ (rollup) missing [data-coverage="service-books"] note`
        );
      } else {
        const svc = serviceName(d.service_org ?? "");
        const text = note.text ?? "";
        // The note must name the service and its J-book, in one of two honest
        // wordings (Phase 5G): the UNINGESTED wording ("…lives in the {svc}
        // J-book, which is not yet ingested…") OR the INGESTED wording ("The
        // {svc} FY2026 J-books are ingested, but this program element carries
        // no R-2/P-40 narrative…"). Army 'A', Navy 'N', and Air Force / Space
        // Force 'F' now render the ingested wording; other org codes keep the
        // uningested wording. Accept either, but require the service name + the
        // phrase "J-book" so the note is never generic.
        const namesUningested = text.includes(`lives in the ${svc} J-book`);
        const namesIngested =
          text.includes(`The ${svc} FY2026 J-book`) &&
          text.includes("no R-2/P-40 narrative");
        if (!namesUningested && !namesIngested) {
          pageOk = false;
          errors.push(
            `program-skeleton(c): /program/${slug}/ note does not name the ${svc} J-book (got: "${text.slice(0, 100)}")`
          );
        }
        const roadmapLink = note
          .querySelectorAll("a[href]")
          .find(
            (a) =>
              (a.getAttribute("href") ?? "").includes("/methodology/#coverage-service-books") &&
              (a.text ?? "").trim() === "roadmap"
          );
        if (!roadmapLink) {
          pageOk = false;
          errors.push(
            `program-skeleton(c): /program/${slug}/ note's 'roadmap' word is not linked to /methodology/#coverage-service-books`
          );
        }
      }
    }

    // (d) project anchors on full-tier pages with project rows
    if (tier === "full") {
      const firstProject = (d.details ?? []).find((r) => r.project_number);
      if (firstProject) {
        const anchorId = `project-${String(firstProject.project_number).replace(/[^A-Za-z0-9-]/g, "_")}`;
        if (!root.querySelector(`[id="${anchorId}"]`)) {
          pageOk = false;
          errors.push(
            `program-skeleton(d): /program/${slug}/ missing project anchor #${anchorId}`
          );
        }
      }
    }

    if (pageOk) pagesOk++;
  }
  notes.push(`sampled ${sample.length} pages (${SAMPLE_PER_TIER}/tier target): ${pagesOk} fully conformant`);

  // ── (e) noindex policy ────────────────────────────────────────────────────
  const hasNoindex = (root) =>
    root
      .querySelectorAll('meta[name="robots"]')
      .some((m) => (m.getAttribute("content") ?? "").includes("noindex"));

  for (const slug of zeroContentSlugs) {
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) {
      errors.push(`program-skeleton(e): zero-content page /program/${slug}/ not built`);
      continue;
    }
    const root = parse(fs.readFileSync(p, "utf8"), { comment: false });
    if (!hasNoindex(root)) {
      errors.push(
        `program-skeleton(e): zero-content page /program/${slug}/ is missing robots noindex`
      );
    }
  }
  // Sampled content pages must NOT be noindexed.
  for (const slug of sample.filter((s) => !zeroContentSlugs.includes(s)).slice(0, 6)) {
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) continue;
    const root = parse(fs.readFileSync(p, "utf8"), { comment: false });
    if (hasNoindex(root)) {
      errors.push(
        `program-skeleton(e): content page /program/${slug}/ is wrongly noindexed`
      );
    }
  }
  notes.push(
    `noindex: ${zeroContentSlugs.length} zero-content page(s) checked` +
      (zeroContentSlugs.length ? ` (${zeroContentSlugs.join(", ")})` : "")
  );

  // ── (f) WHAT-IT-IS card is not a template stub (§P1-2) ────────────────────
  runWhatItIsLeg({ errors, notes });

  return { pass: errors.length === 0, errors, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// leg f — the WHAT-IT-IS card speaks from a real source (§P1-2)
// ═══════════════════════════════════════════════════════════════════════════
//
// The defect: /program/ATA000/ — the largest program in the corpus — opened
// with "F-35 – a procurement program run by Air Force." while a genuinely
// good, fact-cited sentence sat ~3,000px below in its dossier.
//
// The contract this leg enforces, on the BUILT artifact, for EVERY program
// that ships a gated dossier (all 50 — the population is small enough to
// check exhaustively, and these are the site's showcase pages):
//
//   1. [data-testid="answer-what"] exists and declares
//      data-what-source="dossier" — the card knows which tier it spoke from.
//   2. Its text CONTAINS the dossier's own first what_it_is claim, verbatim
//      (read here from data/site/json/dossiers/{pe}.json, not from the page).
//      Verbatim is the point: a paraphrase is a new uncited claim.
//   3. Every hoisted claim carries a citation anchor whose fact_id RESOLVES
//      (checked against the page's own embedded citation slice — the same
//      payload the runtime panel reads, so a chip that would 404 at runtime
//      fails here).
//   4. The card does NOT match the template-stub shape
//      ("{name} — a {family} program run by {org}."). Belt and braces with
//      (2): if the hoist silently regressed to the template AND the dossier
//      sentence happened to be a substring, this still fails.
//
// It also spot-checks the non-dossier tiers on the sampled pages: a full-tier
// card must be field-sourced and name something beyond name-plus-org; a
// rollup card must carry its honest summary-figures tail.
//
// Reads rendered text, never a data-* mirror of the sentence — a page that
// rendered the stub could not satisfy this by also emitting a correct
// attribute.

/** The stub shape the card must never render again. */
const TEMPLATE_STUB_RE = /—\s*an?\s+[^.]{1,40}\s+program run by\s+/i;

/** fact_ids embedded in the page's own citation slice (the runtime payload). */
function pageCitationFactIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\\?"([0-9a-f]{16})\\?"\s*:\s*\{/g)) {
    ids.add(m[1]);
  }
  return ids;
}

function runWhatItIsLeg({ errors, notes }) {
  const dossierDir = path.join(jsonDir, "dossiers");
  if (!fs.existsSync(dossierDir)) {
    errors.push(
      "program-skeleton(f): data/site/json/dossiers/ missing — the §P1-2 hoist source is gone"
    );
    return;
  }
  const dossierFiles = fs
    .readdirSync(dossierDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (dossierFiles.length === 0) {
    errors.push("program-skeleton(f): no dossiers on disk — leg f would be vacuous");
    return;
  }

  let checked = 0;
  for (const file of dossierFiles) {
    const slug = file.replace(/\.json$/, "");
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) {
      errors.push(`program-skeleton(f): dossier page /program/${slug}/ not built`);
      continue;
    }
    let dossier;
    try {
      dossier = readJson(path.join(dossierDir, file));
    } catch {
      errors.push(`program-skeleton(f): unreadable dossier ${file}`);
      continue;
    }
    const claims = dossier?.dossier?.what_it_is?.claims ?? [];
    if (claims.length === 0) continue; // no what_it_is → the card falls back by design

    const html = fs.readFileSync(p, "utf8");
    const root = parse(html, { comment: false });
    const card = root.querySelector('[data-testid="answer-what"]');
    if (!card) {
      errors.push(
        `program-skeleton(f): /program/${slug}/ has no [data-testid="answer-what"] card`
      );
      continue;
    }

    // 1. tier declaration
    const marker = card.querySelector("[data-what-source]");
    const source = marker?.getAttribute("data-what-source") ?? null;
    if (source !== "dossier") {
      errors.push(
        `program-skeleton(f): /program/${slug}/ WHAT-IT-IS is data-what-source=${JSON.stringify(source)} — ` +
          `a program with a gated dossier must hoist it (§P1-2)`
      );
      continue;
    }

    // 2. the dossier's own first sentence, verbatim
    const cardText = (card.text ?? "").replace(/\s+/g, " ").trim();
    const wanted = String(claims[0].text).replace(/\s+/g, " ").trim();
    if (!cardText.includes(wanted)) {
      errors.push(
        `program-skeleton(f): /program/${slug}/ WHAT-IT-IS does not contain the dossier's ` +
          `first sentence verbatim — wanted "${wanted.slice(0, 70)}…", got "${cardText.slice(0, 90)}…"`
      );
    }

    // 3. every hoisted claim's citation resolves in the page's own slice
    const sliceIds = pageCitationFactIds(html);
    const hoisted = card.querySelectorAll("[data-what-claim]");
    if (hoisted.length === 0) {
      errors.push(
        `program-skeleton(f): /program/${slug}/ WHAT-IT-IS claims to be dossier-sourced ` +
          `but renders no [data-what-claim] element`
      );
    }
    for (const el of hoisted) {
      const fid = el.getAttribute("data-cite-fact-id");
      const url = el.getAttribute("data-cite-url");
      if (!fid && !url) {
        errors.push(
          `program-skeleton(f): /program/${slug}/ hoisted sentence carries no citation anchor`
        );
        continue;
      }
      if (fid && !sliceIds.has(fid)) {
        errors.push(
          `program-skeleton(f): /program/${slug}/ hoisted sentence cites ${fid}, which does not ` +
            `resolve in the page's embedded citation slice — the chip would dead-end at runtime`
        );
      }
    }

    // 4. never the template stub
    if (TEMPLATE_STUB_RE.test(cardText)) {
      errors.push(
        `program-skeleton(f): /program/${slug}/ WHAT-IT-IS rendered the template stub again: ` +
          `"${cardText.slice(0, 90)}…"`
      );
    }
    checked++;
  }
  notes.push(`leg f: ${checked}/${dossierFiles.length} dossier cards hoist their own cited prose ✓`);

  // ── the other two tiers, on the sampled pages ────────────────────────────
  const detailsDir = path.join(jsonDir, "program_details");
  const dossierSlugs = new Set(dossierFiles.map((f) => f.replace(/\.json$/, "")));
  const allSlugs = fs
    .readdirSync(detailsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  const fullNoDossier = [];
  const rollups = [];
  for (const slug of allSlugs) {
    if (dossierSlugs.has(slug)) continue;
    let d;
    try {
      d = readJson(path.join(detailsDir, `${slug}.json`));
    } catch {
      continue;
    }
    (d.tier === "rollup" ? rollups : fullNoDossier).push(slug);
  }

  for (const [slugs, wantSource, label] of [
    [spreadSample(fullNoDossier, 6), "fields", "full-tier (no dossier)"],
    [spreadSample(rollups, 6), "rollup", "rollup-tier"],
  ]) {
    for (const slug of slugs) {
      const p = pageHtmlPath(slug);
      if (!fs.existsSync(p)) continue;
      const root = parse(fs.readFileSync(p, "utf8"), { comment: false });
      const card = root.querySelector('[data-testid="answer-what"]');
      if (!card) {
        errors.push(`program-skeleton(f): /program/${slug}/ has no WHAT-IT-IS card`);
        continue;
      }
      const source =
        card.querySelector("[data-what-source]")?.getAttribute("data-what-source") ?? null;
      if (source !== wantSource) {
        errors.push(
          `program-skeleton(f): /program/${slug}/ (${label}) WHAT-IT-IS is ` +
            `data-what-source=${JSON.stringify(source)}, expected "${wantSource}"`
        );
        continue;
      }
      const text = (card.text ?? "").replace(/\s+/g, " ").trim();
      if (TEMPLATE_STUB_RE.test(text)) {
        errors.push(
          `program-skeleton(f): /program/${slug}/ (${label}) rendered the template stub: "${text.slice(0, 90)}…"`
        );
      }
      if (wantSource === "rollup" && !text.includes("Summary figures only")) {
        errors.push(
          `program-skeleton(f): /program/${slug}/ (rollup) WHAT-IT-IS lost its honest tail ` +
            `("Summary figures only: …") — got "${text.slice(0, 90)}…"`
        );
      }
    }
  }
  notes.push(
    `leg f: sampled ${Math.min(6, fullNoDossier.length)} field-sourced + ` +
      `${Math.min(6, rollups.length)} rollup cards ✓`
  );
}
