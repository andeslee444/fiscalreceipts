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
 * (d) No dead links: on / (home), /feed/ and /district/, every internal
 *     href^="/" must resolve to an existing out/ path — page URLs need
 *     index.html present; file URLs (extension) need the file present.
 *     #anchors on existing pages are allowed (fragment is stripped before
 *     resolution); pure same-page "#..." anchors are skipped.
 * (f) Universal PE linking (Phase 5F §2a): on sampled program pages (pages
 *     whose narratives/dossiers reference other PEs, plus generic samples
 *     from BOTH tiers), every PE-shaped token in body text that HAS a built
 *     page and is not the page's own PE must be inside an <a>. The PE shape
 *     is recomputed here (mirror of lib/pe-link.ts PE_TOKEN_RE).
 * (g) A FRAGMENT LINK MUST LAND SOMEWHERE (tri-persona Wave 3). Leg (d)
 *     strips "#..." before resolving, by design — a dead PAGE and a dead
 *     ANCHOR are different failures. Nothing checked the second one, and a
 *     link whose whole promise is "here is the paragraph that explains this"
 *     is worthless if it lands at the top of a long page. See leg (g)'s own
 *     block at the bottom.
 * (h) EVERY SHIPPED DATASET IS DOWNLOADABLE WITHOUT JAVASCRIPT (tri-persona
 *     Wave 4). Leg (d) used to skip href^="/assets/" as "runtime-resolved";
 *     that skip hid fifteen /downloads/ links that 404 for curl, wget and
 *     every non-browser client. Leg (h) reads datasets.json — the exporter's
 *     own inventory of what it wrote — and requires each shipped parquet to
 *     have an ABSOLUTE asset-host href on /downloads/. Leg (d) no longer
 *     carves /assets/ out, so the negative half is covered too.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "out");
const jsonDir = path.resolve(__dirname, "..", "..", "..", "data", "site", "json");

// PE-shaped token — independent recompute of lib/pe-link.ts PE_TOKEN_RE.
const PE_TOKEN_RE = /\b\d{7}[A-Z][A-Z0-9]{0,2}\b/g;

