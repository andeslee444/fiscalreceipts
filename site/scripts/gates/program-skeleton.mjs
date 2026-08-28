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
 * (g) A program element that PB2026 stopped requesting money for must not
 *     end silently: it carries the [data-fy2026-absent] note, and no other
 *     page does (ROADMAP #32a) — see leg g's own block at the bottom.
 * (h) A GAO program-level finding renders only where a human ratified the
 *     crosswalk, quotes GAO verbatim, cites its own report, and sits above
 *     the department note; every other page states the absence (ROADMAP #30)
 *     — see leg h's own block at the bottom.
 * (i) The organization a program page names is an org CODE, and the three
 *     things that key off it actually happen: the header's own "Organization
 *     code {X}" claim is true, X links to its agency page when one exists,
 *     and the GAO department note renders exactly where the overlay payload
 *     has one — see leg i's own block at the bottom.
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

  // ── (g) the PB2026 renumber note (ROADMAP #32a) ───────────────────────────
  runFy2026AbsentLeg({ errors, notes, sidecars });

  // ── (h) the GAO program tier (ROADMAP #30) ────────────────────────────────
  runGaoProgramLeg({ errors, notes, sidecars });

  // ── (i) the org a page names is an org CODE (#30's cause) ─────────────────
  runOrgCodeLeg({ errors, notes, sidecars });

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

// ═══════════════════════════════════════════════════════════════════════════
// leg g — a program element PB2026 stopped requesting must not end silently
// ═══════════════════════════════════════════════════════════════════════════
//
// The defect (ROADMAP #32a, surfaced by PM Sprint 3 Task 1b). PB2026
// renumbered program elements at scale. Counting pages whose PB2026 R-1/P-1
// workbook rows carry FY2024/FY2025 money and NO FY2026 row at all: Army
// 113, Air Force 77, Navy 69, OSD 18, DARPA 14, and 28 across the smaller
// components — 319 pages. A reader who followed /program/0601101E/ (Defense
// Research Sciences) for a decade hit a page whose figures stopped at FY2025
// and said nothing about why.
//
// This is NOT an ingestion gap: data/raw_docs/fy2026/dod/r1_display.xlsx
// shows the FY2026 cells for those lines genuinely blank, and the new PB2026
// lines genuinely carry no FY2024/FY2025 history. The parser is right; the
// MODEL has no way to say "renumbered". Successor edges are #32b (folded
// into backlog #29) — they do not exist yet, and this leg exists partly to
// make sure nobody ships a guess at one in the meantime.
//
// What this leg pins, on the BUILT artifact, for the WHOLE page universe
// (2,016 pages — one read pass, no sampling; the negative direction is the
// half a sample would miss):
//
//   1. The exporter's flag agrees with an INDEPENDENT recompute of the
//      predicate from the sidecar's own workbook rows, on every page, both
//      directions and including last_fy. Same convention as CANONICAL_SECTIONS
//      above: a drift between the two implementations is a real failure.
//   2. Every page in the population renders [data-fy2026-absent].
//   3. NO page outside it does. A note that appears on a page still funded in
//      FY2026 is a false claim about that page's money, which is worse than
//      the silence it was written to fix.
//   4. The note says all four things it must say, verbatim: that there is no
//      FY2026 request; where the record actually stops (and that year must
//      MATCH the recomputed last_fy — the note may not name a year the
//      workbook does not support); that PB2026 renumbered at scale; and that
//      the page names no successor.
//   5. The note never claims the program ended. "zeroed", "cancelled",
//      "terminated", "defunded" are exactly the words the 87 withdrawn feed
//      cards used, and absence in one edition supports none of them.
//   6. The note names no OTHER program element. Naming a successor the corpus
//      cannot prove would be a fabricated citation — the defect species
//      ROADMAP #53 and #69 closed. Until #32b ships there is nothing to name,
//      and this is the check that says so mechanically.

/** Non-vacuity floor: the shipped PB2026 corpus holds exactly 319 such pages
 *  (measured 2026-08-26; 160 last funded FY2024, 159 FY2025). A drop means
 *  either the predicate broke or the corpus changed — RE-MEASURE and re-derive
 *  this number, never lower it to whatever the build produced.
 *
 *  Not the "165" in ROADMAP #32's 2026-08-07 correction: that figure counts
 *  pe_blis with FY2025 money and no FY2026 row across ALL editions, while the
 *  note is a claim about ONE edition and is rendered per PAGE. Fenced to
 *  PB2026 and counted per page, FY2025-only is 159 and FY2024-or-FY2025 — the
 *  entry's own definition, the one that reproduces its per-service figures —
 *  is 319. */
// 319 -> 316 on 2026-08-27. NOT a relaxation: three pages
// (0603669D8Z, 0602669D8Z, 0604669D8Z -- Microelectronics Commons) were
// removed from the population because they publish POSITIVE cited FY2026
// money and must never carry an absence note. The floor tracks the true
// population; lowering it here is the fix landing, not the bar moving.
const MIN_FY2026_ABSENT_PAGES = 316;

/** The stable hook the page must carry. */
const FY2026_ABSENT_ATTR = "data-fy2026-absent";

/** Every sentence the note must actually say (whitespace-normalized).
 *
 * Retargeted 2026-08-27 to the corrected wording. NOT a relaxation -- the
 * properties pinned are the same or stronger:
 *
 *  - the headline now names the record that is actually blank
 *    ("R-1/P-1 request line"), because the old "No FY2026 request" was
 *    false on three pages publishing cited FY2026 J-book money;
 *  - the renumber sentence is unchanged;
 *  - the successor sentence moved OUT of this list because it is now
 *    conditional, and is checked per-page below against the lineage rail
 *    instead. Pinning it unconditionally here is what forced the note to
 *    deny a successor on five pages that named one with a citation.
 */
const FY2026_ABSENT_REQUIRED = [
  "No FY2026 R-1/P-1 request line for this program element.",
  "PB2026 renumbered program elements at scale",
];

/** The successor clause, which must match the page's own lineage rail. */
const FY2026_SUCCESSOR_DENIAL =
  "No ingested budget document in this corpus states a successor for this line.";
const FY2026_SUCCESSOR_POINTER =
  "Where this line's funding went is recorded under Program Lineage below.";

/** Words that would turn an absence into a claim the corpus cannot support. */
const FY2026_ABSENT_FORBIDDEN =
  /\b(zeroed|defunded|cancell?ed|cancellation|terminat(ed|ion))\b/i;

/** Candidate program-element token in the note's prose. Not a shape guess —
 *  every match is looked up in the page universe (the sidecar slugs) so
 *  "FY2026" and "PB2026" are not mistaken for codes and "ATA000", "HCMC00",
 *  "1203154SF" are not missed. Used ONLY to prove the note names no
 *  successor. */
const PE_TOKEN_RE = /\b[A-Z0-9][A-Z0-9]{4,}\b/g;

/**
 * Independent recompute of the exporter's predicate
 * (src/govbudget/export_site.py, _fy2026_absent_block).
 *
 * Reads the sidecar's `budget_lines` — the PB2026 R-1/P-1 workbook rows this
 * very page renders in its Budget Line Items table, already scoped to the
 * page's own account/organization grain for the split keys. So "no FY2026
 * row" here means exactly what the primary source shows: blank cells on this
 * line, in this edition.
 *
 * Returns {last_fy} or null.
 */
function recomputeFy2026Absent(d) {
  const rows = d.budget_lines ?? [];
  if (rows.some((r) => r.fy === 2026)) return null;
  const prior = rows
    .filter(
      (r) => (r.fy === 2024 || r.fy === 2025) && Number(r.amount_thousands) > 0,
    )
    .map((r) => r.fy);
  if (prior.length === 0) return null;

  // WIDENED 2026-08-27 after two independent reviews found the note false
  // on 179 of the 319 pages it rendered on. This function previously read
  // ONLY budget_lines -- the same workbook-only predicate the exporter
  // used -- so it mirrored the exporter's blind spot instead of checking
  // it. Two implementations of one wrong scope agreeing is not
  // corroboration, and that is exactly why leg (g) passed on every page
  // the reviewers flagged.
  //
  // The page's OWN J-book detail rows are the record the note was
  // contradicting, so they are now part of the predicate.
  const fy26Details = (d.details ?? []).filter((r) => r.fy === 2026);
  // Positive J-book money => the page publishes an FY2026 request, so no
  // note may render. /program/0603669D8Z/ and its two Microelectronics
  // Commons siblings rendered "No FY2026 request" over cited FY26 Request
  // figures of $260.7M / $79.7M / $59.6M.
  if (fy26Details.some((r) => Number(r.amount_millions) > 0)) return null;
  return {
    last_fy: Math.max(...prior),
    // A documented $0 is a record, not a silence. 173 pages carry an
    // FY2026 J-book row at exactly 0.000.
    jbook_fy2026_zero: fy26Details.length > 0,
    // 5 pages render a cited "Successors (funding flowed out)" rail while
    // the note denied any document named one.
    has_successor: Boolean(d.lineage?.rail?.successors?.length),
  };
}

function runFy2026AbsentLeg({ errors, notes, sidecars }) {
  // ── 1. exporter flag vs. independent recompute, on every sidecar ─────────
  const expected = new Map(); // slug -> {last_fy}
  let flagDrift = 0;
  for (const [slug, d] of sidecars) {
    const want = recomputeFy2026Absent(d);
    const got = d.fy2026_absent ?? null;
    if (want) expected.set(slug, want);
    if (Boolean(want) !== Boolean(got)) {
      flagDrift++;
      if (flagDrift <= 5) {
        errors.push(
          `program-skeleton(g): /program/${slug}/ sidecar fy2026_absent is ` +
            `${got ? JSON.stringify(got) : "absent"} but the gate's own recompute says ` +
            `${want ? JSON.stringify(want) : "absent"} — the exporter and the gate disagree ` +
            `about whether PB2026 still requests money for this line`,
        );
      }
    } else if (want && got && want.last_fy !== got.last_fy) {
      flagDrift++;
      if (flagDrift <= 5) {
        errors.push(
          `program-skeleton(g): /program/${slug}/ sidecar says last_fy=${got.last_fy}, ` +
            `recompute says ${want.last_fy}`,
        );
      }
    }
  }
  if (flagDrift > 5) {
    errors.push(
      `program-skeleton(g): ${flagDrift} sidecars disagree with the recompute in total ` +
        `(first 5 listed)`,
    );
  }

  if (expected.size < MIN_FY2026_ABSENT_PAGES) {
    errors.push(
      `program-skeleton(g): only ${expected.size} page(s) match the renumber predicate ` +
        `(expected >= ${MIN_FY2026_ABSENT_PAGES}) — the leg would be vacuous. Re-measure ` +
        `the population and re-derive the floor; do not lower it to fit the build`,
    );
    return;
  }

  // ── 2/3/4/5/6. one read pass over the WHOLE page universe ────────────────
  let withNote = 0;
  let missing = 0;
  let stray = 0;
  let badNotes = 0;
  const lastFyCounts = new Map();
  for (const [slug, d] of sidecars) {
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) {
      if (expected.has(slug)) {
        errors.push(`program-skeleton(g): /program/${slug}/ not built`);
      }
      continue;
    }
    const html = fs.readFileSync(p, "utf8");
    const marked = html.includes(FY2026_ABSENT_ATTR);
    const want = expected.get(slug) ?? null;

    if (!want) {
      // 3. the negative direction.
      if (marked) {
        stray++;
        if (stray <= 5) {
          // Name WHICH record contradicts the note. The original message
          // said "its PB2026 workbook DOES carry an FY2026 row" for every
          // stray, which is itself false for the case that actually
          // shipped: the Microelectronics Commons pages' workbook is
          // blank; their J-BOOK DETAIL carries the money. An error message
          // that misexplains its own finding sends the next reader to the
          // wrong file.
          // LARGEST single row, never a sum: the detail carries the same
          // money under several scenarios (BudgetYearOne and
          // BudgetYearOneBase) and at both project and rollup grain, so
          // adding them double-counts. A first cut of this message summed
          // them and reported $1042.9M where the page's largest FY26
          // Request figure is $260.7M -- an inflated number inside the
          // very diagnostic that exists to catch inflated claims.
          const fy26Pos = (d.details ?? [])
            .filter((r) => r.fy === 2026 && Number(r.amount_millions) > 0)
            .reduce((a, r) => Math.max(a, Number(r.amount_millions)), 0);
          const why = fy26Pos > 0
            ? `its PB2026 J-book detail publishes FY2026 money on this page (largest single row $${fy26Pos.toFixed(1)}M)`
            : `its PB2026 workbook DOES carry an FY2026 row`;
          errors.push(
            `program-skeleton(g): /program/${slug}/ renders the "no FY2026 request" note ` +
              `but ${why} — the note is a false claim about this page's money`,
          );
        }
      }
      continue;
    }

    // 2. the positive direction.
    if (!marked) {
      missing++;
      if (missing <= 5) {
        errors.push(
          `program-skeleton(g): /program/${slug}/ has PB2026 money through FY${want.last_fy} ` +
            `and no FY2026 workbook row, but renders no [${FY2026_ABSENT_ATTR}] note — the ` +
            `page ends silently (ROADMAP #32a)`,
        );
      }
      continue;
    }

    const root = parse(html, { comment: false });
    const el = root.querySelector(`[${FY2026_ABSENT_ATTR}]`);
    if (!el) {
      errors.push(
        `program-skeleton(g): /program/${slug}/ mentions ${FY2026_ABSENT_ATTR} but no ` +
          `element carries it`,
      );
      continue;
    }
    const text = (el.text ?? "").replace(/\s+/g, " ").trim();

    // The note comes from ONE component, so a wording regression hits all 319
    // pages at once. Report the first few and count the rest — 1,200 identical
    // lines would bury the other legs' findings.
    const say = (msg) => {
      badNotes++;
      if (badNotes <= 5) errors.push(msg);
    };

    // 4. it says all four things.
    for (const frag of FY2026_ABSENT_REQUIRED) {
      if (!text.includes(frag)) {
        say(
          `program-skeleton(g): /program/${slug}/ note is missing the required sentence ` +
            `"${frag}" — got "${text.slice(0, 140)}…"`,
        );
      }
    }
    // "in this edition" -> "workbook figure": the old phrasing claimed the
    // whole EDITION stopped at that year, contradicted on 173 pages whose
    // J-book carries an FY2026 row at zero in the same edition.
    const yearFrag = `its last workbook figure is FY${want.last_fy}`;
    if (!text.includes(yearFrag)) {
      say(
        `program-skeleton(g): /program/${slug}/ note does not say "${yearFrag}" — the ` +
          `note must name the year the workbook actually stops at, not a different one ` +
          `(got "${text.slice(0, 140)}…")`,
      );
    }
    // 4b. the documented zero must be disclosed exactly where it exists.
    const saysZero = text.includes("recorded as zero");
    if (want.jbook_fy2026_zero && !saysZero) {
      say(
        `program-skeleton(g): /program/${slug}/ has an FY2026 J-book row at zero but the ` +
          `note does not disclose it — a workbook blank and a documented zero are ` +
          `different records, and hiding the second is the 87-feed-card error`,
      );
    }
    if (!want.jbook_fy2026_zero && saysZero) {
      say(
        `program-skeleton(g): /program/${slug}/ note claims a documented FY2026 zero that ` +
          `this page's J-book detail does not carry`,
      );
    }
    // 4c. the successor clause must agree with the page's own lineage rail.
    if (want.has_successor) {
      if (text.includes(FY2026_SUCCESSOR_DENIAL)) {
        say(
          `program-skeleton(g): /program/${slug}/ note denies any document states a ` +
            `successor, but this page renders a cited successor rail — both halves of ` +
            `that sentence are false here`,
        );
      }
      if (!text.includes(FY2026_SUCCESSOR_POINTER)) {
        say(
          `program-skeleton(g): /program/${slug}/ has a successor rail but the note does ` +
            `not point the reader at it`,
        );
      }
    } else if (!text.includes(FY2026_SUCCESSOR_DENIAL)) {
      say(
        `program-skeleton(g): /program/${slug}/ has no successor rail but the note omits ` +
          `the denial — the limit must be stated, not left silent`,
      );
    }

    // 5. it never claims an ending.
    const bad = FY2026_ABSENT_FORBIDDEN.exec(text);
    if (bad) {
      say(
        `program-skeleton(g): /program/${slug}/ note says "${bad[0]}" — absence from one ` +
          `edition supports no such claim (this is the wording the 87 withdrawn feed ` +
          `cards used)`,
      );
    }

    // 6. it names no other program element. Every candidate token is checked
    // against the PAGE UNIVERSE itself, so this cannot be fooled by a code
    // shape nobody anticipated, and cannot fire on "FY2026"/"PB2026".
    const named = [...new Set(text.match(PE_TOKEN_RE) ?? [])].filter(
      (c) => c !== slug && sidecars.has(c),
    );
    if (named.length > 0) {
      say(
        `program-skeleton(g): /program/${slug}/ note names program element(s) ` +
          `${named.join(", ")} — the corpus cannot prove a successor for a renumbered ` +
          `line, so the note must not name one (#32b / backlog #29)`,
      );
    }

    withNote++;
    lastFyCounts.set(want.last_fy, (lastFyCounts.get(want.last_fy) ?? 0) + 1);
  }

  if (missing > 5) {
    errors.push(
      `program-skeleton(g): ${missing} page(s) in the renumber population render no note ` +
        `in total (first 5 listed)`,
    );
  }
  if (stray > 5) {
    errors.push(
      `program-skeleton(g): ${stray} page(s) outside the population render the note in ` +
        `total (first 5 listed)`,
    );
  }
  if (badNotes > 5) {
    errors.push(
      `program-skeleton(g): ${badNotes} note-content failure(s) in total across the ` +
        `population (first 5 listed) — one component renders all of them, so this is ` +
        `one wording regression, not ${badNotes} page defects`,
    );
  }
  const byYear = [...lastFyCounts.entries()]
    .sort()
    .map(([fy, n]) => `${n} last funded FY${fy}`)
    .join(", ");
  notes.push(
    `leg g: ${withNote}/${expected.size} renumbered-away program page(s) carry the ` +
      `"no FY2026 request" note (${byYear}); ${sidecars.size - expected.size} other ` +
      `page(s) correctly do not ✓`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// leg h — a GAO finding sits on the program it is about (ROADMAP #30)
// ═══════════════════════════════════════════════════════════════════════════
//
// The department tier ("DOD — 5 high-risk areas") is not about the program
// whose page it renders on, says so, and is de-emphasized for it. #30 added
// the tier that IS: GAO's per-program Weapon Systems Annual Assessment and
// the program-specific GAO reports that volume cites.
//
// The failure this leg exists to catch is not a formatting slip. Attributing
// a real GAO audit finding to the wrong weapons program is a defamation-
// shaped error, so the design puts a human verdict on every attribution
// (data-seeds/gao_program_xwalk.csv) and the exporter does no matching at
// all. That means this leg cannot "independently reimplement" the exporter's
// rule — there is no rule to reimplement — and it does not try. It asserts
// the CONTRACT, against the built artifact:
//
//   h1. RATIFIED <-> RENDERED, exactly. Every verdict-"y" row whose page is
//       built renders its GAO item; every rendered item traces back to a
//       verdict-"y" row. Nothing reaches a reader that a person did not
//       ratify, and nothing ratified silently stops rendering.
//   h2. The quoted assessment is VERBATIM the ingested GAO paragraph, read
//       from the sidecar, not from the page. A paraphrase would be a new
//       uncited claim about a weapons program.
//   h3. Every item's citation resolves to its own GAO product page.
//   h4. The GAO item's service agrees with the org the PAGE itself links to
//       (its /agency/{org}/ oversight link). An Air Force assessment on an
//       Army budget line is the ROADMAP #55 defect — "Sentinel" the ICBM
//       against "Sentinel Mods" the Army procurement line — and this is the
//       check that refuses it. It shares a premise with the matcher's
//       service filter, deliberately: the premise is a fact about the world,
//       and the two artifacts compared are different ones.
//   h5. CORROBORATION the matcher never consults: the GAO program's name and
//       the page's own title must share a DISTINCTIVE word — one appearing
//       in <= 0.5% of the site's program titles. Measured over the shipped
//       crosswalk, all 62 items clear it.
//   h6. The honest denial. Every program page with no ratified item must
//       still say, verbatim, that no program-specific GAO finding for that
//       line is in the ingested data — and no page may say both.
//   h7. The program tier renders ABOVE the department note, which is the
//       placement #30 asked for and the reason the department note was
//       allowed to give up its emphasis.
//
// Non-vacuity is structural rather than a pinned literal: the leg fails if
// the ratified set is empty, and the population it checks IS the ratified
// set, so a shrinking crosswalk cannot quietly stop exercising it.

const GAO_SEED = path.resolve(
  siteRoot, "..", "data-seeds", "gao_program_xwalk.csv",
);
const GAO_DENIAL =
  "No program-specific GAO finding for this line is in the ingested data.";
/** A word in <= this share of program titles is "distinctive" for h5. */
const GAO_RARE_TOKEN_SHARE = 0.005;
/** GAO service -> the org code its budget lines live under. */
const GAO_SERVICE_ORGS = {
  "Air Force": ["F"],
  "Space Force": ["F"],
  Army: ["A"],
  Navy: ["N"],
  "Marine Corps": ["N"],
};

function gaoTokens(text) {
  return String(text ?? "").toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
}

/** Minimal CSV reader for the ratified seed (quoted fields, embedded ""). */
function readCsvRows(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length === header.length).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i]])),
  );
}

