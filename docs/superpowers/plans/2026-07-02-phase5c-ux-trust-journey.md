# Phase 5C — UX Trust Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the site deliver the trust journey as a measurable experience — evaluator-first gates (link-graph, coverage, degraded-mode, receipt-moment, above-the-fold, motion, personas), then the UX changes that turn them green, then deploy + live verification.

**Architecture:** All work is in `site/` (Next 16 static export) except methodology anchors. New gates follow the existing pattern: `site/scripts/gates/<name>.mjs` exporting `run<Name>Gate() → {pass, errors, notes}`, registered in `site/scripts/verify.mjs`. Static gates parse `out/` HTML with node-html-parser; live gates (G3/G4/G5/G6) use the existing local server (`serve-static.mjs`, port 4173) + Playwright. Data-attribute contracts (`data-coverage`, `data-degraded`, `data-stat`, `data-testid="answer-*"`, `data-filing-mention`, `data-no-company-page`) are the interface between components and gates. Coverage numbers are computed from `data/site/json` sidecars at build time — never hardcoded in JSX.

**Tech Stack:** Next.js 16 static export, React 19, Tailwind v4, node-html-parser, Playwright, vitest. Gates run via `npm run verify` from `site/`.

**Spec:** `docs/superpowers/specs/2026-07-02-phase5c-ux-trust-journey-design.md`
**Standing rules:** every gate ships with recorded proof it can fail (G1/G2/G3 must FAIL against the pre-5C build — captured in Task 4 before any UI work); commits as `--author="Andes Lee <andes.lee444@gmail.com>"` with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; never `git add -A` (stage explicit paths); monorepo root is `/Users/andeslee/Documents/Cursor-Projects`, all site paths below are relative to `GovBudget/`.

**Build/verify loop used throughout:** `cd site && npm run build && npm run verify` (build takes ~3-5 min; gates need a fresh `out/`). `npm test` runs vitest. Never edit gate thresholds to make a gate pass — fix the site.

---

## File map (created / modified)

| File | Task | Responsibility |
|---|---|---|
| `site/scripts/gates/linkgraph.mjs` | 1 | G1: BFS reachability, orphan indexes, entity-link contracts |
| `site/src/lib/coverage.ts` | 2 | Declarative coverage manifest, counts computed from sidecars |
| `site/src/components/coverage-note.tsx` | 2 | `<CoverageNote id>` scope-note renderer |
| `site/scripts/gates/coverage.mjs` | 2 | G2: scope notes present + numbers match recomputed counts |
| `site/scripts/gates/degraded.mjs` | 3 | G3: assets blackholed → explicit fallbacks, no blank/console errors |
| `docs/superpowers/reviews/5c-gates-pre-failure.txt` | 4 | Recorded pre-5C FAIL output for G1/G2/G3 |
| `site/src/app/layout.tsx` | 5 | Header +Districts +Feed; footer +Filings |
| `site/src/components/mobile-nav.tsx` | 5 | Mirror new nav |
| `site/src/app/agency/[org]/page.tsx` | 5 | Breadcrumb fix → `/#agencies` |
| `site/src/app/page.tsx` | 6 | Clickable stats, receipt moment, finding lede, persona row, `id="agencies"` |
| `site/src/components/receipts-intro.tsx` | 6 | One-time dismissible receipts coach mark |
| `site/src/components/program-lobbying.tsx` (or where mentions render) | 7 | Internal `/filing/{uuid}/` links |
| `site/src/app/feed/page.tsx` + feed card component | 7 | new_entrant → company links or `data-no-company-page` |
| `site/src/components/companies-table.tsx` | 7 | Filter/sort parity |
| `site/src/app/methodology/page.tsx` | 8 | `#coverage-*` anchor sections |
| 6 surface components (flow, dossier, company awards, district, state, FY2026) | 8 | Adopt `<CoverageNote>` |
| `site/src/components/citation-panel/footnote.ts` + panel footer | 9 | Copy-as-footnote |
| `site/src/app/globals.css` | 9, 11 | `@media print`, motion custom props, reduced-motion |
| `site/src/app/program/[peBli]/page.tsx` | 10 | Above-the-fold answer block |
| `site/scripts/gates/answerfold.mjs` | 10 | G6 gate |
| `site/src/lib/motion.ts` + `site/src/components/reveal.tsx` | 11 | Motion tokens, scroll reveal |
| `site/scripts/gates/motion.mjs` | 11 | G7 static scan |
| `site/src/components/explorer.tsx`, downloads page, command palette | 12 | Degraded fallbacks (`data-degraded`) |
| `site/scripts/gates/receiptmoment.mjs` | 13 | G4 gate |
| `site/scripts/gates/personas.mjs` | 13 | G5 five persona journeys |
| `site/scripts/verify.mjs` | 1,2,3,10,11,13 | Register G1–G7 |
| `docs/superpowers/reviews/5c-visual/RUBRIC.md` | 14 | Judge rubric incl. V1–V5 |

---

### Task 1: G1 link-graph gate (build it failing)

