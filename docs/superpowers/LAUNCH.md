# Fiscal Receipts Launch Checklist

Ordered, operator-executable steps to take the site from a green local build to a
live Vercel deployment backed by Cloudflare R2 for large static assets.

Every step is idempotent — you can re-run any of them safely.

---

## Prerequisites

- Python env active (`uv run` or activated venv)
- Node 20+, npm available
- rclone installed: `brew install rclone` (needed for step 4)
- Vercel CLI installed: `npm i -g vercel`
- Accounts: Cloudflare R2, Vercel (free tier, `andes.lee444@gmail.com`)

---

## Step 1 — Export site artifacts

Regenerates `data/site/` from the DuckDB warehouse.  Must run before build so
the static JSON sidecars and parquet files are current.

```bash
govbudget export-site
```

Verify: `data/site/manifest.json` `built_at` timestamp is fresh.

---

## Step 2 — Build with NEXT_PUBLIC_SITE_URL

Set the Vercel deployment URL as the sitemap origin **before** building.  While
the custom domain is tabled, use the Vercel preview URL assigned to the project
(e.g. `https://govbudget-xyz.vercel.app`).

```bash
# Substitute your actual *.vercel.app URL:
export NEXT_PUBLIC_SITE_URL=https://govbudget-xyz.vercel.app

cd site
npm run build   # runs prebuild → next build → postbuild (pagefind)
cd ..
```

`site/out/` will contain the full static export (~1.0 GB, ~49 k files).

**Vercel free-tier limits:**
- Deployment source upload: 100 MB compressed — `site/out/` at ~1.0 GB raw
  exceeds this.
- **Mitigation:** the large binary assets (pdfs/, data/, workbooks/, citations/)
  are served from R2, not Vercel.  Vercel only serves the HTML/JS/CSS bundle
  plus small JSON sidecars.  Keep `site/out/` lean by ensuring the `public/`
  folder does not include the R2 asset directories.
- If the Vercel upload still exceeds limits, use `.vercelignore` to exclude
  `out/pdfs/`, `out/data/`, `out/workbooks/`, `out/citations/` (these folders
  should not be in `public/` in the first place — they live in `data/site/` and
  are served from R2 via `assetBaseUrl`).

Gate check (run after build):

```bash
cd site && npm run verify && cd ..
```

---

## Step 3 — Run verify-phase5b1 (citations gate)

Confirms citations.parquet is consistent with the warehouse before uploading
anything to R2.

```bash
govbudget verify-phase5b1
```

Expected: `verify-phase5b1: PASS`

---

## Step 4 — Upload assets to R2 ✅ DONE 2026-07-02 · RE-SYNCED 2026-07-04

52 objects / 154 MiB uploaded to `govbudget-assets` bucket.
Custom domain `assets.fiscalreceipts.com` live and Active.

> **RE-SYNC 2026-07-04 (Phase 5G):** `upload_r2.sh --live` moved 190 files /
> 1.48 GiB. The deploy drill rebuilds `site/out` + pushes to Vercel but does NOT
> re-sync `data/site/pdfs → R2`, so every post-launch phase (5E decade editions,
> 5F/5H, 5G Navy) had shipped citation metadata while the PDF binaries were
> missing from the CDN — the panel degraded to "open official source". **Run
> `R2_BUCKET=govbudget-assets ./scripts/launch/upload_r2.sh --live` after any
> ingestion phase, before/with the Vercel deploy.** (Backlog #27 folds this into
> the deploy sequence + adds a live-PDF-fetch gate.)

### 4a. Configure rclone (one-time)

```bash
brew install rclone
rclone config
# → New remote → name "r2"
# → Provider: S3 Compatible (Cloudflare R2)
# → access_key_id: <R2 API token key ID>
# → secret_access_key: <R2 API token secret>
# → endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# → Leave region blank
# → No ACL needed
```

