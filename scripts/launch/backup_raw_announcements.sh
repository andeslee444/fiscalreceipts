#!/usr/bin/env bash
# Backs up data/raw/announcements (sha256-manifested, git-ignored) to R2 under
# research/announcements-raw/. Idempotent; uses the same rclone remote as upload_r2.sh.
set -euo pipefail
BUCKET="${R2_BUCKET:-govbudget-assets}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)/data/raw/announcements"
[ -f "$SRC/manifest.jsonl" ] || { echo "no manifest at $SRC/manifest.jsonl"; exit 1; }
rclone copy "$SRC" "r2:$BUCKET/research/announcements-raw" --checksum --transfers 8 -P
# verify: every manifest entry exists remotely by name
python3 - "$SRC" "$BUCKET" <<'EOF'
import json, subprocess, sys
# Read JSONL manifest and extract article_ids (which are local filenames like 1000857.html)
article_ids = set()
with open(sys.argv[1] + "/manifest.jsonl") as f:
  for line in f:
    record = json.loads(line)
    article_ids.add(record["article_id"] + ".html")
# Also add the other files in the directory
article_ids.update(["enumeration.json", "manifest.jsonl"])
# List remote files
bucket = sys.argv[2]
remote = set(subprocess.check_output(["rclone", "lsf", f"r2:{bucket}/research/announcements-raw", "-R"]).decode().split())
missing = sorted([k for k in article_ids if k not in remote])
print("manifest entries:", len(article_ids), "missing remotely:", len(missing))
if missing:
  print("Missing files:", missing[:10])
sys.exit(1 if missing else 0)
EOF
