#!/usr/bin/env node
/**
 * generate-feeds.mjs — prebuild step (PM-review Sprint 3 Task 2, §P1-8).
 *
 * "A page called Feed has no subscription. /rss.xml → 404, /feed.xml → 404."
 *
 * The site is a STATIC EXPORT: there is no server to render a feed on
 * request, so the feeds must be real files produced at build time. They are
 * written into public/, which `next build` copies verbatim into out/ — the
 * same path prepare-assets.mjs already uses for llms.txt.
 *
 * WHAT IS EMITTED
 *   /rss.xml     whole feed (RSS 2.0)   — the canonical one
 *   /feed.xml    alias of /rss.xml      — both were reported 404 in §P1-8
 *   /atom.xml    whole feed (Atom 1.0)
 *   /feeds/{event_type}.xml       + .atom.xml
 *   /feeds/program/{pe_bli}.xml   + .atom.xml   (programs that have a page)
 *   /feeds/company/{slug}.xml     + .atom.xml   (top-200 companies)
 *
 * Every item carries the dollars the event is about, a /fact/{id} receipt
 * permalink, a stable guid, and a pubDate. The rules live in
 * src/lib/feed-model.mjs so the Next pages can advertise exactly the feeds
 * this script wrote — see that file's header.
 *
 * STALE FILES ARE DELETED FIRST. A program whose events disappear must lose
 * its feed, not keep serving last month's claims; the run starts by removing
 * public/feeds/ and the three whole-feed files.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
import { companyDisplay } from "../src/lib/company-name.mjs";
  buildFeedTargets,
  companyWatchPeBlis,
  renderRss,
  renderAtom,
} from "../src/lib/feed-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(siteDir, "..");
const jsonDir = path.resolve(repoRoot, "data", "site", "json");
const publicDir = path.resolve(siteDir, "public");

const SITE_NAME = "Fiscal Receipts";
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://govbudget-placeholder.example"
).replace(/\/$/, "");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(jsonDir, rel), "utf8"));
}

function fatal(msg) {
  console.error(`\n❌  FATAL: generate-feeds: ${msg}\n`);
  process.exit(1);
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/**
 * Collect everything the feed model needs from the exported sidecars.
 * Every set here mirrors a rule the site already enforces elsewhere:
 * `programPages` is the generateStaticParams universe (the G1 dead-link
 * contract), `companySlugByFamilyKey` is the top-200 entity index.
 */
export function collectFeedInputs() {
  const feed = readJson("feed.json");
  const meta = readJson("site_meta.json");
  const cards = feed.cards ?? [];
  if (cards.length === 0) fatal("feed.json carries no cards — run export-site");

  const missingMagnitude = cards.filter((c) => !c.magnitude || !c.magnitude.to);
  if (missingMagnitude.length > 0) {
    // §P1-8's substantive half: an item without a dollar magnitude is the
    // defect, not a degraded-but-acceptable item. Fail loudly at build time.
    fatal(
      `${missingMagnitude.length} feed card(s) carry no dollar magnitude ` +
        `(first: ${JSON.stringify(missingMagnitude[0].headline)}) — ` +
        `the exporter must emit one for every card`,
    );
  }

  const programPages = new Set(
    fs
      .readdirSync(path.join(jsonDir, "program_details"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length)),
  );

  const programTitles = new Map(
    readJson("programs.json").map((p) => [p.pe_bli, p.title]),
  );

  const entitiesTop = readJson("entities_top.json");
  const companySlugByFamilyKey = new Map(
    entitiesTop.map((e) => [e.family_key, e.slug]),
  );

  // A company watch feed covers the program elements THE COMPANY PAGE ITSELF
  // LINKS TO: high-confidence budget-to-award crosswalk rows plus
  // lobbying-filing mentions. Both bases are counted separately so the feed's
  // own description can state which link it is built on — the link is a
  // documented connection, never a claim of ownership.
  const companyWatch = [];
  for (const e of entitiesTop) {
    let details;
    try {
      details = readJson(path.join("entity_details", `${e.slug}.json`));
    } catch {
      continue; // no detail sidecar → nothing to watch; company page handles it
    }
    const watch = companyWatchPeBlis(details);
    if (watch.peBlis.size === 0) continue;
    companyWatch.push({
      slug: e.slug,
      // §P2-4: the feed title is a DISPLAY surface — a subscriber's
      // reader shows it verbatim, so it gets the same casing as the page.
      displayName: companyDisplay(e.display_name),
      familyKey: e.family_key,
      ...watch,
    });
  }

  return {
    cards,
    pubDate: meta.built_at,
    programPages,
    programTitles,
    companySlugByFamilyKey,
    companyWatch,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

function rmIfExists(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function writeFile(relPath, body) {
  const dest = path.join(publicDir, relPath.replace(/^\//, ""));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body, "utf8");
}

function main() {
  const input = collectFeedInputs();

  const targets = buildFeedTargets({
    ...input,
    siteUrl: SITE_URL,
    siteName: SITE_NAME,
  });

  // Stale-file sweep — see the header note.
  rmIfExists(path.join(publicDir, "feeds"));
  for (const f of ["rss.xml", "feed.xml", "atom.xml"]) {
    rmIfExists(path.join(publicDir, f));
  }

  let files = 0;
  let items = 0;
  for (const t of targets) {
    const rss = renderRss(t, SITE_URL);
    writeFile(t.rssPath, rss);
    files += 1;
    for (const alias of t.aliasPaths ?? []) {
      // The alias is byte-identical to the canonical file EXCEPT its
      // atom:link rel=self, which must name the alias's own URL or
      // aggregators de-duplicate the two into one subscription.
      writeFile(alias, renderRss({ ...t, rssPath: alias }, SITE_URL));
      files += 1;
    }
    writeFile(t.atomPath, renderAtom(t, SITE_URL));
    files += 1;
    items += t.items.length;
  }

  const byKind = targets.reduce((acc, t) => {
    acc[t.kind] = (acc[t.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `✓  feeds generated: ${files} files, ${targets.length} feeds ` +
      `(${Object.entries(byKind)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")}), ${items} items total, ` +
      `${input.cards.length} cards in the whole feed, base ${SITE_URL}`,
  );
}

// Run when invoked directly (prebuild); importable for tests.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}

export { main };