> **Lesson (2026-07-02):** R2 scoped tokens must include `Object Read & Write`
> AND `Bucket Read & Write` permissions — the `HeadBucket` call rclone makes
> during `lsd` is blocked by object-only tokens, causing spurious "bucket not
> found → CreateBucket" attempts.  Add `no_check_bucket = true` to the rclone
> remote config to skip the check entirely.  Also: R2 API tokens take ~1 min to
> activate after creation.

### 4b. Apply the CORS policy (one-time)

Edit `scripts/launch/cors-policy.json`: replace `REPLACE_WITH_SITE_URL` with
your actual `NEXT_PUBLIC_SITE_URL` value, then apply:

```bash
# Using wrangler (requires an Admin API token — scoped tokens lack PutBucketCors):
wrangler r2 bucket cors put $R2_BUCKET \
  --rules scripts/launch/cors-policy.json

# Least-privilege path: Cloudflare dashboard
# R2 → your bucket → Settings → CORS → Add policy → paste the JSON
```

Policy summary:
- AllowedMethods: GET, HEAD, OPTIONS
- AllowedHeaders: range, origin, content-type, accept
- ExposeHeaders: content-range, accept-ranges, content-length
- MaxAgeSeconds: 3600

> **Lesson (2026-07-02):** `PutBucketCors` requires an Admin-level API token.
> Scoped R2 tokens are insufficient; the dashboard paste is the least-privilege
> path.

### 4c. Dry-run sync

```bash
R2_BUCKET=govbudget-assets ./scripts/launch/upload_r2.sh
```

Review the output — rclone will print what would be transferred without moving
any files.

### 4d. Live upload

```bash
R2_BUCKET=govbudget-assets ./scripts/launch/upload_r2.sh --live
```

Uploads four directories from `data/site/` to R2:

| Local | R2 path | Size |
|---|---|---|
| `data/site/pdfs/` | `/pdfs/` | ~149 MB |
| `data/site/data/` | `/data/` | ~3.2 MB |
| `data/site/workbooks/` | `/workbooks/` | ~1.2 MB |
| `data/site/citations/` | `/citations/` | ~1 MB |

### 4e. Connect custom domain (one-time)

> **Lesson (2026-07-02):** A custom domain on R2 is NOT just a CNAME.  You must
> go to R2 → your bucket → Settings → Custom Domains → Connect Domain, enter the
> subdomain, and let Cloudflare add the CNAME automatically.  Manually adding a
> CNAME at the DNS level without the Connect Domain step returns Cloudflare error
> 1014 ("CNAME cross-user banned") until the bucket binding is active.  The
> binding initializes for a few minutes after connection — expect 1014 responses
> until it turns Active.

---

## Step 5 — Rewrite config.json ✅ DONE 2026-07-02

`assetBaseUrl` set to `https://assets.fiscalreceipts.com` in both
`site/public/config.json` and `site/out/config.json`.

```bash
node scripts/launch/rewrite-config.mjs https://assets.fiscalreceipts.com
```

Verify output: the script prints before/after for each target file.

---

## Step 6 — CORS live test ✅ DONE 2026-07-02

All 7 assertions PASS (exit 0) against the live endpoint:

```
R2_HOST=https://assets.fiscalreceipts.com \
SITE_URL=https://govbudget.vercel.app \
  ./scripts/launch/cors_live_test.sh
```

```
── 1. OPTIONS preflight ──────────────────────────────────────────────────
  PASS: status 204
  PASS: Access-Control-Allow-Origin echoes SITE_URL: https://govbudget.vercel.app
  PASS: Access-Control-Allow-Headers contains 'range': range

── 2. Ranged GET ─────────────────────────────────────────────────────────
  PASS: status 206 Partial Content
  PASS: Access-Control-Allow-Origin echoes SITE_URL: https://govbudget.vercel.app
  PASS: Content-Range: bytes 0-1023/3175571
  PASS: Accept-Ranges declared in Access-Control-Expose-Headers: content-range,accept-ranges,content-length

All CORS assertions passed.
```

