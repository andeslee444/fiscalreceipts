/**
 * gate 1 — build_gate (mechanical checks on out/)
 *
 * Checks:
 * - program pages == programs.json count (data-driven: dim_programs +
 *   trajectory-only feed programs)
 * - agency pages == distinct orgs from agencies.json
 * - company pages == 200 (entities_top.json count)
 * - core pages present (/, /programs, /companies, /data, /flow, /downloads, /methodology, /glossary, /about)
 * - out/pagefind/pagefind.js exists
 * - sitemap URL count == emitted pages AND every URL starts with SITE_URL origin
 * - robots.txt present
 * - llms.txt contains /methodology/, /downloads/, ≥1 /program/ URL
 * - placeholder-origin scan (backlog #18): sitemap.xml / llms.txt /
 *   robots.txt / index.html must NOT contain govbudget-placeholder.example —
 *   UNCONDITIONAL (env-independent), unlike the sitemap-origin leg below
 *   which compares against the verify-time NEXT_PUBLIC_SITE_URL and would
 *   false-pass a placeholder build verified without the env
 * - citations.json key count == manifest citation total (from site_meta.json, data-driven)
 * - download cards: citations.parquet href == /citations/citations.parquet (not /data/)
 * - stale-literal check: built downloads page must NOT contain hardcoded "44,754"
 * - fact-permalink route (PM Sprint 1 Task 5, §P0-4): out/vercel.json exists
 *   AND carries the `/fact/:id` → `/fact/` rewrite AND out/fact/index.html
 *   exists — the deploy can never ship footnote permalinks that 404
 * - (f1) fact-permalink trailing slash (ROADMAP #61, Sprint C Task C2):
 *   out/vercel.json ALSO carries the `/fact/:id/` → `/fact/` rewrite — the
 *   unslashed form alone left /fact/{id}/ 404ing, the one form external
 *   citations (CMSes, link-checkers) normalize onto. Config-shape only; see
 *   the leg's own comment for what it does and does not prove
 * - page-weight budget (PM Sprint 3 §P2-1): per-page raw AND gzip ceilings
 *   over the singleton pages and the heaviest instance of each templated
 *   class — see PAGE_WEIGHT_BUDGET below for why it is per-page and not a
 *   total over out/
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(siteRoot, "out");
const dataDir = path.resolve(siteRoot, "..", "data", "site");
const jsonDir = path.resolve(dataDir, "json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(p) {
  return fs.existsSync(p) && fs.statSync(p).isFile();
}

function dirExists(p) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

// ── Page-weight budget (PM-review Sprint 3 §P2-1) ───────────────────────────
//
// WHY THIS EXISTS. The PM review found the index pages shipping multi-megabyte
// documents. Measured at the start of Sprint 3, /programs/ was 5,875,345 bytes
// (442,874 gzipped) with all 1,741 rows inline — and it had GROWN, because
// Sprint 2's filter/sort/CSV work added markup nobody weighed. Weight is the
// kind of regression that arrives one honest feature at a time and is never
// anybody's bug, so it gets a number and a gate like every other claim here.
//
// WHAT IT PINS. A ceiling per PAGE, never a total over out/ — the corpus grows
// (1,993 program pages today, more with each service book) and a total-bytes
// budget would fail on growth rather than on weight. The templated classes are
// covered by their HEAVIEST built instance, so the whole fleet is measured
// without pretending a fixed instance stays the fattest.
//
// Ceilings sit a few percent above what the Sprint 3 build actually achieves
// (recorded in each entry) — close enough to catch a regression, loose enough
// that ordinary data movement does not trip it. RAISING one is a deliberate
// act that has to be justified in the same breath as the change that needs it.
//
// gzip is measured with zlib level 9 — the transfer size a reader pays. Raw is
// the parse/DOM cost, which is what actually hurts a phone, so both are pinned.
//
// WHERE THE BYTES ACTUALLY GO, on the two tightest pages (measured
// 2026-08-28 with this file's own weigh()/resolveBudgetTarget, so the next
// person does not repeat the search):
//
//   /data/               92,468 raw / 13,172 gzip — 328 bytes of headroom.
//                        49,326 raw of it is the RSC flight payload, which
//                        costs 6,635 gzip: HALF the page is Next's second
//                        copy of the same server tree, and it is what makes
//                        the page hydrate. The other half is prose plus one
//                        16-row inventory table.
//   /companies/families/ 223,384 / 25,502 — 498 bytes of headroom. 141,423
//                        raw / ~14,548 gzip is the flight payload; 21,023 of
//                        that is the embedded citation slice.
//
// Four candidates were measured and REJECTED, each for a stated reason:
//   · Empty the citation slice, as /programs/, /feed/, /years/ and /flow/ all
//     do. Would save ~2 KB gzip — but those pages have no derived-input
//     drill-down, and this one does: all 29 rows are `derived`, the panel's
//     hasCitation() is synchronous, and /companies/families/ promises in
//     prose that a reader can "drill into each member". Emptying the slice
//     silently makes those chips unclickable. That is trimming disclosure.
//   · Drop `description` from the <Explorer> props on /data/ (the 16 scope
//     sentences, already in the inventory table above it). Measured at 3,534
//     raw / 194 gzip — and the explorer renders the selected dataset's scope
//     under its picker, so this removes disclosure for 194 bytes.
//   · Drop data-external-source / data-source-form on /companies/families/
//     (1,998 + 593 raw, duplicating the anchor's own href and text). They are
//     the hooks gate 3's mobile leg and gate 24 read. Removing them weakens
//     two gates.
//   · Drop role="cell"/role="row" from the mobile-card tables. The rows are
//     `display:block` below sm, which drops the implicit table semantics —
//     the roles are what restores them.
//
// So: nothing honest was removed. The finding is that these two pages are
// small documents whose weight is mostly framework duplication, not payload
// anyone chose. The next real change here needs a justified raise, not a
// hunt for slack that is not there.
export const PAGE_WEIGHT_BUDGET = [
  // Singleton pages. `measured` is the Sprint 3 post-fix build.
  // Re-baselined 2026-08-21 (Sprint E). The key split gives each
  // (account, pe_bli) pair its own row: 10 legitimate new programs worth
  // $5.35B — LPD Flight II $2.60B, Medium Landing Ship $1.96B — plus
  // corrected figures on the six rows that were previously publishing a
  // fused total. 277,357 -> 279,513 gzip.
  //
  // NOTE THE HEADROOM, not just the number. This entry's gzip ceiling was
  // set at 278,000 against a 261,871 measurement — 6.2% headroom — and
  // ordinary corpus growth ate it down to 0.23% (643 bytes) without anyone
  // noticing, which is why ten new rows breached it instantly. Restoring
  // 6.2% rather than the 0.23% that had drifted in: re-baselining to the
  // CURRENT proportional headroom would hand the next change the same
  // cliff. Gate 1's near-ceiling note (added 2026-08-14) is what stops
  // this recurring silently.
  //
  // RE-BASELINED 2026-08-29 (tri-persona Wave 5) — CEILINGS RAISED, AND THE
  // CHANGE THAT NEEDS THEM IS THIS ONE. Wave 5 parsed the five FY2026 Navy
  // procurement appropriations the pipeline had been discarding (APN, PMC,
  // WPN, SCN, PANMC — six masters where a filename rule had kept one), and
  // programs.json went from 1,755 entries to 1,938. This page is the index
  // of every one of them, so it grew by construction: 2,686,677 / 281,116 ->
  // 2,962,701 / 311,339, breaching both ceilings.
  //
  // Nothing was trimmed to fit and nothing should be: 183 more rows on the
  // program index is the entire point of the ingestion. Same ~6% headroom
  // rule the Sprint E entry above established (re-baselining to the CURRENT
  // proportional headroom hands the next change the same cliff): 3,150,000
  // is 6.32% over the raw measurement, 330,000 is 7.05% over the gzip one.
  { label: "/programs/", file: "programs/index.html", maxRaw: 3_150_000, maxGzip: 330_000, measured: "2,962,749 / 308,295" },
  { label: "/years/", file: "years/index.html", maxRaw: 45_000, maxGzip: 9_000, measured: "33,035 / 6,652" },
  // Re-baselined 2026-09-01 (FPDS-AP expansion): the crosswalked-PE universe
  // grew 24 → ~186 and the feed derives from it — cards 160 → ~720. Corpus
  // growth, not template bloat (the per-card markup is unchanged). Ceilings
  // follow the ~6% convention over the expansion build's measure. A 4MB raw
  // feed is at the edge of reasonable — pagination is filed as follow-up,
  // and this ceiling must NOT be raised again without it.
  // 2026-09-02: the do-not-raise-again note above is honored — the feed page
  // is now a per-section digest (FEED_SECTION_CAP = 75 in feed/page.tsx;
  // full set in feed.json + RSS/Atom) and the ceiling comes DOWN. Provisional
  // ceilings from the expected ≤300-card page; `measured` is updated from
  // the first capped build.
  { label: "/feed/", file: "feed/index.html", maxRaw: 3_200_000, maxGzip: 150_000, measured: "1,278,916 / 69,534" },
  // RE-BASELINED 2026-08-29 (tri-persona Wave 5) — CEILINGS RAISED, SAME
  // CHANGE. 1,260,784 / 80,771 -> 1,389,568 / 89,557, breaching both.
  //
  // Where the bytes are, measured rather than assumed: 1,341,090 of the
  // page's 1,389,357 raw bytes are inline <script>, and 1,239,952 of those
  // are one RSC flight chunk carrying the page's citation slice — 1,802
  // citations, whose first entry on this build is Virginia Class Submarine's
  // 10,656.927. The homepage cites its hero, its movers and its agency grid,
  // and every one of those slices is drawn from the corpus Wave 5 grew. The
  // page renders 17 program links; the weight is disclosure payload, not
  // markup, and there is nothing to trim that would not remove a citation.
  //
  // ~6% headroom against the new measurement: 1,475,000 is 6.16% over raw,
  // 95,000 is 7.88% over gzip.
  { label: "/", file: "index.html", maxRaw: 1_475_000, maxGzip: 95_000, measured: "1,389,228 / 88,022" },
  { label: "/companies/", file: "companies/index.html", maxRaw: 710_000, maxGzip: 69_000, measured: "684,005 / 67,188" },
  // New page, ROADMAP #29(c) — the lineage identity map. 32 family diagrams
  // (80 identity boxes, 49 stated ribbons), 3 candidate diagrams, and two
  // table views totalling 86 identity rows and 52 link rows. The weight is
  // overwhelmingly the RSC flight payload: the whole lineage_flow.json
  // payload (33,649 bytes on disk) crosses the server→client boundary as
  // props, because the diagram is an island that opens the citation panel
  // from a ribbon.
  //
  // Same ~8% headroom convention as the other new-page entries (/agency/,
  // /district/, /companies/families/) rather than a round-number guess:
  // 340,000 against 315,463 is 7.78% raw; 36,000 against 33,369 is 7.89%
  // gzip. Measured with this file's OWN weigh() — zlib level 9 — on the
  // 2026-08-28 build, and on a build run WITH NEXT_PUBLIC_SITE_URL set: an
  // earlier measuring pass without it wrote the placeholder origin into 16
  // hrefs and read 176 raw / 37 gzip bytes light. Three agents have got a
  // page-weight annotation wrong by measuring with a different tool; this
  // one imports the gate's and states which build it read.
  //
  // RAISED 2026-08-31 (ROADMAP #29(a) — LLM lineage extraction). The page
  // draws the whole corpus, and the corpus doubled: stated edges 49 -> 98,
  // families 32 -> 52, identities 86 -> 154. 539,883 / 50,438 against the
  // 340,000 / 36,000 above. This is the change the page exists to show, so
  // the ceiling follows it, at the same ~8% convention: 585,000 is 8.36%
  // over raw, 54,500 is 8.05% over gzip.
  //
  // TRIMMING WAS TRIED FIRST AND MEASURED, so nobody repeats the experiment.
  // Two candidates dominate the markup — the `font-family` attribute repeated
  // verbatim on 154 text elements (9,394 bytes) and the 444-character
  // Fact-ID chip class repeated on 98 edges (43,414 bytes; the chip's weight
  // is already filed as backlog #43 and is a shared component, out of scope
  // here). Removing BOTH, measured with this file's own weigh():
  //     baseline           539,883 / 50,438
  //     minus font-family  530,489 / 50,223   (-9,394 raw, -215 gzip)
  //     minus chip class   496,469 / 49,957   (-43,414 raw, -481 gzip)
  //     both               487,075 / 49,739   (-52,808 raw, -699 gzip)
  // 52,808 raw bytes buy 699 gzip bytes — 1.4% — because repeated identical
  // strings are exactly what gzip already collapses. The gzip weight is
  // DISTINCT content: 98 evidence sentences, 154 identity labels, 101 edge
  // descriptions, none of which repeat. No amount of markup tidying reaches
  // 36,000, and removing a citation to fit a ceiling is not on the table.
  { label: "/lineage/", file: "lineage/index.html", maxRaw: 585_000, maxGzip: 54_500, measured: "539,950 / 50,468" },
  // Re-baselined 2026-09-01 (FPDS-AP expansion): district universe 41 → 181
  // pages and the index states them all. Same corpus-growth rationale as
  // /feed/ above; ~6% convention over the expansion build's measure.
  // Re-measured again 2026-09-02: announcement-verified links (wave 1) took
  // districts 181 → 204; the index states them all. ~6% over the measure.
  // 2026-09-03: districts 204 → 225 with wave-2 links; ~6% over the measure.
  { label: "/district/", file: "district/index.html", maxRaw: 546_000, maxGzip: 51_000, measured: "515,448 / 48,126" },
  // Re-baselined 2026-09-01: grew +2,319 raw since the ceiling was set via
  // ordinary curated-events/table growth (#10 relabel note, adjudication
  // tier changes), tipping a 159-byte breach. ~6% convention.
  { label: "/companies/families/", file: "companies/families/index.html", maxRaw: 239_700, maxGzip: 27_900, measured: "226,159 / 26,340" },
  // RE-BASELINED 2026-08-29 (tri-persona Wave 5) — CEILINGS RAISED, SAME
  // CHANGE. 93,911 / 13,340 -> 94,741 / 13,619, and the gate's own run on the
  // pre-fix build read 13,657 against a 13,500 ceiling — over by 157, with 259
  // bytes of raw headroom left, which is the same cliff rather than a pass.
  // This page renders the dataset inventory, and Wave 5 moved it:
  // jbook_details went from 21,028 rows to 21,993 and gained an `account`
  // column (the appropriation each detail figure was filed under — without
  // it, summing that table by pe_bli adds ten pairs of unrelated Navy
  // programs together), and its scope sentence now says so.
  //
  // ~6% headroom against the new measurement: 101,000 is 6.34% over raw,
  // 14,450 is 6.02% over gzip.
  { label: "/data/", file: "data/index.html", maxRaw: 101_000, maxGzip: 14_450, measured: "94,830 / 13,678" },
  // New page, Sprint C Task C3 (ROADMAP #62) — the /agency/ index (23 rows,
  // two <Cite> figures each). Same ~8% headroom convention as the other
  // section indexes above (/district/, /companies/families/) rather than a
  // round-number guess.
  //
  // RE-MEASURED 2026-08-29 (tri-persona Wave 3). CEILING UNCHANGED. The 24
  // rows carry their components' NAMES now, not bare acronyms ("TJS" was 21
  // of 24 cards on this list and the <h1> of the page each one links to), and
  // longer strings on an index page cost real bytes: 180,412 -> 184,181 raw.
  // An earlier draft ALSO gave each row a workbook-code chip and landed at
  // 189,750 of 190,000 — 250 bytes, 99.9%, the same cliff /coverage/ hit at
  // nine and /programs/ at 643. The chip came off this page instead of the
  // ceiling coming up (every row's href and title already carry the code, and
  // the destination states it outright). 5,819 raw bytes of room now, and the
  // recorded pair says so: the drift leg below reads THIS string, and the old
  // one would have promised 9,588.
  //
  // RE-BASELINED 2026-08-29 (tri-persona Wave 5) — CEILINGS RAISED, SAME
  // CHANGE. 185,075 / 47,214 -> 192,318 / 52,220, breaching both.
  //
  // AND THE PAGE'S PROSE GOT SHORTER, so the growth is worth naming exactly.
  // Every agency total on this index is a DERIVED sum and cites its inputs.
  // Wave 5 gave the Navy 183 more programs, and the two Navy derived facts'
  // input lists grew with them: the FY2024 and FY2026 citations for org N
  // are 12,887 and 12,154 bytes of JSON on this build (11,180 and 10,520
  // input ids), and the whole slice this page carries is 102,551 bytes. That
  // is the derivation a reader clicks a total to see. Shrinking it means
  // publishing a sum whose inputs are not listed.
  //
  // The §P0-6 note above this table was rewritten SHORTER in the same wave
  // (the ranking is no longer uneven — N 97.0%, F 99.0%, A 99.5% of their
  // workbook totals), so none of this growth is prose.
  //
  // ~6% headroom against the new measurement: 204,000 is 6.13% over raw,
  // 53,700 is 6.12% over gzip. (A first pass set the gzip pair from a
  // measurement taken with Python's zlib.compress instead of the gate's
  // zlib.gzipSync — 52,220 against the gate's own 50,601 — and would have
  // banked 9.5% of unearned headroom. This file has now recorded three
  // agents mis-measuring this table with the wrong tool; the numbers above
  // are the gate's, read by importing PAGE_WEIGHT_BUDGET and calling its
  // weigh().)
  { label: "/agency/", file: "agency/index.html", maxRaw: 204_000, maxGzip: 53_700, measured: "192,327 / 50,615" },
  // Re-baselined 2026-08-08 (Sprint A′). The 2026-08-08 corrections table added
  // ~16.3 KB raw / ~4.1 KB gzip: six was/now rows recording the figures this
  // sprint moved (district $8.01B→$5.58B, mentions 34,538→10,447, the /programs/
  // denominator, stated lineage edges 31→29, the FY2026 reconciliation split,
  // and the R-1 basis chip). The page is heavier because it now documents six
  // corrections — that is this page's job, and trimming the disclosure to fit a
  // budget would be the wrong trade. Ceilings carry the SAME proportional
  // headroom the previous pair did (raw ×1.1215, gzip ×1.0986), so the budget
  // still catches unintended growth from here.
  //
  // Re-baselined 2026-08-24 (ROADMAP #69) — CEILING RAISED, STATED PLAINLY.
  // The 2026-08-08 pair above was set against 125,112 / 33,863. By this
  // build the page had drifted to 127,800 / 34,494 WITHOUT the #69 row:
  // SIX bytes of gzip headroom (0.017%), the identical cliff /coverage/ hit
  // at nine bytes and /programs/ at 643. The near-ceiling note added
  // 2026-08-14 is doing its job — this page has been reported at 99.9% —
  // but a note is not a re-baseline, and any addition at all now fails.
  //
  // #69's seventh corrections row costs 853 raw / 267 gzip. The 2026-08-08
  // entry's own rule applies unchanged: "The page is heavier because it now
  // documents six corrections — that is this page's job, and trimming the
  // disclosure to fit a budget would be the wrong trade." It documents
  // seven now. So the row stays and the ceiling moves, rather than the
  // correction being written short enough to fit.
  //
  // Restoring ~6% headroom against the new measurement (the /programs/
  // Sprint E rule: re-baselining to the CURRENT proportional headroom hands
  // the next change the same cliff), not a round-number guess.
  //
  // CORRECTION 2026-08-28: that last sentence is false, and it is the exact
  // species of error the drift leg below was built for — except the drift leg
  // reads `measured`, not prose, so it could not see it. The pair below does
  // NOT deliver ~6%: 36,900 against 36,156 is 744 bytes, 2.06%; 136,500
  // against 132,816 is 3,684 bytes, 2.77%. #69 wrote down the intent and not
  // the arithmetic, so /methodology/ has been sitting at 98.0% of its gzip
  // ceiling since — reported by the near-ceiling note every build, while this
  // comment told anyone who read it there was three times that much room.
  // The smaller true number is published here rather than the ceiling being
  // widened to make the claim come true: the ceiling is UNCHANGED, and the
  // next sentence that needs to go on this page still has to be argued for
  // in the same breath as the raise it needs.
  //
  // RE-MEASURED AGAIN 2026-08-29 (tri-persona Wave 3). CEILING UNCHANGED.
  // Wave 3 put /glossary/ in the desktop nav — the tenth link, shipping on
  // 6,700+ pages — and this is the page that pays most dearly for a sitewide
  // addition. It cost ELEVEN gzip bytes here (36,642 -> 36,653), and the pair
  // below is re-measured to what the page now weighs rather than left to rot:
  // 247 bytes of headroom, which is what the next sentence on this page has
  // to argue against. Same rule as the note below it: the smaller true number
  // gets published, the ceiling does not move.
  //
  // RE-MEASURED 2026-08-29 (tri-persona review Wave 2). CEILING UNCHANGED at
  // 136,500 / 36,900. The recorded pair was 132,816 / 36,156 and the page had
  // already drifted to 134,024 / 36,389 before this wave touched it; Wave 2's
  // reconciliation-scope sentence (the badge covers four scenarios, not the
  // never-checked AllPriorYears) added 253 raw / 253 gzip. The annotation-drift
  // leg below caught the stale string on the first post-fix build, which is
  // what it was written for. 258 bytes of gzip headroom is the tightest this
  // page has ever run: the next sentence here needs a ceiling raise argued in
  // the same breath, and this comment is the warning, not an invitation.
  // RE-MEASURED 2026-08-29 (tri-persona Wave 5). CEILING UNCHANGED, AND THE
  // NUMBER IS STILL ALARMING: 135,373 / 36,870 -> 135,373 / 36,866. The page
  // did not grow at all — it came in FOUR bytes lighter — so Wave 5 raised
  // five ceilings on this build and deliberately not this one. 34 bytes of
  // gzip headroom. The rule from the 2026-08-28 correction above stands: a
  // raise is argued in the same breath as the change that needs it, and no
  // sentence was added here to argue for one.
  // RAISED 2026-08-29 for ROADMAP #28, justified by the change that needed
  // it. gzip 36,900 -> 39,100. The page breached by EIGHT bytes because 553
  // decade-only pages moved the corpus counts this page derives from — it
  // states them, so growing the corpus grows the page. Nothing was trimmed;
  // headroom restored to ~6% (the /programs/ convention) rather than to the
  // breach. Raw was NOT raised: 135,373 of 136,500 is comfortable.
  // Re-baselined 2026-09-01: §4 gained two disclosure paragraphs (the
  // hand-adjudication method with its 9.1% measured precision, and the
  // FPDS-AP acquisition-program evidence path). Deliberate prose growth on
  // the page whose job is to disclose method; ~6% convention over the
  // expansion build's measure.
  // Re-measured 2026-09-03 (announcement + subaward evidence-path paragraphs).
  { label: "/methodology/", file: "methodology/index.html", maxRaw: 155_000, maxGzip: 42_500, measured: "150,339 / 41,862" },
  // Task 6 (§Coverage). Twelve rows of prose; it grows a paragraph at a time
  // as features land, which is exactly the shape §P2-1 wants weighed.
  //
  // Re-baselined 2026-08-13 (Sprint C). This page had drifted to 16,491 of its
  // 16,500 gzip ceiling — NINE bytes of headroom — through ordinary prose growth
  // across prior sprints, without anyone noticing it was that close. Sprint C's
  // sitewide footer link to the new /glossary/ costs ~22 gzip bytes on every
  // page and tipped it to 16,513 (+13).
  //
  // The link is not optional: a glossary a reader cannot find is not shipped,
  // and the alternative — trimming /coverage/'s prose to buy back 13 bytes —
  // would cut disclosure to satisfy a budget, which is the wrong direction on
  // the page whose job is stating what the corpus does and does not cover.
  // Verified irreducible: a plain <a> costs the same as next/link, because the
  // layout's Server Component tree is duplicated into the RSC flight payload
  // regardless of element type.
  //
  // Both ceilings re-derived at the SAME proportional headroom the previous
  // pair carried (raw ×1.0708, gzip ×1.0742), so the budget still catches
  // unintended growth from here rather than being merely widened.
  // RE-BASELINED 2026-08-29 (tri-persona Wave 5) — CEILINGS RAISED, AND THIS
  // ONE NEEDS SAYING PLAINLY BECAUSE IT LOOKS LIKE A PASS.
  //
  // Wave 5 REPLACED this page's program-pages blocker rather than adding to
  // it: the unparsed-volume backlog it confessed no longer exists, and the
  // row now says so. The replacement plus the recomputed figures beside it
  // still took the page from 95,638 / 17,638 to 95,952 / 17,708 — over the
  // 17,700 ceiling by 8 bytes, measured by the gate on that build. It came
  // back UNDER (95,766 / 17,694, six bytes clear) only because a later edit
  // shortened one sentence, and that edit was made for accuracy — the old
  // wording attributed the residual excluded lines to "the services", which
  // is wrong for the Defense Health and reconciliation lines in it — not to
  // fit a budget. Six bytes is not headroom either way, and leaving the
  // ceiling where it is would mean this page's next true sentence has to be
  // paid for by deleting another one.
  //
  // So the ceiling moves, on the breach this change caused, restored to ~6%
  // against the current measurement (101,500 is 5.99% over raw, 18,750 is
  // 5.97% over gzip) rather than to the 0.03% it had drifted to.
  { label: "/coverage/", file: "coverage/index.html", maxRaw: 101_500, maxGzip: 18_750, measured: "96,898 / 18,105" },
  // Templated classes — the heaviest built instance of each.
  // The heaviest instance is /agency/N/ since Wave 5, not /agency/F/ — the
  // Navy overtook the Air Force on this page class for the same reason it
  // overtook it on the index: 183 more programs.
  { label: "/agency/*/ (heaviest)", dir: "agency", maxRaw: 2_060_000, maxGzip: 137_000, measured: "1,791,697 / 120,681 (/agency/N/)" },
  { label: "/program/*/ (heaviest)", dir: "program", maxRaw: 1_180_000, maxGzip: 151_000, measured: "1,110,842 / 142,829 (/program/0601102A/)" },
  { label: "/company/*/ (heaviest)", dir: "company", maxRaw: 545_000, maxGzip: 25_000, measured: "378,129 / 22,330 (/company/boeing/)" },
  // RAISED 2026-08-29, 325,000 -> 347,500 raw. Justified by the change that
  // needed it, per this file's own rule -- not pre-emptively. Two changes
  // landed together: Wave 5's Navy ingestion gave 183 more programs a
  // parseable title, and the LDA re-pull grew program mentions 12,448 ->
  // 14,016 across 499 programs (was 453). Filing pages list the programs a
  // filing names, so the heaviest one gained ~12,000 raw bytes of real,
  // cited content. Nothing was trimmed to avoid this.
  //
  // gzip is UNCHANGED at 27,500 and is not close: 22,532, 18% headroom. Only
  // the raw ceiling moved, restored to ~6% headroom (the /programs/ Sprint E
  // convention) rather than to the drift.
  { label: "/filing/*/ (heaviest)", dir: "filing", maxRaw: 347_500, maxGzip: 27_500, measured: "327,829 / 22,572" },
];

