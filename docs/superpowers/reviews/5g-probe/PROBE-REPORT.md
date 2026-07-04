# Phase 5G Task 1 — Service J-book Playwright Probe Report

**Date:** 2026-07-04
**Scope:** Bounded evidence gathering (Task 1 only). No warehouse writes, no bulk
downloads, no DB access, no Anthropic API. One sample PDF per reachable service.
**Tooling added:** `playwright>=1.61.0` (dev dependency group) + Chromium browser
(`uv run playwright install chromium`). Probe: `scripts/probe_service_jbooks.py`;
pure functions in `src/govbudget/jbooks/service_fetch.py` (unit-tested,
`tests/jbooks/test_service_fetch.py`).

This settles the two unknowns the FY2026 feasibility spike
(`2026-07-02-service-jbooks-feasibility.md`) left open.

---

## Verdicts at a glance

| Service | Playwright reachable? | Inventory | Sample XML | Recommendation |
|---|---|---|---|---|
| **Navy** | **YES** (WAF bypassed) | 36 PDFs (5 RDTE, procurement, O&M, etc.) | **Scenario A** — embedded jb-2009 XML, 252 PEs, BY2026 | **GO** (with a Task 2 classifier extension) |
| **Army** | **NO — BLOCKED** | none (403 Akamai) | n/a | **BLOCKED** — feasibility spike's Playwright assumption was wrong |

---

## Navy — GO

### Access: reachable via Playwright (feasibility spike confirmed)

- The feasibility-spike entry URL `https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx`
  is **dead in 2026-07** — it 302-redirects to the SECNAV homepage
  (`/Pages/default.aspx`, "SECNAV Front Page", 0 PDFs). The probe records this.