> **Script bug fixed (2026-07-02):** `set -euo pipefail` + the `grep` pipeline
> inside `header_value()` exited with code 1 when R2 omits a standalone
> `Accept-Ranges` header (it lists it in `Access-Control-Expose-Headers`
> instead).  The grep failure propagated through the command substitution and
> aborted the script silently before any leg-2 assertions printed.  Fix: added
> `|| true` to the `grep` and `awk` pipelines in `header_value()`/`status_code()`
> so a no-match grep returns 0; updated the Accept-Ranges assertion to accept
> the expose-headers declaration as equivalent.

Without env vars the script prints the full manual checklist and exits 0
(`SKIPPED`).

---

## Step 7 — Vercel project setup

### 7a. Connect project

```bash
vercel link
# → Set up and deploy → Y
# → Which scope: andes.lee444@gmail.com
# → Found existing project? No → Create new project
# → Project name: govbudget (or govbudget-site)
```

### 7b. Configure Root Directory

In the Vercel dashboard → Project Settings → General:

- **Root Directory:** `GovBudget/site`
  (Vercel builds from here; `next.config.ts` is at this level)
- **Framework:** Next.js (auto-detected)
- **Build Command:** (leave default — `npm run build`)
- **Output Directory:** `out`

### 7c. Set environment variables

```bash
vercel env add NEXT_PUBLIC_SITE_URL production
# value: https://govbudget-xyz.vercel.app
```

Add the same for `preview` and `development` environments as needed.

### 7d. Deploy

```bash
vercel --prod
```

Vercel builds the site in its cloud environment.  The first deploy establishes
the `*.vercel.app` URL.  Once you have the stable production URL, re-run
steps 2 and 5 with that URL if it differs from what you used in step 2.

---

## Step 8 — Smoke checks

After deployment, verify the following manually:

### 8a. Citation panel — PDF from R2

1. Open a program page, e.g. `/program/0400D/`
2. Click any cited figure (blue badge)
3. The PDF.js panel should open and scroll to the highlighted excerpt
4. Network tab: PDF request goes to `pub-<hash>.r2.dev` (not Vercel)
5. No CORS errors in the browser console

### 8b. Explorer query (DuckDB-WASM)

1. Navigate to `/data/`
2. Run a simple query: `SELECT count(*) FROM dim_entities`
3. Result should appear within 2–3 seconds (first load fetches WASM)
4. Run a query referencing a Parquet file:
   `SELECT * FROM 'citations/citations.parquet' LIMIT 5`
5. Expect rows returned — this proves R2 CORS is working for data files

### 8c. Downloads page

1. Navigate to `/downloads/`
2. Verify all download cards show data-driven counts (no hardcoded "44,754")
3. Click "citations.parquet" download link — URL should be
   `/citations/citations.parquet` (not `/data/citations.parquet`)
4. Confirm the file downloads from R2

---

## Step 9 — Unblock the API-key pair

Two commands require `ANTHROPIC_API_KEY` to run live.  Without it both
commands report `BLOCKED` (not `FAIL`) and exit with code 2.

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Submit the dossier batch (cost-capped ≤ $50):
govbudget dossiers submit