**Files:**
- Create: `site/scripts/gates/linkgraph.mjs`
- Modify: `site/scripts/verify.mjs` (register after the filing gate)

The gate has three checks. It reads `out/` directly (static gate, no server).

- [ ] **Step 1: Write the gate**

```js
/**
 * gate — linkgraph_gate (Phase 5C, G1)
 *
 * The connected graph must have no dead ends:
 * (a) No orphaned indexes: /district/, /filings/, /feed/, /downloads/ each
 *     appear as an href in the shared chrome (header/footer as rendered on /)
 *     or the home page body.
 * (b) Every page TYPE is reachable from / within <= 3 clicks. Types:
 *     programs index, program detail, companies index, company detail,
 *     agency detail, district index, district detail, filings index,
 *     filing detail, feed, data, downloads, methodology, about.
 * (c) Entity-link contracts:
 *     - out/feed/index.html: every card inside section#feed-new_entrant
 *       contains <a href^="/company/"> OR carries [data-no-company-page].
 *     - home stats band: every [data-stat] element is (or contains) an <a>.
 *     - sampled program pages with lobbying mentions: every
 *       [data-filing-mention] contains an <a href^="/filing/">.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "out");

const PAGE_TYPES = [
  { key: "programs_index", re: /^\/programs\/$/ },
  { key: "program_detail", re: /^\/program\/[^/]+\/$/ },
  { key: "companies_index", re: /^\/companies\/$/ },
  { key: "company_detail", re: /^\/company\/[^/]+\/$/ },
  { key: "agency_detail", re: /^\/agency\/[^/]+\/$/ },
  { key: "district_index", re: /^\/district\/$/ },
  { key: "district_detail", re: /^\/district\/[^/]+\/$/ },
  { key: "filings_index", re: /^\/filings\/$/ },
  { key: "filing_detail", re: /^\/filing\/[^/]+\/$/ },
  { key: "feed", re: /^\/feed\/$/ },
  { key: "data", re: /^\/data\/$/ },
  { key: "downloads", re: /^\/downloads\/$/ },
  { key: "methodology", re: /^\/methodology\/$/ },
  { key: "about", re: /^\/about\/$/ },
];

function normalize(href) {
  if (!href || href.startsWith("http") || href.startsWith("mailto:")) return null;
  let u = href.split("#")[0].split("?")[0];
  if (!u.startsWith("/")) return null;
  if (!u.endsWith("/")) u += "/";
  return u;
}

function htmlPathFor(url) {
  return path.join(outDir, ...url.split("/").filter(Boolean), "index.html");
}

function linksIn(html) {
  const root = parse(html, { comment: false });
  const hrefs = new Set();
  for (const a of root.querySelectorAll("a[href]")) {
    const n = normalize(a.getAttribute("href"));
    if (n) hrefs.add(n);
  }
  return { root, hrefs };
}

export async function runLinkgraphGate() {
  const errors = [];
  const notes = [];
  const homePath = htmlPathFor("/");
  if (!fs.existsSync(homePath)) {
    notes.push("out/index.html not found — site not yet built (SKIP)");
    return { pass: true, errors, notes };
  }

  // ── (a) orphaned indexes ──
  const { root: homeRoot, hrefs: homeHrefs } = linksIn(fs.readFileSync(homePath, "utf8"));
  for (const must of ["/district/", "/filings/", "/feed/", "/downloads/"]) {
    if (!homeHrefs.has(must)) {
      errors.push(`orphaned index: ${must} has no inbound link from home/header/footer`);
    } else {
      notes.push(`${must} linked from chrome/home ✓`);
    }
  }

  // ── (b) BFS reachability of page types, depth <= 3 ──
  // Parse pages at depth 0..2; anything linked from depth 2 is reachable at 3.
  const reachedAt = new Map([["/", 0]]);
  let frontier = ["/"];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const url of frontier) {
      const p = htmlPathFor(url);
      if (!fs.existsSync(p)) continue;
      const { hrefs } = linksIn(fs.readFileSync(p, "utf8"));
      for (const h of hrefs) {
        if (!reachedAt.has(h)) {
          reachedAt.set(h, depth + 1);
          next.push(h);
        }
      }
    }
    // Parsing every program/company page at depth 2 is wasteful; only keep
    // parsing pages we still need: stop early if all types are reached.
    const unreached = PAGE_TYPES.filter(
      (t) => ![...reachedAt.keys()].some((u) => t.re.test(u))
    );
    if (unreached.length === 0) break;
    // Cap frontier parsing: index/hub pages first, then a sample of details.
    next.sort((a, b) => a.length - b.length);
    frontier = next.slice(0, 200);
  }
  for (const t of PAGE_TYPES) {
    const hit = [...reachedAt.entries()].find(([u]) => t.re.test(u));
    if (!hit) {
      errors.push(`page type unreachable within 3 clicks of /: ${t.key}`);
    }
  }
  notes.push(`BFS covered ${reachedAt.size} URLs`);

  // ── (c1) feed new_entrant company links ──
  const feedPath = htmlPathFor("/feed/");
  if (fs.existsSync(feedPath)) {
    const feedRoot = parse(fs.readFileSync(feedPath, "utf8"), { comment: false });
    const section = feedRoot.querySelector("section#feed-new_entrant");
    if (section) {
      const cards = section.querySelectorAll("div").filter((el) => {
        const cls = el.getAttribute("class") ?? "";
        return cls.includes("px-5") && cls.includes("py-4");
      });
      let bad = 0;
      for (const card of cards) {
        const hasCompanyLink = card
          .querySelectorAll("a[href]")
          .some((a) => (a.getAttribute("href") ?? "").startsWith("/company/"));
        const optedOut = card.getAttribute("data-no-company-page") !== undefined ||
          card.querySelectorAll("[data-no-company-page]").length > 0;
        if (!hasCompanyLink && !optedOut) bad++;
      }
      if (bad > 0) errors.push(`feed new_entrant: ${bad} card(s) with neither a /company/ link nor [data-no-company-page]`);
      else notes.push(`feed new_entrant: ${cards.length} cards all linked/opted-out ✓`);
    }
  }

  // ── (c2) home stats are links ──
  const stats = homeRoot.querySelectorAll("[data-stat]");
  if (stats.length === 0) {
    errors.push("home: no [data-stat] elements found (stats band contract missing)");
  } else {
    const nonLink = stats.filter(
      (el) => el.tagName !== "A" && el.querySelectorAll("a").length === 0 &&
        !(el.closest && el.closest("a"))
    );
    if (nonLink.length > 0) errors.push(`home: ${nonLink.length} [data-stat] element(s) are not links`);
    else notes.push(`home stats: ${stats.length} all linked ✓`);
  }

  // ── (c3) filing mentions link internally (sample 5 program pages) ──
  const programDir = path.join(outDir, "program");
  if (fs.existsSync(programDir)) {
    const slugs = fs.readdirSync(programDir).slice(0, 400);
    let checked = 0, missing = 0;
    for (const slug of slugs) {
      if (checked >= 5) break;
      const p = path.join(programDir, slug, "index.html");
      if (!fs.existsSync(p)) continue;
      const r = parse(fs.readFileSync(p, "utf8"), { comment: false });
      const mentions = r.querySelectorAll("[data-filing-mention]");
      if (mentions.length === 0) continue;
      checked++;
      for (const m of mentions) {
        const ok = m.querySelectorAll("a[href]").some((a) =>
          (a.getAttribute("href") ?? "").startsWith("/filing/"));
        if (!ok) missing++;
      }
    }
    if (checked === 0) {
      errors.push("program pages: no [data-filing-mention] elements found on any sampled page (contract missing)");
    } else if (missing > 0) {
      errors.push(`program pages: ${missing} filing mention(s) without internal /filing/ link`);
    } else {
      notes.push(`filing mentions: ${checked} pages sampled, all internally linked ✓`);
    }
  }

  return { pass: errors.length === 0, errors, notes };
}
```

