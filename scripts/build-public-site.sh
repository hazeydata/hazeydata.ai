#!/usr/bin/env bash
# Build the publishable site into an output dir (default: ./dist) from tracked files only.
# Usage: scripts/build-public-site.sh [OUT_DIR]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-dist}"

if [ "$OUT" = "dist" ]; then
  rm -rf dist
elif [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "error: output dir '$OUT' exists and is not empty" >&2
  exit 1
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# Filter tracked paths in one pass, then copy with tar (fast on ~14k files).
list="$(mktemp)"
trap 'rm -f "$list"' EXIT
git ls-files -z | python3 -c '
import sys
skip_top = ("scripts/", "tests/", "migrations/", "functions/", "node_modules/", "scheduled/")
for f in sys.stdin.buffer.read().split(b"\0"):
    if not f:
        continue
    s = f.decode()
    parts = s.split("/")
    if any(p.startswith(".") for p in parts): continue          # dotfiles/dirs (.wrangler, .github)
    if s.startswith(skip_top): continue
    if "docs" in parts[:-1] or "node_modules" in parts[:-1]: continue  # any depth
    if s.endswith(".md") or parts[-1] in ("package.json", "package-lock.json"): continue
    sys.stdout.buffer.write(f + b"\0")
' > "$list"
tar --null -T "$list" -cf - | tar -xf - -C "$OUT"
count="$(tr -cd '\0' < "$list" | wc -c)"
echo "Built $count files into $OUT"