const PAGE_TYPES = [
  { key: "programs_index", re: /^\/programs\/$/ },
  { key: "program_detail", re: /^\/program\/[^/]+\/$/ },
  { key: "companies_index", re: /^\/companies\/$/ },
  // PM Sprint 2 §P1-3 — the curated rename/acquisition table is a publishable
  // asset; if it ever loses its inbound links it is invisible.
  { key: "company_families", re: /^\/companies\/families\/$/ },
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
  // Phase 5H — the experimental flowdown must stay reachable from chrome.
  { key: "flow", re: /^\/flow\/$/ },
  // PM Sprint 3 Task 6 (§Coverage) — the roadmap page answers "early and
  // moving, or abandoned at 1%?". A coverage page nobody can find answers it
  // for nobody, so its reachability is pinned like every other page type.
  { key: "coverage", re: /^\/coverage\/$/ },
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
    if (!section) {
      errors.push("feed: section#feed-new_entrant not found (contract missing)");
    } else {
      // Contract: FeedCardItem root carries data-feed-card="". Selecting by
      // that attribute instead of class makes this selector stable against style changes.
      const cards = section.querySelectorAll("[data-feed-card]");
      if (cards.length === 0) {
        errors.push("feed new_entrant: section present but 0 cards matched the card selector (selector rot?)");
      } else {
        let bad = 0;
        for (const card of cards) {
          const hasCompanyLink = card
            .querySelectorAll("a[href]")
            .some((a) => (a.getAttribute("href") ?? "").startsWith("/company/"));
          const optedOut =
            card.getAttribute("data-no-company-page") !== undefined ||
            card.querySelectorAll("[data-no-company-page]").length > 0;
          if (!hasCompanyLink && !optedOut) bad++;
        }
        if (bad > 0) errors.push(`feed new_entrant: ${bad} card(s) with neither a /company/ link nor [data-no-company-page]`);
        else notes.push(`feed new_entrant: ${cards.length} cards all linked/opted-out ✓`);
      }
    }
  }

  // ── (c2) home stats are links ──
  const stats = homeRoot.querySelectorAll("[data-stat]");
  if (stats.length === 0) {
    errors.push("home: no [data-stat] elements found (stats band contract missing)");
  } else {
    const nonLink = stats.filter((el) => {
      if (el.tagName === "A") return false;
      if (el.querySelectorAll("a").length > 0) return false;
      // node-html-parser may not have closest; guard it
      if (typeof el.closest === "function" && el.closest("a")) return false;
      return true;
    });
    if (nonLink.length > 0) errors.push(`home: ${nonLink.length} [data-stat] element(s) are not links`);
    else notes.push(`home stats: ${stats.length} all linked ✓`);
  }

  // ── (c3) filing mentions link internally (sample 5 program pages) ──
  const programDir = path.join(outDir, "program");
  if (!fs.existsSync(programDir)) {
    errors.push("out/program/ missing — build incomplete");
  } else {
    const slugs = fs.readdirSync(programDir).sort().slice(0, 400);
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

  // ── (d) dead links: /, /feed/, /district/ ──
  // Every internal href^="/" must resolve to an existing out/ path. Page URLs
  // resolve to {out}/{path}/index.html; file URLs (with extension) resolve to
  // the file itself. Fragments/queries are stripped first, so #anchors on
  // existing pages are allowed; pure same-page "#..." anchors never enter the
  // loop (they don't start with "/").
  // WIDENED 2026-08-25. This list was ["/", "/feed/", "/district/"] and the
  // logic below was already correct — it simply never looked at /programs/,
  // which had been shipping a link to /json/programs_excluded.json that 404s.
  // That file is built into data/site/json/ but was never added to
  // prepare-assets.mjs's copy list, so it never reached public/json/. The
  // completeness manifest — the artifact whose whole job is accounting for
  // what the index omits — was the one file a reader could not open, and the
  // prose above the link says "listed in full in programs_excluded.json".
  //
  // Every SINGLETON hub page is now scanned. Templated detail pages
  // (/program/*, /company/*, /filing/*) stay out: there are ~2,000 of them,
  // leg (f) already samples them, and the dead-link risk there is a shared
  // template, not a hand-written href. These pages are where hand-written
  // hrefs actually live.
  for (const pageUrl of [
    "/", "/feed/", "/district/", "/programs/", "/companies/",
    "/companies/families/", "/filings/", "/data/", "/coverage/",
    "/methodology/", "/flow/", "/lineage/", "/agency/", "/years/",
    "/downloads/", "/glossary/", "/about/",
  ]) {
    const pagePath = htmlPathFor(pageUrl);
    if (!fs.existsSync(pagePath)) {
      errors.push(`dead-link scan: ${pageUrl} not built (${pagePath} missing)`);
      continue;
    }
    const root = parse(fs.readFileSync(pagePath, "utf8"), { comment: false });
    const deadByTarget = new Map();
    let internal = 0;
    for (const a of root.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/")) continue;
      internal++;
      const target = href.split("#")[0].split("?")[0];
      if (target === "") continue; // fragment/query on the page itself
      // CARVE-OUT REMOVED — tri-persona review Wave 4, item 1.
      //
      // This leg used to `continue` on every href starting with /assets/,
      // reasoning that the path is "RESOLVED AT RUNTIME" and the static
      // snapshot legitimately carries hrefs no local file backs. The premise
      // was true and the conclusion was the bug: a reader without JavaScript
      // — curl, wget, a copied link, any scripted fetch — never runs the
      // resolution, and got a same-origin 404 from all fifteen /downloads/
      // cards. The carve-out's own comment recorded that 404 as a verified
      // fact and skipped it anyway.
      //
      // The SSR base is now the real asset host (lib/asset-base.ts →
      // AssetConfigProvider ssrBase), so a /assets/ href in built HTML means
      // a component skipped that seed and is shipping a 404. Leg (h) below
      // checks the positive half: that the cards DO carry the host.
      const isFile = /\.[a-z0-9]+$/i.test(target);
      const resolved = isFile
        ? path.join(outDir, ...target.split("/").filter(Boolean))
        : htmlPathFor(target);
      if (!fs.existsSync(resolved)) {
        deadByTarget.set(target, (deadByTarget.get(target) ?? 0) + 1);
      }
    }
    const deadCount = [...deadByTarget.values()].reduce((a, b) => a + b, 0);
    if (deadCount > 0) {
      const sample = [...deadByTarget.keys()].slice(0, 10).join(", ");
      errors.push(
        `dead links on ${pageUrl}: ${deadCount} internal href(s) resolve to no built page ` +
        `(${deadByTarget.size} unique target(s); first: ${sample})`
      );
      for (const [target, count] of deadByTarget) {
        errors.push(`  dead link on ${pageUrl}: ${target}${count > 1 ? ` x${count}` : ""}`);
      }
    } else {
      notes.push(`dead links on ${pageUrl}: 0 of ${internal} internal hrefs ✓`);
    }
  }

  // ── (g) fragment links must land somewhere (tri-persona Wave 3) ──
  runFragmentLeg(errors, notes);

  // ── (h) every shipped dataset is downloadable without JS (Wave 4) ──
  runDownloadLinkLeg(errors, notes);

  // ── (f) universal PE linking on sampled program pages (Phase 5F §2a) ──
  {
    const detailsDir = path.join(jsonDir, "program_details");
    const dossiersDir = path.join(jsonDir, "dossiers");
    if (!fs.existsSync(detailsDir)) {
      errors.push("(f) pe-linking: data/site/json/program_details missing");
    } else {
      const allSlugs = fs
        .readdirSync(detailsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();
      const peSet = new Set(allSlugs);
      const findTokens = (text) => [...(text ?? "").matchAll(PE_TOKEN_RE)].map((m) => m[0]);

      // Sample: pages whose narratives reference OTHER PEs (up to 8), dossier
      // pages with cross-PE claims (up to 4), plus 3 rollup + 3 full generic.
      const sample = new Set();
      let fullSeen = 0;
      let rollupSeen = 0;
      let narrativeRefAdds = 0;
      for (const slug of allSlugs) {
        let sidecar;
        try {
          sidecar = JSON.parse(
            fs.readFileSync(path.join(detailsDir, `${slug}.json`), "utf8")
          );
        } catch {
          continue;
        }
        const isRollup = sidecar.tier === "rollup";
        if (isRollup && rollupSeen < 3) {
          sample.add(slug);
          rollupSeen++;
        }
        if (!isRollup && fullSeen < 3) {
          sample.add(slug);
          fullSeen++;
        }
        // Pages whose narratives reference OTHER PEs are the meaningful
        // targets for this leg — sample up to 8 of them.
        if (narrativeRefAdds < 8) {
          const narrativeText = (sidecar.narratives ?? [])
            .map((n) => n.body ?? "")
            .join("\n");
          if (findTokens(narrativeText).some((t) => peSet.has(t) && t !== slug)) {
            if (!sample.has(slug)) narrativeRefAdds++;
            sample.add(slug);
          }
        }
      }
      if (fs.existsSync(dossiersDir)) {
        let dossierAdds = 0;
        for (const f of fs.readdirSync(dossiersDir).filter((x) => x.endsWith(".json")).sort()) {
          if (dossierAdds >= 4) break;
          const slug = f.replace(/\.json$/, "");
          const raw = fs.readFileSync(path.join(dossiersDir, f), "utf8");
          if (findTokens(raw).some((t) => peSet.has(t) && t !== slug)) {
            sample.add(slug);
            dossierAdds++;
          }
        }
      }

      // Walk body text nodes; a linkable token outside an <a> is an error.
      const walkText = (node, insideAnchor, cb) => {
        if (node.nodeType === 3) {
          cb(node.rawText ?? "", insideAnchor);
          return;
        }
        const tag = node.tagName ? node.tagName.toLowerCase() : null;
        if (tag === "script" || tag === "style" || tag === "head") return;
        const nowInside = insideAnchor || tag === "a";
        for (const child of node.childNodes ?? []) {
          walkText(child, nowInside, cb);
        }
      };

      let scanned = 0;
      let unlinked = 0;
      const unlinkedDetails = [];
      for (const slug of [...sample].sort()) {
        const p = htmlPathFor(`/program/${slug}/`);
        if (!fs.existsSync(p)) {
          errors.push(`(f) pe-linking: sampled page /program/${slug}/ not built`);
          continue;
        }
        scanned++;
        const root = parse(fs.readFileSync(p, "utf8"), { comment: false });
        const body = root.querySelector("body") ?? root;
        walkText(body, false, (text, insideAnchor) => {
          if (insideAnchor) return;
          for (const token of findTokens(text)) {
            if (!peSet.has(token) || token === slug) continue;
            unlinked++;
            if (unlinkedDetails.length < 10) {
              unlinkedDetails.push(
                `/program/${slug}/: "${token}" in "${text.trim().slice(0, 80)}"`
              );
            }
          }
        });
      }
      if (unlinked > 0) {
        errors.push(
          `(f) pe-linking: ${unlinked} PE-shaped token(s) with pages are NOT <a>-wrapped on sampled pages:`
        );
        for (const d of unlinkedDetails) errors.push(`  ${d}`);
      } else {
        notes.push(`(f) pe-linking: ${scanned} sampled pages, 0 unlinked PE tokens ✓`);
      }
    }
  }

  return { pass: errors.length === 0, errors, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// leg (g) — a fragment link must land somewhere
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS, and it is an honest story. Wave 3 gave the WHO GETS IT
// card a "why" link for the sentence "No contract award is linked to this
// line", pointed at /coverage/#bridge — the id of the coverage-map ROW, which
// is a data key and not an element id. The page loads, the browser finds no
// anchor, and the reader lands at the top of a 12-section page having been
// promised the paragraph that explains their question. Leg (d) passed it:
// /coverage/ exists, and leg (d) strips the fragment before resolving,
// deliberately, because a dead page and a dead anchor are different failures.
// This is the second one. It was found by hand, on a build that had already
// passed 24 gates, which is the argument for the leg.
//
// SCOPE. Every singleton hub page — the same list leg (d) scans, where
// hand-written hrefs live — PLUS a sample of each templated detail type.
// Leg (d) excludes templated pages on the grounds that their risk is a shared
// template rather than a hand-written href; for FRAGMENTS that reasoning
// inverts, because a shared template means ONE wrong anchor ships on two
// thousand pages, which is exactly what happened. Sampling catches a template
// defect at the first sampled page, so a handful per type is enough.
//
// SAME-PAGE ANCHORS COUNT TOO ("#mentions-heading"), resolved against the
// source page's own ids: a jump link to a section that did not render is the
// same broken promise.

const FRAGMENT_HUB_PAGES = [
  "/", "/feed/", "/district/", "/programs/", "/companies/",
  "/companies/families/", "/filings/", "/data/", "/coverage/",
  "/methodology/", "/flow/", "/lineage/", "/agency/", "/years/",
  "/downloads/", "/glossary/", "/about/",
];

/** A few built pages of each templated type — evenly spread, not the head. */
function sampledDetailPages(perType = 6) {
  const out = [];
  for (const dir of ["program", "company", "agency", "filing", "district"]) {
    const abs = path.join(outDir, dir);
    if (!fs.existsSync(abs)) continue;
    const names = fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(abs, d.name, "index.html")))
      .map((d) => d.name)
      .sort();
    if (names.length === 0) continue;
    const stride = Math.max(1, Math.floor(names.length / perType));
    for (let i = 0, taken = 0; i < names.length && taken < perType; i += stride, taken += 1) {
      out.push(`/${dir}/${names[i]}/`);
    }
  }
  return out;
}

function runFragmentLeg(errors, notes) {
  const idCache = new Map();
  const idsOf = (pageUrl) => {
    if (!idCache.has(pageUrl)) {
      const p = htmlPathFor(pageUrl);
      if (!fs.existsSync(p)) idCache.set(pageUrl, null);
      else {
        const ids = new Set();
        for (const m of fs.readFileSync(p, "utf8").matchAll(/\sid="([^"]+)"/g)) {
          ids.add(m[1]);
        }
        idCache.set(pageUrl, ids);
      }
    }
    return idCache.get(pageUrl);
  };

  const pages = [...FRAGMENT_HUB_PAGES, ...sampledDetailPages()];
  const dead = new Map(); // "dest#frag" -> {count, sources:Set}
  let checked = 0;
  let scanned = 0;

  for (const pageUrl of pages) {
    const p = htmlPathFor(pageUrl);
    if (!fs.existsSync(p)) continue;
    scanned += 1;
    const html = fs.readFileSync(p, "utf8");
    const root = parse(html, { comment: false });
    for (const a of root.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") ?? "";
      if (!href.includes("#")) continue;
      const [rawTarget, frag] = href.split("#");
      if (!frag) continue; // bare "#" / "path#" — nothing promised
      if (rawTarget.startsWith("/assets/")) continue; // runtime-resolved host
      if (rawTarget !== "" && !rawTarget.startsWith("/")) continue; // external
      const destUrl = rawTarget === "" ? pageUrl : rawTarget;
      const ids = idsOf(destUrl);
      if (ids === null) continue; // dead PAGE — leg (d)'s finding, not this one
      checked += 1;
      // decodeURIComponent so an escaped anchor still matches its id
      let want = frag;
      try {
        want = decodeURIComponent(frag);
      } catch {
        /* malformed escape — compare raw */
      }
      if (!ids.has(want) && !ids.has(frag)) {
        const key = `${destUrl}#${frag}`;
        const rec = dead.get(key) ?? { count: 0, sources: new Set() };
        rec.count += 1;
        rec.sources.add(pageUrl);
        dead.set(key, rec);
      }
    }
  }

  if (dead.size > 0) {
    for (const [key, rec] of [...dead.entries()].sort((a, b) => b[1].sources.size - a[1].sources.size)) {
      errors.push(
        `dead fragment: ${key} — no element carries that id on the destination ` +
          `page (${rec.count} link(s) on ${rec.sources.size} of ${scanned} scanned page(s); ` +
          `first: ${[...rec.sources][0]})`,
      );
    }
  }
  notes.push(
    `leg g: ${checked} fragment link(s) across ${scanned} page(s) ` +
      `(${FRAGMENT_HUB_PAGES.length} hubs + sampled detail pages) — ` +
      `${dead.size} dead anchor(s)`,
  );
}