- [ ] **Step 2: Register in verify.mjs** — add `import { runLinkgraphGate } from "./gates/linkgraph.mjs";` next to the other gate imports and a `printGate(13, "linkgraph", await runLinkgraphGate())` call in the static-gates section (match the existing numbering/accumulation pattern — read how gates 8–12 accumulate into the pass array and do the same).

- [ ] **Step 3: Run against the existing build to confirm it FAILS** — `cd site && node -e "import('./scripts/gates/linkgraph.mjs').then(async m => { const r = await m.runLinkgraphGate(); console.log(JSON.stringify(r, null, 1)); process.exit(r.pass ? 0 : 1); })"`. Expected: FAIL with orphaned-index errors for /district/ and /filings/, missing [data-stat], missing [data-filing-mention]. If `out/` is stale or missing, build first (`npm run build`). Save this output — Task 4 commits it.

- [ ] **Step 4: Commit** — `git add site/scripts/gates/linkgraph.mjs site/scripts/verify.mjs && git commit -m "feat(5c): G1 link-graph gate — orphan indexes, 3-click reachability, entity-link contracts (failing pre-5C by design)"`

### Task 2: Coverage manifest + G2 coverage gate (failing)

**Files:**
- Create: `site/src/lib/coverage.ts`, `site/src/components/coverage-note.tsx`, `site/scripts/gates/coverage.mjs`
- Modify: `site/scripts/verify.mjs`
- Test: `site/src/lib/__tests__/coverage.test.ts`

- [ ] **Step 1: Write the failing vitest** for the manifest shape:

```ts
import { describe, it, expect } from "vitest";
import { getCoverage, COVERAGE_IDS } from "@/lib/coverage";

describe("coverage manifest", () => {
  it("exposes all six surfaces with computed counts", () => {
    const ids = ["follow-the-dollar", "dossiers", "company-awards", "districts", "state-ca", "fy2026-partial"];
    expect(COVERAGE_IDS).toEqual(ids);
    for (const id of ids) {
      const c = getCoverage(id);
      expect(c.note.length).toBeGreaterThan(10);
      expect(c.anchor).toMatch(/^\/methodology\/#coverage-/);
      // numerator/denominator present where meaningful (fy2026-partial is prose-only)
      if (id !== "fy2026-partial" && id !== "state-ca") {
        expect(c.numerator).toBeGreaterThan(0);
        expect(c.denominator).toBeGreaterThan(c.numerator);
      }
    }
  });
});
```