- The **live FY2026 book listing** is the SharePoint document library folder
  `https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/` ("26pres" = 2026
  President's budget). Headless Chromium with a realistic UA/viewport/locale
  reached it: HTTP 200, title "26pres - All Documents", 292 KB, **no WAF page**.
  The `/fmc` bot-WAF that returned a 244-byte rejection to server-side curl does
  **not** block a real browser. Evidence: `evidence/navy-2.png`.
- The probe's `SERVICE_INDEX_URLS["navy"]` was corrected to point at the working
  folder (dead page kept as a second entry so the redirect is recorded).

### Inventory: 36 PDFs (see `navy-inventory.txt`)

Naming is by **appropriation code**, not the DoD `RDTE_/PROC_` convention:

- RDT&E (5, split by budget activity): `RDTEN_BA1-3_Book.pdf`, `RDTEN_BA4_Book.pdf`,
  `RDTEN_BA5_Book.pdf`, `RDTEN_BA6_Book.pdf`, `RDTEN_BA7-8_Book.pdf`
- Procurement: `APN_BA*` (aircraft), `WPN_Book` (weapons), `SCN_Book` (shipbuilding),
  `OPN_BA*` (other), `PMC_Book`/`RPMC_Book` (Marine Corps), `PANMC_Book`
- O&M / MilPers / MilCon / RDF / working capital / overview: `OMN_*`, `MPN_Book`,
  `MCON_Book`, `NWCF_Book`, `Highlights_Book`, `The_Bottom_Line`, etc.

### Sample-book XML: Scenario A (embedded jb-2009 XML) — see `sample-extraction.md`

Downloaded `RDTEN_BA7-8_Book.pdf` (71.2 MB) to `/tmp/5g_probe/` (not committed):

- **`.zzz` present: YES.** Embedded attachments include
  `U_RDTE_MJB_2506260924XAYF_NAVY_PB_2026.zzz` (master),
  `U_RDTE_JB_2506260927ZZZZ_NAVY_PB_2026.zzz` (volume), plus `Exhibit_R-1D.xml`
  and `R3_overview.xml`. `extract_jbook_xml()` unzipped all of them with **zero
  code changes**.
- `pick_book_xml(family="rdte")` selected the `_MJB_` master; `parse_jbook_xml()`
  parsed **252 ProgramElements**.
- **XML namespace:** `http://www.dtic.mil/comptroller/xml/schema/022009/jb`
  (jb-2009 — byte-identical to the defense-wide FY2026 corpus).
- **BudgetYear values: {2026}** — `BudgetYear == 2026` confirmed.
- **ServiceAgencyName: {"Navy"}**.
- **Important:** each BA-split PDF embeds the **full Navy RDTE master book** (all
  252 PEs), not just its own budget activity. So the sample verdict holds for any
  of the five RDTEN books, and Task 3 must **register only one** RDTEN book per
  family (the other four are duplicates of the same master XML) — the 5E
  edition-manifest exclusion mechanism applies.

### Classifier compatibility: NEEDS a Task 2 extension (this is the real work)

`_classify_jbook()` returns **`None` for every Navy filename** (see
`classifier-verdicts.txt`) — the word-bounded `RDTE`/`PROC` token rule does not
match `RDTEN`/`APN`/`OPN`/`WPN`/`PMC`/`SCN`. Classifying by the embedded `.zzz`
name is also unclean: `U_RDTE_MJB_2506260924XAYF_NAVY_PB_2026.pdf` classifies as
`('rdte', '2506260924XAYF_NAVY')` because `_NOISE_TOKEN` doesn't strip the CG-OMS
hash token.

**Task 2 path (unchanged from the 5E playbook):** add explicit filename→(family,
org) entries for the Navy books — the same `EVIDENCE_NAMES`/allowlist mechanism
used for the PB2018 tokenless per-agency books — mapping e.g.
`RDTEN_BA1-3_Book.pdf → ('rdte', 'N')`, `APN_BA1-4_Book.pdf → ('procurement',
'N')`, etc. Workbook org `N` matches `budget_lines.organization` directly (spike
confirmed `A`/`N`/`F` are the display-workbook codes), so **no `ORG_ALIASES`
entry is needed** once the org resolves to `N`. The extract→parse→load→reconcile
path is otherwise zero-change (Scenario A).

### Navy recommendation: **GO**

The two spike unknowns are resolved positively: Playwright reaches the listing,
and the PDFs carry the exact jb-2009 embedded XML the pipeline parses. The only
build work beyond the feasibility estimate is the **filename classifier
extension** (appropriation-code naming) and the **one-of-five RDTEN dedup** —
both scoped to Task 2/3, both mechanical. Proceed with Navy ingestion.

---

## Army — BLOCKED

### Access: NOT reachable via Playwright — a finding, not a challenge

Every Army entry point returns **HTTP 403 Akamai "Access Denied"** from headless
Chromium with a realistic UA, 1440×900 viewport, `en-US` locale,
`America/New_York` timezone, and browser-standard Accept/Accept-Language/
Upgrade-Insecure-Requests headers:

| URL | Result |
|---|---|
| `https://www.asafm.army.mil/` | 403 Access Denied |
| `https://www.asafm.army.mil/Budget-Materials/` | 403 Access Denied |
| `https://www.asafm.army.mil/Budget-Materials/Budget2026/` | 403 Access Denied |
| `https://asafm.army.mil/Budget-Materials/` | 403 Access Denied |

Body: `Reference #18.c9623417...` / `errors.edgesuite.net` — an Akamai edge WAF
rejection. Evidence: `evidence/army-blocked.png`, `army-inventory.txt`.

**This contradicts the feasibility spike**, which asserted "Akamai anti-bot, not
certificate-gated … Playwright would bypass this." It does not. The Army Akamai
policy blocks even a real headless browser (likely TLS/JA3 fingerprinting or a
managed-browser challenge that a vanilla Playwright Chromium fails).

Per the plan's honesty rule: **a WAF that blocks a normal headless browser is a
finding, not a challenge to defeat.** No stealth/evasion escalation was attempted
(and none should be without an explicit human decision).

### Army recommendation: **BLOCKED (no-go for automated ingestion as-is)**

Army does **not** clear the CONDITIONAL-GO bar the spike set. Options for a
future human decision (none built or attempted here):

1. **Manual drop-dir** — reuse the AF `ingest-local` path the plan already
   builds for Air Force (`acquisition='manual'`, operator source URL). A human
   with normal browser access downloads the Army books; the pipeline processes
   them unchanged (Army books are near-certainly Scenario A, same CG-OMS system
   as Navy). This is the lowest-risk path and needs no new WAF work.
2. **Stealth transport** (undetected-chromedriver / real-Chrome CDP attach / a
   residential-egress fetch) — explicitly out of scope; requires a human call on
   whether to arms-race the Army Akamai policy.
3. **Alternate source** — check whether Army RDTE/Proc books are mirrored on a
   non-Akamai host. Not investigated in this bounded probe.

**Recommendation to the phase owner:** proceed with **Navy automated ingestion
now**; move **Army to the same manual drop-dir path as Air Force** (so Task 3's
`ingest-local` command serves both A and F), unless a human authorizes a stealth
transport. The spike's "Army ≈ Navy, same Playwright resolution" premise is
disproven by this evidence.

---

## What changed from the feasibility spike

| Spike claim | Probe finding |
|---|---|
| Navy `Pres-Budget.aspx` is the index | Dead (redirects to homepage); real listing is `/fmc/fmb/Documents/26pres/` |
| Navy WAF bypassable by Playwright | **True** — confirmed reachable |
| Army Akamai bypassable by Playwright | **False** — 403 to headless Chromium at every path |
| Service filenames follow `RDTE_N_/PROC_N_` | **False** — Navy uses appropriation codes (`RDTEN`, `APN`, …); classifier returns `None`, needs a Task 2 allowlist |
| Scenario A (embedded jb-2009 XML) | **Confirmed for Navy** — 252 PEs, BY2026, `.zzz` present, namespace-identical |
| One RDTE master book per service | Navy publishes 5 BA-split PDFs, **each embedding the same full master** — dedup to one at register time |

---

## GO / NO-GO / BLOCKED summary

- **Navy: GO** — reachable, Scenario A confirmed; Task 2 adds a filename
  classifier extension + one-of-five RDTEN dedup; extract/parse/load/reconcile
  unchanged.
- **Army: BLOCKED** — Akamai 403 to headless Chromium at every entry point;
  recommend routing Army through the manual drop-dir path (same as AF) pending a
  human decision on stealth transport or an alternate mirror.
- **Air Force:** unchanged from the spike — CAC-gated, manual path only (not
  re-probed; out of Task 1 scope).
