#!/usr/bin/env bash
# deploy.sh — the ONLY deploy path for Fiscal Receipts.
#
# THIS SCRIPT IS THE SOURCE OF TRUTH.  docs/superpowers/LAUNCH.md §7d points
# here; it does not restate the commands.  If you find yourself typing
# `vercel --prod` by hand, that is the bug this script exists to fix.
#
# WHY IT EXISTS (ROADMAP backlog #27).  The deploy drill used to be "rebuild,
# then `vercel --prod`", and the R2 sync was a separate thing someone had to
# remember.  Nobody remembered it, so the PDF binaries for every post-launch
# ingestion phase were missing from the CDN and every citation panel on the new
# pages silently fell back to "open official source".  It ran that way in
# production until the 2026-07-04 catch, and no gate noticed, because no gate
# could: the property is production CDN state.  Binding the two steps into one
# command is the fix, and the post-deploy check at the end is the alarm.
#
# ORDER IS DELIBERATE: assets FIRST, pages SECOND.  upload_r2.sh never deletes,
# so syncing early is safe; deploying pages before their assets exist opens a
# window in which live pages cite binaries that are not there yet.
#
# USAGE
#   ./scripts/launch/deploy.sh                # sync R2, deploy prod, verify live
#   ./scripts/launch/deploy.sh --dry-run      # print every step, change nothing
#   ./scripts/launch/deploy.sh --skip-r2      # pages-only redeploy (no new assets)
#   ./scripts/launch/deploy.sh --no-verify    # skip the post-deploy check (discouraged)
#
# PREREQUISITES
#   - `site/out/` built and current:
#       cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
#     Vercel does NOT build this site.  See the note on --archive/cwd below.
#   - rclone configured with an `r2` remote (see upload_r2.sh --help)
#   - `vercel` CLI logged in
#
# ENVIRONMENT
#   VERCEL_PROJECT_ID / VERCEL_ORG_ID  defaulted below; `site/out/` carries no
#                                      `.vercel/` link (each build wipes it),
#                                      so the IDs go in as env vars.
#   R2_BUCKET                          passed through to upload_r2.sh
#   ASSET_BASE_URL / SITE_URL          passed through to verify_live_assets.mjs
#
# EXIT CODES
#   0  deployed and verified
#   1  a step failed (nothing further runs)
#   2  preflight failed — nothing was uploaded or deployed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_OUT="${REPO_ROOT}/site/out"

# Vercel project identity.  These are project identifiers, not secrets, and
# they are already recorded in LAUNCH.md; override via env for another project.
VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_oen0seknELM3lK6UcZPS5252D7QD}"
VERCEL_ORG_ID="${VERCEL_ORG_ID:-team_b94lNMYEXzNevW7VmSNvdeYZ}"

DRY_RUN=0
SKIP_R2=0
VERIFY=1

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --skip-r2)    SKIP_R2=1 ;;
    --no-verify)  VERIFY=0 ;;
    --help|-h)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      echo "USAGE: $0 [--dry-run] [--skip-r2] [--no-verify]" >&2
      exit 2
      ;;
  esac
done

step() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  $*"
  echo "═══════════════════════════════════════════════════════════════════"
}

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    "$@"
  fi
}

# ── Preflight ────────────────────────────────────────────────────────────────
step "0/3  preflight"

fail_preflight() { echo "ERROR: $*" >&2; exit 2; }

command -v vercel >/dev/null 2>&1 || fail_preflight "vercel CLI not found (npm i -g vercel)"
command -v node   >/dev/null 2>&1 || fail_preflight "node not found"

[[ -d "$SITE_OUT" ]] || fail_preflight \
  "site/out/ not found. Build first:
     cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build"

[[ -f "${SITE_OUT}/index.html" ]] || fail_preflight \
  "site/out/index.html missing — the export did not finish. Rebuild."