- [ ] **Step 2: Run to confirm it fails** — `cd site && npx vitest run src/lib/__tests__/coverage.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `site/src/lib/coverage.ts`.** Counts come from the same data loaders the pages already use (`@/lib/data` reads `data/site/json/*`). Follow the existing loader style in data.ts (fs.readFileSync at module scope is fine — SSG only). Shape:

```ts
import { getFlowsCount, getProgramsCount, getDossierCount, getCompaniesCount,
  getCompaniesWithAwardsCount, getDistrictsCount } from "@/lib/data";
// If these helpers don't exist in data.ts, add them there — each is a
// one-liner over already-loaded sidecar indexes (flows dir length,
// program_details length, dossiers dir length, entity_details length,
// entity_details filtered where linked_award_rows > 0, districts length).

export const COVERAGE_IDS = ["follow-the-dollar", "dossiers", "company-awards",
  "districts", "state-ca", "fy2026-partial"] as const;
export type CoverageId = (typeof COVERAGE_IDS)[number];

export interface Coverage {
  id: CoverageId;
  numerator: number | null;
  denominator: number | null;
  note: string;          // full rendered sentence, numbers interpolated
  anchor: string;        // /methodology/#coverage-<id>
}

export function getCoverage(id: CoverageId): Coverage { /* switch over ids;
  e.g. follow-the-dollar: num=getFlowsCount(), den=getProgramsCount(),
  note=`Follow-the-dollar covers ${num} of ${den} programs — only high-confidence
  budget→award links are shown.` ; districts: num=getDistrictsCount(), den=435,
  note=`${num} of 435 congressional districts have high-confidence linked
  defense dollars.`; state-ca: note="California data covers FY2025 only.";
  fy2026-partial: note="FY2026 award data is a partial year." */ }
```

- [ ] **Step 4: `site/src/components/coverage-note.tsx`** — server component:

```tsx
import { getCoverage, type CoverageId } from "@/lib/coverage";
import Link from "next/link";

