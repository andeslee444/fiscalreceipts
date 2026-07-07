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

  return { pass: errors.length === 0, errors, notes };
}
