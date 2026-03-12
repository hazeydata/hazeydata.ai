#!/usr/bin/env bash
# generate-sitemap.sh — Auto-generate sitemap.xml from all published pages
#
# Scans HTML files, extracts publish dates, writes sitemap.xml
# Excludes: drafts/, login.html, signup.html, 404.html
#
# Usage: bash scripts/generate-sitemap.sh

set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="https://hazeydata.ai"
SITEMAP="sitemap.xml"
TODAY=$(date +%Y-%m-%d)

# Start XML
cat > "$SITEMAP" << 'HEADER'
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
HEADER

# Helper: add a URL entry
add_url() {
    local loc="$1"
    local lastmod="$2"
    local priority="$3"
    cat >> "$SITEMAP" << EOF
    <url>
        <loc>${DOMAIN}${loc}</loc>
        <lastmod>${lastmod}</lastmod>
        <priority>${priority}</priority>
    </url>
EOF
}

# Static pages
add_url "/" "$TODAY" "1.0"
add_url "/blog/" "$TODAY" "0.9"
add_url "/bio.html" "2026-02-27" "0.6"
add_url "/contact.html" "2026-02-27" "0.5"
add_url "/subscribe.html" "2026-02-27" "0.5"
add_url "/year-view.html" "$TODAY" "0.7"

# Blog posts — scan all HTML files except index.html
BLOG_COUNT=0
for f in blog/*.html; do
    filename=$(basename "$f")
    [[ "$filename" == "index.html" ]] && continue
    [[ "$filename" == "blog.css" ]] && continue

    # Extract date from the post metadata (e.g., "March 3, 2026")
    raw_date=$(grep -oP '<span>\K[A-Z][a-z]+ [0-9]+, [0-9]+' "$f" 2>/dev/null | head -1)
    
    if [[ -n "$raw_date" ]]; then
        # Convert "March 3, 2026" to "2026-03-03"
        lastmod=$(date -d "$raw_date" +%Y-%m-%d 2>/dev/null || echo "$TODAY")
    else
        # Fallback to file modification time
        lastmod=$(date -r "$f" +%Y-%m-%d 2>/dev/null || echo "$TODAY")
    fi

    add_url "/blog/${filename}" "$lastmod" "0.8"
    BLOG_COUNT=$((BLOG_COUNT + 1))
done

# Close XML
echo "</urlset>" >> "$SITEMAP"

echo "✅ Sitemap generated: $SITEMAP"
echo "   Static pages: 6"
echo "   Blog posts: $BLOG_COUNT"
echo "   Total URLs: $((6 + BLOG_COUNT))"