export function CoverageNote({ id, className = "" }: { id: CoverageId; className?: string }) {
  const c = getCoverage(id);
  return (
    <p data-coverage={id} className={`text-xs text-muted-foreground ${className}`}>
      {c.note}{" "}
      <Link href={c.anchor} className="underline decoration-dotted hover:text-foreground">
        why →
      </Link>
    </p>
  );
}
```

- [ ] **Step 5: `site/scripts/gates/coverage.mjs`** — G2. For each manifest entry, check representative built pages and verify note presence AND that the interpolated numbers match recomputation from `data/site/json` (read the sidecar counts directly in the gate — independent recomputation, not an import of coverage.ts):

```js
// Representative pages: follow-the-dollar + dossiers + company-awards +
// fy2026-partial → a flow program page (pick first slug in data/site/json/flows/);
// districts → out/district/index.html; state-ca → out/methodology/index.html
// (or the state surface if a page renders CA data — check /data/ inventory note).
// Assert: [data-coverage=<id>] exists on at least one representative page and
// its text contains `${numerator} of ${denominator}` where applicable, where
// numerator/denominator are recomputed: flows = fs.readdirSync(data/site/json/flows).length,
// programs = readdirSync(program_details).length, dossiers = readdirSync(dossiers).length,
// districts = districts.json length, company-awards = entity_details filtered.
// Also assert /methodology/ contains an element with id="coverage-<id>" for every id.
```
Write it fully in the same structure as linkgraph.mjs (fs + node-html-parser, `runCoverageGate()`). Register in verify.mjs as gate 14.

- [ ] **Step 6: Run gate against existing build → confirm FAIL** (no [data-coverage] anywhere). Run vitest → coverage.test.ts PASS.

- [ ] **Step 7: Commit** — `git add site/src/lib/coverage.ts site/src/components/coverage-note.tsx site/src/lib/__tests__/coverage.test.ts site/scripts/gates/coverage.mjs site/scripts/verify.mjs` + any data.ts helper additions; message `"feat(5c): coverage manifest + G2 coverage-banner gate (failing pre-5C by design)"`.

### Task 3: G3 degraded-mode gate (failing)

**Files:**
- Create: `site/scripts/gates/degraded.mjs`
- Modify: `site/scripts/verify.mjs` (live-gates section — needs the server)

- [ ] **Step 1: Write the gate.** Playwright (already a devDependency — see clickthrough.mjs for the launch pattern). Serve `out/` on the existing server, but intercept: `page.route("**/assets/**", r => r.abort())` and also route `**/config.json` to return `{"assetBaseUrl": "/assets"}` (its default). Checks:
  1. `/data/` → click the engine start button if present → expect `[data-degraded="explorer"]` visible within 10s; page must NOT show an empty dataset table with no explanation.
  2. `/downloads/` → expect `[data-degraded="downloads"]` visible (banner) OR every download card carries an explicit unavailable state.
  3. First flow program page → open a `jbook_pdf` citation (click a `[data-fact-id]` element) → panel shows `[data-degraded="pdf"]` fallback (official-source link still present).
  4. Console: no uncaught errors (filter out expected aborted-fetch noise: messages containing "assets" + "Failed to fetch"/"ERR_FAILED" are allowed; anything else errors the gate).
  Export `runDegradedGate({ baseUrl })`; register in verify.mjs alongside the other live gates (after a11y), passing the server URL.

- [ ] **Step 2: Run against existing build → confirm FAIL** (explorer and downloads have no `[data-degraded]`). The PDF-panel leg may already pass (fallback exists) — that's fine, the gate fails on 1–2.

- [ ] **Step 3: Commit** — `"feat(5c): G3 degraded-mode gate — assets blackholed must yield explicit fallbacks (failing pre-5C by design)"`.

### Task 4: Record pre-5C failures (proof-can-fail evidence)

- [ ] **Step 1:** `cd site && node scripts/verify.mjs 2>&1 | tail -40 > ../docs/superpowers/reviews/5c-gates-pre-failure.txt` — must show G1/G2/G3 FAIL lines and gates 1–12 PASS. If any of gates 1–12 fail, STOP and report (stale build — rebuild first).
- [ ] **Step 2:** Commit the file: `"docs(5c): recorded pre-5C gate failures — G1/G2/G3 proof-can-fail evidence"`.

### Task 5: IA / navigation fixes

**Files:** `site/src/app/layout.tsx`, `site/src/components/mobile-nav.tsx`, `site/src/app/agency/[org]/page.tsx`

- [ ] **Step 1:** In layout.tsx desktop nav (after the Companies link, before Data), insert Districts and Feed links using the identical className as siblings:

```tsx
<Link href="/district/" className="text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">Districts</Link>
<Link href="/feed/" className="text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">Feed</Link>
```

- [ ] **Step 2:** In the footer link row (before Methodology): `<Link href="/filings/" className="hover:text-foreground transition-colors">Lobbying filings</Link>`.
- [ ] **Step 3:** Mirror both additions in mobile-nav.tsx (read it; it lists the same 4 links — add Districts + Feed in the same style; filings stays footer-only).
- [ ] **Step 4:** In agency/[org]/page.tsx find the breadcrumb linking "Agencies" to `/programs/` and change href to `/#agencies` (Task 6 adds the id).
- [ ] **Step 5:** `npx vitest run` (existing snapshot/unit tests may reference nav — fix any), then commit staged files: `"feat(5c): nav IA — Districts + Feed in header, Filings in footer, agency breadcrumb fix"`.

### Task 6: Home — receipt moment, clickable stats, finding lede, persona row, coach mark

**Files:** `site/src/app/page.tsx`, create `site/src/components/receipts-intro.tsx`

Read page.tsx fully first. Changes, keeping existing sections and style system:

- [ ] **Step 1: Clickable stats.** Wrap each stats-band figure in a Link and add the contract attr: programs → `/programs/`, citations → `/methodology/#verification` (add that id to the methodology verification section if missing), companies → `/companies/`, agencies → `#agencies`. Each rendered stat element gets `data-stat="programs|citations|companies|agencies"`. Keep visual style; add hover state consistent with cards.
- [ ] **Step 2: `id="agencies"`** on the agency-grid section wrapper.
- [ ] **Step 3: Receipt moment.** New section directly under the hero (above the fold at 1440): pull the top FY25→26 mover the page already loads for the movers list; render its headline number as a large existing `<Cite>` (the mover data already carries a citation — same as the movers list) with copy: program title, delta, and a styled button-look label "See the page it's printed on →" as part of the clickable cite area. Wrapper gets `data-testid="receipt-moment"`. IMPORTANT: reuse the existing Cite component/data — invent no new citation path; the whole section is one client-side click from the citation panel.
- [ ] **Step 4: Finding lede.** Replace (or augment) the hero's static subtitle with the top feed event as a one-line finding, linking to its program page, sourced from the same feed.json the teaser uses: e.g. "⚡ {event headline} — see the feed →". Falls back to the current subtitle if feed data is empty (same guard the teaser uses).
- [ ] **Step 5: Persona row.** Three link-cards under the receipt moment: "Verify a number" → `/programs/`, "See what a district builds" → `/district/`, "Track who's winning" → `/feed/`. One-line description each, no insider nouns. `data-testid="persona-row"`.
- [ ] **Step 6: `receipts-intro.tsx`** — client component: if `localStorage["receipts-intro-seen"]` unset, render a small dismissible callout near the header toggle ("Receipts mode shows the citation behind every number — try it") with a Dismiss button that sets the key. Mount it in page.tsx (home only). Guard SSR (useEffect-gated render).
- [ ] **Step 7:** `npm run build && npx vitest run` — fix breaks. Manual sanity: `grep -c 'data-stat' out/index.html` ≥ 4. Commit: `"feat(5c): home — receipt moment, clickable stats, finding lede, persona row, receipts coach mark"`.

