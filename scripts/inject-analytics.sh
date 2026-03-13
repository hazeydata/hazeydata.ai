#!/bin/bash
# Inject Cloudflare Web Analytics beacon into all HTML files
# Usage: ./scripts/inject-analytics.sh <CF_BEACON_TOKEN>
#
# To get the token:
# 1. Go to https://dash.cloudflare.com → Web Analytics
# 2. Add site: hazeydata.ai
# 3. Copy the beacon token from the JS snippet
#
# This script is idempotent — it won't double-inject.

TOKEN="${1:?Usage: $0 <cloudflare-beacon-token>}"
SNIPPET="<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"${TOKEN}\"}'></script><!-- End Cloudflare Web Analytics -->"

SITE_DIR="$(dirname "$0")/.."
cd "$SITE_DIR" || exit 1

count=0
for f in *.html blog/*.html; do
    [ -f "$f" ] || continue
    # Skip if already has beacon
    if grep -q "cloudflareinsights" "$f"; then
        echo "SKIP (already has analytics): $f"
        continue
    fi
    # Inject before </body>
    if grep -q "</body>" "$f"; then
        sed -i "s|</body>|${SNIPPET}\n</body>|" "$f"
        echo "INJECTED: $f"
        ((count++))
    else
        echo "WARN (no </body> tag): $f"
    fi
done

echo ""
echo "Done. Injected analytics into $count files."
echo "Commit and push to deploy: git add -A && git commit -m 'Add Cloudflare Web Analytics' && git push"