function runGaoProgramLeg({ errors, notes, sidecars }) {
  const sidecarPath = path.join(jsonDir, "gao_program_findings.json");
  if (!fs.existsSync(GAO_SEED) || !fs.existsSync(sidecarPath)) {
    errors.push(
      "program-skeleton(h): missing " +
        (!fs.existsSync(GAO_SEED)
          ? "data-seeds/gao_program_xwalk.csv"
          : "gao_program_findings.json") +
        " — the program tier cannot be verified",
    );
    return;
  }

  // ── the human record ─────────────────────────────────────────────────────
  const seedRows = readCsvRows(fs.readFileSync(GAO_SEED, "utf8"));
  const ratified = new Set();
  for (const r of seedRows) {
    const verdict = (r.verdict ?? "").trim();
    if (verdict !== "y" && verdict !== "n") {
      errors.push(
        `program-skeleton(h): seed row ${r.gao_program} -> ${r.slug} carries ` +
          `verdict "${verdict}" — an unadjudicated crosswalk must not exist`,
      );
      continue;
    }
    if (verdict === "y") ratified.add(`${r.product_number} ${r.slug}`);
  }
  if (ratified.size === 0) {
    errors.push(
      "program-skeleton(h): no ratified crosswalk in the seed — the leg would " +
        "be vacuous. If the crosswalk really is empty the program tier must " +
        "not render at all; do not weaken this check to pass a build",
    );
    return;
  }

  // ── the ingested GAO text (h2's source of truth — not the page) ──────────
  const side = readJson(sidecarPath);
  const quoteFor = new Map();
  const serviceFor = new Map();
  for (const bucket of Object.values(side.by_slug ?? {})) {
    for (const a of bucket.assessments ?? []) {
      quoteFor.set(`${a.product_number} ${a.gao_program}`, a.description);
      serviceFor.set(`${a.product_number} ${a.gao_program}`, a.service);
    }
  }

  // ── corpus title statistics for h5 ───────────────────────────────────────
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const titleBySlug = new Map(programs.map((p) => [p.slug, p.title ?? ""]));
  const docFreq = new Map();
  for (const p of programs) {
    for (const t of new Set(gaoTokens(p.title))) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }
  const rareLimit = GAO_RARE_TOKEN_SHARE * programs.length;

  // ── one pass over the whole page universe ────────────────────────────────
  let rendered = 0;
  let pagesWithBlock = 0;
  let missingDenial = 0;
  let bothClaims = 0;
  const seenPairs = new Set();
  const unratified = { n: 0 };
  const badQuote = { n: 0 };
  const badCite = { n: 0 };
  const badService = { n: 0 };
  const badCorroboration = { n: 0 };
  const say = (bucket, msg) => {
    bucket.n++;
    if (bucket.n <= 5) errors.push(msg);
  };

  for (const slug of sidecars.keys()) {
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, "utf8");
    const hasBlock = html.includes('data-gao-scope="program"');
    const hasDenial = html.includes(GAO_DENIAL);

    // h6 — the honest denial, on every page with nothing ratified.
    if (!hasBlock) {
      if (!hasDenial) {
        missingDenial++;
        if (missingDenial <= 5) {
          errors.push(
            `program-skeleton(h6): /program/${slug}/ carries no ratified GAO ` +
              `item and does not say "${GAO_DENIAL}" — the page must state ` +
              `the absence, not go quiet about it`,
          );
        }
      }
      continue;
    }
    if (hasDenial) {
      bothClaims++;
      if (bothClaims <= 5) {
        errors.push(
          `program-skeleton(h6): /program/${slug}/ renders GAO program-level ` +
            `work AND denies that any is ingested — both cannot be true`,
        );
      }
    }
    pagesWithBlock++;

    const root = parse(html, { comment: false });
    const block = root.querySelector('[data-gao-scope="program"]');
    const dept = root.querySelector('[data-gao-scope="department"]');

    // h7 — placement.
    if (dept) {
      const order = root
        .querySelectorAll("[data-gao-scope]")
        .map((el) => el.getAttribute("data-gao-scope"));
      if (order.indexOf("program") > order.indexOf("department")) {
        errors.push(
          `program-skeleton(h7): /program/${slug}/ renders the department ` +
            `note ABOVE the program-specific finding — #30 requires the reverse`,
        );
      }
    }

    // The org the PAGE itself claims, from its own agency link (h4).
    const agencyHref =
      root
        .querySelectorAll("a[href]")
        .map((a) => a.getAttribute("href") ?? "")
        .find((h) => /^\/agency\/[^/]+\/#oversight$/.test(h)) ?? "";
    const pageOrg = agencyHref.split("/")[2] ?? "";
    const pageTitleTokens = new Set(gaoTokens(titleBySlug.get(slug) ?? ""));

    for (const item of block.querySelectorAll("[data-gao-item]")) {
      const product = item.getAttribute("data-gao-product") ?? "";
      const program = item.getAttribute("data-gao-program") ?? "";
      rendered++;
      const pairKey = `${product} ${slug}`;
      seenPairs.add(pairKey);

      // h1 — nothing renders that a person did not ratify.
      if (!ratified.has(pairKey)) {
        say(
          unratified,
          `program-skeleton(h1): /program/${slug}/ renders GAO ${product} ` +
            `("${program}") but no verdict-"y" row in ` +
            `data-seeds/gao_program_xwalk.csv ratifies that attribution`,
        );
        continue;
      }

      // h3 — the citation resolves to this product's own GAO page.
      const cite = item.querySelector("[data-gao-cite]");
      const want = `https://www.gao.gov/products/${product.toLowerCase()}`;
      if (!cite || (cite.getAttribute("href") ?? "") !== want) {
        say(
          badCite,
          `program-skeleton(h3): /program/${slug}/ item ${product} cites ` +
            `"${cite ? cite.getAttribute("href") : "(no link)"}", expected ${want}`,
        );
      }

      if (item.getAttribute("data-gao-item") === "assessment") {
        // h2 — the quote is GAO's paragraph, verbatim.
        const expectedQuote = quoteFor.get(`${product} ${program}`);
        const quoteEl = item.querySelector("[data-gao-quote]");
        const shown = (quoteEl?.text ?? "").replace(/\s+/g, " ").trim();
        if (!expectedQuote) {
          say(
            badQuote,
            `program-skeleton(h2): /program/${slug}/ quotes GAO on "${program}" ` +
              `(${product}) but no such assessment is in the ingested data`,
          );
        } else if (!shown.includes(expectedQuote.replace(/\s+/g, " ").trim())) {
          say(
            badQuote,
            `program-skeleton(h2): /program/${slug}/ renders a GAO quote that ` +
              `is not the ingested paragraph verbatim — a paraphrase of an ` +
              `audit finding is a new uncited claim (shown: "${shown.slice(0, 90)}…")`,
          );
        }

        // h4 — services must agree with the page's own org.
        const service = serviceFor.get(`${product} ${program}`) ?? "";
        const allowed = GAO_SERVICE_ORGS[service];
        if (allowed && pageOrg && !allowed.includes(pageOrg)) {
          say(
            badService,
            `program-skeleton(h4): /program/${slug}/ (org ${pageOrg}) renders ` +
              `${/^[aeiou]/i.test(service) ? "an" : "a"} ${service} GAO ` +
              `assessment of "${program}" — that service's program assessment ` +
              `cannot be about a line in another service's book`,
          );
        }
      }

      // h5 — corroboration the matcher never used.
      const shared = [...new Set(gaoTokens(program))].filter(
        (t) => pageTitleTokens.has(t) && (docFreq.get(t) ?? 0) <= rareLimit,
      );
      if (shared.length === 0) {
        say(
          badCorroboration,
          `program-skeleton(h5): /program/${slug}/ ("${titleBySlug.get(slug)}") ` +
            `renders GAO work on "${program}" with no distinctive word in ` +
            `common — the crosswalk is not corroborated by the page's own title`,
        );
      }
    }
  }

  // h1, the other direction — a ratified row that stopped rendering.
  let notRendered = 0;
  for (const key of ratified) {
    const [product, slug] = key.split(" ");
    if (!sidecars.has(slug)) continue; // no page exists for this budget line
    if (!fs.existsSync(pageHtmlPath(slug))) continue;
    if (seenPairs.has(key)) continue;
    notRendered++;
    if (notRendered <= 5) {
      errors.push(
        `program-skeleton(h1): GAO ${product} is ratified for /program/${slug}/ ` +
          `but the built page renders no such item`,
      );
    }
  }

  for (const [bucket, label] of [
    [unratified, "h1 unratified attribution"],
    [badQuote, "h2 quote mismatch"],
    [badCite, "h3 citation mismatch"],
    [badService, "h4 service mismatch"],
    [badCorroboration, "h5 uncorroborated crosswalk"],
  ]) {
    if (bucket.n > 5) {
      errors.push(
        `program-skeleton(${label}): ${bucket.n} occurrence(s) in total ` +
          `(first 5 listed)`,
      );
    }
  }
  if (missingDenial > 5) {
    errors.push(
      `program-skeleton(h6): ${missingDenial} page(s) with no ratified GAO ` +
        `item omit the denial sentence in total (first 5 listed)`,
    );
  }
  if (notRendered > 5) {
    errors.push(
      `program-skeleton(h1): ${notRendered} ratified crosswalk(s) render ` +
        `nowhere in total (first 5 listed)`,
    );
  }

  notes.push(
    `leg h: ${rendered} GAO item(s) on ${pagesWithBlock} program page(s), each ` +
      `traced to a verdict-"y" row of ${ratified.size} in ` +
      `data-seeds/gao_program_xwalk.csv; ${sidecars.size - pagesWithBlock} ` +
      `other page(s) state that no program-specific GAO finding for that line ` +
      `is ingested ✓`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// leg i — the org a program page names is an org CODE (ROADMAP #30's cause)
// ═══════════════════════════════════════════════════════════════════════════
//
// The defect this exists to stop recurring: rollupProgramRow synthesized
// ProgramRow.org by running the sidecar's service_org through serviceOrgName,
// storing "Air Force" where every LOOKUP downstream keys by "F". Display kept
// working (serviceOrgName passes a name through unchanged), so nothing looked
// broken — while 226 pages silently resolved no GAO department overlay, showed
// their organization as dead plain text instead of a link to an /agency/ page
// that does exist, and told the reader "Organization code Air Force". #30
// patched the visible silence; nothing pinned the contract.
//
// The contract, asserted against the BUILT artifact for every program page:
//
//   i1 — the header's own claim is true. It renders title="Organization code
//        {X}"; X must EQUAL the org the page's data source carries. Full tier:
//        programs.json's `org`. Rollup tier: the sidecar's `service_org`, or
//        the "DoD" umbrella when it declares none. (That `|| "DoD"` is the one
//        line mirrored from rollupProgramRow — the sidecar's documented
//        fallback for its one service-less line, not the resolution logic
//        under test.) Every occurrence on the page must agree, so the RSC
//        flight copy cannot disagree with the rendered header.
//   i2 — a code with an agency page LINKS to it. out/agency/{X}/index.html
//        existing and the header not carrying href="/agency/{X}/" is the
//        exact shape the name-for-code swap produced.
//   i3 — the GAO department note renders exactly where gao_overlays.json has
//        a non-empty overlay for X. Both directions: a page with an overlay
//        that stays quiet is #30's silence returning; a page without one that
//        renders a note is citing an overlay that is not in the payload.
//
// Reads the org from the page's own tooltip text, not a data-* mirror: the
// page ASSERTS "Organization code X" to the reader, and this checks that
// assertion. A page that rendered the wrong org could not satisfy it by also
// emitting a correct attribute somewhere.

/** Display names serviceOrgName produces — never valid values for `org`. */
const SERVICE_DISPLAY_NAMES = new Set(["Army", "Navy", "Air Force"]);

function runOrgCodeLeg({ errors, notes, sidecars }) {
  const programsPath = path.join(jsonDir, "programs.json");
  const overlaysPath = path.join(jsonDir, "gao_overlays.json");
  if (!fs.existsSync(programsPath)) {
    errors.push("program-skeleton(i): programs.json missing — org codes cannot be verified");
    return;
  }
  const orgBySlug = new Map(
    readJson(programsPath).map((p) => [p.slug ?? p.pe_bli, p.org]),
  );

  // The overlay payload, read as data. `getGaoOverlayForOrg` returns null for
  // an org whose overlay carries neither a high-risk area nor an improper
  // row; that is a shape fact about this payload, mirrored here so i3 states
  // the same "has an overlay" the page does.
  let overlayOrgs = null;
  if (fs.existsSync(overlaysPath)) {
    const ov = readJson(overlaysPath);
    overlayOrgs = new Set();
    for (const [org, code] of Object.entries(ov.agency_code_by_org ?? {})) {
      const a = (ov.agencies ?? {})[code];
      if (!a) continue;
      if ((a.high_risk_areas ?? []).length > 0 || a.improper) overlayOrgs.add(org);
    }
  }

  const orgClaim = /Organization code ([A-Za-z0-9 &._-]+?)(?=["\\])/g;
  const bad = { n: 0 };
  const noLink = { n: 0 };
  const noNote = { n: 0 };
  const strayNote = { n: 0 };
  const say = (bucket, msg) => {
    bucket.n++;
    if (bucket.n <= 5) errors.push(msg);
  };

  let checked = 0;
  let linked = 0;
  let withNote = 0;
  const seenOrgs = new Map();

  for (const [slug, d] of sidecars) {
    const p = pageHtmlPath(slug);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, "utf8");

    const full = orgBySlug.get(slug);
    // The one mirrored line — see the block comment above.
    const expected = full ?? (d.service_org || "DoD");
    const tier = full ? "full" : "rollup";

    const claimed = new Set();
    orgClaim.lastIndex = 0;
    let m;
    while ((m = orgClaim.exec(html)) !== null) claimed.add(m[1]);
    if (claimed.size === 0) {
      say(
        bad,
        `program-skeleton(i1): /program/${slug}/ (${tier}) renders no ` +
          `"Organization code …" header claim at all — the org is unstated`,
      );
      continue;
    }
    const wrong = [...claimed].filter((c) => c !== expected);
    if (wrong.length > 0) {
      const nameSwap = wrong.find((c) => SERVICE_DISPLAY_NAMES.has(c));
      say(
        bad,
        `program-skeleton(i1): /program/${slug}/ (${tier}) claims ` +
          `"Organization code ${wrong.join('" / "')}" but its data source ` +
          `carries org "${expected}"` +
          (nameSwap
            ? ` — "${nameSwap}" is the DISPLAY NAME of a code, not a code. ` +
              `Something humanized the org before storing it (the ROADMAP #30 ` +
              `cause: lib/program-tier.ts rollupProgramRow). Every lookup ` +
              `keyed by org resolves nothing on this page.`
            : ""),
      );
      continue;
    }
    // Counted only once the page's own claim is TRUE — a note that folded
    // the mismatches in would report the number of pages it just failed.
    checked++;
    seenOrgs.set(expected, (seenOrgs.get(expected) ?? 0) + 1);

    // i2 — an org with an agency page must be linked to it.
    const agencyPage = path.join(outDir, "agency", expected, "index.html");
    if (fs.existsSync(agencyPage)) {
      if (!html.includes(`href="/agency/${expected}/"`)) {
        say(
          noLink,
          `program-skeleton(i2): /program/${slug}/ (${tier}, org ${expected}) ` +
            `renders its organization as plain text, but /agency/${expected}/ ` +
            `is a built page — the header's orgHasPage test is keyed by code ` +
            `and only fails to match when the org is not one`,
        );
      } else {
        linked++;
      }
    }

    // i3 — the department overlay note, both directions.
    if (overlayOrgs) {
      const hasNote = html.includes('data-gao-scope="department"');
      const wantsNote = overlayOrgs.has(expected);
      if (wantsNote && !hasNote) {
        say(
          noNote,
          `program-skeleton(i3): /program/${slug}/ (${tier}) has org ` +
            `"${expected}", which gao_overlays.json carries an overlay for, ` +
            `but the page renders no [data-gao-scope="department"] note`,
        );
      } else if (!wantsNote && hasNote) {
        say(
          strayNote,
          `program-skeleton(i3): /program/${slug}/ (${tier}) renders a GAO ` +
            `department note, but gao_overlays.json has no non-empty overlay ` +
            `for its org "${expected}" — the note cites something absent`,
        );
      }
      if (hasNote) withNote++;
    }
  }

  for (const [bucket, label] of [
    [bad, "i1 org-code mismatch"],
    [noLink, "i2 unlinked agency"],
    [noNote, "i3 missing department note"],
    [strayNote, "i3 unbacked department note"],
  ]) {
    if (bucket.n > 5) {
      errors.push(
        `program-skeleton(${label}): ${bucket.n} occurrence(s) in total ` +
          `(first 5 listed)`,
      );
    }
  }

  const orgList = [...seenOrgs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([o, n]) => `${o}:${n}`)
    .join(" ");
  notes.push(
    `leg i: ${checked} of ${sidecars.size} program page(s) name an org code ` +
      `matching their own data source; of those, ${linked} link to their ` +
      `agency page and ${withNote} carry the GAO department note the overlay ` +
      `payload backs — ${orgList}`,
  );
}