### Task 7: Graph edges — filing links, feed company links, companies table parity

**Files:** wherever program/company pages render lobbying mentions (grep `lda.senate.gov` in src/components + app), the feed card component, `site/src/components/companies-table.tsx`

- [ ] **Step 1: Filing mentions.** Every mention row gains wrapper attr `data-filing-mention` and an internal link `<Link href={`/filing/${m.filing_uuid}/`}>view filing</Link>` alongside the existing external lda.senate.gov link. The sidecar rows already carry `filing_uuid` (they key the filing pages) — if the program_details mention rows lack it, add it in the exporter (`src/govbudget/export_site.py`) and re-run `uv run python -m govbudget export-site` (flag this in the task report if needed).
- [ ] **Step 2: Feed new_entrant links.** Feed events carry `family_key`. Build slug lookup at SSG in the feed page: from the same entity index the companies page uses (slug per family_key, top-200 only). Cards whose family has a page wrap the family name in `<Link href={`/company/${slug}/`}>`; others get `data-no-company-page` on the card wrapper.
- [ ] **Step 3: Companies table parity.** Add the same client filter/sort pattern used in programs-table.tsx (read it; mirror: text filter on name + sortable obligation/uei columns).
- [ ] **Step 4:** Rebuild; run G1 standalone (same node -e command as Task 1 Step 3) — the (c1)/(c3) legs must now pass; orphan/stat legs pass from Tasks 5–6. G1 overall should now PASS. Commit: `"feat(5c): graph edges — internal filing links, feed company links, companies table parity (G1 green)"`.

### Task 8: Coverage notes adoption + methodology anchors (G2 green)

**Files:** methodology page + the six surfaces: follow-the-dollar component, program dossier section, company awards section, district index/detail, the state/CA surface (methodology + /data/ inventory note), FY2026 totals surfaces (programs index header, agency pages)

- [ ] **Step 1:** Methodology page: add a "Coverage & limits" section with one anchored block per id: `<section id="coverage-follow-the-dollar">…` etc. (6 blocks, 2–4 sentences each, honest about why: crosswalk confidence, top-50 selection, partial FY2026, CA single-year).
- [ ] **Step 2:** Drop `<CoverageNote id="…"/>` into each surface near its heading; empty states get explanatory copy instead of section removal — e.g. program pages without flows render, inside the section placeholder: "No follow-the-dollar view — this program's awards haven't been crosswalked at high confidence. why →" (same data-coverage attr via CoverageNote).
- [ ] **Step 3:** Rebuild; run G2 standalone → PASS. Full `npm run verify` → gates 1–14 all PASS except degraded (Task 12) and any not-yet-registered. Commit: `"feat(5c): coverage notes at point of use + methodology coverage anchors (G2 green)"`.

### Task 9: Copy-as-footnote + print one-pager

**Files:** create `site/src/components/citation-panel/footnote.ts`; modify panel footer component; `site/src/app/globals.css`
**Test:** `site/src/components/citation-panel/__tests__/footnote.test.ts`

- [ ] **Step 1: Failing test** for the formatter:

