#!/usr/bin/env bash
# cors_live_test.sh — validate CORS headers on the live R2 bucket.
#
# USAGE:
#   R2_HOST=https://pub-xxx.r2.dev SITE_URL=https://your.vercel.app \
#     ./scripts/launch/cors_live_test.sh
#
# ENVIRONMENT:
#   R2_HOST    — base URL of your R2 public bucket (no trailing slash)
#                e.g. https://pub-abc123.r2.dev
#   SITE_URL   — deployed site origin (used as the Origin header)
#                e.g. https://govbudget.vercel.app
#
# If either variable is absent, the script prints the full test checklist and
# exits 0 with a SKIPPED banner so CI stays green before credentials exist.
#
# WHAT IS TESTED:
#   1. OPTIONS preflight on a known PDF path:
#        - Sends Origin: $SITE_URL
#        - Expects 200 or 204 status
#        - Access-Control-Allow-Origin echoes $SITE_URL  (ACAO echo)
#        - Access-Control-Allow-Headers contains "range" (case-insensitive)
#
#   2. Ranged GET on the same PDF path:
#        - Sends Origin: $SITE_URL  +  Range: bytes=0-1023
#        - Expects 206 Partial Content
#        - Access-Control-Allow-Origin echoes $SITE_URL  (ACAO echo)
#        - Content-Range header present
#        - Accept-Ranges header present
#
# EXIT CODES:
#   0  all assertions passed (or SKIPPED — no env)
#   1  one or more assertions failed

set -euo pipefail

# ── SKIPPED banner ────────────────────────────────────────────────────────────
if [[ -z "${R2_HOST:-}" ]] || [[ -z "${SITE_URL:-}" ]]; then
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  CORS LIVE TEST — SKIPPED (no credentials)                      ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Set both env vars to run live assertions:"
  echo "  R2_HOST   — R2 public bucket base URL (e.g. https://pub-xxx.r2.dev)"
  echo "  SITE_URL  — deployed site origin       (e.g. https://yoursite.vercel.app)"
  echo ""
  echo "Full checklist (manual fallback):"
  echo ""
  echo "  ┌─ 1. OPTIONS preflight ──────────────────────────────────────────"
  echo "  │  curl -si -X OPTIONS \\"
  echo "  │    -H 'Origin: \$SITE_URL' \\"
  echo "  │    -H 'Access-Control-Request-Method: GET' \\"
  echo "  │    -H 'Access-Control-Request-Headers: range' \\"
  echo "  │    \$R2_HOST/pdfs/<any-pdf-key>"
  echo "  │"
  echo "  │  Expected:"
  echo "  │    HTTP/2 200 or 204"
  echo "  │    access-control-allow-origin: \$SITE_URL   (echo of Origin)"
  echo "  │    access-control-allow-headers: (contains) range"
  echo "  │"
  echo "  ├─ 2. Ranged GET ─────────────────────────────────────────────────"
  echo "  │  curl -si -X GET \\"
  echo "  │    -H 'Origin: \$SITE_URL' \\"
  echo "  │    -H 'Range: bytes=0-1023' \\"
  echo "  │    \$R2_HOST/pdfs/<any-pdf-key>"
  echo "  │"
  echo "  │  Expected:"
  echo "  │    HTTP/2 206"
  echo "  │    access-control-allow-origin: \$SITE_URL   (echo of Origin)"
  echo "  │    content-range: bytes 0-1023/<total>"
  echo "  │    accept-ranges: bytes"
  echo "  └──────────────────────────────────────────────────────────────────"
  echo ""
  echo "Apply CORS policy with wrangler (after substituting SITE_URL):"
  echo "  envsubst < scripts/launch/cors-policy.json > /tmp/cors.json"
  echo "  wrangler r2 bucket cors put \$R2_BUCKET --rules /tmp/cors.json"
  echo ""
  echo "SKIPPED"
  exit 0
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
FAIL_COUNT=0