# The /fact/{id} permalink rewrite lives in site/out/vercel.json.  Deploying a
# directory without it produces a site that 404s every permalink, silently.
[[ -f "${SITE_OUT}/vercel.json" ]] || fail_preflight \
  "site/out/vercel.json missing — the /fact/ rewrite would silently die.
   Check site/scripts/prepare-assets.mjs and rebuild."

if [[ "$SKIP_R2" -eq 0 ]]; then
  command -v rclone >/dev/null 2>&1 || fail_preflight \
    "rclone not found (brew install rclone). Pass --skip-r2 only if you are
     certain no asset changed since the last deploy."
  [[ -d "${REPO_ROOT}/data/site/pdfs" ]] || fail_preflight \
    "data/site/pdfs/ not found — run \`govbudget export-site\` first."
fi

FILE_COUNT="$(find "$SITE_OUT" -type f | wc -l | tr -d ' ')"
echo "  site/out/:       ${FILE_COUNT} files"
echo "  vercel project:  ${VERCEL_PROJECT_ID}"
if [[ "$SKIP_R2" -eq 1 ]]; then
  echo "  R2 sync:         SKIPPED (--skip-r2)"
else
  PDF_COUNT="$(find "${REPO_ROOT}/data/site/pdfs" -name '*.pdf' | wc -l | tr -d ' ')"
  echo "  R2 pdfs:         ${PDF_COUNT} binaries to sync"
fi
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo ""
  echo "  DRY RUN — the steps below are printed, not executed."
fi

# ── 1. R2 sync ───────────────────────────────────────────────────────────────
# Assets before pages: upload_r2.sh never deletes, so an early sync is safe,
# while deploying first would publish pages citing binaries that do not exist.
if [[ "$SKIP_R2" -eq 0 ]]; then
  step "1/3  sync assets to R2 (pdfs, data, workbooks, citations)"
  run "${REPO_ROOT}/scripts/launch/upload_r2.sh" --live
else
  step "1/3  R2 sync SKIPPED (--skip-r2)"
fi

# ── 2. Vercel ────────────────────────────────────────────────────────────────
# Both the working directory and the flag are load-bearing:
#
#   cwd = site/out/, never site/.  Vercel does not build this site in the
#   cloud; it serves the prebuilt static export.  From site/ it would run
#   `npm run build`, whose prebuild reads data/site/json/site_meta.json — a
#   path outside site/ that is never uploaded — and die with
#   "FATAL: data/site/json/site_meta.json not found."
#
#   --archive=tgz.  The default per-file upload sends a JSON manifest of every
#   file; at ~89.5k files that exceeds Vercel's 10 MB request limit and fails
#   with "Request body too large" BEFORE anything uploads.  Required since
#   2026-08-05 (the same deploy succeeded on the manifest path 15 h earlier,
#   so the limit tightened server-side).  Retrying, upgrading the CLI, and
#   .vercelignore all do not help.
step "2/3  deploy site/out/ to Vercel production"
echo "+ cd ${SITE_OUT} && VERCEL_PROJECT_ID=… VERCEL_ORG_ID=… vercel --prod --yes --archive=tgz"
if [[ "$DRY_RUN" -eq 0 ]]; then
  (
    cd "$SITE_OUT"
    VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID" \
    VERCEL_ORG_ID="$VERCEL_ORG_ID" \
      vercel --prod --yes --archive=tgz
  )
fi

# ── 3. Post-deploy verification ──────────────────────────────────────────────
# The alarm for the defect this script exists to prevent.  A missing-from-CDN
# PDF now fails HERE instead of failing a reader six weeks later.
if [[ "$VERIFY" -eq 1 ]]; then
  step "3/3  verify live assets (the backlog-#27 alarm)"
  run node "${REPO_ROOT}/scripts/launch/verify_live_assets.mjs"
else
  step "3/3  post-deploy verification SKIPPED (--no-verify)"
  echo "  Run it manually: node scripts/launch/verify_live_assets.mjs"
fi

echo ""
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run complete — nothing was uploaded or deployed."
else
  echo "Deploy complete: assets synced, site/out/ live, live assets verified."
fi
