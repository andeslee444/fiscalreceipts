#!/usr/bin/env bash
# upload_r2.sh — sync GovBudget static assets to Cloudflare R2 via rclone.
#
# USAGE:
#   ./scripts/launch/upload_r2.sh [--live]
#
# By default this is a DRY RUN — no files are transferred.  Pass --live to
# actually upload.
#
# PREREQUISITES:
#   1. Install rclone:
#        brew install rclone
#
#   2. Configure an rclone remote named "r2" pointing at your Cloudflare R2
#      bucket (the remote name is controlled by RCLONE_REMOTE below).
#      Quick-start — run once, then follow the interactive wizard:
#        rclone config
#      Choose "New remote" → name it "r2" → provider "S3 Compatible" →
#      access_key_id / secret_access_key from the R2 API tokens page →
#      endpoint "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
#      (Leave region blank; no ACL needed for R2.)
#
#   3. Set R2_BUCKET to your bucket name (env var or edit the default below).
#
# WHAT IS SYNCED:
#   data/site/pdfs/       → r2:<bucket>/pdfs/       (~149 MB)
#   data/site/data/       → r2:<bucket>/data/        (~3.2 MB)
#   data/site/workbooks/  → r2:<bucket>/workbooks/   (~1.2 MB)
#   data/site/citations/  → r2:<bucket>/citations/   (~1 MB)
#
# Sync is idempotent: rclone compares checksums and only transfers changed
# files.  Destination objects NOT present in the source are preserved (no
# --delete flag) so accidental partial runs are safe.
#
# EXIT CODES:
#   0  success (or dry-run completed)
#   1  missing dependency / missing env / rclone error

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RCLONE_REMOTE="${RCLONE_REMOTE:-r2}"
R2_BUCKET="${R2_BUCKET:-govbudget-assets}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_SITE="${REPO_ROOT}/data/site"

# ── Flags ─────────────────────────────────────────────────────────────────────
LIVE=0
for arg in "$@"; do
  case "$arg" in
    --live) LIVE=1 ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      echo "USAGE: $0 [--live]" >&2
      exit 1
      ;;
  esac
done

# ── Dependency check ──────────────────────────────────────────────────────────
if ! command -v rclone &>/dev/null; then
  echo "ERROR: rclone not found." >&2
  echo "" >&2
  echo "Install with:" >&2
  echo "  brew install rclone" >&2
  echo "" >&2
  echo "Then configure an R2 remote:" >&2
  echo "  rclone config" >&2
  exit 1
fi

# ── Source directory check ────────────────────────────────────────────────────
if [[ ! -d "$DATA_SITE" ]]; then
  echo "ERROR: data/site/ not found at: $DATA_SITE" >&2
  echo "Run export-site first:  govbudget export-site" >&2
  exit 1
fi

# ── Folders to sync ──────────────────────────────────────────────────────────
declare -a FOLDERS=("pdfs" "data" "workbooks" "citations")

for folder in "${FOLDERS[@]}"; do
  src="${DATA_SITE}/${folder}"
  if [[ ! -d "$src" ]]; then
    echo "WARNING: source folder not found, skipping: $src" >&2
  fi
done

# ── Run ───────────────────────────────────────────────────────────────────────
DRY_FLAG=""
if [[ "$LIVE" -eq 0 ]]; then
  DRY_FLAG="--dry-run"
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  DRY RUN — no files will be transferred."
  echo "  Pass --live to perform the actual upload."
  echo "═══════════════════════════════════════════════════════════════════"
fi

echo ""
echo "Remote:  ${RCLONE_REMOTE}:${R2_BUCKET}"
echo "Source:  ${DATA_SITE}"
echo ""

EXIT_CODE=0
for folder in "${FOLDERS[@]}"; do
  src="${DATA_SITE}/${folder}/"
  dst="${RCLONE_REMOTE}:${R2_BUCKET}/${folder}/"

  if [[ ! -d "${DATA_SITE}/${folder}" ]]; then
    echo "  SKIP  ${folder}/ (directory not found)"
    continue
  fi

  echo "  SYNC  ${folder}/ → ${RCLONE_REMOTE}:${R2_BUCKET}/${folder}/"
  # shellcheck disable=SC2086
  rclone sync \
    $DRY_FLAG \
    --progress \
    --checksum \
    --transfers 8 \
    --checkers 16 \
    "$src" "$dst" || { echo "  ERROR syncing $folder/" >&2; EXIT_CODE=1; }
done

echo ""
if [[ "$LIVE" -eq 0 ]]; then
  echo "Dry run complete. Re-run with --live to upload."
else
  if [[ "$EXIT_CODE" -eq 0 ]]; then
    echo "Upload complete."
  else
    echo "Upload finished with errors (see above)."
  fi
fi

exit "$EXIT_CODE"