/**
 * Leg (h) — EVERY SHIPPED DATASET IS DOWNLOADABLE WITHOUT JAVASCRIPT.
 * Tri-persona review Wave 4, items 1 and 2.
 *
 * Two defects of one shape met on /downloads/:
 *
 *   1. Every href was `/assets/data/*.parquet` — a path nothing serves.
 *      The real URL was assembled client-side from /config.json, so the
 *      page worked in a browser and 404'd for `curl`, `wget`, a copied
 *      link and every scripted fetch. Leg (d)'s carve-out skipped exactly
 *      these hrefs, so no gate saw it.
 *   2. The card list was hand-authored in TSX while /data/ read the
 *      manifest, and the two drifted: budget_lines_decade (32,642 rows)
 *      and fct_district_totals were queryable and not downloadable.
 *
 * So the predicate is the union of both, asserted against the artifact
 * that decides the truth — data/site/json/datasets.json, the exporter's
 * inventory of what it actually wrote:
 *
 *   · every dataset in the manifest has a download href on /downloads/;
 *   · every one of those hrefs is an ABSOLUTE http(s) URL (fetchable with
 *     no JavaScript), not a same-origin /assets/ path;
 *   · the citation index (citations.parquet) is linked the same way.
 *
 * Independent of the page: the gate reads the manifest, not the component's
 * own idea of the list. If a card is dropped, or its href regresses to the
 * SSR fallback, or a new mart ships without a card, this fails.
 */