fail() {
  echo "  FAIL: $*" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

pass() {
  echo "  PASS: $*"
}

header_value() {
  # Extract value of a response header (case-insensitive).
  # $1 = header name (lowercase), $2 = full response headers string
  echo "$2" | grep -i "^$1:" | head -1 | sed 's/^[^:]*: *//' | tr -d '\r'
}

status_code() {
  # Extract HTTP status code from the first status line.
  echo "$1" | grep -m1 "^HTTP" | awk '{print $2}'
}

# ── Find a probe path ─────────────────────────────────────────────────────────
# Use the first PDF listed in data/site/pdfs/ if we have access, otherwise
# fall back to a well-known fixture path.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE_PATH=""
PDF_DIR="${REPO_ROOT}/data/site/pdfs"

if [[ -d "$PDF_DIR" ]]; then
  first_pdf=$(find "$PDF_DIR" -maxdepth 1 -name "*.pdf" -print -quit 2>/dev/null || true)
  if [[ -n "$first_pdf" ]]; then
    PROBE_PATH="/pdfs/$(basename "$first_pdf")"
  fi
fi

# Fallback: try a path that should always exist after upload
if [[ -z "$PROBE_PATH" ]]; then
  # Use a data file which is smaller and always present
  PROBE_PATH="/data/site_meta.json"
fi

R2_HOST="${R2_HOST%/}"  # strip trailing slash
PROBE_URL="${R2_HOST}${PROBE_PATH}"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  CORS LIVE TEST                                                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  R2_HOST:   $R2_HOST"
echo "  SITE_URL:  $SITE_URL"
echo "  Probe URL: $PROBE_URL"
echo ""

# ── Test 1: OPTIONS preflight ─────────────────────────────────────────────────
echo "── 1. OPTIONS preflight ──────────────────────────────────────────────────"

preflight_response=$(curl --silent --include \
  --max-time 15 \
  -X OPTIONS \
  -H "Origin: ${SITE_URL}" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: range" \
  "${PROBE_URL}" 2>&1) || {
  fail "curl failed for OPTIONS request"
  echo ""
  echo "FAILED"
  exit 1
}

pre_status=$(status_code "$preflight_response")
pre_acao=$(header_value "access-control-allow-origin" "$preflight_response")
pre_acah=$(header_value "access-control-allow-headers" "$preflight_response")

# Status: 200 or 204
if [[ "$pre_status" == "200" ]] || [[ "$pre_status" == "204" ]]; then
  pass "status $pre_status"
else
  fail "expected 200 or 204, got: $pre_status"
fi

# ACAO echo
if [[ "$pre_acao" == "$SITE_URL" ]]; then
  pass "Access-Control-Allow-Origin echoes SITE_URL: $pre_acao"
else
  fail "Access-Control-Allow-Origin: expected '$SITE_URL', got '${pre_acao:-<absent>}'"
fi

# Allow-Headers contains "range"
pre_acah_lower=$(echo "$pre_acah" | tr '[:upper:]' '[:lower:]')
if echo "$pre_acah_lower" | grep -q "range"; then
  pass "Access-Control-Allow-Headers contains 'range': $pre_acah"
else
  fail "Access-Control-Allow-Headers missing 'range': got '${pre_acah:-<absent>}'"
fi

echo ""

# ── Test 2: Ranged GET ────────────────────────────────────────────────────────
echo "── 2. Ranged GET ─────────────────────────────────────────────────────────"

ranged_response=$(curl --silent --include \
  --max-time 30 \
  -X GET \
  -H "Origin: ${SITE_URL}" \
  -H "Range: bytes=0-1023" \
  "${PROBE_URL}" 2>&1) || {
  fail "curl failed for ranged GET request"
  echo ""
  echo "FAILED"
  exit 1
}

get_status=$(status_code "$ranged_response")
get_acao=$(header_value "access-control-allow-origin" "$ranged_response")
get_cr=$(header_value "content-range" "$ranged_response")
get_ar=$(header_value "accept-ranges" "$ranged_response")

# Status: 206
if [[ "$get_status" == "206" ]]; then
  pass "status 206 Partial Content"
else
  fail "expected 206, got: $get_status"
fi

# ACAO echo
if [[ "$get_acao" == "$SITE_URL" ]]; then
  pass "Access-Control-Allow-Origin echoes SITE_URL: $get_acao"
else
  fail "Access-Control-Allow-Origin: expected '$SITE_URL', got '${get_acao:-<absent>}'"
fi

# Content-Range present
if [[ -n "$get_cr" ]]; then
  pass "Content-Range: $get_cr"
else
  fail "Content-Range header absent"
fi

# Accept-Ranges present
if [[ -n "$get_ar" ]]; then
  pass "Accept-Ranges: $get_ar"
else
  fail "Accept-Ranges header absent"
fi

echo ""

# ── Result ────────────────────────────────────────────────────────────────────
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "All CORS assertions passed."
  exit 0
else
  echo "FAILED — $FAIL_COUNT assertion(s) failed." >&2
  exit 1
fi