/** raw + gzip(level 9) bytes of one built file. */
function weigh(absPath) {
  const buf = fs.readFileSync(absPath);
  return { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length };
}

/**
 * Resolve a budget entry to the ONE file it measures: the named file, or the
 * heaviest index.html in a templated directory (raw size picks the candidate —
 * cheap over 4,394 filings — and only that one gets gzipped).
 */
function resolveBudgetTarget(entry) {
  if (entry.file) {
    const p = path.join(outDir, entry.file);
    return fileExists(p) ? { path: p, rel: entry.file } : null;
  }
  const base = path.join(outDir, entry.dir);
  if (!dirExists(base)) return null;
  let worst = null;
  for (const slug of fs.readdirSync(base)) {
    const p = path.join(base, slug, "index.html");
    let size;
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    if (!worst || size > worst.size) {
      worst = { size, path: p, rel: path.join(entry.dir, slug, "index.html") };
    }
  }
  return worst;
}

/** The leg. Returns {errors, notes} so runBuildGate can fold them in. */
/** Gzip-ceiling usage at or above which a page is reported as near-ceiling. */
const NEAR_CEILING_PCT = 90;

export function checkPageWeight() {
  const errors = [];
  const notes = [];
  const lines = [];
  const nearCeiling = [];

  for (const entry of PAGE_WEIGHT_BUDGET) {
    const target = resolveBudgetTarget(entry);
    if (!target) {
      errors.push(
        `page weight: ${entry.label} — nothing built to measure (${entry.file ?? `out/${entry.dir}/*/index.html`})`
      );
      continue;
    }
    const { raw, gzip } = weigh(target.path);
    if (raw > entry.maxRaw) {
      errors.push(
        `page weight: ${entry.label} is ${raw.toLocaleString()} bytes, over its ${entry.maxRaw.toLocaleString()}-byte ceiling (+${(raw - entry.maxRaw).toLocaleString()}) — measured at ${entry.measured} when the ceiling was set [${target.rel}]`
      );
    }
    if (gzip > entry.maxGzip) {
      errors.push(
        `page weight: ${entry.label} is ${gzip.toLocaleString()} bytes gzipped, over its ${entry.maxGzip.toLocaleString()}-byte ceiling (+${(gzip - entry.maxGzip).toLocaleString()}) — measured at ${entry.measured} when the ceiling was set [${target.rel}]`
      );
    }
    // NEAR-CEILING WARNING (2026-08-14). A ceiling is a cliff: it says nothing
    // until it says FAIL. /coverage/ drifted to NINE bytes of headroom through
    // ordinary prose growth and nobody knew until a one-line footer link tipped
    // it, and /methodology/ did the same thing a week earlier. Worse, every
    // `measured` string in this file had gone stale — /programs/ recorded
    // 261,871 while actually shipping 277,357, so the file itself told a reader
    // there was 6% headroom where there was 0.2%. The strings were refreshed
    // 2026-08-14; this note is what stops them rotting again unnoticed.
    //
    // A NOTE, not an error: six pages are legitimately above 94% today, and
    // failing on that would be inventing a stricter budget than anyone agreed
    // to. It is early warning, so the next person to add a sentence knows
    // before they spend an hour on the build that fails.
    const pctUsed = (100 * gzip) / entry.maxGzip;
    if (pctUsed >= NEAR_CEILING_PCT) {
      nearCeiling.push(
        `${entry.label} ${pctUsed.toFixed(1)}% (${gzip.toLocaleString()}/${entry.maxGzip.toLocaleString()} gzip, ${(entry.maxGzip - gzip).toLocaleString()} bytes left)`
      );
    }
    // ANNOTATION-DRIFT LEG (2026-08-24). The `measured` strings above are
    // the only page-weight facts a human reads WITHOUT running a build, and
    // they have now gone stale twice: /programs/ on 2026-08-14 (261,871
    // recorded against 277,357 shipped) and /filing/*/ today (21,784
    // recorded, 26,526 actual — the file promised 5,716 bytes of room where
    // there were 974). The near-ceiling note above was written to "stop them
    // rotting again unnoticed" and structurally cannot: it reports the LIVE
    // percentage and never compares it to what is written down, so a wrong
    // annotation stays wrong and quietly informs the next person's decision.
    // It informed one on 2026-08-24 — /methodology/ was reported as having
    // 637 bytes of headroom off a stale string when it had 6.
    //
    // Fires only on OVERSTATED headroom, and only past 2x. Understating is
    // harmless (someone trims when they needn't have), and small drift is
    // ordinary data movement — erroring on that would be failing on growth
    // rather than on weight, which this file's own header rules out.
    const ann = /^\s*([\d,]+)\s*\/\s*([\d,]+)/.exec(entry.measured ?? "");
    if (ann) {
      const annGzip = Number(ann[2].replace(/,/g, ""));
      const annLeft = entry.maxGzip - annGzip;
      const realLeft = entry.maxGzip - gzip;
      if (annLeft > 0 && realLeft > 0 && annLeft > 2 * realLeft) {
        errors.push(
          `page weight: ${entry.label}'s recorded measurement overstates its headroom — the entry says ${annGzip.toLocaleString()} gzip (${annLeft.toLocaleString()} bytes left) but the page weighs ${gzip.toLocaleString()} (${realLeft.toLocaleString()} left, ${(annLeft / realLeft).toFixed(1)}x less than recorded). Re-measure the entry — do NOT raise the ceiling to match [${target.rel}]`
        );
      }
    }
    lines.push(
      `${entry.label} ${raw.toLocaleString()}/${gzip.toLocaleString()}`
    );
  }

  if (nearCeiling.length > 0) {
    notes.push(
      `page weight: ${nearCeiling.length} page(s) at or above ${NEAR_CEILING_PCT}% of the gzip ceiling — ${nearCeiling.join("; ")}`
    );
  }
  if (errors.length === 0) {
    notes.push(
      `page weight: ${PAGE_WEIGHT_BUDGET.length} page budgets within ceiling ✓ (raw/gzip: ${lines.slice(0, 3).join("; ")}; …)`
    );
  }
  return { errors, notes };
}

export async function runBuildGate() {
  const errors = [];
  const notes = [];

  // ── Load sidecars ────────────────────────────────────────────────────────
  const programs = readJson(path.join(jsonDir, "programs.json"));
  const entities = readJson(path.join(jsonDir, "entities_top.json"));
  const agencies = readJson(path.join(jsonDir, "agencies.json"));
  const siteMeta = readJson(path.join(jsonDir, "site_meta.json"));

  // Phase 5F §2a: the program-page universe is EVERY program_details sidecar
  // (full tier from programs.json + rollup tier), recomputed here
  // independently of src/. Zero-content pages (no details/narratives/awards/
  // mentions and every figure zero) are built but noindex — excluded from
  // the sitemap, so the two counts differ.
  const detailsDir = path.join(jsonDir, "program_details");
  const programSlugs = dirExists(detailsDir)
    ? fs.readdirSync(detailsDir).filter((f) => f.endsWith(".json"))
    : [];
  const programCount = programSlugs.length;
  let zeroContentCount = 0;
  for (const f of programSlugs) {
    try {
      const d = readJson(path.join(detailsDir, f));
      const hasContent =
        (d.details ?? []).length > 0 ||
        (d.narratives ?? []).length > 0 ||
        (d.awards ?? []).length > 0 ||
        (d.mentions ?? []).length > 0 ||
        // ROADMAP #28: a decade-only page's whole content IS its decade
        // series — cited figures from the editions that do carry the line.
        // Omitting it here counted all 553 of them as "zero-content" and
        // subtracted them from the expected sitemap size, against a sitemap
        // that (correctly) lists them and pages that are not noindex.
        (d.decade_series?.actuals ?? []).length > 0 ||
        (d.decade_series?.request ?? []).length > 0;
      if (hasContent) continue;
      const figures = (d.budget_lines ?? []).map((bl) => bl.amount_thousands);
      const t = d.trajectory;
      if (t) {
        for (const v of [t.fy2024_actuals, t.fy2025_total, t.fy2026_total]) {
          if (v !== null && v !== undefined) figures.push(v);
        }
      }
      // `[].every(...)` is TRUE, so a page with no figures at all read as
      // "every figure is zero". Zero-content means measured-and-zero, not
      // nothing-to-measure — require at least one figure before concluding it.
      if (figures.length > 0 && figures.every((v) => v === 0)) zeroContentCount++;
    } catch {
      errors.push(`program sidecar unreadable: ${f}`);
    }
  }
  // Sprint E, Task E3 (ROADMAP #67): the 8 genuine appropriation-account
  // collisions each get a bare-pe_bli disambiguation STUB page in addition
  // to their program_details sidecars — a stub carries no sidecar of its
  // own (program-skeleton.mjs's gate 21 would otherwise demand the full
  // 13-section skeleton from a page that isn't a program at all), so it is
  // invisible to programCount above. Derived from programs.json's own
  // pe_bli duplicates — never hand-counted — so a future re-key changes
  // this automatically.
  const pesSeen = new Map();
  for (const p of programs) pesSeen.set(p.pe_bli, (pesSeen.get(p.pe_bli) ?? 0) + 1);
  const stubCount = [...pesSeen.values()].filter((n) => n > 1).length;

  const sitemapProgramCount = programCount - zeroContentCount + stubCount;

  const companyCount = entities.length;
  const agencyCount = agencies.length;
  const citationTotal = siteMeta.counts?.citations ?? 0;

  notes.push(
    `sidecars: ${programCount} program pages (${programs.length} full tier, ` +
      `${zeroContentCount} zero-content/noindex), ${companyCount} companies, ` +
      `${agencyCount} agencies, ${citationTotal} citations`
  );

  // ── out/ exists ──────────────────────────────────────────────────────────
  if (!dirExists(outDir)) {
    errors.push(`out/ directory not found at ${outDir}`);
    return { pass: false, errors, notes };
  }

  // ── Build staleness check ─────────────────────────────────────────────────
  // out/.build-meta.json is written by scripts/write-build-meta.mjs (postbuild).
  // Gate verifies: (a) marker exists, (b) git HEAD matches, (c) marker mtime is
  // newer than the newest watched source file — catches stale out/ after src edits.
  {
    const markerPath = path.join(outDir, ".build-meta.json");
    if (!fileExists(markerPath)) {
      errors.push(
        "out/.build-meta.json missing — out/ was not produced by a complete build " +
          "(re-run `npm run build`)"
      );
    } else {
      let marker;
      try {
        marker = readJson(markerPath);
      } catch (e) {
        errors.push(`out/.build-meta.json is corrupt: ${e.message}`);
        marker = null;
      }
      if (marker) {
        // (b) git HEAD check
        let currentHead = "unknown";
        try {
          const { execSync } = await import("child_process");
          currentHead = execSync("git rev-parse HEAD", {
            cwd: siteRoot,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
        } catch {
          // non-fatal if git unavailable
        }
        if (
          currentHead !== "unknown" &&
          marker.git_head !== "unknown" &&
          currentHead !== marker.git_head
        ) {
          errors.push(
            `out/.build-meta.json git_head mismatch: built from ${marker.git_head.slice(0, 8)}, ` +
              `current HEAD is ${currentHead.slice(0, 8)} — re-run \`npm run build\``
          );
        } else {
          notes.push(`build-meta git_head: ${marker.git_head.slice(0, 8)} ✓`);
        }

        // (c) mtime freshness: marker mtime must be newer than source max mtime.
        // This catches the "touched src file after build" failure mode.
        const markerMtime = fs.statSync(markerPath).mtimeMs;
        function maxMtimeGate(dirOrFile) {
          if (!fs.existsSync(dirOrFile)) return 0;
          const st = fs.lstatSync(dirOrFile);
          if (!st.isDirectory()) return st.mtimeMs;
          let mx = st.mtimeMs;
          for (const entry of fs.readdirSync(dirOrFile, { withFileTypes: true })) {
            if (["node_modules", ".next", "out"].includes(entry.name)) continue;
            mx = Math.max(mx, maxMtimeGate(path.join(dirOrFile, entry.name)));
          }
          return mx;
        }
        const watchedPaths = [
          path.join(siteRoot, "src"),
          path.join(siteRoot, "public"),
          path.join(siteRoot, "package.json"),
          path.join(siteRoot, "next.config.ts"),
          path.join(siteRoot, "tsconfig.json"),
          path.join(siteRoot, "postcss.config.mjs"),
        ];
        const sourceMax = Math.max(...watchedPaths.map(maxMtimeGate));
        if (markerMtime < sourceMax) {
          const staleBy = ((sourceMax - markerMtime) / 1000).toFixed(1);
          errors.push(
            `out/ is stale: a source file is ${staleBy}s newer than out/.build-meta.json ` +
              `(source_max=${new Date(sourceMax).toISOString()}, ` +
              `marker=${new Date(markerMtime).toISOString()}) — re-run \`npm run build\``
          );
        } else {
          notes.push("build freshness: out/ is newer than all watched source files ✓");
        }
      }
    }
  }

  // ── Program pages ────────────────────────────────────────────────────────
  const programOut = path.join(outDir, "program");
  if (!dirExists(programOut)) {
    errors.push("out/program/ directory not found");
  } else {
    const builtPblis = fs.readdirSync(programOut).filter((d) => {
      return fs.statSync(path.join(programOut, d)).isDirectory();
    });
    // Sprint E, Task E3: + stubCount — the 8 split-key bare-pe_bli
    // disambiguation pages are real, built out/program/{pe_bli}/ directories
    // with no program_details sidecar (see stubCount's own comment above).
    const expectedProgramPages = programCount + stubCount;
    if (builtPblis.length !== expectedProgramPages) {
      errors.push(
        `program pages: found ${builtPblis.length}, expected ${expectedProgramPages} ` +
          `(${programCount} sidecar-backed + ${stubCount} split-key stubs)`
      );
    } else {
      notes.push(`program pages: ${builtPblis.length} ✓ (incl. ${stubCount} split-key stubs)`);
    }
  }

  // ── Agency pages ─────────────────────────────────────────────────────────
  const agencyOut = path.join(outDir, "agency");
  if (!dirExists(agencyOut)) {
    errors.push("out/agency/ directory not found");
  } else {
    const builtOrgs = fs.readdirSync(agencyOut).filter((d) => {
      return fs.statSync(path.join(agencyOut, d)).isDirectory();
    });
    if (builtOrgs.length !== agencyCount) {
      errors.push(
        `agency pages: found ${builtOrgs.length}, expected ${agencyCount}`
      );
    } else {
      notes.push(`agency pages: ${builtOrgs.length} ✓`);
    }
  }

  // ── Company pages ─────────────────────────────────────────────────────────
  const companyOut = path.join(outDir, "company");
  if (!dirExists(companyOut)) {
    errors.push("out/company/ directory not found");
  } else {
    const builtSlugs = fs.readdirSync(companyOut).filter((d) => {
      return fs.statSync(path.join(companyOut, d)).isDirectory();
    });
    if (builtSlugs.length !== companyCount) {
      errors.push(
        `company pages: found ${builtSlugs.length}, expected ${companyCount}`
      );
    } else {
      notes.push(`company pages: ${builtSlugs.length} ✓`);
    }
  }

  // ── Core pages ────────────────────────────────────────────────────────────
  const corePages = [
    { path: "index.html", label: "/" },
    { path: path.join("programs", "index.html"), label: "/programs/" },
    { path: path.join("companies", "index.html"), label: "/companies/" },
    { path: path.join("data", "index.html"), label: "/data/" },
    { path: path.join("flow", "index.html"), label: "/flow/" },
    // ROADMAP #29(c) — the lineage identity diagram.
    { path: path.join("lineage", "index.html"), label: "/lineage/" },
    { path: path.join("downloads", "index.html"), label: "/downloads/" },
    { path: path.join("methodology", "index.html"), label: "/methodology/" },
    { path: path.join("glossary", "index.html"), label: "/glossary/" },
    // Sprint C Task C3 (ROADMAP #62) — the /agency/ index.
    { path: path.join("agency", "index.html"), label: "/agency/" },
    { path: path.join("about", "index.html"), label: "/about/" },
  ];
  for (const { path: rel, label } of corePages) {
    if (!fileExists(path.join(outDir, rel))) {
      errors.push(`core page missing: ${label}`);
    }
  }
  const missingCore = corePages.filter((c) => !fileExists(path.join(outDir, c.path)));
  if (missingCore.length === 0) {
    notes.push(`core pages: all ${corePages.length} present ✓`);
  }

  // ── Pagefind bundle ───────────────────────────────────────────────────────
  const pagefindJs = path.join(outDir, "pagefind", "pagefind.js");
  if (!fileExists(pagefindJs)) {
    errors.push("out/pagefind/pagefind.js not found — run `npm run build` (includes postbuild pagefind)");
  } else {
    notes.push("pagefind/pagefind.js ✓");
  }

  // ── Sitemap ───────────────────────────────────────────────────────────────
  // Next.js static export from app/sitemap.ts → out/sitemap.xml
  let sitemapContent = null;
  const sitemapCandidates = [
    path.join(outDir, "sitemap.xml"),
    path.join(outDir, "sitemap", "index.html"),
  ];
  for (const cand of sitemapCandidates) {
    if (fileExists(cand)) {
      sitemapContent = fs.readFileSync(cand, "utf8");
      break;
    }
  }

  if (!sitemapContent) {
    errors.push("sitemap.xml not found in out/ (tried sitemap.xml and sitemap/index.html)");
  } else {
    // Count <url> entries
    const urlMatches = sitemapContent.match(/<url>/g) || [];
    const sitemapCount = urlMatches.length;

    // Compute district page count from sidecar (0 if not yet generated)
    let districtPageCount = 0;
    try {
      const districtIndex = readJson(path.join(jsonDir, "districts", "index.json"));
      // +1 for /district/ index page, +N for each district detail page
      districtPageCount = 1 + (districtIndex.total_districts ?? 0);
    } catch {
      // sidecars not generated — only count the base /district/ page if it exists
      // but since the route needs params, it won't be in the sitemap when count=0.
    }
    // Compute filing page count from sidecar (Task 6a): /filings/ index +
    // ONLY mention-bearing filings (zero-mention filings are noindex and
    // deliberately excluded from the sitemap).
    let filingPageCount = 0;
    try {
      const filingsIndex = readJson(path.join(jsonDir, "filings_index.json"));
      const withMentions = (filingsIndex.filings ?? []).filter(
        (f) => f.has_mentions
      ).length;
      filingPageCount = 1 + withMentions;
    } catch {
      // sidecars not generated — no filing URLs expected
    }
    // Expected: static(12) + feed(1) + district pages + filing pages + programs + companies + agencies
    // static(14) = /, /programs/, /companies/, /companies/families/, /data/,
    //              /years/, /flow/, /lineage/, /downloads/, /methodology/,
    //              /glossary/, /agency/, /coverage/, /about/
    // (/flow/ added in Phase 5H; /companies/families/ added in PM Sprint 2
    //  §P1-3 — the curated rename/acquisition table; /coverage/ in Sprint 3
    //  Task 6 — the roadmap page; /glossary/ in Sprint C Task C1 — ROADMAP
    //  #60, term definitions; /agency/ in Sprint C Task C3 — ROADMAP #62,
    //  the /agency/{org}/ index, counted separately from the ${agencyCount}
    //  dynamic /agency/{org}/ pages below; /lineage/ in ROADMAP #29(c) — the
    //  lineage identity diagram, the only surface that renders the nine
    //  stated links whose endpoints have no program page of their own;
    //  /years/ in the tri-persona review Wave 4 — the decade matrix was in
    //  no sitemap at all, on a site whose cross-program "asked vs got"
    //  analysis happens there.)
    // Programs: page universe MINUS zero-content noindex pages (5F policy —
    // built but excluded from the sitemap, like zero-mention filings).
    const STATIC_SITEMAP_PAGES = 14;
    const expectedTotal =
      STATIC_SITEMAP_PAGES + 1 + districtPageCount + filingPageCount + sitemapProgramCount + companyCount + agencyCount;
    if (sitemapCount !== expectedTotal) {
      errors.push(
        `sitemap URL count: found ${sitemapCount}, expected ${expectedTotal} (${STATIC_SITEMAP_PAGES} static + 1 feed + ${districtPageCount} district + ${filingPageCount} filing + ${sitemapProgramCount} programs (${programCount} pages − ${zeroContentCount} zero-content noindex) + ${companyCount} companies + ${agencyCount} agencies)`
      );
    } else {
      notes.push(`sitemap: ${sitemapCount} URLs ✓ (${zeroContentCount} zero-content program page(s) excluded)`);
    }

    // Check all URLs start with SITE_URL origin
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://govbudget-placeholder.example";
    const origin = new URL(siteUrl).origin;
    const locMatches = sitemapContent.match(/<loc>([^<]+)<\/loc>/g) || [];
    const badUrls = locMatches.filter((m) => {
      const loc = m.replace(/<\/?loc>/g, "");
      return !loc.startsWith(origin);
    });
    if (badUrls.length > 0) {
      errors.push(
        `sitemap: ${badUrls.length} URLs do not start with origin ${origin}. First: ${badUrls[0]}`
      );
    } else if (locMatches.length > 0) {
      notes.push(`sitemap origins: all start with ${origin} ✓`);
    }
  }

  // ── robots.txt ────────────────────────────────────────────────────────────
  // Next.js static export from app/robots.ts → out/robots.txt
  const robotsCandidates = [
    path.join(outDir, "robots.txt"),
    path.join(outDir, "robots", "index.html"),
  ];
  let robotsFound = false;
  for (const cand of robotsCandidates) {
    if (fileExists(cand)) {
      robotsFound = true;
      notes.push("robots.txt ✓");
      break;
    }
  }
  if (!robotsFound) {
    errors.push("robots.txt not found in out/");
  }

  // ── llms.txt ─────────────────────────────────────────────────────────────
  const llmsTxt = path.join(outDir, "llms.txt");
  if (!fileExists(llmsTxt)) {
    errors.push("llms.txt not found in out/");
  } else {
    const content = fs.readFileSync(llmsTxt, "utf8");
    const checks = [
      { pattern: "/methodology/", label: "/methodology/" },
      { pattern: "/downloads/", label: "/downloads/" },
    ];
    for (const { pattern, label } of checks) {
      if (!content.includes(pattern)) {
        errors.push(`llms.txt missing ${label}`);
      }
    }
    const programLineRe = /\/program\/[A-Z0-9]+\//;
    if (!programLineRe.test(content)) {
      errors.push("llms.txt has no /program/... URL");
    } else {
      notes.push("llms.txt: /methodology/ + /downloads/ + /program/... ✓");
    }
  }

  // ── Placeholder-origin scan (backlog #18) ─────────────────────────────────
  // A build without NEXT_PUBLIC_SITE_URL bakes https://govbudget-placeholder
  // .example into sitemap/llms.txt/canonicals (src/lib/site.ts fallback).
  // The sitemap-origin check above is relative to the verify-time env — and
  // falls back to the SAME placeholder, so a placeholder build verified in a
  // placeholder env would false-pass it. This scan is UNCONDITIONAL: the
  // production artifacts must never contain the placeholder host, no matter
  // what origin this verify run was given.
  {
    const PLACEHOLDER_HOST = "govbudget-placeholder.example";
    const scanTargets = ["sitemap.xml", "llms.txt", "robots.txt", "index.html"];
    let scanned = 0;
    let hits = 0;
    for (const rel of scanTargets) {
      const p = path.join(outDir, rel);
      if (!fileExists(p)) continue; // absence is reported by each file's own leg
      scanned++;
      if (fs.readFileSync(p, "utf8").includes(PLACEHOLDER_HOST)) {
        hits++;
        errors.push(
          `placeholder origin: out/${rel} contains "${PLACEHOLDER_HOST}" — ` +
            "the site was built without NEXT_PUBLIC_SITE_URL; rebuild with the production origin"
        );
      }
    }
    if (hits === 0) {
      notes.push(`placeholder scan: ${scanned}/${scanTargets.length} artifacts free of ${PLACEHOLDER_HOST} ✓`);
    }
  }

  // ── Fact-permalink route (PM Sprint 1 Task 5, spec §P0-4) ─────────────────
  // The footnote formatter emits https://…/fact/{fid8} permalinks (gate 23
  // leg c goldens). Those URLs resolve ONLY when the deploy root carries the
  // Vercel rewrite AND the /fact/ resolver page built. out/ is the deploy
  // root (`vercel --prod` from site/out), and Next copies public/vercel.json
  // into out/ — so both artifacts must be in out/ or the permalinks 404.
  {
    const vercelJsonPath = path.join(outDir, "vercel.json");
    let vercelConfig = null;
    if (!fileExists(vercelJsonPath)) {
      errors.push(
        "fact permalinks: out/vercel.json missing — /fact/{id} URLs will 404 on deploy " +
          "(site/public/vercel.json must ship the /fact/:id rewrite)"
      );
    } else {
      let rewriteOk = false;
      try {
        vercelConfig = readJson(vercelJsonPath);
        rewriteOk = (vercelConfig.rewrites ?? []).some(
          (r) => r.source === "/fact/:id" && r.destination === "/fact/"
        );
      } catch (e) {
        errors.push(`fact permalinks: out/vercel.json is corrupt: ${e.message}`);
      }
      if (!rewriteOk) {
        errors.push(
          'fact permalinks: out/vercel.json lacks the {"source": "/fact/:id", "destination": "/fact/"} rewrite'
        );
      } else {
        notes.push("fact permalinks: /fact/:id rewrite present in out/vercel.json ✓");
      }

      // (f1) ROADMAP #61: /fact/{id}/ (trailing slash) 404ed in production
      // — verified live 2026-08-13: unslashed 200s, slashed 404s, even
      // though every OTHER route on the site canonically ends in a slash
      // (next.config.ts trailingSlash:true) and CMSes/link-checkers
      // normalize trailing slashes onto URLs routinely. Root cause,
      // confirmed against live Vercel routing rather than assumed: a curl
      // of the slashed URL returned Vercel's literal 404.html
      // (content-disposition: filename="404.html"), not the rewritten fact
      // page (content-disposition: filename="fact") — proving the
      // `/fact/:id` rewrite never fires for a slash-terminated request on
      // Vercel's edge, even though the open-source path-to-regexp@6
      // library's OWN default compile of that same source string DOES
      // match a trailing slash (checked locally against
      // node_modules/msw's path-to-regexp@6.3.0) — Vercel's actual
      // matching is stricter than the library's default. The fix is a
      // second, explicit literal rule for the slashed form.
      //
      // WHAT THIS LEG PROVES: only that out/vercel.json's rewrite array
      // carries that second rule (config shape) — NOT that Vercel's edge
      // honors it post-deploy. Nothing in this repo can prove the live
      // routing behaviour: scripts/serve-static.mjs (the server every
      // other local gate drives) never reads vercel.json and implements
      // only its own filesystem trailing-slash fallback
      // ($uri → $uri/index.html → $uri.html → 404.html) — per its own
      // docstring it doesn't apply Vercel rewrites at all, so it 404s on
      // BOTH /fact/{id} and /fact/{id}/ alike (there is no
      // out/fact/{id}/index.html for either) and cannot distinguish
      // "rewrite present" from "rewrite absent" for either form. A gate
      // built on that server would pass for the wrong reason. The live
      // curl above is the only behavioural evidence there is; re-check
      // production the same way after deploy.
      if (vercelConfig) {
        const slashedRewriteOk = (vercelConfig.rewrites ?? []).some(
          (r) => r.source === "/fact/:id/" && r.destination === "/fact/"
        );
        if (!slashedRewriteOk) {
          errors.push(
            'fact permalinks (f1): out/vercel.json lacks the {"source": "/fact/:id/", ' +
              '"destination": "/fact/"} rewrite — /fact/{id}/ (trailing slash) will 404 ' +
              "on deploy (ROADMAP #61)"
          );
        } else {
          notes.push(
            "fact permalinks (f1): /fact/:id/ (trailing-slash) rewrite present in out/vercel.json ✓"
          );
        }
      }
    }
    if (!fileExists(path.join(outDir, "fact", "index.html"))) {
      errors.push(
        "fact permalinks: out/fact/index.html missing — the /fact/ resolver page did not build"
      );
    } else {
      notes.push("fact permalinks: out/fact/index.html present ✓");
    }
  }

  // ── citations.json key count ──────────────────────────────────────────────
  const citationsPath = path.join(jsonDir, "citations.json");
  if (!fileExists(citationsPath)) {
    errors.push("citations.json not found in data/site/json/");
  } else {
    const citations = readJson(citationsPath);
    const citationKeys = Object.keys(citations).length;
    if (citationTotal === 0) {
      errors.push("site_meta.json counts.citations is 0 — re-run export-site");
    } else if (citationKeys !== citationTotal) {
      errors.push(
        `citations.json: ${citationKeys} keys, expected ${citationTotal} (from site_meta.json)`
      );
    } else {
      notes.push(`citations.json: ${citationKeys} keys == ${citationTotal} total ✓`);
    }
  }

  // ── /json/feed.json is SHIPPED, parses, and carries cards ─────────────────
  //
  // Final review I2 / batch review 1.2. /json/feed.json is fetched by
  // FeedSectionExpand when a reader clicks "show all" on a /feed/ section,
  // and by nothing else: no <a href> points at it, so no link-graph leg could
  // see it. It 404'd in production. Gate 13 leg (i) now scans site/src for
  // static fetch targets and asserts each exists; this leg adds the part a
  // path-existence check cannot make: the file must PARSE and carry a real
  // digest, not a zero-card husk written by a half-run prepare-assets.
  //
  // Floor measured 2026-09-04 from data/site/json/feed.json: 1,047 cards.
  // 800 leaves headroom for ordinary corpus movement (feed cards come and go
  // with each export) and still fails on the shape this exists to catch — an
  // empty or truncated copy. RE-MEASURE if the feed's construction changes;
  // do not lower it to whatever the build produced.
  const MIN_SHIPPED_FEED_CARDS = 800;
  const shippedFeedPath = path.join(outDir, "json", "feed.json");
  if (!fileExists(shippedFeedPath)) {
    errors.push(
      "out/json/feed.json not found — /feed/'s 'show all' button fetches this " +
        "file and nothing links to it, so a missing copy 404s silently for " +
        "every reader (prepare-assets.mjs copies it into public/json/)"
    );
  } else {
    let shippedFeed;
    try {
      shippedFeed = readJson(shippedFeedPath);
    } catch (e) {
      shippedFeed = null;
      errors.push(`out/json/feed.json is not parseable JSON: ${e.message}`);
    }
    if (shippedFeed) {
      const cards = Array.isArray(shippedFeed.cards) ? shippedFeed.cards : null;
      if (!cards) {
        errors.push(
          "out/json/feed.json has no `cards` array — FeedSectionExpand reads " +
            "data.cards and would throw on every expand"
        );
      } else if (cards.length < MIN_SHIPPED_FEED_CARDS) {
        errors.push(
          `out/json/feed.json carries ${cards.length} card(s), floor ` +
            `${MIN_SHIPPED_FEED_CARDS} (measured 2026-09-04 at 1,047). A ` +
            `truncated copy passes every existence check and still breaks ` +
            `"show all". Re-measure the feed; do not lower the floor`
        );
      } else {
        notes.push(
          `out/json/feed.json: ${cards.length} cards (floor ${MIN_SHIPPED_FEED_CARDS}) ✓`
        );
      }
    }
  }

  // ── Download-href check ───────────────────────────────────────────────────
  // The built downloads page must use /citations/citations.parquet (not /data/).
  const downloadsHtml = path.join(outDir, "downloads", "index.html");
  if (!fileExists(downloadsHtml)) {
    errors.push("out/downloads/index.html not found — cannot check download hrefs");
  } else {
    const dlContent = fs.readFileSync(downloadsHtml, "utf8");
    // Verify the citations parquet link points to /citations/ not /data/
    if (dlContent.includes("/data/citations.parquet")) {
      errors.push(
        "downloads page contains stale href /data/citations.parquet — should be /citations/citations.parquet"
      );
    } else if (dlContent.includes("citations.parquet")) {
      notes.push("download href: citations.parquet points to /citations/ ✓");
    } else {
      // Could be asset-URL-resolved at runtime; don't error, just note
      notes.push("download href: citations.parquet not found in static HTML (runtime asset URL)");
    }

    // Stale-literal check: must NOT contain hardcoded "44,754"
    if (dlContent.includes("44,754")) {
      errors.push(
        "downloads page contains stale literal \"44,754\" — counts must be data-driven from site_meta.json"
      );
    } else {
      notes.push("stale-literal check: no hardcoded \"44,754\" in downloads page ✓");
    }
  }

  // ── Page-weight budget (§P2-1) ────────────────────────────────────────────
  {
    const w = checkPageWeight();
    errors.push(...w.errors);
    notes.push(...w.notes);
  }

  return { pass: errors.length === 0, errors, notes };
}