function runDownloadLinkLeg(errors, notes) {
  const manifestPath = path.join(jsonDir, "datasets.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push(`leg h: ${manifestPath} missing — cannot check download coverage`);
    return;
  }
  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(manifestPath, "utf8")).datasets ?? [];
  } catch (e) {
    errors.push(`leg h: datasets.json unreadable — ${e.message}`);
    return;
  }
  if (!Array.isArray(inventory) || inventory.length === 0) {
    errors.push("leg h: datasets.json lists no datasets");
    return;
  }

  const pagePath = htmlPathFor("/downloads/");
  if (!fs.existsSync(pagePath)) {
    errors.push(`leg h: /downloads/ not built (${pagePath} missing)`);
    return;
  }
  const root = parse(fs.readFileSync(pagePath, "utf8"), { comment: false });
  const hrefs = root
    .querySelectorAll("a[href]")
    .map((a) => a.getAttribute("href") ?? "");

  // Relative asset paths anywhere on the page are the original defect.
  const relative = hrefs.filter((h) => h.startsWith("/assets/"));
  if (relative.length > 0) {
    const uniq = [...new Set(relative)];
    errors.push(
      `leg h: /downloads/ ships ${relative.length} same-origin /assets/ href(s) ` +
        `(${uniq.length} unique; first: ${uniq[0]}). Nothing is served under ` +
        `/assets/ in production — these 404 for every client that does not run ` +
        `the client-side /config.json rewrite. Pass ssrBase={getAssetBase()} to ` +
        `<AssetConfigProvider>`,
    );
  }

  // Every manifest dataset needs an absolute href ending in its parquet.
  const absolute = hrefs.filter((h) => /^https?:\/\//i.test(h));
  const missing = [];
  const notAbsolute = [];
  for (const ds of inventory) {
    const suffix = `/data/${ds.name}.parquet`;
    if (absolute.some((h) => h.endsWith(suffix))) continue;
    if (hrefs.some((h) => h.endsWith(suffix))) notAbsolute.push(ds.name);
    else missing.push(ds.name);
  }
  if (missing.length > 0) {
    errors.push(
      `leg h: ${missing.length} shipped dataset(s) have no download link on ` +
        `/downloads/ — ${missing.join(", ")}. datasets.json is the inventory of ` +
        `what the exporter wrote; a parquet that ships without a card is ` +
        `queryable on /data/ and undownloadable`,
    );
  }
  if (notAbsolute.length > 0) {
    errors.push(
      `leg h: ${notAbsolute.length} dataset link(s) on /downloads/ are not ` +
        `absolute URLs — ${notAbsolute.join(", ")}`,
    );
  }
  if (!absolute.some((h) => h.endsWith("/citations/citations.parquet"))) {
    errors.push(
      "leg h: /downloads/ has no absolute link to citations/citations.parquet — " +
        "the citation index is what makes every other file checkable",
    );
  }
  if (missing.length === 0 && notAbsolute.length === 0 && relative.length === 0) {
    notes.push(
      `leg h: all ${inventory.length} shipped datasets + the citation index link ` +
        `to absolute asset-host URLs on /downloads/ (no /assets/ paths) ✓`,
    );
  }
}