```ts
import { describe, it, expect } from "vitest";
import { formatFootnote } from "../footnote";

it("formats a jbook_pdf citation as a quotable footnote", () => {
  const s = formatFootnote({
    kind: "jbook_pdf", factId: "abc123def4567890",
    label: "PE 0601101E — Defense Research Sciences, FY2025 enacted",
    amountText: "$293.145M", docTitle: "FY2026 DoD J-book, RDT&E Defense-Wide Vol 1 (R-1)",
    page: 42, sha256: "deadbeef", retrievedAt: "2026-06-11", url: "https://govbudget.vercel.app/program/0601101E/",
  });
  expect(s).toContain("PE 0601101E");
  expect(s).toContain("$293.145M");
  expect(s).toContain("p.42");
  expect(s).toContain("sha256:deadbeef");
  expect(s).toContain("retrieved 2026-06-11");
  expect(s).toContain("govbudget.vercel.app/program/0601101E/");
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `formatFootnote(input)` — one template per kind (jbook_pdf/workbook/usaspending/lda_filing/derived/state_*/jbook_narrative; derived includes "derived: {formula}"). Pure function, no DOM.
- [ ] **Step 4:** Panel footer button "Copy as footnote" — builds input from the already-loaded citation object, `navigator.clipboard.writeText`, transient "Copied ✓" state; `data-testid="copy-footnote"`. Place beside the existing official-source link.
- [ ] **Step 5: Print stylesheet** in globals.css:

```css
@media print {
  header, footer, [data-search-trigger], .skip-to-content,
  [data-citation-panel], [data-receipts-toggle], nav { display: none !important; }
  main { margin: 0; padding: 0; }
  a { color: inherit; text-decoration: none; }
  [data-print-only] { display: block !important; }
}
```
Add a `data-print-only` hidden byline in the program page (`hidden` by default via inline class, shown in print): "Printed from {SITE_URL}{path} — data as of {builtAt}. Every figure is citation-backed; see the page online for per-number provenance."
- [ ] **Step 6:** Tests pass, rebuild, commit: `"feat(5c): copy-as-footnote + print one-pager stylesheet"`.

### Task 10: Above-the-fold answer block + G6 gate

**Files:** `site/src/app/program/[peBli]/page.tsx`; create `site/scripts/gates/answerfold.mjs`; register in verify.mjs

- [ ] **Step 1:** Answer strip directly under the program header (before budget figures): a 3-item row, each with `data-testid`:
  - `answer-what`: one plain-language line — title + org + exhibit family (all data already on the page).
  - `answer-changed`: FY25→FY26 delta with its existing `<Cite>` (trajectory data already loaded).
  - `answer-who`: top recipient family + its share when concentration/awards data exists (already in sidecar); otherwise the line reads "No award linkage at high confidence" (honest absence, still renders the testid).
  Compact styling (grid-cols-1 md:grid-cols-3, small caps labels "WHAT IT IS / WHAT CHANGED / WHO GETS IT").
- [ ] **Step 2: G6 gate** `answerfold.mjs` (live gate, Playwright): sample 10 program slugs from `out/program/` (first 5 + 5 with flows), for each at 1440×900 and 390×844 assert all three `[data-testid^="answer-"]` elements have `boundingBox().y + height < viewport.height` (above the fold). Register in verify.mjs.
- [ ] **Step 3:** Rebuild, run G6 → PASS (iterate placement if 390 fails — the strip may need to sit immediately after the h1 on mobile). Commit: `"feat(5c): program above-the-fold answer block (what/changed/who) + G6 gate"`.

### Task 11: Motion system + G7 gate

**Files:** create `site/src/lib/motion.ts`, `site/src/components/reveal.tsx`, `site/scripts/gates/motion.mjs`; modify `site/src/app/globals.css`, citation panel, card/chip hover classes, category hero + follow-the-dollar durations

- [ ] **Step 1: Tokens.** globals.css `:root`:

```css
:root {
  --motion-fast: 150ms; --motion-base: 220ms; --motion-slow: 320ms; --motion-story: 600ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0, 1);
  --ease-accelerate: cubic-bezier(0.3, 0, 1, 1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --motion-fast: 1ms; --motion-base: 1ms; --motion-slow: 1ms; --motion-story: 1ms; }
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
```
`motion.ts` exports the same values for JS consumers (`export const MOTION = { fast: 150, base: 220, slow: 320, story: 600 } as const;`) with a comment that globals.css is the source of truth for CSS.
- [ ] **Step 2: `reveal.tsx`** — client component: IntersectionObserver, once, adds `is-revealed`; CSS: `.reveal { opacity: 0; transform: translateY(12px); transition: opacity var(--motion-slow) var(--ease-decelerate), transform var(--motion-slow) var(--ease-decelerate); } .reveal.is-revealed { opacity: 1; transform: none; }` + stagger helper (`style={{ transitionDelay: … }}` capped at 5×60ms). SSR-safe: render children visible when JS unavailable (`no-js` fallback: apply .reveal only after mount).
- [ ] **Step 3: Adopt:** home sections + feed cards get `<Reveal>` (stagger on feed card lists); citation panel gets slide-in (`translate-x` transition using tokens) and PDF page container a crossfade class; interactive cards/cite chips get a shared hover class (`.interactive-raise { transition: transform var(--motion-fast) var(--ease-standard), box-shadow …; } :hover { transform: translateY(-1px); }`). Category hero + follow-the-dollar SVG animations: replace literal durations with `var(--motion-story)` multiples where CSS-driven; JS-driven ones import MOTION.
- [ ] **Step 4: G7 gate** `motion.mjs` (static scan of `site/src/**/*.{tsx,css}`):
  - no `\d+ms` duration literals outside `globals.css` + `motion.ts` (allowlist file list in the gate);
  - no `duration-[` arbitrary Tailwind values;
  - globals.css contains the `prefers-reduced-motion` block;
  - extend the existing animation.mjs compositor allowlist scan site-wide (only transform/opacity/filter in @keyframes across all css).
  Register in verify.mjs. Run → fix violations it finds in existing code (migrate literals to tokens; this is the point).
- [ ] **Step 5:** Rebuild + full verify → all green so far. Visual sanity at 3 widths via the existing screenshot script. Commit: `"feat(5c): motion system — tokens, reveal/stagger, panel transitions, reduced-motion, G7 motion gate"`.

### Task 12: Degraded fallbacks (G3 green)

**Files:** `site/src/components/explorer.tsx`, downloads page component, `site/src/components/search/command-palette.tsx`

- [ ] **Step 1: Explorer.** On engine start / dataset registration failure (fetch of parquet manifest or first HTTP-range request rejects): set error state rendering `<div data-degraded="explorer" role="alert">Data files are unavailable in this deployment — the explorer needs the asset bundle. You can still browse every cited number on the site. <a href="/downloads/">About the data files →</a></div>`. Do not leave the spinner/empty table.
- [ ] **Step 2: Downloads.** Client check on mount: HEAD `{assetBase}/citations/citations.parquet`; on failure render banner `data-degraded="downloads"`: "Download files are not attached to this deployment yet — they ship from object storage. Checksums and schemas below still describe the bundle." Cards get `aria-disabled` + visual dim.
- [ ] **Step 3: Search hint.** When Pagefind init fails or returns no index (dev / missing bundle): render a quiet row in the results panel `data-degraded="deep-search"`: "Deep document search unavailable here — quick search still works."
- [ ] **Step 4:** Rebuild; run G3 standalone → PASS (all four legs). Run full verify → G1–G7 + originals green. Commit: `"feat(5c): explicit degraded-mode fallbacks — explorer, downloads, deep search (G3 green)"`.

### Task 13: G4 receipt-moment gate + G5 persona walkthroughs

**Files:** create `site/scripts/gates/receiptmoment.mjs`, `site/scripts/gates/personas.mjs`; register both (live gates)

- [ ] **Step 1: G4** — Playwright: viewport 1440×900, goto `/`; assert `[data-testid="receipt-moment"]` fully above fold; click its cite → citation panel visible with either a rendered PDF canvas OR `[data-degraded="pdf"]` fallback — total clicks ≤ 2 (it should be 1). Repeat fold-visibility assert at 390×844 (click leg once is enough). Also: coach mark `receipts-intro` visible on first visit and absent after dismiss (localStorage).
- [ ] **Step 2: G5** — five journeys, each a function returning `{name, ok, steps}` with a hard ≤ 6 interaction budget (a click/keypress = 1; scroll free):
  1. **Journalist:** `/` → click receipt-moment cite (1) → panel → click copy-footnote (2) → clipboard contains "retrieved" (grant clipboard permissions in context).
  2. **Staffer:** `/` → header Districts (1) → first district row link (2) → a program link on district page (3) → `page.emulateMedia({media:"print"})` → assert header hidden + `[data-print-only]` visible.
  3. **BD analyst:** `/` → header Feed (1) → new_entrant section: click a company link (2) → company page shows lobbying-vs-obligations rows (`data-testid` or text assertion on the lobbying section).
  4. **Academic:** `/` → footer Downloads (1) → page lists citations.parquet card + schema/dictionary link present (assert text), degraded banner acceptable.
  5. **Citizen:** `/` → open search (1) → type "hypersonic" (typing = 1 interaction) → click first program result (3) → program page has dossier section or answer strip; assert og:image meta present.
  Register as one gate line each (`persona:journalist` …) or a single gate with per-journey errors — match verify.mjs output style.
- [ ] **Step 3:** Run both → iterate site/gate until green **without weakening budgets**. Commit: `"feat(5c): G4 receipt-moment + G5 persona walkthrough gates (green)"`.

### Task 14: Full loop, visual judging, code review, deploy, live computer-use verification

- [ ] **Step 1: Full suite.** `cd site && npm run build && npm run verify && npx vitest run` and repo-root `uv run pytest -q` — everything green. Fix loop as needed.
- [ ] **Step 2: Rubric.** Write `docs/superpowers/reviews/5c-visual/RUBRIC.md`: existing 5B dimensions + V1 (receipt-moment credibility ≥4), V2 (no implied completeness), V3 (journey legibility ≥4), V4 (tells-not-shows ≥4; zero causal influence language), V5 (motion design & modernity ≥4). Capture screenshots at 390/768/1440 for home, program (dossier+flow), feed, district, panel-open; short recordings (Playwright video) for panel-open + follow-the-dollar.
- [ ] **Step 3: Visual judging.** 3 independent opus vision judges score the rubric (orchestrator dispatches; median ≥ 4 per dimension; ≤ 2 rounds then fix loop).
- [ ] **Step 4: Final code review.** Opus whole-implementation review of the 5C diff (established per-phase pattern); fix findings.
- [ ] **Step 5: Deploy.** Rebuild with `NEXT_PUBLIC_SITE_URL=https://govbudget.vercel.app`; restore `site/out/.vercelignore` (`filing/` excluded) and `site/out/.vercel/project.json` (`{"projectId":"prj_oen0seknELM3lK6UcZPS5252D7QD","orgId":"team_b94lNMYEXzNevW7VmSNvdeYZ","projectName":"govbudget"}`); `cd site/out && vercel --prod --archive=tgz`. Smoke: home 200, data-testid receipt-moment present in served HTML.
- [ ] **Step 6: Live computer-use verification** (orchestrator does this directly, not a subagent): drive https://govbudget.vercel.app in the browser — receipt moment, all five persona journeys, nav IA, coverage notes, motion feel, degraded states (explorer/downloads legs verify fallbacks until R2 lands), console/network clean. Screenshot evidence → `docs/superpowers/reviews/5c-live/`. Fix loop → redeploy as needed.
- [ ] **Step 7: Close out.** ROADMAP.md 5C ledger row + findings; commit + push monorepo main; re-split + push standalone GitHub repo; final user report.