# Run the full verify-phase5 gate suite (NL eval ≥ 90%):
govbudget verify-phase5
```

Expected terminal state after both complete:
- `verify-phase5: PASS` (or `exit 2` if all gates pass but dossier batch is
  still running — run `govbudget dossiers collect` after the batch ends and
  re-run `verify-phase5`)
- `dossier_gate: PASS`

---

## Service J-books (Phase 5G) — Navy automated, Army/AF manual

Beyond the defense-wide comptroller books, the site ingests the military
services' own R&D and procurement justification books. Access differs per
service (probe evidence: `docs/superpowers/reviews/5g-probe/PROBE-REPORT.md`):

| Service | Path | Why |
|---|---|---|
| **Navy** | automated (`jbooks backfill --service navy`) | reachable via headless Chromium; the `/fmc` bot-WAF does not block a real browser |
| **Army** | **manual** (`jbooks ingest-local --service army`) | Akamai edge WAF returns **403 to headless Chromium** at every entry point — a finding, not a challenge. No stealth/evasion transport is built or permitted. |
| **Air Force** | **manual** (`jbooks ingest-local --service af`) | CAC-gated; no anonymous automated fetch |

### Navy — automated backfill

```bash
govbudget jbooks backfill --fiscal-year 2026 --service navy
```

This Playwright-fetches the FY2026 Navy index
(`https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/`), builds a download
plan, and:

- classifies each PDF via the Navy appropriation-code allowlist (`NAVY_NAMES`
  in `registry.py`): 5 RDTEN + 12 procurement books → `(family, org='N')`;
- **de-duplicates the RDTE BA-splits** — the five `RDTEN_BA*_Book.pdf` files
  each embed the SAME full 252-PE master book, so only the lowest-BA volume
  (`RDTEN_BA1-3_Book.pdf`) registers; the other four are recorded in the
  edition manifest under `services.navy_2026.exclusions`
  (rule `rdte-ba-split-duplicate`);
- excludes the 19 non-justification volumes (O&M / MilPers / MilCon / BRAC /
  working-capital / overview), rule `non-justification-appropriation`;
- registers each keeper with `acquisition='playwright'`, downloads through the
  browser context (sha256 + size verified, 2–4 s throttle, **resume-safe** —
  a re-run skips books already `downloaded`), then runs the standard
  extract → reconcile scoped to org `N`.

### Army / Air Force — manual drop-dir

A human with normal browser (or CAC) access downloads the service's R&D and
procurement justification PDFs to a directory, then:

```bash
govbudget jbooks ingest-local \
  --service army --fiscal-year 2026 \
  --source-url "https://www.asafm.army.mil/Budget-Materials/Budget2026/" \
  /path/to/army-drop-dir
```

Every classifiable PDF in the directory is registered with
`acquisition='manual'` and the operator-supplied `--source-url` (recorded on
each document for provenance; a per-file `#<basename>` fragment keeps rows
distinct under one URL). PDFs the classifier cannot place are **reported, not
registered** — the operator sees exactly what was skipped. `--service`,
`--source-url`, and the directory argument are all required.

> Army routes here because its Akamai policy blocks even a real headless
> browser. Do **not** attempt a stealth transport (undetected-chromedriver,
> real-Chrome CDP attach, residential egress) without an explicit human
> decision — a WAF that blocks a normal browser is a finding, not a challenge.

---

## Step 10 — Domain cutover (TABLED)

Domain selection is tabled.  Current shortlist: `outlays.us`,
`fiscalreceipts.com`.

When a domain is chosen:

1. Add it to Vercel: Project Settings → Domains → Add
2. Update DNS at registrar (CNAME → `cname.vercel-dns.com`)
3. Wait for SSL provisioning (usually < 5 min)
4. Re-run step 5 with the custom domain as `assetBaseUrl` if the R2 bucket
   is also being served via a custom subdomain
5. Re-run step 4b (CORS policy) with the new origin
6. Re-run step 7c to update `NEXT_PUBLIC_SITE_URL`
7. Redeploy: `vercel --prod`
8. Re-run step 6 (CORS live test) with the new domain

---

## Quick reference — all commands

```bash
# 1. Export
govbudget export-site

# 2. Build
NEXT_PUBLIC_SITE_URL=https://govbudget-xyz.vercel.app \
  bash -c 'cd site && npm run build'

# 3. Gate
govbudget verify-phase5b1

# 4. Upload (dry-run first)
./scripts/launch/upload_r2.sh
./scripts/launch/upload_r2.sh --live

# 5. Rewrite config
node scripts/launch/rewrite-config.mjs https://pub-<hash>.r2.dev

# 6. CORS test
R2_HOST=https://pub-<hash>.r2.dev \
SITE_URL=https://govbudget-xyz.vercel.app \
  ./scripts/launch/cors_live_test.sh

# 7. Deploy
vercel --prod

# 9. Unblock
export ANTHROPIC_API_KEY=sk-ant-...
govbudget dossiers submit
govbudget verify-phase5
```
